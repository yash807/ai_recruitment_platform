import json
import unittest
from unittest.mock import patch

from app.models import Doc
from app.routes import company_interviews as routes


class CompanyInterviewStudentResultRouteTests(unittest.TestCase):
    def test_completed_result_is_published_without_private_fields(self) -> None:
        evaluation = {
            "target_role": "Backend Developer",
            "technical_score": 84,
            "communication_score": 79,
            "problem_solving_score": 82,
            "project_understanding_score": 86,
            "role_readiness_score": 83,
            "overall_score": 83,
            "strengths": ["Strong technical examples"],
            "improvement_areas": ["Use a more concise structure"],
            "improvement_plan": ["Practice timed STAR answers"],
            "summary": "A technically strong company interview.",
            "answer_evaluations": [],
        }
        application = Doc(
            {
                "id": 9,
                "student_id": 3,
                "job_id": 5,
                "recruiter_feedback": "Private recruiter note",
                "final_score": 91,
            }
        )
        interview = Doc(
            {
                "id": 18,
                "application_id": 9,
                "analysis_status": "Completed",
                "transcripts": json.dumps(["Private answer transcript"]),
                "ai_evaluation": json.dumps(evaluation),
            }
        )
        job = Doc(
            {
                "id": 5,
                "company_name": "Acme Labs",
                "job_title": "Backend Developer",
            }
        )

        with patch.object(
            routes.students,
            "get",
            return_value=Doc({"id": 3}),
        ), patch.object(
            routes.applications,
            "list_by_student",
            return_value=[application],
        ), patch.object(
            routes.jobs,
            "many_by_id",
            return_value={5: job},
        ), patch.object(
            routes.company_interviews,
            "latest_completed_for_application",
            return_value=interview,
        ):
            results = routes.get_student_company_interview_results(3)

        self.assertEqual(len(results), 1)
        result = results[0]
        self.assertEqual(result.application_id, 9)
        self.assertEqual(result.company_name, "Acme Labs")
        self.assertEqual(result.evaluation.overall_score, 83)
        published = result.model_dump()
        self.assertNotIn("transcripts", published)
        self.assertNotIn("recruiter_feedback", published)
        self.assertNotIn("final_score", published)


if __name__ == "__main__":
    unittest.main()
