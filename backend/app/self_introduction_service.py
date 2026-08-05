"""Deterministic self-introduction transcription and profile extraction.

The prototype deliberately keeps this step explainable. Speech is transcribed
with the same local Whisper model used by interviews, then a small set of
transparent rules extracts self-reported highlights. No emotion, personality,
or demographic traits are inferred from the recording.
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from pathlib import Path

from pydantic import BaseModel

from .ai_interview_service import AIAnalysisError, get_local_whisper_model
from .models import Doc
from .role_profiles import get_role_profile


class SelfIntroductionProfile(BaseModel):
    full_name: str
    college: str | None = None
    branch: str | None = None
    target_role: str | None = None
    professional_summary: str
    skills_mentioned: list[str]
    project_highlights: list[str]
    experience_highlights: list[str]
    career_goal: str | None = None
    source: str = "self-reported introduction transcript"


class SelfIntroductionAnswer(BaseModel):
    question_number: int
    prompt: str
    transcript: str
    start_seconds: float
    end_seconds: float
    duration_seconds: float
    time_limit_seconds: float
    within_time_limit: bool


class SelfIntroductionTranscription(BaseModel):
    transcript: str
    answers: list[SelfIntroductionAnswer]
    missing_question_numbers: list[int]


class _TimedWord(BaseModel):
    text: str
    start_seconds: float
    end_seconds: float


_SPOKEN_WORD_ALIASES = {
    "amber": {"ember"},
    "coral": {"choral"},
    "comet": {"comment"},
    "harbor": {"harbour"},
    "summit": {"submit"},
    "valley": {"value"},
    "one": {"won"},
    "two": {"to", "too"},
    "three": {"tree"},
    "four": {"for", "fore"},
    "six": {"sicks"},
    "eight": {"ate"},
    "violet": {"boiled", "voilait", "wallet"},
    "breeze": {"breezy"},
    "maple": {"mabel"},
    "quartz": {"quarts", "courts"},
}
_PHRASE_MARKER_ALIASES = {"phrase", "phase", "face", "frays", "code"}
_CHALLENGE_FILLER_WORDS = {"is", "was", "equals", "equal", "uh", "um"}
_QUESTION_NUMBER_ALIASES = {
    1: {"1", "one", "won", "first"},
    2: {"2", "two", "to", "too", "second"},
    3: {"3", "three", "tree", "third"},
    4: {"4", "four", "for", "fore", "fourth"},
    5: {"5", "five", "fifth"},
    6: {"6", "six", "sicks", "sixth"},
    7: {"7", "seven", "seventh"},
    8: {"8", "eight", "ate", "eighth"},
    9: {"9", "nine", "ninth"},
    10: {"10", "ten", "tenth"},
}


def normalize_spoken_text(value: str) -> str:
    """Normalize text so a spoken challenge survives minor punctuation changes."""
    number_words = {
        "0": "zero",
        "1": "one",
        "2": "two",
        "3": "three",
        "4": "four",
        "5": "five",
        "6": "six",
        "7": "seven",
        "8": "eight",
        "9": "nine",
    }
    words = re.findall(r"[a-z0-9]+", value.lower())
    return " ".join(number_words.get(word, word) for word in words)


def _spoken_word_score(candidate_words: list[str], expected_word: str) -> float:
    """Score one expected word against one or two ASR-produced tokens."""
    candidate = "".join(candidate_words)
    accepted_words = {
        expected_word,
        *_SPOKEN_WORD_ALIASES.get(expected_word, set()),
    }
    if candidate in accepted_words:
        return 1.0
    return max(
        SequenceMatcher(None, candidate, accepted).ratio()
        for accepted in accepted_words
    )


def _challenge_words_follow_marker(
    transcript_words: list[str],
    start: int,
    expected_words: list[str],
) -> bool:
    """Align all random words in a short, ordered post-marker window."""
    window = transcript_words[start : start + 10]

    def matches(
        position: int,
        expected_index: int,
        scores: list[float],
        skipped_fillers: int,
    ) -> bool:
        if expected_index == len(expected_words):
            return (
                len(scores) == len(expected_words)
                and min(scores) >= 0.68
                and sum(scores) / len(scores) >= 0.84
                and sum(score >= 0.90 for score in scores) >= 3
            )
        if position >= len(window):
            return False

        # A codeword such as "orbit" can be emitted as "or bit". Try one
        # token first, then a two-token join, without permitting reordering.
        for width in (1, 2):
            if position + width > len(window):
                continue
            score = _spoken_word_score(
                window[position : position + width],
                expected_words[expected_index],
            )
            if score >= 0.68 and matches(
                position + width,
                expected_index + 1,
                [*scores, score],
                skipped_fillers,
            ):
                return True

        # Permit only speech fillers, not arbitrary challenge-vocabulary
        # words. This prevents a vocabulary dump from satisfying the check.
        if (
            skipped_fillers < 2
            and window[position] in _CHALLENGE_FILLER_WORDS
        ):
            return matches(
                position + 1,
                expected_index,
                scores,
                skipped_fillers + 1,
            )
        return False

    return matches(0, 0, [], 0)


def challenge_phrase_was_spoken(transcript: str, challenge_phrase: str) -> bool:
    """Require every random word in order after a tolerant spoken marker."""
    transcript_words = normalize_spoken_text(transcript).split()
    challenge_words = normalize_spoken_text(challenge_phrase).split()
    if not transcript_words or len(challenge_words) < 4:
        return False

    random_words = challenge_words[-4:]
    for index in range(len(transcript_words) - 1):
        verification_score = _spoken_word_score(
            [transcript_words[index]],
            "verification",
        )
        phrase_word = transcript_words[index + 1]
        phrase_score = max(
            SequenceMatcher(None, phrase_word, alias).ratio()
            for alias in _PHRASE_MARKER_ALIASES
        )
        if verification_score < 0.84 or phrase_score < 0.70:
            continue
        if _challenge_words_follow_marker(
            transcript_words,
            index + 2,
            random_words,
        ):
            return True
    return False


def _sentences(transcript: str) -> list[str]:
    return [
        " ".join(sentence.split())
        for sentence in re.split(r"(?<=[.!?])\s+|\n+", transcript.strip())
        if sentence.strip()
    ]


def _matching_sentences(
    sentences: list[str],
    keywords: tuple[str, ...],
    limit: int,
) -> list[str]:
    matches = [
        sentence
        for sentence in sentences
        if any(keyword in sentence.lower() for keyword in keywords)
    ]
    return matches[:limit]


def extract_self_introduction_profile(
    student: Doc,
    transcript: str,
) -> SelfIntroductionProfile:
    """Extract only statements supported by the transcript or student profile."""
    sentences = _sentences(transcript)
    transcript_lower = transcript.lower()

    known_skills = [
        value.strip()
        for value in (student.skills or "").split(",")
        if value.strip()
    ]
    role_profile = get_role_profile(student.target_role or "")
    role_skills: list[str] = []
    if role_profile:
        role_skills = [
            *role_profile["core_skills"].keys(),
            *role_profile["supporting_skills"].keys(),
        ]

    skills_mentioned: list[str] = []
    for skill in [*known_skills, *role_skills]:
        if skill.lower() in transcript_lower and skill not in skills_mentioned:
            skills_mentioned.append(skill)

    project_highlights = _matching_sentences(
        sentences,
        (
            "project",
            "built",
            "developed",
            "created",
            "implemented",
            "designed",
        ),
        limit=3,
    )
    experience_highlights = _matching_sentences(
        sentences,
        (
            "intern",
            "experience",
            "worked",
            "responsible",
            "team",
            "volunteer",
        ),
        limit=3,
    )
    career_goal_matches = _matching_sentences(
        sentences,
        (
            "career goal",
            "my goal",
            "i want to",
            "i hope to",
            "i aspire",
            "interested in",
        ),
        limit=1,
    )

    summary_sentences = [
        sentence
        for sentence in sentences
        if "verification phrase" not in sentence.lower()
    ][:2]
    professional_summary = " ".join(summary_sentences).strip()
    if not professional_summary:
        professional_summary = (
            f"{student.name} submitted a self-introduction for "
            f"{student.target_role or 'the selected role'}."
        )

    return SelfIntroductionProfile(
        full_name=student.name,
        college=student.college,
        branch=student.branch,
        target_role=student.target_role,
        professional_summary=professional_summary[:600],
        skills_mentioned=skills_mentioned[:12],
        project_highlights=project_highlights,
        experience_highlights=experience_highlights,
        career_goal=career_goal_matches[0] if career_goal_matches else None,
    )


def _clean_word(value: str) -> str:
    matches = re.findall(r"[a-z0-9]+", value.lower())
    return matches[0] if matches else ""


def _question_marker(words: list[_TimedWord], index: int) -> tuple[int, int] | None:
    """Return ``(question number, token width)`` for a spoken marker."""
    first = _clean_word(words[index].text)
    second = _clean_word(words[index + 1].text) if index + 1 < len(words) else ""
    for number, aliases in _QUESTION_NUMBER_ALIASES.items():
        if first in {"question", "questions", "q"} and second in aliases:
            return number, 2
        if first in aliases and second in {"question", "questions"}:
            return number, 2
    return None


def _join_words(words: list[_TimedWord]) -> str:
    text = " ".join(word.text.strip() for word in words if word.text.strip())
    return re.sub(r"\s+([,.!?;:])", r"\1", text).strip()


def split_numbered_answers(
    words: list[_TimedWord],
    prompts: list[str],
    *,
    time_limit_seconds: float = 5.0,
) -> SelfIntroductionTranscription:
    """Split a continuous transcript using sequential spoken question markers."""
    markers: list[tuple[int, int, int]] = []
    last_number = 0
    index = 0
    while index < len(words):
        marker = _question_marker(words, index)
        if marker:
            number, marker_width = marker
            if number <= len(prompts) and number > last_number:
                markers.append((number, index, index + marker_width))
                last_number = number
            index += marker_width
            continue
        index += 1

    # Whisper can omit a marker spoken immediately as recording begins while
    # still transcribing the complete first answer. Recover only that narrow
    # case: Question 2 must be the first recognized marker and there must be a
    # meaningful spoken section before it. Later missing markers remain errors.
    if markers and markers[0][0] == 2:
        first_answer_words = [
            word for word in words[: markers[0][1]] if _clean_word(word.text)
        ]
        if len(first_answer_words) >= 5:
            markers.insert(0, (1, 0, 0))

    answers: list[SelfIntroductionAnswer] = []
    for marker_index, (number, _marker_start, answer_start) in enumerate(markers):
        answer_end = (
            markers[marker_index + 1][1]
            if marker_index + 1 < len(markers)
            else len(words)
        )
        answer_words = words[answer_start:answer_end]
        while answer_words and not _clean_word(answer_words[0].text):
            answer_words = answer_words[1:]
        if not answer_words:
            continue
        start_seconds = answer_words[0].start_seconds
        end_seconds = answer_words[-1].end_seconds
        duration_seconds = max(0.0, end_seconds - start_seconds)
        answers.append(
            SelfIntroductionAnswer(
                question_number=number,
                prompt=prompts[number - 1],
                transcript=_join_words(answer_words),
                start_seconds=round(start_seconds, 2),
                end_seconds=round(end_seconds, 2),
                duration_seconds=round(duration_seconds, 2),
                time_limit_seconds=time_limit_seconds,
                within_time_limit=duration_seconds <= time_limit_seconds,
            )
        )

    answered_numbers = {answer.question_number for answer in answers}
    return SelfIntroductionTranscription(
        transcript=_join_words(words),
        answers=answers,
        missing_question_numbers=[
            number
            for number in range(1, len(prompts) + 1)
            if number not in answered_numbers
        ],
    )


def transcribe_self_introduction(
    video_path: Path,
    prompts: list[str],
    *,
    time_limit_seconds: float = 5.0,
) -> SelfIntroductionTranscription:
    """Transcribe once with word timestamps, then time every numbered answer."""
    try:
        if not video_path.exists():
            raise AIAnalysisError("The self-introduction video could not be found.")
        model = get_local_whisper_model()
        segments, _ = model.transcribe(
            str(video_path),
            language="en",
            beam_size=3,
            vad_filter=False,
            condition_on_previous_text=False,
            temperature=0.0,
            word_timestamps=True,
            initial_prompt=(
                "The speaker answers Question 1 through Question 10 in order "
                "and then says: My verification phrase is."
            ),
        )
        timed_words: list[_TimedWord] = []
        for segment in segments:
            segment_words = list(segment.words or [])
            if segment_words:
                timed_words.extend(
                    _TimedWord(
                        text=word.word,
                        start_seconds=float(word.start),
                        end_seconds=float(word.end),
                    )
                    for word in segment_words
                )
                continue

            # Defensive fallback for models that omit word timestamps.
            raw_words = re.findall(r"\S+", segment.text.strip())
            if not raw_words:
                continue
            word_duration = max(0.01, (segment.end - segment.start) / len(raw_words))
            timed_words.extend(
                _TimedWord(
                    text=word,
                    start_seconds=float(segment.start + offset * word_duration),
                    end_seconds=float(segment.start + (offset + 1) * word_duration),
                )
                for offset, word in enumerate(raw_words)
            )
        if not timed_words:
            raise AIAnalysisError("No clear speech was detected in the video.")
        return split_numbered_answers(
            timed_words,
            prompts,
            time_limit_seconds=time_limit_seconds,
        )
    except AIAnalysisError:
        raise
    except Exception as error:
        raise AIAnalysisError(
            "The self-introduction video could not be transcribed."
        ) from error
