import unittest
from fractions import Fraction
from pathlib import Path
from tempfile import TemporaryDirectory

from app.identity_verification_service import (
    REFERENCE_VERSION,
    aggregate_face_signatures,
    build_face_reference,
    classify_identity_similarity,
    compare_face_signatures,
    identity_reference_is_valid,
    get_video_duration_seconds,
)


class IdentityVerificationServiceTests(unittest.TestCase):
    def test_reference_is_json_serializable_and_versioned(self) -> None:
        reference = build_face_reference(
            [
                [1.0, 0.0, 0.0],
                [0.98, 0.02, 0.0],
                [0.99, 0.01, 0.0],
            ]
        )
        self.assertEqual(reference["version"], REFERENCE_VERSION)
        self.assertEqual(len(reference["signature"]), 3)
        self.assertGreater(reference["enrollment_consistency"], 0.9)
        self.assertTrue(identity_reference_is_valid(reference))

    def test_same_signature_is_verified(self) -> None:
        reference = aggregate_face_signatures(
            [[1.0, 0.0, 0.0], [0.99, 0.01, 0.0]]
        )
        score = compare_face_signatures(
            reference,
            [[1.0, 0.0, 0.0], [0.98, 0.02, 0.0]],
        )
        self.assertIsNotNone(score)
        status, reason = classify_identity_similarity(score or 0)
        self.assertEqual(status, "Verified")
        self.assertIsNone(reason)

    def test_low_similarity_is_rejected(self) -> None:
        status, reason = classify_identity_similarity(0.2)
        self.assertEqual(status, "Rejected")
        self.assertIn("does not match", reason or "")

    def test_borderline_similarity_requests_a_retake(self) -> None:
        status, reason = classify_identity_similarity(0.6)
        self.assertEqual(status, "Needs Review")
        self.assertIn("uncertain", reason or "")

    def test_encoded_video_duration_is_measured_from_media(self) -> None:
        import cv2
        import numpy as np

        with TemporaryDirectory() as directory:
            path = Path(directory) / "duration.avi"
            writer = cv2.VideoWriter(
                str(path),
                cv2.VideoWriter_fourcc(*"MJPG"),
                10.0,
                (64, 64),
            )
            self.assertTrue(writer.isOpened())
            for _ in range(20):
                writer.write(np.zeros((64, 64, 3), dtype=np.uint8))
            writer.release()

            self.assertAlmostEqual(
                get_video_duration_seconds(path),
                2.0,
                delta=0.25,
            )

    def test_metadata_less_webm_duration_is_measured_from_packets(self) -> None:
        import av
        import numpy as np

        with TemporaryDirectory() as directory:
            path = Path(directory) / "media-recorder.webm"
            with av.open(
                str(path),
                mode="w",
                format="webm",
                options={"live": "1"},
            ) as container:
                stream = container.add_stream("libvpx", rate=10)
                stream.width = 64
                stream.height = 64
                stream.pix_fmt = "yuv420p"

                for index in range(20):
                    frame = av.VideoFrame.from_ndarray(
                        np.zeros((64, 64, 3), dtype=np.uint8),
                        format="rgb24",
                    )
                    frame.pts = index
                    frame.time_base = Fraction(1, 10)
                    for packet in stream.encode(frame):
                        container.mux(packet)
                for packet in stream.encode():
                    container.mux(packet)

            with av.open(str(path)) as container:
                self.assertIsNone(container.duration)
                self.assertIsNone(container.streams.video[0].duration)

            self.assertAlmostEqual(
                get_video_duration_seconds(path),
                2.0,
                delta=0.25,
            )


if __name__ == "__main__":
    unittest.main()
