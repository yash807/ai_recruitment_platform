import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.models import Doc
from app.routes import resume_builders as routes


class ResumeBuilderRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.student = Doc(
            {
                "id": 3,
                "name": "Asha Student",
                "email": "asha@example.com",
                "target_role": "Data Analyst",
                "skills": "Python, SQL",
                "linkedin_url": "https://linkedin.com/in/asha",
                "github_url": "https://github.com/asha",
            }
        )

    def test_new_builder_is_prefilled_from_student_profile(self) -> None:
        with patch.object(routes.students, "get", return_value=self.student), patch.object(
            routes.resume_builders,
            "get_for_student",
            return_value=None,
        ):
            result = routes.get_student_resume_builder(3)

        self.assertEqual(result.basics.full_name, "Asha Student")
        self.assertEqual(result.basics.professional_title, "Data Analyst")
        self.assertEqual(result.skills, ["Python", "SQL"])

    def test_save_creates_persistent_builder(self) -> None:
        payload = routes.ResumeBuilderPayload(
            template="single-column",
            basics=routes.ResumeBasics(full_name="Asha Student"),
            skills=["Python", "SQL"],
        )

        def create(data):
            return Doc({"id": 9, **data})

        with patch.object(routes.students, "get", return_value=self.student), patch.object(
            routes.resume_builders,
            "get_for_student",
            return_value=None,
        ), patch.object(routes.resume_builders, "create", side_effect=create) as create_mock:
            result = routes.save_student_resume_builder(3, payload)

        self.assertEqual(result.template, "single-column")
        self.assertEqual(result.student_id, 3)
        self.assertEqual(create_mock.call_args.args[0]["student_id"], 3)

    def test_unknown_student_is_rejected(self) -> None:
        with patch.object(routes.students, "get", return_value=None):
            with self.assertRaises(HTTPException) as context:
                routes.get_student_resume_builder(999)

        self.assertEqual(context.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
