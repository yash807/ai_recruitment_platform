from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.sql import func
from .database import Base


# Stores the student's profile, resume scores, and future AI profile.
class Student(Base):
    __tablename__ = "students"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=True)
    college = Column(String)
    branch = Column(String)
    cgpa = Column(Float)
    skills = Column(Text)
    target_role = Column(String, nullable=True)
    linkedin_url = Column(String, nullable=True)
    github_url = Column(String, nullable=True)
    leetcode_url = Column(String, nullable=True)

    resume_path = Column(String, nullable=True)
    resume_text = Column(Text, nullable=True)
    resume_score = Column(Float, default=0)
    role_match_score = Column(Float, default=0)

    mock_interview_score = Column(Float, default=0)
    ai_profile_summary = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())


# Stores jobs posted by recruiters. This model is used in later prototype days.
class Job(Base):
    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True, index=True)
    company_name = Column(String, nullable=False)
    job_title = Column(String, nullable=False)
    job_description = Column(Text)
    required_skills = Column(Text)
    min_cgpa = Column(Float)
    eligible_branch = Column(String)
    location = Column(String)
    salary = Column(String)

    created_at = Column(DateTime(timezone=True), server_default=func.now())


# Connects one student to one job and tracks their recruitment progress.
class Application(Base):
    __tablename__ = "applications"
    __table_args__ = (
        UniqueConstraint("student_id", "job_id", name="uq_application_student_job"),
    )

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("students.id"))
    job_id = Column(Integer, ForeignKey("jobs.id"))

    match_score = Column(Float, default=0)
    company_interview_score = Column(Float, default=0)
    recruiter_review_score = Column(Float, default=0)
    final_score = Column(Float, default=0)
    recruiter_feedback = Column(Text, nullable=True)

    eligible = Column(Boolean, default=False)
    eligibility_reasons = Column(Text, default="[]")
    score_breakdown = Column(Text, default="{}")
    matched_skills = Column(Text, default="[]")
    missing_skills = Column(Text, default="[]")

    status = Column(String, default="Applied")
    recommendation = Column(String, default="Pending")

    created_at = Column(DateTime(timezone=True), server_default=func.now())


# Stores one mock-interview session and the saved video path for every answer.
class MockInterview(Base):
    __tablename__ = "mock_interviews"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False, index=True)
    questions = Column(Text, nullable=False)
    video_paths = Column(Text, default="{}", nullable=False)
    status = Column(String, default="In Progress", nullable=False)
    transcripts = Column(Text, default="[]", nullable=False)
    ai_evaluation = Column(Text, nullable=True)
    analysis_status = Column(String, default="Not Started", nullable=False)
    analysis_error = Column(Text, nullable=True)
    overall_score = Column(Float, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# Stores the company-specific video interview attached to one application.
class CompanyInterview(Base):
    __tablename__ = "company_interviews"

    id = Column(Integer, primary_key=True, index=True)
    application_id = Column(
        Integer,
        ForeignKey("applications.id"),
        nullable=False,
        index=True,
    )
    questions = Column(Text, nullable=False)
    video_paths = Column(Text, default="{}", nullable=False)
    transcripts = Column(Text, default="[]", nullable=False)
    ai_evaluation = Column(Text, nullable=True)
    status = Column(String, default="In Progress", nullable=False)
    analysis_status = Column(String, default="Not Started", nullable=False)
    analysis_error = Column(Text, nullable=True)
    overall_score = Column(Float, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
