import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from app.adaptive_interview_service import (
    AdaptiveQuestion,
    AdaptiveQuestionError,
    build_fallback_question,
    generate_adaptive_question,
    validate_adaptive_question,
)


JOB_DESCRIPTION = (
    "Build Python APIs for a recruitment platform. Design reliable services "
    "and work with MongoDB."
)


def response_payload(question: dict) -> dict:
    return {
        "output": [
            {
                "content": [
                    {
                        "type": "output_text",
                        "text": json.dumps(question),
                    }
                ]
            }
        ]
    }


class AdaptiveInterviewServiceTests(unittest.TestCase):
    def test_structured_llm_question_is_validated(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = response_payload(
            {
                "question": (
                    "How would you make a Python API reliable under load?"
                ),
                "competency": "Python",
                "difficulty": "intermediate",
                "jd_evidence": "Build Python APIs",
                "follow_up": True,
            }
        )

        with (
            patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}, clear=False),
            patch(
                "app.adaptive_interview_service.httpx.post",
                return_value=response,
            ) as request,
        ):
            generated = generate_adaptive_question(
                job_title="Backend Engineer",
                company_name="Example",
                job_description=JOB_DESCRIPTION,
                required_skills=["Python", "MongoDB"],
                previous_turns=[
                    {
                        "question": "How have you used Python?",
                        "answer": "I created a small REST API.",
                    }
                ],
                question_index=1,
                max_questions=5,
            )

        self.assertEqual(generated.source, "llm")
        self.assertEqual(generated.competency, "Python")
        sent_payload = request.call_args.kwargs["json"]
        self.assertFalse(sent_payload["store"])
        self.assertNotIn("resume", sent_payload["input"].lower())

    def test_missing_key_uses_job_description_fallback(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": ""}, clear=False):
            generated = generate_adaptive_question(
                job_title="Backend Engineer",
                company_name="Example",
                job_description=JOB_DESCRIPTION,
                required_skills=["Python"],
                previous_turns=[],
                question_index=0,
                max_questions=5,
            )

        self.assertEqual(generated.source, "fallback")
        self.assertIn("Build Python APIs", generated.question)

    def test_protected_topic_is_rejected(self):
        with self.assertRaises(AdaptiveQuestionError):
            validate_adaptive_question(
                AdaptiveQuestion(
                    question="How does your family affect your Python work?",
                    competency="Python",
                    difficulty="introductory",
                    jd_evidence="Build Python APIs",
                    follow_up=False,
                ),
                job_description=JOB_DESCRIPTION,
                required_skills=["Python"],
                previous_questions=[],
            )

    def test_duplicate_question_is_rejected(self):
        question = "How would you design reliable services with MongoDB?"
        with self.assertRaises(AdaptiveQuestionError):
            validate_adaptive_question(
                AdaptiveQuestion(
                    question=question,
                    competency="MongoDB",
                    difficulty="advanced",
                    jd_evidence="Design reliable services",
                    follow_up=True,
                ),
                job_description=JOB_DESCRIPTION,
                required_skills=["MongoDB"],
                previous_questions=[question],
            )

    def test_fallback_is_one_question(self):
        generated = build_fallback_question(
            job_title="Backend Engineer",
            job_description=JOB_DESCRIPTION,
            required_skills=["Python"],
            question_index=4,
        )
        self.assertEqual(generated.question.count("?"), 1)
        self.assertTrue(generated.question.endswith("?"))


if __name__ == "__main__":
    unittest.main()
