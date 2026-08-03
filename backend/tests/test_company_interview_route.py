import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017/unit_test")
BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from fastapi import UploadFile

from app.adaptive_interview_service import AdaptiveQuestion
from app.models import Doc
from app.routes import company_interviews as route


class CompanyInterviewRouteTests(unittest.TestCase):
    def test_upload_transcribes_and_appends_one_adaptive_question(self):
        interview = Doc(
            {
                "id": 10,
                "application_id": 20,
                "questions": json.dumps(
                    ["How have you used Python to build an API?"]
                ),
                "question_metadata": "[]",
                "video_paths": "{}",
                "transcripts": "[]",
                "max_questions": 5,
                "adaptive_version": route.ADAPTIVE_INTERVIEW_VERSION,
                "job_description_snapshot": (
                    "Build Python APIs and design reliable services."
                ),
                "required_skills_snapshot": json.dumps(["Python"]),
                "status": "In Progress",
                "analysis_status": "Not Started",
            }
        )
        student = Doc({"id": 1, "self_introduction_id": 4})
        job = Doc(
            {
                "id": 2,
                "job_title": "Backend Engineer",
                "company_name": "Example",
                "job_description": (
                    "Build Python APIs and design reliable services."
                ),
                "required_skills": "Python",
            }
        )
        generated = AdaptiveQuestion(
            question="What trade-off did you make in that Python API?",
            competency="Python",
            difficulty="intermediate",
            jd_evidence="Build Python APIs",
            follow_up=True,
            source="llm",
        )
        upload = UploadFile(
            filename="answer.webm",
            file=io.BytesIO(b"test-video"),
        )

        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(route, "INTERVIEW_UPLOAD_DIR", Path(directory)),
            patch.object(
                route.company_interviews,
                "get",
                return_value=interview,
            ),
            patch.object(route.company_interviews, "save") as save,
            patch.object(
                route,
                "get_interview_context",
                return_value=(Doc({"id": 20}), student, job),
            ),
            patch.object(route, "verify_interview_recording_identity"),
            patch.object(
                route,
                "transcribe_recordings",
                return_value=["I built a Python API with caching."],
            ),
            patch.object(
                route,
                "build_adaptive_question",
                return_value=generated,
            ) as build_question,
        ):
            result = route.upload_company_video_answer(
                interview_id=10,
                question_index=0,
                video=upload,
            )

        self.assertEqual(result.next_question_index, 1)
        self.assertEqual(len(result.questions), 2)
        self.assertEqual(result.questions[1], generated.question)
        self.assertEqual(
            json.loads(interview.transcripts),
            ["I built a Python API with caching."],
        )
        self.assertEqual(interview.status, "In Progress")
        save.assert_called_once_with(interview)
        build_question.assert_called_once()

    def test_recruiter_result_falls_back_to_completed_interview(self):
        evaluation = route.InterviewEvaluation(
            target_role="Backend Engineer",
            technical_score=70,
            communication_score=75,
            problem_solving_score=72,
            project_understanding_score=68,
            role_readiness_score=71,
            overall_score=71,
            strengths=["Clear explanation"],
            improvement_areas=["Add more detail"],
            improvement_plan=["Practice one system-design answer"],
            summary="Ready for recruiter review.",
            answer_evaluations=[],
        )
        incomplete = Doc(
            {
                "id": 12,
                "application_id": 20,
                "analysis_status": "Not Started",
                "ai_evaluation": None,
            }
        )
        completed = Doc(
            {
                "id": 11,
                "application_id": 20,
                "analysis_status": "Completed",
                "ai_evaluation": evaluation.model_dump_json(),
                "transcripts": json.dumps(["Completed answer"]),
            }
        )

        with (
            patch.object(
                route.company_interviews,
                "get",
                return_value=incomplete,
            ),
            patch.object(
                route.company_interviews,
                "latest_completed_for_application",
                return_value=completed,
            ) as find_completed,
        ):
            result = route.get_recruiter_interview_result(12)

        self.assertEqual(result.interview_id, 11)
        self.assertEqual(result.transcripts, ["Completed answer"])
        self.assertEqual(result.evaluation.overall_score, 71)
        find_completed.assert_called_once_with(20)


if __name__ == "__main__":
    unittest.main()
