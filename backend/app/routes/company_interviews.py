import json
import os
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
from ..adaptive_interview_service import (
    AdaptiveQuestion,
    generate_adaptive_question,
)
from ..identity_workflow import (
    IdentityContinuityError,
    require_verified_identity_enrollment,
    require_verified_recording_checks,
    verify_interview_recording_identity,
)
from ..media_uploads import (
    EmptyUploadError,
    UploadTooLargeError,
    stream_upload_to_path,
)
from ..models import Doc, applications, company_interviews, jobs, students
from .applications import split_requirements


router = APIRouter(
    prefix="/company-interviews",
    tags=["Company Interviews"],
)

PROJECT_ROOT = Path(__file__).resolve().parents[3]
INTERVIEW_UPLOAD_DIR = PROJECT_ROOT / "uploads" / "interviews"
ALLOWED_VIDEO_EXTENSIONS = {".webm", ".mp4", ".mov"}
MAX_VIDEO_SIZE = 100 * 1024 * 1024
ADAPTIVE_INTERVIEW_VERSION = "jd-adaptive-v1"
DEFAULT_MAX_QUESTIONS = 5


class CompanyInterviewResponse(BaseModel):
    """Student-safe interview session without private scores."""

    id: int
    application_id: int
    company_name: str
    job_title: str
    questions: list[str]
    max_questions: int
    recorded_question_indexes: list[int]
    status: str
    analysis_status: str


class CompanyVideoAnswerResponse(BaseModel):
    message: str
    interview_id: int
    question_index: int
    questions: list[str]
    next_question_index: int | None
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


def get_max_questions() -> int:
    """Return a bounded interview length from local/Render configuration."""
    try:
        configured = int(
            os.getenv("COMPANY_INTERVIEW_MAX_QUESTIONS", DEFAULT_MAX_QUESTIONS)
        )
    except ValueError:
        configured = DEFAULT_MAX_QUESTIONS
    return max(3, min(8, configured))


def question_metadata(question: AdaptiveQuestion) -> dict:
    return question.model_dump(exclude={"question"})


def build_adaptive_question(
    *,
    job: Doc,
    previous_turns: list[dict[str, str]],
    question_index: int,
    max_questions: int,
) -> AdaptiveQuestion:
    return generate_adaptive_question(
        job_title=job.job_title,
        company_name=job.company_name,
        job_description=job.job_description or job.job_title,
        required_skills=split_requirements(job.required_skills),
        previous_turns=previous_turns,
        question_index=question_index,
        max_questions=max_questions,
    )


def initialise_adaptive_fields(interview: Doc, job: Doc) -> Doc:
    """Start adaptive mode or migrate an untouched legacy interview."""
    if interview.adaptive_version == ADAPTIVE_INTERVIEW_VERSION:
        return interview

    video_paths = json.loads(interview.video_paths or "{}")
    if video_paths or interview.analysis_status == "Completed":
        # Preserve an already-started legacy interview instead of invalidating
        # its recordings. New and untouched interviews use adaptive mode.
        return interview

    max_questions = get_max_questions()
    first = build_adaptive_question(
        job=job,
        previous_turns=[],
        question_index=0,
        max_questions=max_questions,
    )
    interview.questions = json.dumps([first.question])
    interview.question_metadata = json.dumps([question_metadata(first)])
    interview.transcripts = "[]"
    interview.max_questions = max_questions
    interview.adaptive_version = ADAPTIVE_INTERVIEW_VERSION
    interview.job_description_snapshot = job.job_description or job.job_title
    interview.required_skills_snapshot = json.dumps(
        split_requirements(job.required_skills)
    )
    interview.status = "In Progress"
    interview.analysis_status = "Not Started"
    return interview


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
    questions = json.loads(interview.questions or "[]")
    return CompanyInterviewResponse(
        id=interview.id,
        application_id=interview.application_id,
        company_name=job.company_name,
        job_title=job.job_title,
        questions=questions,
        max_questions=interview.max_questions or len(questions),
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
    try:
        require_verified_identity_enrollment(student)
    except IdentityContinuityError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail=str(error),
        ) from error

    existing = company_interviews.latest_for_application(application.id)
    if existing:
        previous_version = existing.adaptive_version
        existing = initialise_adaptive_fields(existing, job)
        if previous_version != existing.adaptive_version:
            company_interviews.save(existing)
        return serialize_interview(existing, job)

    max_questions = get_max_questions()
    first_question = build_adaptive_question(
        job=job,
        previous_turns=[],
        question_index=0,
        max_questions=max_questions,
    )
    interview = company_interviews.create(
        {
            "application_id": application.id,
            "questions": json.dumps([first_question.question]),
            "question_metadata": json.dumps(
                [question_metadata(first_question)]
            ),
            "video_paths": "{}",
            "transcripts": "[]",
            "max_questions": max_questions,
            "adaptive_version": ADAPTIVE_INTERVIEW_VERSION,
            "job_description_snapshot": job.job_description or job.job_title,
            "required_skills_snapshot": json.dumps(
                split_requirements(job.required_skills)
            ),
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
def upload_company_video_answer(
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

    video_paths = json.loads(interview.video_paths or "{}")
    if str(question_index) in video_paths:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This question already has a saved answer.",
        )
    if question_index != len(video_paths):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Answer the company interview questions in order.",
        )

    original_filename = video.filename or "answer.webm"
    extension = Path(original_filename).suffix.lower()
    if extension not in ALLOWED_VIDEO_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Only WebM, MP4, or MOV video answers are supported.",
        )

    interview_directory = INTERVIEW_UPLOAD_DIR / f"company-{interview.id}"
    stored_filename = f"question-{question_index + 1}-{uuid4().hex}{extension}"
    stored_path = interview_directory / stored_filename
    try:
        stream_upload_to_path(
            video,
            stored_path,
            max_size=MAX_VIDEO_SIZE,
        )
    except EmptyUploadError as error:
        raise HTTPException(
            status_code=400,
            detail="The recorded video is empty.",
        ) from error
    except UploadTooLargeError as error:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="Each video answer must be 100 MB or smaller.",
        ) from error

    _, student, job = get_interview_context(interview)
    try:
        verify_interview_recording_identity(
            student=student,
            video_path=stored_path,
            stage="company_interview",
            interview_id=interview.id,
            question_index=question_index,
        )
    except IdentityContinuityError as error:
        stored_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=error.status_code,
            detail=str(error),
        ) from error

    try:
        transcript = transcribe_recordings(
            video_paths={"0": str(stored_path)},
            question_count=1,
        )[0]
    except AIAnalysisError as error:
        stored_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(error),
        ) from error
    if len(re.findall(r"[a-zA-Z0-9]+", transcript)) < 3:
        stored_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                "No clear spoken answer was detected. Record the answer again "
                "in a quiet place and speak close to the microphone."
            ),
        )

    video_paths[str(question_index)] = str(stored_path)
    transcripts = json.loads(interview.transcripts or "[]")
    while len(transcripts) <= question_index:
        transcripts.append("")
    transcripts[question_index] = transcript

    max_questions = interview.max_questions or len(questions)
    metadata = json.loads(interview.question_metadata or "[]")
    if (
        interview.adaptive_version == ADAPTIVE_INTERVIEW_VERSION
        and len(video_paths) < max_questions
    ):
        previous_turns = [
            {"question": questions[index], "answer": transcripts[index]}
            for index in range(len(video_paths))
        ]
        next_question = build_adaptive_question(
            job=Doc(
                {
                    **job,
                    "job_description": interview.job_description_snapshot
                    or job.job_description,
                    "required_skills": ", ".join(
                        json.loads(
                            interview.required_skills_snapshot or "[]"
                        )
                    )
                    or job.required_skills,
                }
            ),
            previous_turns=previous_turns,
            question_index=len(video_paths),
            max_questions=max_questions,
        )
        questions.append(next_question.question)
        metadata.append(question_metadata(next_question))

    interview.questions = json.dumps(questions)
    interview.question_metadata = json.dumps(metadata)
    interview.video_paths = json.dumps(video_paths)
    interview.transcripts = json.dumps(transcripts)
    interview.status = (
        "Ready to Submit"
        if len(video_paths) == max_questions
        else "In Progress"
    )
    company_interviews.save(interview)

    return CompanyVideoAnswerResponse(
        message=(
            "Answer transcribed. The next adaptive question is ready."
            if interview.status == "In Progress"
            else "All answers were transcribed and saved successfully."
        ),
        interview_id=interview.id,
        question_index=question_index,
        questions=questions,
        next_question_index=(
            len(video_paths) if interview.status == "In Progress" else None
        ),
        recorded_question_indexes=sorted(int(index) for index in video_paths),
        status=interview.status,
    )


@router.post(
    "/{interview_id}/submit",
    response_model=CompanyInterviewSubmissionResponse,
)
def submit_company_interview(interview_id: int):
    """Evaluate saved transcripts and store the private recruiter result."""
    interview = company_interviews.get(interview_id)
    if not interview:
        raise HTTPException(status_code=404, detail="Company interview not found.")

    application, student, job = get_interview_context(interview)
    questions = json.loads(interview.questions)
    video_paths = json.loads(interview.video_paths or "{}")
    transcripts = json.loads(interview.transcripts or "[]")
    max_questions = interview.max_questions or len(questions)
    if (
        len(video_paths) != max_questions
        or len(questions) != max_questions
        or len(transcripts) != max_questions
        or any(not transcript.strip() for transcript in transcripts)
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Record and transcribe all {max_questions} answers before "
                "submitting the interview."
            ),
        )
    try:
        require_verified_identity_enrollment(student)
        require_verified_recording_checks(
            student_id=student.id,
            stage="company_interview",
            interview_id=interview.id,
            introduction_id=student.self_introduction_id,
            question_count=len(questions),
        )
    except IdentityContinuityError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail=str(error),
        ) from error

    if interview.analysis_status == "Completed":
        return CompanyInterviewSubmissionResponse(
            interview_id=interview.id,
            status=interview.status,
            analysis_status=interview.analysis_status,
            message="The company interview was already submitted for recruiter review.",
        )

    required_skills_value = (
        ", ".join(json.loads(interview.required_skills_snapshot or "[]"))
        if interview.required_skills_snapshot
        else job.required_skills
    )
    job_description = (
        interview.job_description_snapshot
        or job.job_description
        or job.job_title
    )
    required_skills = set(split_requirements(required_skills_value))
    description_keywords = {
        word.lower()
        for word in re.findall(r"[a-zA-Z][a-zA-Z+#.-]{2,}", job_description)
    }
    evaluation_keywords = required_skills | description_keywords

    try:
        interview.analysis_status = "Processing"
        interview.analysis_error = None
        company_interviews.save(interview)

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
        completed_interview = (
            company_interviews.latest_completed_for_application(
                interview.application_id
            )
        )
        if not completed_interview:
            raise HTTPException(
                status_code=404,
                detail="The company interview has not been analyzed yet.",
            )
        interview = completed_interview
    return RecruiterInterviewResult(
        interview_id=interview.id,
        application_id=interview.application_id,
        transcripts=json.loads(interview.transcripts or "[]"),
        evaluation=InterviewEvaluation.model_validate_json(
            interview.ai_evaluation
        ),
    )
