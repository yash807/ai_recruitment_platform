import unittest
from unittest.mock import patch

from app.identity_workflow import (
    IdentityContinuityError,
    require_verified_identity_enrollment,
    require_verified_recording_checks,
)
from app.models import Doc


VALID_REFERENCE = {
    "version": "prototype-face-continuity-v1",
    "signature": [1.0, 0.0, 0.0],
}


class IdentityWorkflowTests(unittest.TestCase):
    def test_interview_is_blocked_before_enrollment(self) -> None:
        student = Doc(
            {
                "id": 1,
                "self_introduction_status": "Not Started",
                "identity_enrollment_status": "Not Started",
            }
        )
        with self.assertRaises(IdentityContinuityError):
            require_verified_identity_enrollment(student)

    def test_valid_enrollment_reference_unlocks_interview(self) -> None:
        student = Doc(
            {
                "id": 1,
                "self_introduction_id": 4,
                "self_introduction_status": "Completed",
                "identity_enrollment_status": "Verified",
            }
        )
        introduction = Doc(
            {
                "id": 4,
                "status": "Completed",
                "identity_enrollment_status": "Verified",
                "identity_reference": VALID_REFERENCE,
            }
        )
        with patch(
            "app.identity_workflow.self_introductions.get",
            return_value=introduction,
        ):
            self.assertEqual(
                require_verified_identity_enrollment(student),
                introduction,
            )

    def test_submission_requires_every_question_check(self) -> None:
        checks = [
            Doc({"question_index": index})
            for index in range(4)
        ]
        with patch(
            "app.identity_workflow.identity_checks.list",
            return_value=checks,
        ):
            with self.assertRaises(IdentityContinuityError):
                require_verified_recording_checks(
                    student_id=1,
                    stage="mock_interview",
                    interview_id=2,
                    introduction_id=4,
                    question_count=5,
                )


if __name__ == "__main__":
    unittest.main()
