"""Self-introduction recording, extraction, and identity enrollment routes."""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel
from pymongo.errors import PyMongoError

from ..ai_interview_service import AIAnalysisError
from ..identity_verification_service import (
    IdentityVerificationError,
    enroll_identity_from_video,
    get_video_duration_seconds,
)
from ..media_uploads import (
    EmptyUploadError,
    UploadTooLargeError,
    stream_upload_to_path,
)
from ..models import self_introductions, students
from ..role_profiles import get_role_profile
from ..self_introduction_service import (
    SelfIntroductionAnswer,
    SelfIntroductionProfile,
    challenge_phrase_was_spoken,
    extract_self_introduction_profile,
    transcribe_self_introduction,
)


router = APIRouter(
    prefix="/self-introductions",
    tags=["Self Introductions"],
)

PROJECT_ROOT = Path(__file__).resolve().parents[3]
SELF_INTRODUCTION_UPLOAD_DIR = PROJECT_ROOT / "uploads" / "self-introductions"
ALLOWED_VIDEO_EXTENSIONS = {".webm", ".mp4", ".mov"}
MAX_VIDEO_SIZE = 150 * 1024 * 1024
CHALLENGE_TTL = timedelta(minutes=20)
QUESTION_TIME_LIMIT_SECONDS = 5.0

COLORS = (
    "amber",
    "blue",
    "coral",
    "green",
    "indigo",
    "orange",
    "silver",
    "teal",
    "violet",
    "yellow",
)
NOUNS = (
    "bridge",
    "comet",
    "forest",
    "garden",
    "harbor",
    "meadow",
    "planet",
    "river",
    "summit",
    "valley",
)
NUMBERS = ("one", "two", "three", "four", "five", "six", "seven", "eight", "nine")
CODEWORDS = (
    "atlas",
    "breeze",
    "cabin",
    "delta",
    "echo",
    "falcon",
    "lotus",
    "maple",
    "orbit",
    "piano",
    "quartz",
    "tiger",
)

INTRODUCTION_TEMPLATE = [
    "State your name, college, degree, branch, and current year.",
    "Name the job role you are targeting and why it interests you.",
    "Mention your strongest technical skills.",
    "Describe your most important project and the problem it solves.",
    "Explain your personal contribution to that project.",
    "Name the main technologies you used.",
    "Describe one challenge you faced and how you solved it.",
    "Summarize your internship or work experience, if any.",
    "State your career goal.",
    "Clearly speak the verification phrase shown on screen.",
]


class SelfIntroductionChallengeResponse(BaseModel):
    introduction_id: int
    student_id: int
    status: str
    challenge_phrase: str
    challenge: str
    instruction: str
    template: list[str]
    recommended_duration_seconds: dict[str, int]


class SelfIntroductionSubmissionResponse(BaseModel):
    introduction_id: int
    student_id: int
    status: str
    liveness_status: str
    identity_enrollment_status: str
    transcript: str
    question_answers: list[SelfIntroductionAnswer]
    timing_summary: dict[str, float | int]
    extracted_profile: SelfIntroductionProfile
    redirect_to: str
    message: str


def _new_challenge_phrase() -> str:
    return (
        "My verification phrase is "
        f"{secrets.choice(COLORS)} {secrets.choice(NOUNS)} "
        f"{secrets.choice(NUMBERS)} {secrets.choice(CODEWORDS)}."
    )


def _serialize_challenge(introduction) -> SelfIntroductionChallengeResponse:
    challenge_phrase = introduction.challenge_phrase or _new_challenge_phrase()
    return SelfIntroductionChallengeResponse(
        introduction_id=introduction.id,
        student_id=introduction.student_id,
        status=introduction.status,
        challenge_phrase=challenge_phrase,
        challenge=challenge_phrase,
        instruction=(
            "Upload or record one continuous video. Start every answer by saying "
            "'Question 1', 'Question 2', and so on through 'Question 10'. Keep "
            "your full face visible and keep each answer close to five seconds."
        ),
        template=INTRODUCTION_TEMPLATE,
        recommended_duration_seconds={"minimum": 30, "maximum": 75},
    )


def _challenge_is_expired(created_at: datetime | None) -> bool:
    if not created_at:
        return True
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - created_at > CHALLENGE_TTL


@router.get(
    "/challenge/{student_id}",
    response_model=SelfIntroductionChallengeResponse,
)
def get_self_introduction_challenge(student_id: int):
    """Create or reuse the student's current recording challenge."""
    student = students.get(student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")
    if not student.resume_text:
        raise HTTPException(
            status_code=400,
            detail="Upload and analyze the resume before recording the self-introduction.",
        )
    if not student.target_role or not get_role_profile(student.target_role):
        raise HTTPException(
            status_code=400,
            detail="Select a supported target role before recording the self-introduction.",
        )

    existing = self_introductions.latest_for_student(student_id)
    if existing and existing.status == "Completed":
        raise HTTPException(
            status_code=409,
            detail=(
                "The self-introduction is already completed and locked. "
                "Proceed to the mock interview."
            ),
        )
    if existing and existing.status == "Processing":
        if _challenge_is_expired(existing.challenge_created_at):
            existing.status = "Needs Retake"
            existing.analysis_error = (
                "The previous processing attempt did not finish."
            )
            self_introductions.save(existing)
        else:
            raise HTTPException(
                status_code=409,
                detail="The self-introduction is already being processed.",
            )
    if existing and existing.status in {"Ready to Record", "Needs Retake"}:
        if (
            existing.status == "Needs Retake"
            or not existing.challenge_phrase
            or _challenge_is_expired(existing.challenge_created_at)
        ):
            existing.challenge_phrase = _new_challenge_phrase()
            existing.challenge_created_at = datetime.now(timezone.utc)
            existing.challenge_consumed_at = None
            existing.status = "Ready to Record"
            self_introductions.save(existing)
        student.self_introduction_id = existing.id
        student.self_introduction_status = "Ready to Record"
        student.identity_enrollment_status = "Pending"
        students.save(student)
        return _serialize_challenge(existing)

    challenge_phrase = _new_challenge_phrase()
    introduction = self_introductions.create(
        {
            "student_id": student.id,
            "status": "Ready to Record",
            "liveness_status": "Pending",
            "identity_enrollment_status": "Pending",
            "challenge_phrase": challenge_phrase,
            "challenge_created_at": datetime.now(timezone.utc),
        }
    )
    student.self_introduction_id = introduction.id
    student.self_introduction_status = "Ready to Record"
    student.identity_enrollment_status = "Pending"
    students.save(student)
    return _serialize_challenge(introduction)


@router.post(
    "/{introduction_id}/submit",
    response_model=SelfIntroductionSubmissionResponse,
)
def submit_self_introduction(
    introduction_id: int,
    video: UploadFile = File(...),
    duration_seconds: float = Form(...),
):
    """Process the recording immediately and unlock the mock interview."""
    introduction = self_introductions.get(introduction_id)
    if not introduction:
        raise HTTPException(status_code=404, detail="Self-introduction not found.")
    student = students.get(introduction.student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")
    if student.self_introduction_id != introduction.id:
        raise HTTPException(
            status_code=409,
            detail="This is not the student's current self-introduction session.",
        )
    if student.self_introduction_status == "Completed":
        raise HTTPException(
            status_code=409,
            detail="The student's self-introduction is already completed and locked.",
        )
    if introduction.status == "Completed":
        raise HTTPException(
            status_code=409,
            detail=(
                "This self-introduction is already completed and its identity "
                "reference is locked."
            ),
        )
    if introduction.status == "Processing":
        raise HTTPException(
            status_code=409,
            detail="This self-introduction is already being processed.",
        )
    if introduction.status not in {"Ready to Record", "Needs Retake"}:
        raise HTTPException(
            status_code=409,
            detail="This self-introduction session is no longer active.",
        )
    if _challenge_is_expired(introduction.challenge_created_at):
        raise HTTPException(
            status_code=409,
            detail="The verification phrase expired. Reload the page for a new phrase.",
        )

    if duration_seconds < 10 or duration_seconds > 77:
        raise HTTPException(
            status_code=400,
            detail="Please submit one continuous self-introduction of 10–75 seconds.",
        )

    original_filename = video.filename or "self-introduction.webm"
    extension = Path(original_filename).suffix.lower()
    if extension not in ALLOWED_VIDEO_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Only WebM, MP4, or MOV self-introduction videos are supported.",
        )

    student_directory = SELF_INTRODUCTION_UPLOAD_DIR / f"student-{student.id}"
    stored_path = student_directory / f"introduction-{uuid4().hex}{extension}"
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
            detail="The self-introduction video must be 150 MB or smaller.",
        ) from error

    try:
        actual_duration_seconds = get_video_duration_seconds(stored_path)
    except IdentityVerificationError as error:
        stored_path.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=str(error)) from error
    if actual_duration_seconds < 8 or actual_duration_seconds > 85:
        stored_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=400,
            detail=(
                "The encoded video must be no longer than 75 seconds. "
                f"Detected duration: {actual_duration_seconds:.1f} seconds."
            ),
        )

    previous_path = Path(introduction.video_path) if introduction.video_path else None
    claimed_introduction = self_introductions.claim_for_processing(introduction.id)
    if not claimed_introduction:
        stored_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=409,
            detail="This verification phrase was already used or is no longer active.",
        )
    introduction = claimed_introduction
    introduction.video_path = str(stored_path)
    introduction.analysis_error = None
    self_introductions.save(introduction)

    try:
        enrollment = enroll_identity_from_video(stored_path)
        if enrollment.status != "Verified":
            introduction.status = "Needs Retake"
            introduction.liveness_status = "Needs Retake"
            introduction.identity_enrollment_status = enrollment.status
            introduction.identity_reference = None
            introduction.video_path = None
            introduction.analysis_error = enrollment.review_reason
            self_introductions.save(introduction)

            student.self_introduction_status = "Needs Retake"
            student.identity_enrollment_status = enrollment.status
            students.save(student)
            stored_path.unlink(missing_ok=True)
            raise HTTPException(
                status_code=422,
                detail=(
                    enrollment.review_reason
                    or "Keep one face clearly visible throughout the recording and try again."
                ),
            )

        transcription = transcribe_self_introduction(
            stored_path,
            INTRODUCTION_TEMPLATE,
            time_limit_seconds=QUESTION_TIME_LIMIT_SECONDS,
        )
        transcript = transcription.transcript

        if transcription.missing_question_numbers:
            missing = ", ".join(
                str(number) for number in transcription.missing_question_numbers
            )
            introduction.status = "Needs Retake"
            introduction.liveness_status = "Verified"
            introduction.identity_enrollment_status = "Needs Retake"
            introduction.identity_reference = None
            introduction.video_path = None
            introduction.transcript = transcript
            introduction.question_answers = [
                answer.model_dump() for answer in transcription.answers
            ]
            introduction.analysis_error = (
                f"Question markers or answers were missing for: {missing}."
            )
            self_introductions.save(introduction)
            student.self_introduction_status = "Needs Retake"
            student.identity_enrollment_status = "Needs Retake"
            students.save(student)
            stored_path.unlink(missing_ok=True)
            raise HTTPException(
                status_code=422,
                detail=(
                    "The video could not be split into all ten answers. Start "
                    "each answer by clearly saying its number. Missing question "
                    f"numbers: {missing}."
                ),
            )

        phrase_was_detected = challenge_phrase_was_spoken(
            transcript,
            introduction.challenge_phrase or "",
        )

        if not phrase_was_detected:
            introduction.status = "Needs Retake"
            introduction.liveness_status = "Rejected"
            introduction.identity_enrollment_status = "Needs Review"
            introduction.identity_reference = None
            introduction.video_path = None
            introduction.transcript = transcript
            introduction.analysis_error = (
                "The spoken verification phrase was not detected."
            )
            self_introductions.save(introduction)

            student.self_introduction_status = "Needs Retake"
            student.identity_enrollment_status = "Needs Review"
            students.save(student)
            stored_path.unlink(missing_ok=True)
            transcript_tail = " ".join(transcript.split()[-30:]).strip()[:400]
            heard_message = (
                f' Whisper heard near the end: “{transcript_tail}”'
                if transcript_tail
                else " No clear speech was detected in the recording."
            )
            raise HTTPException(
                status_code=422,
                detail=(
                    "The verification phrase was not detected. Record again "
                    "and clearly speak the exact phrase shown on screen."
                    f"{heard_message}"
                ),
            )

        extracted_profile = extract_self_introduction_profile(student, transcript)
        introduction.transcript = transcript
        introduction.question_answers = [
            answer.model_dump() for answer in transcription.answers
        ]
        introduction.timing_summary = {
            "question_count": len(transcription.answers),
            "within_time_limit_count": sum(
                answer.within_time_limit for answer in transcription.answers
            ),
            "time_limit_seconds": QUESTION_TIME_LIMIT_SECONDS,
            "total_answer_seconds": round(
                sum(answer.duration_seconds for answer in transcription.answers),
                2,
            ),
        }
        introduction.extracted_profile = extracted_profile.model_dump()
        introduction.identity_reference = enrollment.reference
        introduction.liveness_status = "Verified"
        introduction.identity_enrollment_status = "Verified"
        introduction.status = "Completed"
        introduction.submitted_at = datetime.now(timezone.utc)
        self_introductions.save(introduction)

        student.self_introduction_id = introduction.id
        student.self_introduction_status = "Completed"
        student.identity_enrollment_status = "Verified"
        students.save(student)

        if previous_path and previous_path != stored_path:
            previous_path.unlink(missing_ok=True)
    except HTTPException:
        raise
    except (AIAnalysisError, IdentityVerificationError) as error:
        introduction.status = "Needs Retake"
        introduction.video_path = None
        introduction.analysis_error = str(error)
        self_introductions.save(introduction)
        student.self_introduction_status = "Needs Retake"
        students.save(student)
        stored_path.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=str(error)) from error
    except PyMongoError as error:
        stored_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=503,
            detail="The database is temporarily unavailable. Please retry.",
        ) from error
    except Exception as error:
        introduction.status = "Needs Retake"
        introduction.video_path = None
        introduction.analysis_error = "Self-introduction processing failed."
        try:
            self_introductions.save(introduction)
        except PyMongoError:
            pass
        stored_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=500,
            detail="The self-introduction could not be processed. Please record it again.",
        ) from error

    return SelfIntroductionSubmissionResponse(
        introduction_id=introduction.id,
        student_id=student.id,
        status=introduction.status,
        liveness_status=introduction.liveness_status,
        identity_enrollment_status=introduction.identity_enrollment_status,
        transcript=transcript,
        question_answers=transcription.answers,
        timing_summary=introduction.timing_summary,
        extracted_profile=extracted_profile,
        redirect_to=f"/mock-interview?student_id={student.id}",
        message=(
            "Self-introduction completed and identity reference enrolled. "
            "Proceeding to the mock interview."
        ),
    )
