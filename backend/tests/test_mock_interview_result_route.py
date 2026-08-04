import json
import unittest
from unittest.mock import patch

from app.models import Doc
from app.routes import interviews as routes


class MockInterviewResultRouteTests(unittest.TestCase):
    def test_latest_published_result_is_returned_to_student(self) -> None:
        evaluation = {
            "target_role": "Frontend Developer",
            "technical_score": 78,
            "communication_score": 82,
            "problem_solving_score": 76,
            "project_understanding_score": 80,
            "role_readiness_score": 79,
            "overall_score": 79,
            "strengths": ["Clear project evidence"],
            "improvement_areas": ["Explain trade-offs in more detail"],
            "improvement_plan": ["Practice structured technical answers"],
            "summary": "A clear, evidence-based interview.",
            "answer_evaluations": [],
        }
        interview = Doc(
            {
                "id": 14,
                "student_id": 3,
                "analysis_status": "Completed",
                "transcripts": json.dumps(["Answer one"]),
                "ai_evaluation": json.dumps(evaluation),
            }
        )

        with patch.object(
            routes.students,
            "get",
            return_value=Doc({"id": 3}),
        ), patch.object(
            routes.mock_interviews,
            "latest_completed_for_student",
            return_value=interview,
        ):
            result = routes.get_latest_student_mock_interview_analysis(3)

        self.assertEqual(result.interview_id, 14)
        self.assertEqual(result.analysis_status, "Completed")
        self.assertEqual(result.evaluation.overall_score, 79)
        self.assertEqual(result.evaluation.strengths, ["Clear project evidence"])


if __name__ == "__main__":
    unittest.main()
