"""Privacy-conscious face continuity checks for interview recordings.

This module provides a lightweight *prototype* continuity check. It answers
only: "does the face in this recording look consistent with the face enrolled
from the self-introduction video?" It does not establish a person's legal
identity and deliberately performs no emotion, age, gender, ethnicity, or
other demographic inference.

The stored reference is a compact HOG/DCT feature vector rather than a frame or
face image. It is still biometric data and should therefore be access
controlled, encrypted at rest, and deleted according to the application's
retention policy.
"""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Sequence

from pydantic import BaseModel, Field


IdentityStatus = Literal["Verified", "Rejected", "Needs Review"]

REFERENCE_VERSION = "prototype-face-continuity-v1"
DEFAULT_MATCH_THRESHOLD = 0.68
DEFAULT_REJECT_THRESHOLD = 0.52
MIN_ENROLLMENT_FACE_RATIO = 0.65
MIN_VERIFICATION_FACE_RATIO = 0.50
MIN_USABLE_ENROLLMENT_FRAMES = 6
MIN_USABLE_VERIFICATION_FRAMES = 3
MIN_ENROLLMENT_CONSISTENCY = 0.58
DEFAULT_SAMPLE_COUNT = 12
MIN_MULTI_FACE_FRAMES = 2
MIN_MULTI_FACE_FRAME_RATIO = 0.15
MIN_SECONDARY_FACE_AREA_RATIO = 0.20


class IdentityVerificationError(RuntimeError):
    """Raised only when a video cannot be read or vision support is unavailable."""


class IdentityEnrollmentResult(BaseModel):
    status: IdentityStatus
    face_count: int = Field(ge=0)
    sampled_frames: int = Field(ge=0)
    usable_face_frames: int = Field(ge=0)
    reference: dict[str, Any] = Field(default_factory=dict)
    review_reason: str | None = None


class IdentityVerificationResult(BaseModel):
    status: IdentityStatus
    face_count: int = Field(ge=0)
    sampled_frames: int = Field(ge=0)
    usable_face_frames: int = Field(ge=0)
    similarity_score: float | None = Field(default=None, ge=0.0, le=1.0)
    review_reason: str | None = None


@dataclass(frozen=True)
class _VideoFaceObservations:
    signatures: list[list[float]]
    sampled_frames: int
    max_face_count: int
    multi_face_frames: int


def has_repeated_multi_face_evidence(
    multi_face_frames: int,
    sampled_frames: int,
) -> bool:
    """Require repeated detections before rejecting a recording.

    Haar cascades can occasionally classify posters, reflections, or high-
    contrast objects as a second face. A real additional person should remain
    visible in more than one of the frames sampled across the recording.
    """
    required_frames = max(
        MIN_MULTI_FACE_FRAMES,
        math.ceil(sampled_frames * MIN_MULTI_FACE_FRAME_RATIO),
    )
    return multi_face_frames >= required_frames


def cosine_similarity(
    left: Sequence[float],
    right: Sequence[float],
) -> float:
    """Return a stable 0..1 similarity value for two equal-length signatures."""

    if not left or len(left) != len(right):
        return 0.0

    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    if left_norm <= 1e-12 or right_norm <= 1e-12:
        return 0.0

    score = sum(a * b for a, b in zip(left, right)) / (left_norm * right_norm)
    return round(max(0.0, min(1.0, float(score))), 6)


def aggregate_face_signatures(
    signatures: Sequence[Sequence[float]],
) -> list[float]:
    """Build a normalized median signature from compatible frame signatures.

    The function is intentionally independent of OpenCV so unit tests can
    exercise comparison and threshold behavior without loading video codecs.
    """

    usable = [list(signature) for signature in signatures if signature]
    if not usable:
        return []

    feature_count = len(usable[0])
    usable = [signature for signature in usable if len(signature) == feature_count]
    if not usable:
        return []

    aggregate = [
        statistics.median(signature[index] for signature in usable)
        for index in range(feature_count)
    ]
    norm = math.sqrt(sum(value * value for value in aggregate))
    if norm <= 1e-12:
        return []
    return [round(value / norm, 6) for value in aggregate]


def compare_face_signatures(
    reference_signature: Sequence[float],
    candidate_signatures: Sequence[Sequence[float]],
) -> float | None:
    """Compare a reference with a recording using the median frame similarity."""

    scores = [
        cosine_similarity(reference_signature, candidate)
        for candidate in candidate_signatures
        if candidate and len(candidate) == len(reference_signature)
    ]
    if not scores:
        return None
    return round(float(statistics.median(scores)), 4)


def build_face_reference(
    signatures: Sequence[Sequence[float]],
    *,
    match_threshold: float = DEFAULT_MATCH_THRESHOLD,
    reject_threshold: float = DEFAULT_REJECT_THRESHOLD,
) -> dict[str, Any]:
    """Create the JSON-serializable biometric template stored after enrollment."""

    aggregate = aggregate_face_signatures(signatures)
    if not aggregate:
        return {}

    consistency_scores = [
        cosine_similarity(aggregate, signature)
        for signature in signatures
        if len(signature) == len(aggregate)
    ]
    consistency = (
        round(float(statistics.median(consistency_scores)), 4)
        if consistency_scores
        else 0.0
    )
    return {
        "version": REFERENCE_VERSION,
        "algorithm": "opencv-haar-hog-dct",
        "signature": aggregate,
        "enrollment_frames": len(consistency_scores),
        "enrollment_consistency": consistency,
        "match_threshold": round(float(match_threshold), 4),
        "reject_threshold": round(float(reject_threshold), 4),
    }


def classify_identity_similarity(
    similarity_score: float,
    *,
    match_threshold: float = DEFAULT_MATCH_THRESHOLD,
    reject_threshold: float = DEFAULT_REJECT_THRESHOLD,
) -> tuple[IdentityStatus, str | None]:
    """Classify a similarity score using a review band around the decision."""

    if similarity_score >= match_threshold:
        return "Verified", None
    if similarity_score <= reject_threshold:
        return (
            "Rejected",
            "The face does not match the self-introduction reference.",
        )
    return (
        "Needs Review",
        "The face match is uncertain. Record again with your full face clearly visible.",
    )


def enroll_identity_from_video(video_path: Path) -> IdentityEnrollmentResult:
    """Enroll a continuity reference from a self-introduction recording."""

    observations = _observe_video_faces(Path(video_path))
    sampled = observations.sampled_frames
    usable = len(observations.signatures)

    if has_repeated_multi_face_evidence(
        observations.multi_face_frames,
        sampled,
    ):
        return IdentityEnrollmentResult(
            status="Rejected",
            face_count=observations.max_face_count,
            sampled_frames=sampled,
            usable_face_frames=usable,
            review_reason=(
                "More than one face was detected. Record the self-introduction alone."
            ),
        )

    minimum_usable = min(
        MIN_USABLE_ENROLLMENT_FRAMES,
        max(1, math.ceil(sampled * MIN_ENROLLMENT_FACE_RATIO)),
    )
    face_ratio = usable / sampled if sampled else 0.0
    if usable < minimum_usable or face_ratio < MIN_ENROLLMENT_FACE_RATIO:
        return IdentityEnrollmentResult(
            status="Needs Review",
            face_count=observations.max_face_count,
            sampled_frames=sampled,
            usable_face_frames=usable,
            review_reason=(
                "A single face was not clearly visible for enough of the recording. "
                "Face the camera in steady, even lighting and record again."
            ),
        )

    reference = build_face_reference(observations.signatures)
    consistency = float(reference.get("enrollment_consistency", 0.0))
    if not reference or consistency < MIN_ENROLLMENT_CONSISTENCY:
        return IdentityEnrollmentResult(
            status="Needs Review",
            face_count=observations.max_face_count,
            sampled_frames=sampled,
            usable_face_frames=usable,
            review_reason=(
                "The detected face was not consistent across the recording. "
                "Keep your face centered and avoid large camera movements."
            ),
        )

    return IdentityEnrollmentResult(
        status="Verified",
        face_count=observations.max_face_count,
        sampled_frames=sampled,
        usable_face_frames=usable,
        reference=reference,
    )


def verify_identity_in_video(
    video_path: Path,
    reference: dict[str, Any],
) -> IdentityVerificationResult:
    """Check a later interview recording against the enrollment reference."""

    observations = _observe_video_faces(Path(video_path))
    sampled = observations.sampled_frames
    usable = len(observations.signatures)

    if has_repeated_multi_face_evidence(
        observations.multi_face_frames,
        sampled,
    ):
        return IdentityVerificationResult(
            status="Rejected",
            face_count=observations.max_face_count,
            sampled_frames=sampled,
            usable_face_frames=usable,
            review_reason="More than one face was detected in the interview recording.",
        )

    reference_signature = _validated_reference_signature(reference)
    if not reference_signature:
        return IdentityVerificationResult(
            status="Needs Review",
            face_count=observations.max_face_count,
            sampled_frames=sampled,
            usable_face_frames=usable,
            review_reason=(
                "The self-introduction identity reference is missing or incompatible."
            ),
        )

    minimum_usable = min(
        MIN_USABLE_VERIFICATION_FRAMES,
        max(1, math.ceil(sampled * MIN_VERIFICATION_FACE_RATIO)),
    )
    face_ratio = usable / sampled if sampled else 0.0
    if usable < minimum_usable or face_ratio < MIN_VERIFICATION_FACE_RATIO:
        return IdentityVerificationResult(
            status="Needs Review",
            face_count=observations.max_face_count,
            sampled_frames=sampled,
            usable_face_frames=usable,
            review_reason=(
                "A single face was not clearly visible for enough of the recording. "
                "Record again while facing the camera."
            ),
        )

    similarity = compare_face_signatures(
        reference_signature,
        observations.signatures,
    )
    if similarity is None:
        return IdentityVerificationResult(
            status="Needs Review",
            face_count=observations.max_face_count,
            sampled_frames=sampled,
            usable_face_frames=usable,
            review_reason="No compatible face samples could be compared.",
        )

    match_threshold = _safe_threshold(
        reference.get("match_threshold"),
        DEFAULT_MATCH_THRESHOLD,
    )
    reject_threshold = _safe_threshold(
        reference.get("reject_threshold"),
        DEFAULT_REJECT_THRESHOLD,
    )
    if reject_threshold >= match_threshold:
        reject_threshold = DEFAULT_REJECT_THRESHOLD
        match_threshold = DEFAULT_MATCH_THRESHOLD

    status, reason = classify_identity_similarity(
        similarity,
        match_threshold=match_threshold,
        reject_threshold=reject_threshold,
    )
    return IdentityVerificationResult(
        status=status,
        face_count=observations.max_face_count,
        sampled_frames=sampled,
        usable_face_frames=usable,
        similarity_score=similarity,
        review_reason=reason,
    )


def identity_reference_is_valid(reference: dict[str, Any]) -> bool:
    """Return whether a stored reference is compatible with this verifier."""
    return bool(_validated_reference_signature(reference))


def get_video_duration_seconds(video_path: Path) -> float:
    """Read the encoded media duration instead of trusting a browser field."""
    path = Path(video_path)
    if not path.is_file():
        raise IdentityVerificationError("The video file could not be read.")

    # PyAV handles browser-produced WebM metadata more reliably than OpenCV.
    try:
        import av

        with av.open(str(path)) as container:
            if container.duration:
                duration = float(container.duration / av.time_base)
                if math.isfinite(duration) and duration > 0:
                    return round(duration, 3)
            for stream in container.streams.video:
                if stream.duration is not None and stream.time_base is not None:
                    duration = float(stream.duration * stream.time_base)
                    if math.isfinite(duration) and duration > 0:
                        return round(duration, 3)

            # Chrome MediaRecorder writes WebM as a live stream, so the
            # container and stream duration fields are commonly empty. Packet
            # timestamps are still encoded and let us measure the recording
            # without trusting the duration submitted by the browser.
            if container.streams.video:
                video_stream = container.streams.video[0]
                first_timestamp: float | None = None
                last_timestamp: float | None = None
                for packet in container.demux(video_stream):
                    if packet.pts is None:
                        continue
                    time_base = packet.time_base or video_stream.time_base
                    if time_base is None:
                        continue

                    packet_start = float(packet.pts * time_base)
                    packet_duration = (
                        float(packet.duration * time_base)
                        if packet.duration is not None
                        else 0.0
                    )
                    packet_end = packet_start + max(0.0, packet_duration)
                    if not (
                        math.isfinite(packet_start)
                        and math.isfinite(packet_end)
                    ):
                        continue

                    first_timestamp = (
                        packet_start
                        if first_timestamp is None
                        else min(first_timestamp, packet_start)
                    )
                    last_timestamp = (
                        packet_end
                        if last_timestamp is None
                        else max(last_timestamp, packet_end)
                    )

                if first_timestamp is not None and last_timestamp is not None:
                    duration = last_timestamp - first_timestamp
                    if math.isfinite(duration) and duration > 0:
                        return round(duration, 3)
    except Exception:
        # Fall back to OpenCV when a codec exposes incomplete container
        # metadata. The caller still receives an error if both probes fail.
        pass

    cv2, _ = _load_vision_dependencies()
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        capture.release()
        raise IdentityVerificationError("The video file could not be opened.")
    try:
        frame_count = float(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        frames_per_second = float(capture.get(cv2.CAP_PROP_FPS) or 0)
    finally:
        capture.release()

    if frame_count <= 0 or frames_per_second <= 0:
        raise IdentityVerificationError(
            "The recorded video duration could not be verified."
        )
    duration = frame_count / frames_per_second
    if not math.isfinite(duration) or duration <= 0:
        raise IdentityVerificationError(
            "The recorded video duration could not be verified."
        )
    return round(duration, 3)


def face_signature_from_crop(face_crop: Any) -> list[float]:
    """Create a compact face feature vector from an OpenCV image crop.

    This public helper is useful for deterministic unit tests with synthetic
    image arrays. It uses appearance/shape descriptors only and makes no
    demographic or affective classifications.
    """

    cv2, np = _load_vision_dependencies()
    if face_crop is None or getattr(face_crop, "size", 0) == 0:
        return []

    try:
        if len(face_crop.shape) == 3:
            gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
        else:
            gray = face_crop
        normalized = cv2.resize(gray, (32, 32), interpolation=cv2.INTER_AREA)
        normalized = cv2.equalizeHist(normalized)

        hog = cv2.HOGDescriptor(
            (32, 32),
            (16, 16),
            (8, 8),
            (8, 8),
            9,
        )
        hog_features = hog.compute(normalized).reshape(-1).astype("float32")
        hog_norm = float(np.linalg.norm(hog_features))
        if hog_norm > 1e-12:
            hog_features /= hog_norm

        dct_input = normalized.astype("float32") / 255.0
        dct_features = cv2.dct(dct_input)[:8, :8].reshape(-1)[1:]
        dct_norm = float(np.linalg.norm(dct_features))
        if dct_norm > 1e-12:
            dct_features /= dct_norm

        combined = np.concatenate((hog_features * 0.75, dct_features * 0.25))
        combined_norm = float(np.linalg.norm(combined))
        if combined_norm <= 1e-12:
            return []
        combined /= combined_norm
        return [round(float(value), 6) for value in combined.tolist()]
    except Exception as exc:  # OpenCV errors differ between binary builds.
        raise IdentityVerificationError(
            "The face sample could not be processed by the vision service."
        ) from exc


def _observe_video_faces(video_path: Path) -> _VideoFaceObservations:
    cv2, _ = _load_vision_dependencies()
    frames = _sample_video_frames(video_path, cv2)
    detector = _load_face_detector(cv2)

    signatures: list[list[float]] = []
    max_face_count = 0
    multi_face_frames = 0
    try:
        for frame in frames:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            scale = min(1.0, 960.0 / max(gray.shape[1], 1))
            detection_frame = (
                cv2.resize(
                    gray,
                    None,
                    fx=scale,
                    fy=scale,
                    interpolation=cv2.INTER_AREA,
                )
                if scale < 1.0
                else gray
            )
            detection_frame = cv2.equalizeHist(detection_frame)
            faces = detector.detectMultiScale(
                detection_frame,
                scaleFactor=1.1,
                minNeighbors=5,
                minSize=(48, 48),
            )
            faces = list(faces)
            if len(faces) > 1:
                largest_area = max(
                    int(width) * int(height)
                    for _, _, width, height in faces
                )
                faces = [
                    face
                    for face in faces
                    if int(face[2]) * int(face[3])
                    >= largest_area * MIN_SECONDARY_FACE_AREA_RATIO
                ]
            face_count = len(faces)
            max_face_count = max(max_face_count, face_count)
            if face_count > 1:
                multi_face_frames += 1
                continue
            if face_count != 1:
                continue

            x, y, width, height = (int(value / scale) for value in faces[0])
            margin_x = int(width * 0.12)
            margin_y = int(height * 0.12)
            x0 = max(0, x - margin_x)
            y0 = max(0, y - margin_y)
            x1 = min(gray.shape[1], x + width + margin_x)
            y1 = min(gray.shape[0], y + height + margin_y)
            signature = face_signature_from_crop(gray[y0:y1, x0:x1])
            if signature:
                signatures.append(signature)
    except IdentityVerificationError:
        raise
    except Exception as exc:
        raise IdentityVerificationError(
            "The video could not be processed by the vision service."
        ) from exc

    return _VideoFaceObservations(
        signatures=signatures,
        sampled_frames=len(frames),
        max_face_count=max_face_count,
        multi_face_frames=multi_face_frames,
    )


def _sample_video_frames(video_path: Path, cv2: Any) -> list[Any]:
    if not video_path.is_file():
        raise IdentityVerificationError("The video file could not be read.")

    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        capture.release()
        raise IdentityVerificationError("The video file could not be opened.")

    frames: list[Any] = []
    try:
        frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if frame_count > 0:
            target_count = min(DEFAULT_SAMPLE_COUNT, frame_count)
            if target_count == 1:
                indices = [0]
            else:
                indices = [
                    round(index * (frame_count - 1) / (target_count - 1))
                    for index in range(target_count)
                ]
            for frame_index in indices:
                capture.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
                ok, frame = capture.read()
                if ok and frame is not None and getattr(frame, "size", 0):
                    frames.append(frame)
            # Seeking is unreliable for some browser-produced WebM files.
            # Fall back to a sequential pass when too few seeked frames decode.
            if len(frames) < min(3, target_count):
                frames.clear()
                capture.set(cv2.CAP_PROP_POS_FRAMES, 0)
                stride = max(1, frame_count // target_count)
                frame_index = 0
                while frame_index < frame_count and len(frames) < target_count:
                    ok, frame = capture.read()
                    if not ok:
                        break
                    if (
                        frame_index % stride == 0
                        and frame is not None
                        and getattr(frame, "size", 0)
                    ):
                        frames.append(frame)
                    frame_index += 1
        else:
            fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
            stride = max(1, round(fps * 3.0)) if fps > 0 else 30
            frame_index = 0
            max_frames_to_scan = max(stride * DEFAULT_SAMPLE_COUNT, 1)
            while frame_index < max_frames_to_scan and len(frames) < DEFAULT_SAMPLE_COUNT:
                ok, frame = capture.read()
                if not ok:
                    break
                if (
                    frame_index % stride == 0
                    and frame is not None
                    and getattr(frame, "size", 0)
                ):
                    frames.append(frame)
                frame_index += 1
    finally:
        capture.release()

    if not frames:
        raise IdentityVerificationError(
            "No video frames could be decoded. Use a WebM, MP4, or MOV recording."
        )
    return frames


def _load_face_detector(cv2: Any) -> Any:
    cascade_path = Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml"
    detector = cv2.CascadeClassifier(str(cascade_path))
    if detector.empty():
        raise IdentityVerificationError(
            "The face detector is unavailable in the vision installation."
        )
    return detector


def _load_vision_dependencies() -> tuple[Any, Any]:
    try:
        import cv2  # type: ignore[import-not-found]
        import numpy as np  # type: ignore[import-not-found]
    except ImportError as exc:
        raise IdentityVerificationError(
            "Identity verification requires opencv-python-headless and numpy."
        ) from exc
    return cv2, np


def _validated_reference_signature(reference: dict[str, Any]) -> list[float]:
    if not isinstance(reference, dict):
        return []
    if reference.get("version") != REFERENCE_VERSION:
        return []
    raw_signature = reference.get("signature")
    if not isinstance(raw_signature, list) or not raw_signature:
        return []
    try:
        signature = [float(value) for value in raw_signature]
    except (TypeError, ValueError):
        return []
    if not all(math.isfinite(value) for value in signature):
        return []
    return signature


def _safe_threshold(value: Any, default: float) -> float:
    try:
        threshold = float(value)
    except (TypeError, ValueError):
        return default
    return threshold if 0.0 <= threshold <= 1.0 else default
