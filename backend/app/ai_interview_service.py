import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

# Keep downloaded speech models inside the project instead of the user's home.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
MODEL_CACHE = BACKEND_ROOT / ".cache" / "huggingface"

from dotenv import load_dotenv
from pydantic import BaseModel, Field

from .models import Doc
from .role_profiles import get_role_profile

load_dotenv(BACKEND_ROOT / ".env")


# Fixed result models keep the frontend response predictable.
class AnswerEvaluation(BaseModel):
    question_index: int
    relevance_score: int = Field(ge=0, le=100)
    technical_score: int = Field(ge=0, le=100)
    communication_score: int = Field(ge=0, le=100)
    feedback: str


class InterviewEvaluation(BaseModel):
    target_role: str
    technical_score: int = Field(ge=0, le=100)
    communication_score: int = Field(ge=0, le=100)
    problem_solving_score: int = Field(ge=0, le=100)
    project_understanding_score: int = Field(ge=0, le=100)
    role_readiness_score: int = Field(ge=0, le=100)
    overall_score: int = Field(ge=0, le=100)
    strengths: list[str]
    improvement_areas: list[str]
    improvement_plan: list[str]
    summary: str
    answer_evaluations: list[AnswerEvaluation]


class AIAnalysisError(Exception):
    """Raised when local transcription or evaluation cannot be completed."""


STOPWORDS = {
    "about",
    "after",
    "also",
    "and",
    "are",
    "did",
    "does",
    "explain",
    "for",
    "from",
    "have",
    "how",
    "important",
    "into",
    "most",
    "one",
    "that",
    "the",
    "their",
    "this",
    "was",
    "what",
    "when",
    "why",
    "with",
    "would",
    "your",
}


def words(text: str) -> list[str]:
    """Convert text into simple lowercase words for transparent matching."""
    return re.findall(r"[a-z0-9+#.-]+", text.lower())


def clamp_score(value: float) -> int:
    return max(0, min(100, round(value)))


@lru_cache(maxsize=1)
def get_local_whisper_model() -> Any:
    """Import and load Whisper only when an interview needs transcription."""
    try:
        from faster_whisper import WhisperModel
    except ImportError as error:
        raise AIAnalysisError(
            "Local speech transcription is not installed. Install the backend requirements and try again."
        ) from error

    MODEL_CACHE.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("HF_HOME", str(MODEL_CACHE))
    model_name = os.getenv("LOCAL_WHISPER_MODEL", "base.en")
    try:
        return WhisperModel(
            model_name,
            device="cpu",
            compute_type="int8",
            download_root=str(MODEL_CACHE),
        )
    except (OSError, RuntimeError, ValueError) as error:
        raise AIAnalysisError(
            "The local speech model could not be loaded. Check the model cache and available disk space."
        ) from error


def transcribe_recordings(
    video_paths: dict[str, str],
    question_count: int,
    *,
    beam_size: int = 1,
    vad_filter: bool = True,
    condition_on_previous_text: bool = True,
    temperature: float = 0.0,
) -> list[str]:
    """Transcribe WebM recordings locally; no interview data leaves the Mac."""
    try:
        model = get_local_whisper_model()
        transcripts: list[str] = []

        for question_index in range(question_count):
            video_path = Path(video_paths[str(question_index)])
            if not video_path.exists():
                raise AIAnalysisError(
                    f"Recorded answer {question_index + 1} could not be found."
                )

            segments, _ = model.transcribe(
                str(video_path),
                language="en",
                beam_size=beam_size,
                vad_filter=vad_filter,
                condition_on_previous_text=condition_on_previous_text,
                temperature=temperature,
            )
            transcript = " ".join(
                segment.text.strip() for segment in segments
            ).strip()
            transcripts.append(transcript)

        return transcripts
    except AIAnalysisError:
        raise
    except Exception as error:
        raise AIAnalysisError(
            "The recorded answers could not be transcribed locally."
        ) from error


def communication_score(word_count: int) -> int:
    """Use answer length as a simple, explainable communication proxy."""
    if word_count == 0:
        return 0
    if word_count < 8:
        return 20
    if word_count < 20:
        return 40
    if word_count < 40:
        return 60
    if word_count < 70:
        return 80
    return 90


def build_role_keywords(student: Doc, target_role: str | None = None) -> set[str]:
    profile = get_role_profile(target_role or student.target_role or "")
    if not profile:
        return set()

    keywords: set[str] = set()
    for group_name in ("core_skills", "supporting_skills"):
        for label, aliases in profile[group_name].items():
            keywords.add(label.lower())
            keywords.update(alias.lower() for alias in aliases)
    keywords.update(term.lower() for term in profile["role_terms"])
    return keywords


def phrase_hits(text: str, phrases: set[str]) -> int:
    lowered = text.lower()
    return sum(1 for phrase in phrases if phrase in lowered)


def evaluate_one_answer(
    question_index: int,
    question: str,
    transcript: str,
    role_keywords: set[str],
) -> AnswerEvaluation:
    """Score one answer with visible rules instead of a black-box decision."""
    transcript_words = words(transcript)
    word_count = len(transcript_words)
    if word_count == 0:
        return AnswerEvaluation(
            question_index=question_index,
            relevance_score=0,
            technical_score=0,
            communication_score=0,
            feedback=(
                "No clear speech was detected. Record the answer again and "
                "speak for 30–60 seconds."
            ),
        )

    transcript_word_set = set(transcript_words)
    question_keywords = {
        word
        for word in words(question)
        if word not in STOPWORDS and len(word) > 2
    }
    question_overlap = len(question_keywords & transcript_word_set)
    role_hits = phrase_hits(transcript, role_keywords)
    evidence_terms = {
        "because",
        "built",
        "challenge",
        "created",
        "implemented",
        "improved",
        "result",
        "tested",
        "used",
    }
    evidence_hits = len(evidence_terms & transcript_word_set)

    length_component = min(30, word_count * 0.75)
    relevance = clamp_score(
        length_component + question_overlap * 12 + role_hits * 10
    )
    technical = clamp_score(
        min(35, word_count * 0.55) + role_hits * 15 + evidence_hits * 7
    )
    communication = communication_score(word_count)

    if word_count < 12:
        feedback = (
            "The answer is too short. Add the situation, your action, the "
            "technical reason, and the result."
        )
    elif relevance < 50:
        feedback = (
            "Connect the answer more directly to the question and the selected "
            "role using one concrete example."
        )
    elif technical < 50:
        feedback = (
            "The answer is understandable, but it needs specific tools, "
            "decisions, challenges, and measurable results."
        )
    else:
        feedback = (
            "The answer contains relevant evidence. Improve it further by "
            "making the result measurable and keeping the structure concise."
        )

    return AnswerEvaluation(
        question_index=question_index,
        relevance_score=relevance,
        technical_score=technical,
        communication_score=communication,
        feedback=feedback,
    )


def average(values: list[int]) -> int:
    return round(sum(values) / len(values)) if values else 0


def evaluate_transcripts(
    student: Doc,
    questions: list[str],
    transcripts: list[str],
    *,
    target_role: str | None = None,
    extra_keywords: set[str] | None = None,
    role_match_score: float | None = None,
) -> InterviewEvaluation:
    """Create a local, deterministic readiness profile from the transcripts."""
    if len(questions) != len(transcripts):
        raise AIAnalysisError(
            "Every interview question must have one transcript."
        )

    evaluated_role = target_role or student.target_role or "Selected role"
    role_keywords = build_role_keywords(student, evaluated_role)
    role_keywords.update(keyword.lower() for keyword in (extra_keywords or set()))
    answer_evaluations = [
        evaluate_one_answer(
            question_index=index,
            question=question,
            transcript=transcripts[index],
            role_keywords=role_keywords,
        )
        for index, question in enumerate(questions)
    ]

    # The introduction is excluded from the overall technical score.
    technical_answers = answer_evaluations[1:] or answer_evaluations
    technical = average(
        [answer.technical_score for answer in technical_answers]
    )
    communication = average(
        [answer.communication_score for answer in answer_evaluations]
    )

    project_answers = answer_evaluations[1:3]
    project_understanding = average(
        [
            round(
                (answer.technical_score + answer.relevance_score) / 2
            )
            for answer in project_answers
        ]
    )
    problem_solving = average(
        [
            answer.relevance_score
            for answer in answer_evaluations[2:]
        ]
        + [technical]
    )
    average_relevance = average(
        [answer.relevance_score for answer in answer_evaluations]
    )
    role_readiness = clamp_score(
        technical * 0.35
        + average_relevance * 0.35
        + (
            role_match_score
            if role_match_score is not None
            else student.role_match_score or 0
        )
        * 0.30
    )

    overall = clamp_score(
        technical * 0.30
        + communication * 0.20
        + problem_solving * 0.20
        + project_understanding * 0.15
        + role_readiness * 0.15
    )

    categories = {
        "Technical detail": technical,
        "Communication completeness": communication,
        "Problem-solving evidence": problem_solving,
        "Project understanding": project_understanding,
        "Role readiness": role_readiness,
    }
    strengths = [
        f"{name} ({score}/100)"
        for name, score in categories.items()
        if score >= 60
    ]
    if not strengths:
        strengths = [
            "Completed the full role-specific video interview workflow."
        ]

    improvement_areas = [
        f"{name} ({score}/100)"
        for name, score in sorted(categories.items(), key=lambda item: item[1])
        if score < 60
    ][:3]
    short_answer_count = sum(
        1 for transcript in transcripts if len(words(transcript)) < 12
    )
    if short_answer_count:
        improvement_areas.insert(
            0,
            f"{short_answer_count} answer(s) were missing or too short.",
        )

    role_profile = get_role_profile(evaluated_role)
    project_advice = (
        role_profile["project_advice"]
        if role_profile
        else "Build one role-relevant project and explain your contribution."
    )
    improvement_plan = [
        "Record each answer for 30–60 seconds using Situation, Task, Action, and Result.",
        project_advice,
        "Mention the tools used, one technical decision, one challenge, and a measurable result.",
    ]

    if overall >= 75:
        level = "strong practice readiness"
    elif overall >= 50:
        level = "developing practice readiness"
    else:
        level = "early practice readiness"
    summary = (
        f"The local evaluator found {level} for "
        f"{evaluated_role}. "
        f"The score is based on transcript relevance, technical evidence, "
        f"answer completeness, resume role match, and project explanation."
    )

    return InterviewEvaluation(
        target_role=evaluated_role,
        technical_score=technical,
        communication_score=communication,
        problem_solving_score=problem_solving,
        project_understanding_score=project_understanding,
        role_readiness_score=role_readiness,
        overall_score=overall,
        strengths=strengths,
        improvement_areas=improvement_areas,
        improvement_plan=improvement_plan,
        summary=summary,
        answer_evaluations=answer_evaluations,
    )
