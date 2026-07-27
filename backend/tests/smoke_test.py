"""Run the core API workflow against a real, disposable MongoDB database.

Set MONGODB_URI (e.g. in backend/.env) before running this file directly:

    cd backend
    python tests/smoke_test.py

The test rewrites the URI to point at a throwaway database name
("..._smoke_test") so it never touches your real data, and drops that
database again at the end.
"""

import os
import re
import sys
import tempfile
from pathlib import Path

import fitz

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from dotenv import load_dotenv

load_dotenv(BACKEND_ROOT / ".env")

base_uri = os.environ.get("MONGODB_URI")
if not base_uri:
    raise SystemExit(
        "MONGODB_URI is not set. Add it to backend/.env or export it before "
        "running the smoke test."
    )

TEST_DB_NAME = "ai_recruitment_platform_smoke_test"


def _use_test_database(uri: str, db_name: str) -> str:
    """Return the same URI, but pointed at a disposable database name."""
    match = re.match(r"^(mongodb(?:\+srv)?://[^/]+)(/[^?]*)?(\?.*)?$", uri)
    if not match:
        raise ValueError(f"Could not parse MONGODB_URI: {uri!r}")
    host_part, _existing_path, query = match.groups()
    return f"{host_part}/{db_name}{query or ''}"


os.environ["MONGODB_URI"] = _use_test_database(base_uri, TEST_DB_NAME)

temporary_directory = tempfile.TemporaryDirectory()

from fastapi.testclient import TestClient

from app.main import app
from app.mongo import client as mongo_client, mongo_db
from app.routes import students as student_routes

student_routes.RESUME_UPLOAD_DIR = Path(temporary_directory.name) / "resumes"


def expect_status(response, expected: int) -> None:
    assert response.status_code == expected, (
        response.request.method,
        response.request.url,
        response.status_code,
        response.text,
    )


def run() -> None:
    with TestClient(app) as client:
        health = client.get("/health")
        expect_status(health, 200)
        assert health.json() == {"status": "ok", "database": "ok"}

        invalid_profile_link = client.post(
            "/students/register",
            json={
                "name": "Invalid Link Student",
                "email": "invalid-link@gmail.com",
                "password": "secure-password",
                "college": "Test College",
                "branch": "CSE",
                "cgpa": 8.2,
                "skills": "Python, SQL",
                "linkedin_url": "https://fake.example/linkedin.com/in/student",
                "github_url": None,
                "leetcode_url": None,
            },
        )
        expect_status(invalid_profile_link, 422)
        assert "Please enter a valid URL." in invalid_profile_link.text

        for field_name, invalid_url in (
            ("github_url", "https://example.com/github.com/student"),
            ("leetcode_url", "https://leetcode.com/problems/two-sum"),
        ):
            invalid_optional_profile = client.post(
                "/students/register",
                json={
                    "name": f"Invalid {field_name} Student",
                    "email": f"invalid-{field_name}@gmail.com",
                    "password": "secure-password",
                    "college": "Test College",
                    "branch": "CSE",
                    "cgpa": 8.2,
                    "skills": "Python, SQL",
                    "linkedin_url": (
                        f"https://linkedin.com/in/invalid-{field_name}"
                    ),
                    field_name: invalid_url,
                },
            )
            expect_status(invalid_optional_profile, 422)
            assert "Please enter a valid URL." in invalid_optional_profile.text

        missing_linkedin = client.post(
            "/students/register",
            json={
                "name": "Missing LinkedIn Student",
                "email": "missing-linkedin@gmail.com",
                "password": "secure-password",
                "college": "Test College",
                "branch": "CSE",
                "cgpa": 8.2,
                "skills": "Python, SQL",
                "github_url": None,
                "leetcode_url": None,
            },
        )
        expect_status(missing_linkedin, 422)

        registered_student = client.post(
            "/students/register",
            json={
                "name": "Registered Student",
                "email": "registered@example.com",
                "password": "secure-password",
                "college": "Test College",
                "branch": "CSE",
                "cgpa": 8.2,
                "skills": "Python, SQL",
                "linkedin_url": "https://linkedin.com/in/registered-student",
                "github_url": None,
                "leetcode_url": None,
            },
        )
        expect_status(registered_student, 201)
        registered_student_id = registered_student.json()["id"]
        sign_in = client.post(
            "/students/sign-in",
            json={
                "email": "registered@example.com",
                "password": "secure-password",
            },
        )
        expect_status(sign_in, 200)
        assert sign_in.json()["id"] == registered_student_id
        expect_status(
            client.post(
                "/students/sign-in",
                json={
                    "email": "registered@example.com",
                    "password": "wrong-password",
                },
            ),
            401,
        )

        pdf = fitz.open()
        page = pdf.new_page()
        page.insert_text(
            (72, 72),
            (
                "Smoke Test Student Data Analyst Resume Python SQL Excel "
                "data cleaning statistics dashboard visualization project "
                "developed analyzed measurable results LinkedIn GitHub"
            ),
        )
        resume_bytes = pdf.tobytes()
        pdf.close()

        student = client.post(
            "/students",
            data={
                "name": "Smoke Test Student",
                "email": "smoke-test@example.com",
                "college": "Test College",
                "branch": "CSE",
                "cgpa": "9.0",
                "skills": "Python, SQL, Excel, Statistics",
                "target_role": "AI/ML Intern",
                "linkedin_url": "https://linkedin.com/in/smoke-test",
                "github_url": "https://github.com/smoke-test",
                "leetcode_url": "",
            },
            files={"file": ("resume.pdf", resume_bytes, "application/pdf")},
        )
        expect_status(student, 201)
        student_body = student.json()
        student_id = student_body["student_id"]
        assert student_body["target_role"] == "AI/ML Intern"
        assert student_body["resume_score"] > 0

        activated_student = client.post(
            "/students/register",
            json={
                "name": "Smoke Test Student",
                "email": "smoke-test@example.com",
                "password": "activated-password",
                "college": "Test College",
                "branch": "CSE",
                "cgpa": 9.0,
                "skills": "Python, SQL, Excel, Statistics",
                "linkedin_url": "https://linkedin.com/in/smoke-test",
                "github_url": "https://github.com/smoke-test",
                "leetcode_url": None,
            },
        )
        expect_status(activated_student, 201)
        assert activated_student.json()["id"] == student_id
        assert activated_student.json()["resume_score"] > 0

        role_update = client.patch(
            f"/students/{student_id}/target-role",
            json={"target_role": "Data Analyst"},
        )
        expect_status(role_update, 200)
        assert role_update.json()["target_role"] == "Data Analyst"
        assert role_update.json()["role_match_score"] > 0

        job = client.post(
            "/jobs",
            json={
                "company_name": "Test Company",
                "job_title": "Data Analyst",
                "job_description": (
                    "Analyze business data using Python, SQL, Excel, statistics, "
                    "data cleaning, dashboards, and clear visualizations."
                ),
                "required_skills": "Python, SQL, Excel",
                "min_cgpa": 7,
                "eligible_branch": "All",
                "location": "Remote",
                "salary": "Test stipend",
            },
        )
        expect_status(job, 201)
        job_id = job.json()["id"]

        invited_student = client.post(
            "/students",
            data={
                "name": "Invited Test Student",
                "email": "invited-test@example.com",
                "college": "Test College",
                "branch": "CSE",
                "cgpa": "8.5",
                "skills": "Python, SQL, Excel, Statistics",
                "target_role": "Data Analyst",
                "linkedin_url": "https://linkedin.com/in/invited-test",
                "github_url": "",
                "leetcode_url": "",
            },
            files={"file": ("resume.pdf", resume_bytes, "application/pdf")},
        )
        expect_status(invited_student, 201)
        invited_student_id = invited_student.json()["student_id"]

        candidate_matches = client.get(f"/applications/job/{job_id}/matches")
        expect_status(candidate_matches, 200)
        assert all(candidate["eligible"] for candidate in candidate_matches.json())
        invited_candidate = next(
            candidate
            for candidate in candidate_matches.json()
            if candidate["student_id"] == invited_student_id
        )
        assert invited_candidate["eligible"] is True, invited_candidate
        assert invited_candidate["match_score"] >= 60, invited_candidate

        invitation = client.post(
            "/applications/invite",
            json={"student_id": invited_student_id, "job_id": job_id},
        )
        expect_status(invitation, 201)
        assert invitation.json()["status"] == "Invited by Recruiter to AI Interview"
        expect_status(
            client.post(
                "/applications/invite",
                json={"student_id": invited_student_id, "job_id": job_id},
            ),
            409,
        )
        invited_student_applications = client.get(
            f"/applications/student/{invited_student_id}"
        )
        expect_status(invited_student_applications, 200)
        assert invited_student_applications.json()[0]["eligible"] is True

        application = client.post(
            "/applications",
            json={"student_id": student_id, "job_id": job_id},
        )
        expect_status(application, 201)
        application_body = application.json()
        assert application_body["eligible"] is True, application_body
        duplicate_application = client.post(
            "/applications",
            json={"student_id": student_id, "job_id": job_id},
        )
        expect_status(duplicate_application, 409)

        bulk_invitation = client.post(
            f"/applications/job/{job_id}/invite-matches"
        )
        expect_status(bulk_invitation, 200)
        assert bulk_invitation.json()["invited_count"] == 0

        mock_interview = client.post(f"/mock-interviews/start/{student_id}")
        expect_status(mock_interview, 200)
        assert len(mock_interview.json()["questions"]) == 5

        company_interview = client.post(
            f"/company-interviews/start/{application_body['id']}"
        )
        expect_status(company_interview, 200)
        assert len(company_interview.json()["questions"]) == 5

        expect_status(client.get(f"/students/{student_id}"), 200)
        expect_status(client.get(f"/jobs/{job_id}"), 200)
        expect_status(client.get(f"/applications/job/{job_id}"), 200)

        college_options = client.get("/college/options")
        expect_status(college_options, 200)
        test_college = next(
            option
            for option in college_options.json()
            if option["name"] == "Test College"
        )
        assert test_college["student_count"] == 3

        college_insights = client.get(
            "/college/insights",
            params={"college": "Test College", "limit": 3},
        )
        expect_status(college_insights, 200)
        assert college_insights.json()["selected_students"] == 3
        assert college_insights.json()["applied_students"] == 2

    print("Backend smoke test passed.")


if __name__ == "__main__":
    try:
        run()
    finally:
        # Always clean up the disposable test database, pass or fail.
        mongo_client.drop_database(mongo_db.name)
