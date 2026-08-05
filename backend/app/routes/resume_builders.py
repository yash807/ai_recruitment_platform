"""Persistent student resume-builder data and template selection."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..models import resume_builders, students


router = APIRouter(prefix="/resume-builders", tags=["Resume Builder"])


class ResumeBasics(BaseModel):
    full_name: str = Field(default="", max_length=120)
    professional_title: str = Field(default="", max_length=120)
    email: str = Field(default="", max_length=180)
    phone: str = Field(default="", max_length=40)
    location: str = Field(default="", max_length=120)
    summary: str = Field(default="", max_length=1200)
    linkedin_url: str = Field(default="", max_length=300)
    github_url: str = Field(default="", max_length=300)
    portfolio_url: str = Field(default="", max_length=300)


class EducationEntry(BaseModel):
    entry_id: str = Field(max_length=64)
    institution: str = Field(default="", max_length=180)
    degree: str = Field(default="", max_length=180)
    field_of_study: str = Field(default="", max_length=180)
    location: str = Field(default="", max_length=120)
    start_date: str = Field(default="", max_length=40)
    end_date: str = Field(default="", max_length=40)
    score: str = Field(default="", max_length=80)
    highlights: list[str] = Field(default_factory=list, max_length=8)


class ExperienceEntry(BaseModel):
    entry_id: str = Field(max_length=64)
    role: str = Field(default="", max_length=180)
    organization: str = Field(default="", max_length=180)
    location: str = Field(default="", max_length=120)
    start_date: str = Field(default="", max_length=40)
    end_date: str = Field(default="", max_length=40)
    current: bool = False
    highlights: list[str] = Field(default_factory=list, max_length=10)


class ProjectEntry(BaseModel):
    entry_id: str = Field(max_length=64)
    name: str = Field(default="", max_length=180)
    role: str = Field(default="", max_length=120)
    technologies: str = Field(default="", max_length=300)
    project_url: str = Field(default="", max_length=300)
    start_date: str = Field(default="", max_length=40)
    end_date: str = Field(default="", max_length=40)
    highlights: list[str] = Field(default_factory=list, max_length=10)


class CertificationEntry(BaseModel):
    entry_id: str = Field(max_length=64)
    name: str = Field(default="", max_length=180)
    issuer: str = Field(default="", max_length=180)
    issue_date: str = Field(default="", max_length=40)
    credential_url: str = Field(default="", max_length=300)


class DetailEntry(BaseModel):
    entry_id: str = Field(max_length=64)
    title: str = Field(default="", max_length=180)
    organization: str = Field(default="", max_length=180)
    description: str = Field(default="", max_length=600)


class LanguageEntry(BaseModel):
    entry_id: str = Field(max_length=64)
    name: str = Field(default="", max_length=80)
    proficiency: str = Field(default="", max_length=80)


class ResumeBuilderPayload(BaseModel):
    template: Literal["two-column", "single-column"] = "two-column"
    basics: ResumeBasics = Field(default_factory=ResumeBasics)
    education: list[EducationEntry] = Field(default_factory=list, max_length=10)
    experience: list[ExperienceEntry] = Field(default_factory=list, max_length=12)
    projects: list[ProjectEntry] = Field(default_factory=list, max_length=12)
    skills: list[str] = Field(default_factory=list, max_length=40)
    certifications: list[CertificationEntry] = Field(default_factory=list, max_length=15)
    achievements: list[DetailEntry] = Field(default_factory=list, max_length=12)
    leadership: list[DetailEntry] = Field(default_factory=list, max_length=12)
    languages: list[LanguageEntry] = Field(default_factory=list, max_length=12)
    interests: list[str] = Field(default_factory=list, max_length=20)


class ResumeBuilderResponse(ResumeBuilderPayload):
    student_id: int
    updated_at: datetime | None = None


def _initial_builder(student) -> ResumeBuilderPayload:
    return ResumeBuilderPayload(
        basics=ResumeBasics(
            full_name=student.name or "",
            professional_title=student.target_role or "",
            email=student.email or "",
            linkedin_url=student.linkedin_url or "",
            github_url=student.github_url or "",
        ),
        skills=[
            skill.strip()
            for skill in (student.skills or "").split(",")
            if skill.strip()
        ][:40],
    )


def _response(student_id: int, payload: ResumeBuilderPayload, updated_at=None):
    return ResumeBuilderResponse(
        student_id=student_id,
        updated_at=updated_at,
        **payload.model_dump(),
    )


@router.get("/student/{student_id}", response_model=ResumeBuilderResponse)
def get_student_resume_builder(student_id: int):
    student = students.get(student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")
    existing = resume_builders.get_for_student(student_id)
    if not existing:
        return _response(student_id, _initial_builder(student))
    payload = ResumeBuilderPayload.model_validate(existing)
    return _response(student_id, payload, existing.updated_at)


@router.put("/student/{student_id}", response_model=ResumeBuilderResponse)
def save_student_resume_builder(student_id: int, payload: ResumeBuilderPayload):
    if not students.get(student_id):
        raise HTTPException(status_code=404, detail="Student not found.")
    now = datetime.now(timezone.utc)
    existing = resume_builders.get_for_student(student_id)
    if existing:
        for key, value in payload.model_dump().items():
            existing[key] = value
        existing.updated_at = now
        saved = resume_builders.save(existing)
    else:
        saved = resume_builders.create(
            {
                "student_id": student_id,
                **payload.model_dump(),
                "updated_at": now,
            }
        )
    return _response(student_id, payload, saved.updated_at)
