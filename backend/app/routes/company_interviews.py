import json
import re
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from pydantic import BaseModel
from pymongo.errors import PyMongoError

from ..ai_interview_service import (
    AIAnalysisError,
    InterviewEvaluation,
    evaluate_transcripts,
    transcribe_recordings,
)
from ..models import Doc, applications, company_interviews, jobs, students
from ..role_profiles import get_role_profile
from .applications import split_requirements


router = APIRouter(
    prefix="/company-interviews",
    tags=["Company Interviews"],
)

PROJECT_ROOT = Path(__file__).resolve().parents[3]
INTERVIEW_UPLOAD_DIR = PROJECT_ROOT / "uploads" / "interviews"
ALLOWED_VIDEO_EXTENSIONS = {".webm", ".mp4", ".mov"}
MAX_VIDEO_SIZE = 100 * 1024 * 1024


class CompanyInterviewResponse(BaseModel):
    """Student-safe interview session without private scores."""

    id: int
    application_id: int
    company_name: str
    job_title: str
    questions: list[str]
    recorded_question_indexes: list[int]
    status: str
    analysis_status: str


class CompanyVideoAnswerResponse(BaseModel):
    message: str
    interview_id: int
    question_index: int
    recorded_question_indexes: list[int]
    status: str


class CompanyInterviewSubmissionResponse(BaseModel):
    interview_id: int
    status: str
    analysis_status: str
    message: str


class RecruiterInterviewResult(BaseModel):
    """Detailed result reserved for the recruiter dashboard."""

    interview_id: int
    application_id: int
    transcripts: list[str]
    evaluation: InterviewEvaluation


def generate_company_questions(student: Doc, job: Doc) -> list[str]:
    """Create five questions from the JD, required skills, and resume context."""
    required_skills = split_requirements(job.required_skills)
    primary_skill = required_skills[0] if required_skills else "the main required skill"
    second_skill = required_skills[1] if len(required_skills) > 1 else primary_skill
    role_profile = get_role_profile(job.job_title)
    role_questions = (
        role_profile["interview_questions"]
        if role_profile
        else (
            f"What knowledge is most important for {job.job_title}?",
            f"Describe how you would solve a common {job.job_title} task.",
        )
    )

    description = " ".join((job.job_description or "").split())
    responsibility = description.split(".")[0][:220] or (
        f"deliver the responsibilities of a {job.job_title}"
    )

    return [
        (
            f"Introduce yourself and explain why your background is suitable for "
            f"the {job.job_title} role at {job.company_name}."
        ),
        (
            f"Choose one project from your resume that is relevant to {primary_skill}. "
            "Explain your contribution, technical decisions, and result."
        ),
        (
            f"This job requires {second_skill}. Explain how you have used it, "
            "or how you would use it to solve a practical task."
        ),
        role_questions[0],
        (
            f"The job description includes this responsibility: \u201c{responsibility}\u201d. "
            f"{role_questions[1]}"
        ),
    ]


def get_interview_context(interview: Doc) -> tuple[Doc, Doc, Doc]:
    application = applications.get(interview.application_id)
    if not application:
        raise HTTPException(status_code=404, detail="Application not found.")

    student = students.get(application.student_id)
    job = jobs.get(application.job_id)
    if not student or not job:
        raise HTTPException(
            status_code=404,
            detail="Student or job record could not be found.",
        )
    return application, student, job


def serialize_interview(interview: Doc, job: Doc) -> CompanyInterviewResponse:
    video_paths = json.loads(interview.video_paths or "{}")
    return CompanyInterviewResponse(
        id=interview.id,
        application_id=interview.application_id,
        company_name=job.company_name,
        job_title=job.job_title,
        questions=json.loads(interview.questions),
        recorded_question_indexes=sorted(int(index) for index in video_paths),
        status=interview.status,
        analysis_status=interview.analysis_status,
    )


@router.post(
    "/start/{application_id}",
    response_model=CompanyInterviewResponse,
)
def start_company_interview(application_id: int):
    """Start or resume the company interview for an eligible application."""
    application = applications.get(application_id)
    if not application:
        raise HTTPException(status_code=404, detail="Application not found.")
    if not application.eligible:
        raise HTTPException(
            status_code=403,
            detail="This application is not eligible for the company AI interview.",
        )

    student = students.get(application.student_id)
    job = jobs.get(application.job_id)
    if not student or not job:
        raise HTTPException(
            status_code=404,
            detail="Student or job record could not be found.",
        )

    existing = company_interviews.latest_for_application(application.id)
    if existing:
        return serialize_interview(existing, job)

    interview = company_interviews.create(
        {
            "application_id": application.id,
            "questions": json.dumps(generate_company_questions(student, job)),
            "video_paths": "{}",
            "transcripts": "[]",
            "status": "In Progress",
            "analysis_status": "Not Started",
            "overall_score": 0,
        }
    )
    application.status = "Company AI Interview In Progress"
    applications.save(application)
    return serialize_interview(interview, job)


@router.get(
    "/{interview_id}",
    response_model=CompanyInterviewResponse,
)
def get_company_interview(interview_id: int):
    interview = company_interviews.get(interview_id)
    if not interview:
        raise HTTPException(status_code=404, detail="Company interview not found.")
    _, _, job = get_interview_context(interview)
    return serialize_interview(interview, job)


@router.post(
    "/{interview_id}/answers/{question_index}",
    response_model=CompanyVideoAnswerResponse,
)
async def upload_company_video_answer(
    interview_id: int,
    question_index: int,
    video: UploadFile = File(...),
):
    interview = company_interviews.get(interview_id)
    if not interview:
        raise HTTPException(status_code=404, detail="Company interview not found.")
    if interview.analysis_status == "Completed":
        raise HTTPException(
            status_code=400,
            detail="This interview has already been submitted.",
        )

    questions = json.loads(interview.questions)
    if question_index < 0 or question_index >= len(questions):
        raise HTTPException(status_code=400, detail="Invalid question number.")

    original_filename = video.filename or "answer.webm"
    extension = Path(original_filename).suffix.lower()
    if extension not in ALLOWED_VIDEO_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Only WebM, MP4, or MOV video answers are supported.",
        )

    video_bytes = await video.read()
    if not video_bytes:
        raise HTTPException(status_code=400, detail="The recorded video is empty.")
    if len(video_bytes) > MAX_VIDEO_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="Each video answer must be 100 MB or smaller.",
        )

    interview_directory = INTERVIEW_UPLOAD_DIR / f"company-{interview.id}"
    interview_directory.mkdir(parents=True, exist_ok=True)
    stored_filename = f"question-{question_index + 1}-{uuid4().hex}{extension}"
    stored_path = interview_directory / stored_filename
    stored_path.write_bytes(video_bytes)

    video_paths = json.loads(interview.video_paths or "{}")
    previous_path = (
        Path(video_paths[str(question_index)])
        if str(question_index) in video_paths
        else None
    )
    video_paths[str(question_index)] = str(stored_path)
    interview.video_paths = json.dumps(video_paths)
    interview.status = (
        "Ready to Submit"
        if len(video_paths) == len(questions)
        else "In Progress"
    )
    company_interviews.save(interview)

    if previous_path and previous_path != stored_path:
        previous_path.unlink(missing_ok=True)

    return CompanyVideoAnswerResponse(
        message="Video answer saved successfully.",
        interview_id=interview.id,
        question_index=question_index,
        recorded_question_indexes=sorted(int(index) for index in video_paths),
        status=interview.status,
    )


@router.post(
    "/{interview_id}/submit",
    response_model=CompanyInterviewSubmissionResponse,
)
def submit_company_interview(interview_id: int):
    """Transcribe, evaluate, and save the private company-interview result."""
    interview = company_interviews.get(interview_id)
    if not interview:
        raise HTTPException(status_code=404, detail="Company interview not found.")

    application, student, job = get_interview_context(interview)
    questions = json.loads(interview.questions)
    video_paths = json.loads(interview.video_paths or "{}")
    if len(video_paths) != len(questions):
        raise HTTPException(
            status_code=400,
            detail="Record all five answers before submitting the interview.",
        )

    if interview.analysis_status == "Completed":
        return CompanyInterviewSubmissionResponse(
            interview_id=interview.id,
            status=interview.status,
            analysis_status=interview.analysis_status,
            message="The company interview was already submitted for recruiter review.",
        )

    required_skills = set(split_requirements(job.required_skills))
    description_keywords = {
        word.lower()
        for word in re.findall(r"[a-zA-Z][a-zA-Z+#.-]{2,}", job.job_description or "")
    }
    evaluation_keywords = required_skills | description_keywords

    try:
        interview.analysis_status = "Processing"
        interview.analysis_error = None
        company_interviews.save(interview)

        transcripts = transcribe_recordings(
            video_paths=video_paths,
            question_count=len(questions),
        )
        evaluation = evaluate_transcripts(
            student=student,
            questions=questions,
            transcripts=transcripts,
            target_role=job.job_title,
            extra_keywords=evaluation_keywords,
            role_match_score=application.match_score or 0,
        )
        interview.transcripts = json.dumps(transcripts)
        interview.ai_evaluation = evaluation.model_dump_json()
        interview.overall_score = evaluation.overall_score
        interview.status = "Submitted"
        interview.analysis_status = "Completed"
        company_interviews.save(interview)

        application.company_interview_score = evaluation.overall_score
        application.status = "Company AI Interview Submitted"
        application.recommendation = "Awaiting recruiter review."
        applications.save(application)
    except AIAnalysisError as error:
        interview.analysis_status = "Failed"
        interview.analysis_error = str(error)
        try:
            company_interviews.save(interview)
        except PyMongoError:
            pass
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(error),
        ) from error
    except PyMongoError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The interview database is unreachable. Check MONGODB_URI and retry.",
        ) from error
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(
                "Local company-interview analysis failed unexpectedly. "
                "Restart the backend and retry."
            ),
        ) from error

    return CompanyInterviewSubmissionResponse(
        interview_id=interview.id,
        status=interview.status,
        analysis_status=interview.analysis_status,
        message="Interview submitted successfully for recruiter review.",
    )


@router.get(
    "/{interview_id}/recruiter-result",
    response_model=RecruiterInterviewResult,
)
def get_recruiter_interview_result(interview_id: int):
    """Return the detailed private result for the Day 7 recruiter dashboard."""
    interview = company_interviews.get(interview_id)
    if not interview:
        raise HTTPException(status_code=404, detail="Company interview not found.")
    if interview.analysis_status != "Completed" or not interview.ai_evaluation:
        raise HTTPException(
            status_code=404,
            detail="The company interview has not been analyzed yet.",
        )
    return RecruiterInterviewResult(
        interview_id=interview.id,
        application_id=interview.application_id,
        transcripts=json.loads(interview.transcripts or "[]"),
        evaluation=InterviewEvaluation.model_validate_json(
            interview.ai_evaluation
        ),
    )
