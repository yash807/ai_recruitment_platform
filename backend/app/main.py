import logging

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text
from sqlalchemy.exc import OperationalError, SQLAlchemyError
from sqlalchemy.orm import Session

from .database import engine, get_db
from .models import Base
from .routes import applications, college, company_interviews, interviews, jobs, students

logger = logging.getLogger(__name__)

# Create any database tables that do not exist yet.
Base.metadata.create_all(bind=engine)


def ensure_prototype_schema():
    """Add new prototype columns without deleting the existing SQLite data."""
    student_columns = {
        column["name"] for column in inspect(engine).get_columns("students")
    }
    interview_columns = {
        column["name"]
        for column in inspect(engine).get_columns("mock_interviews")
    }
    application_columns = {
        column["name"]
        for column in inspect(engine).get_columns("applications")
    }
    with engine.begin() as connection:
        # Schema upgrades are optional during normal startup. Fail quickly if
        # another desktop tool currently owns SQLite's write lock.
        connection.exec_driver_sql("PRAGMA busy_timeout = 1000")
        if "target_role" not in student_columns:
            connection.execute(
                text("ALTER TABLE students ADD COLUMN target_role VARCHAR")
            )
        if "password_hash" not in student_columns:
            connection.execute(
                text("ALTER TABLE students ADD COLUMN password_hash VARCHAR")
            )
        if "role_match_score" not in student_columns:
            connection.execute(
                text(
                    "ALTER TABLE students "
                    "ADD COLUMN role_match_score FLOAT DEFAULT 0"
                )
            )
        if "linkedin_url" not in student_columns:
            connection.execute(
                text("ALTER TABLE students ADD COLUMN linkedin_url VARCHAR")
            )
        if "github_url" not in student_columns:
            connection.execute(
                text("ALTER TABLE students ADD COLUMN github_url VARCHAR")
            )
        if "leetcode_url" not in student_columns:
            connection.execute(
                text("ALTER TABLE students ADD COLUMN leetcode_url VARCHAR")
            )
        if "transcripts" not in interview_columns:
            connection.execute(
                text(
                    "ALTER TABLE mock_interviews "
                    "ADD COLUMN transcripts TEXT DEFAULT '[]' NOT NULL"
                )
            )
        if "ai_evaluation" not in interview_columns:
            connection.execute(
                text("ALTER TABLE mock_interviews ADD COLUMN ai_evaluation TEXT")
            )
        if "analysis_status" not in interview_columns:
            connection.execute(
                text(
                    "ALTER TABLE mock_interviews "
                    "ADD COLUMN analysis_status VARCHAR "
                    "DEFAULT 'Not Started' NOT NULL"
                )
            )
        if "analysis_error" not in interview_columns:
            connection.execute(
                text("ALTER TABLE mock_interviews ADD COLUMN analysis_error TEXT")
            )
        if "overall_score" not in interview_columns:
            connection.execute(
                text(
                    "ALTER TABLE mock_interviews "
                    "ADD COLUMN overall_score FLOAT DEFAULT 0"
                )
            )
        if "eligible" not in application_columns:
            connection.execute(
                text(
                    "ALTER TABLE applications "
                    "ADD COLUMN eligible BOOLEAN DEFAULT 0"
                )
            )
        if "eligibility_reasons" not in application_columns:
            connection.execute(
                text(
                    "ALTER TABLE applications "
                    "ADD COLUMN eligibility_reasons TEXT DEFAULT '[]'"
                )
            )
        if "score_breakdown" not in application_columns:
            connection.execute(
                text(
                    "ALTER TABLE applications "
                    "ADD COLUMN score_breakdown TEXT DEFAULT '{}'"
                )
            )
        if "matched_skills" not in application_columns:
            connection.execute(
                text(
                    "ALTER TABLE applications "
                    "ADD COLUMN matched_skills TEXT DEFAULT '[]'"
                )
            )
        if "missing_skills" not in application_columns:
            connection.execute(
                text(
                    "ALTER TABLE applications "
                    "ADD COLUMN missing_skills TEXT DEFAULT '[]'"
                )
            )
        if "recruiter_review_score" not in application_columns:
            connection.execute(
                text(
                    "ALTER TABLE applications "
                    "ADD COLUMN recruiter_review_score FLOAT DEFAULT 0"
                )
            )
        if "recruiter_feedback" not in application_columns:
            connection.execute(
                text(
                    "ALTER TABLE applications "
                    "ADD COLUMN recruiter_feedback TEXT"
                )
            )
        connection.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS "
                "uq_application_student_job "
                "ON applications (student_id, job_id)"
            )
        )
        connection.exec_driver_sql("PRAGMA busy_timeout = 30000")


try:
    ensure_prototype_schema()
except OperationalError as error:
    # DB Browser for SQLite may temporarily hold a write lock. The API can
    # still start and serve existing data; the migration will be retried on
    # the next clean backend start.
    if "database is locked" not in str(error).lower():
        raise
    engine.dispose()
    logger.warning(
        "SQLite is temporarily locked; deferred the optional schema update."
    )

# Create the main FastAPI backend application.
app = FastAPI(title="AI Talent Intelligence Prototype")

# Allow the local Next.js frontend to call this backend from the browser.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register APIs defined in separate route files.
app.include_router(students.router)
app.include_router(interviews.router)
app.include_router(jobs.router)
app.include_router(applications.router)
app.include_router(company_interviews.router)
app.include_router(college.router)


# Simple test endpoint for checking that the backend server is running.
@app.get("/")
def home():
    return {"message": "Backend is running"}


# The frontend calls this endpoint to display the system status.
@app.get("/health")
def health_check(db: Session = Depends(get_db)):
    """Report readiness only when the API can also reach SQLite."""
    try:
        db.execute(text("SELECT 1"))
    except SQLAlchemyError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The database is not available.",
        ) from error
    return {"status": "ok", "database": "ok"}
