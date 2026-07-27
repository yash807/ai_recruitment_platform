import json
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
from ..models import Doc, mock_interviews, students
from ..role_profiles import get_role_profile


router = APIRouter(prefix="/mock-interviews", tags=["Mock Interviews"])

# Interview videos are stored on disk; their paths are stored in MongoDB.
PROJECT_ROOT = Path(__file__).resolve().parents[3]
INTERVIEW_UPLOAD_DIR = PROJECT_ROOT / "uploads" / "interviews"
ALLOWED_VIDEO_EXTENSIONS = {".webm", ".mp4", ".mov"}
MAX_VIDEO_SIZE = 100 * 1024 * 1024


# Data returned when an interview starts or is loaded.
class MockInterviewResponse(BaseModel):
    id: int
    student_id: int
    questions: list[str]
    recorded_question_indexes: list[int]
    status: str
    analysis_status: str
    overall_score: float


# Data returned after one video answer is uploaded.
class VideoAnswerResponse(BaseModel):
    message: str
    interview_id: int
    question_index: int
    recorded_question_indexes: list[int]
    status: str


# Complete Day 4 result returned to the Next.js page.
class InterviewAnalysisResponse(BaseModel):
    interview_id: int
    analysis_status: str
    transcripts: list[str]
    evaluation: InterviewEvaluation


# Build five questions from the student's skills and selected target role.
def generate_mock_questions(student: Doc) -> list[str]:
    skills = [
        skill.strip()
        for skill in (student.skills or "").split(",")
        if skill.strip()
    ]
    primary_skill = skills[0] if skills else "your strongest technical skill"
    target_role = student.target_role or "your preferred role"
    role_profile = get_role_profile(student.target_role or "")
    # Two questions come from the shared role catalogue.
    role_questions = (
        role_profile["interview_questions"]
        if role_profile
        else (
            f"What fundamentals are most important for {target_role}?",
            f"Describe a problem you would expect to solve as a {target_role}.",
        )
    )

    return [
        f"Tell me about yourself, your education, and why you want to pursue opportunities in {target_role}.",
        "Explain your most important project. What problem did it solve, and what was your contribution?",
        f"How have you used {primary_skill} in a project? Explain one technical decision you made.",
        role_questions[0],
        role_questions[1],
    ]


# Convert JSON text stored in Mongo back into normal Python lists.
def serialize_interview(interview: Doc) -> MockInterviewResponse:
    video_paths = json.loads(interview.video_paths or "{}")
    return MockInterviewResponse(
        id=interview.id,
        student_id=interview.student_id,
        questions=json.loads(interview.questions),
        recorded_question_indexes=sorted(int(index) for index in video_paths),
        status=interview.status,
        analysis_status=interview.analysis_status,
        overall_score=interview.overall_score or 0,
    )


# Validate the student and create a new mock-interview session.
@router.post("/start/{student_id}", response_model=MockInterviewResponse)
def start_mock_interview(student_id: int):
    student = students.get(student_id)
    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student not found.",
        )
    if not student.resume_text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Upload and analyze the student's resume before starting the mock interview.",
        )
    if not student.target_role or not get_role_profile(student.target_role):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Select a supported target job role before starting the mock interview.",
        )

    interview = mock_interviews.create(
        {
            "student_id": student.id,
            "questions": json.dumps(generate_mock_questions(student)),
            "video_paths": "{}",
            "status": "In Progress",
            "transcripts": "[]",
            "analysis_status": "Not Started",
            "overall_score": 0,
        }
    )
    return serialize_interview(interview)


# Load one existing mock-interview session.
@router.get("/{interview_id}", response_model=MockInterviewResponse)
def get_mock_interview(interview_id: int):
    interview = mock_interviews.get(interview_id)
    if not interview:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mock interview not found.",
        )
    return serialize_interview(interview)


# Receive and save one recorded answer for one question.
@router.post(
    "/{interview_id}/answers/{question_index}",
    response_model=VideoAnswerResponse,
)
async def upload_video_answer(
    interview_id: int,
    question_index: int,
    video: UploadFile = File(...),
):
    interview = mock_interviews.get(interview_id)
    if not interview:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mock interview not found.",
        )

    questions = json.loads(interview.questions)
    if question_index < 0 or question_index >= len(questions):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid interview question number.",
        )

    original_filename = video.filename or "answer.webm"
    extension = Path(original_filename).suffix.lower()
    if extension not in ALLOWED_VIDEO_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only WebM, MP4, or MOV video answers are supported.",
        )

    # Read the uploaded recording and reject empty or oversized files.
    video_bytes = await video.read()
    if not video_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The recorded video is empty.",
        )
    if len(video_bytes) > MAX_VIDEO_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="Each video answer must be 100 MB or smaller.",
        )

    # Each interview receives its own folder containing five answer files.
    interview_directory = INTERVIEW_UPLOAD_DIR / f"mock-{interview.id}"
    interview_directory.mkdir(parents=True, exist_ok=True)
    stored_filename = f"question-{question_index + 1}-{uuid4().hex}{extension}"
    stored_path = interview_directory / stored_filename
    stored_path.write_bytes(video_bytes)

    # Update the JSON mapping: question index -> saved video path.
    video_paths = json.loads(interview.video_paths or "{}")
    previous_path = (
        Path(video_paths[str(question_index)])
        if str(question_index) in video_paths
        else None
    )
    video_paths[str(question_index)] = str(stored_path)
    interview.video_paths = json.dumps(video_paths)
    interview.status = "Completed" if len(video_paths) == len(questions) else "In Progress"
    mock_interviews.save(interview)

    if previous_path and previous_path != stored_path:
        previous_path.unlink(missing_ok=True)

    recorded_indexes = sorted(int(index) for index in video_paths)
    return VideoAnswerResponse(
        message="Video answer saved successfully.",
        interview_id=interview.id,
        question_index=question_index,
        recorded_question_indexes=recorded_indexes,
        status=interview.status,
    )


# Transcribe all five videos, evaluate their content, and save the AI profile.
@router.post(
    "/{interview_id}/analyze",
    response_model=InterviewAnalysisResponse,
)
def analyze_mock_interview(interview_id: int):
    interview = mock_interviews.get(interview_id)
    if not interview:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mock interview not found.",
        )
    if interview.status != "Completed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Record all five answers before starting AI analysis.",
        )

    student = students.get(interview.student_id)
    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student profile not found.",
        )

    # Reuse a completed result instead of charging for the same analysis twice.
    if interview.analysis_status == "Completed" and interview.ai_evaluation:
        return InterviewAnalysisResponse(
            interview_id=interview.id,
            analysis_status=interview.analysis_status,
            transcripts=json.loads(interview.transcripts or "[]"),
            evaluation=InterviewEvaluation.model_validate_json(
                interview.ai_evaluation
            ),
        )

    questions = json.loads(interview.questions)
    video_paths = json.loads(interview.video_paths or "{}")

    try:
        interview.analysis_status = "Processing"
        interview.analysis_error = None
        mock_interviews.save(interview)

        transcripts = transcribe_recordings(
            video_paths=video_paths,
            question_count=len(questions),
        )
        evaluation = evaluate_transcripts(
            student=student,
            questions=questions,
            transcripts=transcripts,
        )
        # Store both the detailed interview result and the student-level summary.
        interview.transcripts = json.dumps(transcripts)
        interview.ai_evaluation = evaluation.model_dump_json()
        interview.analysis_status = "Completed"
        interview.overall_score = evaluation.overall_score
        mock_interviews.save(interview)

        student.mock_interview_score = evaluation.overall_score
        student.ai_profile_summary = evaluation.summary
        students.save(student)
    except AIAnalysisError as error:
        interview.analysis_status = "Failed"
        interview.analysis_error = str(error)
        try:
            mock_interviews.save(interview)
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
                "Local interview analysis failed unexpectedly. Restart the "
                "backend and retry."
            ),
        ) from error

    return InterviewAnalysisResponse(
        interview_id=interview.id,
        analysis_status=interview.analysis_status,
        transcripts=transcripts,
        evaluation=evaluation,
    )


# Load a previously saved analysis without calling OpenAI again.
@router.get(
    "/{interview_id}/analysis",
    response_model=InterviewAnalysisResponse,
)
def get_mock_interview_analysis(interview_id: int):
    interview = mock_interviews.get(interview_id)
    if not interview:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mock interview not found.",
        )
    if interview.analysis_status != "Completed" or not interview.ai_evaluation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="AI analysis has not been completed for this interview.",
        )

    return InterviewAnalysisResponse(
        interview_id=interview.id,
        analysis_status=interview.analysis_status,
        transcripts=json.loads(interview.transcripts or "[]"),
        evaluation=InterviewEvaluation.model_validate_json(
            interview.ai_evaluation
        ),
    )
