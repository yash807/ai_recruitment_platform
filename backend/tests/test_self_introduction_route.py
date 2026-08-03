import io
import unittest
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fastapi import HTTPException, UploadFile

from app.identity_verification_service import IdentityEnrollmentResult
from app.models import Doc
from app.routes import self_introductions as routes


class SelfIntroductionRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.introduction = Doc(
            {
                "id": 8,
                "student_id": 3,
                "status": "Ready to Record",
                "challenge_phrase": (
                    "My verification phrase is amber garden four quartz."
                ),
                "challenge_created_at": datetime.now(timezone.utc),
                "challenge_consumed_at": None,
                "video_path": None,
            }
        )
        self.student = Doc(
            {
                "id": 3,
                "name": "Test Student",
                "college": "Test College",
                "branch": "CSE",
                "skills": "Python, SQL",
                "target_role": "Data Analyst",
                "self_introduction_id": 8,
                "self_introduction_status": "Ready to Record",
                "identity_enrollment_status": "Pending",
            }
        )

    def _upload(self) -> UploadFile:
        return UploadFile(
            filename="introduction.webm",
            file=io.BytesIO(b"test-video"),
        )

    def test_successful_submission_completes_and_locks_enrollment(self) -> None:
        def claim(_introduction_id: int):
            self.introduction.status = "Processing"
            self.introduction.challenge_consumed_at = datetime.now(timezone.utc)
            return self.introduction

        enrollment = IdentityEnrollmentResult(
            status="Verified",
            face_count=1,
            sampled_frames=20,
            usable_face_frames=20,
            reference={
                "version": "prototype-face-continuity-v1",
                "signature": [1.0, 0.0, 0.0],
            },
        )
        transcript = (
            "I built a Python dashboard project. "
            "My verification face is amber garden for quarts."
        )

        with TemporaryDirectory() as directory, patch.object(
            routes,
            "SELF_INTRODUCTION_UPLOAD_DIR",
            Path(directory),
        ), patch.object(
            routes.self_introductions,
            "get",
            return_value=self.introduction,
        ), patch.object(
            routes.self_introductions,
            "claim_for_processing",
            side_effect=claim,
        ), patch.object(
            routes.self_introductions,
            "save",
            side_effect=lambda value: value,
        ), patch.object(
            routes.students,
            "get",
            return_value=self.student,
        ), patch.object(
            routes.students,
            "save",
            side_effect=lambda value: value,
        ), patch.object(
            routes,
            "get_video_duration_seconds",
            return_value=60.0,
        ), patch.object(
            routes,
            "enroll_identity_from_video",
            return_value=enrollment,
        ), patch.object(
            routes,
            "transcribe_self_introduction",
            return_value=transcript,
        ) as transcribe:
            result = routes.submit_self_introduction(
                introduction_id=8,
                video=self._upload(),
                duration_seconds=60,
            )

        self.assertEqual(result.status, "Completed")
        self.assertEqual(result.identity_enrollment_status, "Verified")
        self.assertEqual(self.student.self_introduction_status, "Completed")
        self.assertEqual(self.student.identity_enrollment_status, "Verified")
        self.assertIsNotNone(self.introduction.identity_reference)
        self.assertEqual(self.introduction.transcript, transcript)
        self.assertEqual(transcribe.call_count, 1)

    def test_old_introduction_id_cannot_replace_current_enrollment(self) -> None:
        self.student.self_introduction_id = 99
        with patch.object(
            routes.self_introductions,
            "get",
            return_value=self.introduction,
        ), patch.object(
            routes.students,
            "get",
            return_value=self.student,
        ):
            with self.assertRaises(HTTPException) as context:
                routes.submit_self_introduction(
                    introduction_id=8,
                    video=self._upload(),
                    duration_seconds=60,
                )

        self.assertEqual(context.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
