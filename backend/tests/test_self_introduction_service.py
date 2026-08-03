import unittest
from pathlib import Path
from unittest.mock import patch

from app.models import Doc
from app.self_introduction_service import (
    challenge_phrase_was_spoken,
    extract_self_introduction_profile,
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

    def test_high_accuracy_transcription_uses_phrase_safe_options(self) -> None:
        with patch(
            "app.self_introduction_service.transcribe_recordings",
            return_value=["verification transcript"],
        ) as transcribe:
            result = transcribe_self_introduction(
                Path("introduction.webm"),
            )

        self.assertEqual(result, "verification transcript")
        transcribe.assert_called_once_with(
            {"0": "introduction.webm"},
            1,
            beam_size=5,
            vad_filter=False,
            condition_on_previous_text=False,
            temperature=0.0,
        )

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
