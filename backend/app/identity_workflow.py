"""Shared identity-continuity checks for mock and company interviews."""

from __future__ import annotations

import json
from pathlib import Path

from .identity_verification_service import (
    IdentityVerificationError,
    identity_reference_is_valid,
    verify_identity_in_video,
)
from .models import Doc, identity_checks, self_introductions


class IdentityContinuityError(Exception):
    """A recording cannot be accepted as the enrolled student's recording."""

    def __init__(self, message: str, *, status_code: int = 422) -> None:
        super().__init__(message)
        self.status_code = status_code


def require_verified_identity_enrollment(student: Doc) -> Doc:
    """Return the verified introduction used as the student's face reference."""
    if (
        student.self_introduction_status != "Completed"
        or student.identity_enrollment_status != "Verified"
    ):
        raise IdentityContinuityError(
            "Complete the self-introduction and identity check before starting an interview.",
            status_code=403,
        )

    introduction = (
        self_introductions.get(student.self_introduction_id)
        if student.self_introduction_id
        else self_introductions.latest_for_student(student.id)
    )
    if (
        not introduction
        or introduction.status != "Completed"
        or introduction.identity_enrollment_status != "Verified"
        or not introduction.identity_reference
    ):
        raise IdentityContinuityError(
            "The verified self-introduction reference is missing. Record the self-introduction again.",
            status_code=409,
        )
    reference = introduction.identity_reference
    if isinstance(reference, str):
        try:
            reference = json.loads(reference)
        except json.JSONDecodeError:
            reference = {}
    if not identity_reference_is_valid(reference):
        raise IdentityContinuityError(
            "The verified identity reference is invalid. Record the self-introduction again.",
            status_code=409,
        )
    return introduction


def verify_interview_recording_identity(
    *,
    student: Doc,
    video_path: Path,
    stage: str,
    interview_id: int,
    question_index: int,
) -> None:
    """Verify a recorded answer and keep an auditable, minimal check record."""
    introduction = require_verified_identity_enrollment(student)
    reference = introduction.identity_reference
    if isinstance(reference, str):
        try:
            reference = json.loads(reference)
        except json.JSONDecodeError as error:
            raise IdentityContinuityError(
                "The identity reference is invalid. Record the self-introduction again.",
                status_code=409,
            ) from error

    try:
        result = verify_identity_in_video(video_path, reference)
    except IdentityVerificationError as error:
        raise IdentityContinuityError(str(error), status_code=422) from error

    identity_checks.create(
        {
            "student_id": student.id,
            "stage": stage,
            "interview_id": interview_id,
            "session_type": stage,
            "session_id": interview_id,
            "introduction_id": introduction.id,
            "reference_version": reference.get("version"),
            "question_index": question_index,
            "video_path": str(video_path),
            "face_count": result.face_count,
            "sampled_frames": result.sampled_frames,
            "usable_face_frames": result.usable_face_frames,
            "similarity_score": result.similarity_score,
            "status": result.status,
            "review_reason": result.review_reason,
        }
    )

    if result.status == "Verified":
        return

    if result.status == "Rejected":
        raise IdentityContinuityError(
            result.review_reason
            or "The person in this answer does not match the self-introduction.",
            status_code=403,
        )
    raise IdentityContinuityError(
        result.review_reason
        or "Identity could not be verified. Keep one face clearly visible and record again.",
        status_code=422,
    )


def require_verified_recording_checks(
    *,
    student_id: int,
    stage: str,
    interview_id: int,
    introduction_id: int,
    question_count: int,
) -> None:
    """Prevent analysis/submission when any answer bypassed identity checks."""
    checks = identity_checks.list(
        {
            "student_id": student_id,
            "stage": stage,
            "interview_id": interview_id,
            "introduction_id": introduction_id,
            "status": "Verified",
        }
    )
    verified_indexes = {
        int(check.question_index)
        for check in checks
        if check.question_index is not None
    }
    required_indexes = set(range(question_count))
    if not required_indexes.issubset(verified_indexes):
        raise IdentityContinuityError(
            "Every recorded answer must pass the identity continuity check before submission.",
            status_code=409,
        )
