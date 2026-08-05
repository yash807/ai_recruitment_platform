import unittest
from pathlib import Path
from unittest.mock import patch

from app.models import Doc
from app.self_introduction_service import (
    _TimedWord,
    challenge_phrase_was_spoken,
    extract_self_introduction_profile,
    split_numbered_answers,
    transcribe_self_introduction,
)


class SelfIntroductionServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.student = Doc(
            {
                "name": "Asha Student",
                "college": "Test University",
                "branch": "CSE",
                "skills": "Python, SQL, Pandas",
                "target_role": "Data Analyst",
            }
        )

    def test_spoken_challenge_accepts_number_formatting(self) -> None:
        self.assertTrue(
            challenge_phrase_was_spoken(
                "At the end, my verification phrase is blue river 7 orbit.",
                "My verification phrase is blue river seven orbit.",
            )
        )

    def test_spoken_challenge_accepts_common_transcription_variations(self) -> None:
        self.assertTrue(
            challenge_phrase_was_spoken(
                "My verification face is amber garden for quarts.",
                "My verification phrase is amber garden four quartz.",
            )
        )

    def test_spoken_challenge_accepts_observed_violet_variation(self) -> None:
        for variation in ("Voilait", "Wallet", "Boiled"):
            with self.subTest(variation=variation):
                self.assertTrue(
                    challenge_phrase_was_spoken(
                        f"Question ten, my verification phrase is {variation} River 8 Tiger.",
                        "My verification phrase is violet river eight tiger.",
                    )
                )

    def test_spoken_challenge_accepts_a_split_codeword(self) -> None:
        self.assertTrue(
            challenge_phrase_was_spoken(
                "My verification phrase is green valley nine or bit.",
                "My verification phrase is green valley nine orbit.",
            )
        )

    def test_spoken_challenge_rejects_unrelated_transcript(self) -> None:
        self.assertFalse(
            challenge_phrase_was_spoken(
                "I built a dashboard with Python and SQL.",
                "My verification phrase is amber garden four quartz.",
            )
        )

    def test_fixed_challenge_words_cannot_pass_with_wrong_random_words(self) -> None:
        self.assertFalse(
            challenge_phrase_was_spoken(
                "My verification phrase is red ocean one cabin.",
                "My verification phrase is amber garden four quartz.",
            )
        )

    def test_spoken_challenge_rejects_one_genuinely_wrong_word(self) -> None:
        self.assertFalse(
            challenge_phrase_was_spoken(
                "My verification phrase is amber garden four cabin.",
                "My verification phrase is amber garden four quartz.",
            )
        )

    def test_spoken_challenge_rejects_reordered_words(self) -> None:
        self.assertFalse(
            challenge_phrase_was_spoken(
                "My verification phrase is amber quartz four garden.",
                "My verification phrase is amber garden four quartz.",
            )
        )

    def test_spoken_challenge_rejects_missing_marker(self) -> None:
        self.assertFalse(
            challenge_phrase_was_spoken(
                "I finished by saying amber garden four quartz.",
                "My verification phrase is amber garden four quartz.",
            )
        )

    def test_challenge_vocabulary_dump_cannot_pass(self) -> None:
        self.assertFalse(
            challenge_phrase_was_spoken(
                (
                    "My verification phrase is amber blue coral green indigo "
                    "bridge comet forest garden harbor one two three four five "
                    "atlas breeze cabin delta echo quartz."
                ),
                "My verification phrase is amber garden four quartz.",
            )
        )

    def test_numbered_answers_are_split_and_timed(self) -> None:
        words = []
        for number in range(1, 11):
            start = float((number - 1) * 6)
            words.extend(
                [
                    _TimedWord(text="Question", start_seconds=start, end_seconds=start + 0.2),
                    _TimedWord(text=str(number), start_seconds=start + 0.2, end_seconds=start + 0.4),
                    _TimedWord(text="answer", start_seconds=start + 0.5, end_seconds=start + 4.5),
                ]
            )

        result = split_numbered_answers(words, [f"Prompt {number}" for number in range(1, 11)])

        self.assertEqual(len(result.answers), 10)
        self.assertEqual(result.missing_question_numbers, [])
        self.assertEqual(result.answers[0].duration_seconds, 4.0)
        self.assertTrue(result.answers[0].within_time_limit)

    def test_missing_spoken_number_is_reported(self) -> None:
        words = [
            _TimedWord(text="Question", start_seconds=0, end_seconds=0.2),
            _TimedWord(text="one", start_seconds=0.2, end_seconds=0.4),
            _TimedWord(text="answer", start_seconds=0.5, end_seconds=1.0),
            _TimedWord(text="Question", start_seconds=1.1, end_seconds=1.3),
            _TimedWord(text="three", start_seconds=1.3, end_seconds=1.5),
            _TimedWord(text="answer", start_seconds=1.6, end_seconds=2.0),
        ]

        result = split_numbered_answers(words, ["One", "Two", "Three"])

        self.assertEqual([answer.question_number for answer in result.answers], [1, 3])
        self.assertEqual(result.missing_question_numbers, [2])

    def test_first_answer_is_recovered_when_whisper_omits_opening_marker(self) -> None:
        words = [
            _TimedWord(text="Hello", start_seconds=0, end_seconds=0.2),
            _TimedWord(text="my", start_seconds=0.2, end_seconds=0.3),
            _TimedWord(text="name", start_seconds=0.3, end_seconds=0.5),
            _TimedWord(text="is", start_seconds=0.5, end_seconds=0.6),
            _TimedWord(text="Asha", start_seconds=0.6, end_seconds=0.9),
            _TimedWord(text="Student", start_seconds=0.9, end_seconds=1.2),
            _TimedWord(text="Question", start_seconds=1.4, end_seconds=1.6),
            _TimedWord(text="two", start_seconds=1.6, end_seconds=1.8),
            _TimedWord(text="Data", start_seconds=1.9, end_seconds=2.1),
            _TimedWord(text="Analyst", start_seconds=2.1, end_seconds=2.4),
        ]

        result = split_numbered_answers(words, ["Profile", "Target role"])

        self.assertEqual([answer.question_number for answer in result.answers], [1, 2])
        self.assertEqual(result.missing_question_numbers, [])
        self.assertTrue(result.answers[0].transcript.startswith("Hello"))

    def test_high_accuracy_transcription_uses_word_timestamps(self) -> None:
        class Word:
            def __init__(self, word: str, start: float, end: float):
                self.word = word
                self.start = start
                self.end = end

        class Segment:
            start = 0.0
            end = 1.0
            text = "Question one answer"
            words = [Word("Question", 0, 0.2), Word("one", 0.2, 0.4), Word("answer", 0.5, 1)]

        class Model:
            def transcribe(self, *_args, **_kwargs):
                return iter([Segment()]), None

        with patch(
            "app.self_introduction_service.get_local_whisper_model",
            return_value=Model(),
        ) as get_model, patch.object(Path, "exists", return_value=True):
            result = transcribe_self_introduction(
                Path("introduction.webm"),
                ["Prompt one"],
            )

        self.assertEqual(result.transcript, "Question one answer")
        self.assertEqual(len(result.answers), 1)
        get_model.assert_called_once()

    def test_extraction_uses_only_profile_and_transcript_evidence(self) -> None:
        profile = extract_self_introduction_profile(
            self.student,
            (
                "I am Asha and I built a sales dashboard project using Python, "
                "SQL, and Pandas. I worked with a team during my internship. "
                "My goal is to become a data analyst."
            ),
        )

        self.assertEqual(profile.full_name, "Asha Student")
        self.assertIn("Python", profile.skills_mentioned)
        self.assertIn("SQL", profile.skills_mentioned)
        self.assertTrue(profile.project_highlights)
        self.assertTrue(profile.experience_highlights)
        self.assertIsNotNone(profile.career_goal)
        self.assertEqual(
            profile.source,
            "self-reported introduction transcript",
        )


if __name__ == "__main__":
    unittest.main()
