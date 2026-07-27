from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from ..models import jobs
from ..role_profiles import TARGET_ROLES


router = APIRouter(prefix="/jobs", tags=["Jobs"])


class JobCreate(BaseModel):
    """Information entered by a recruiter while publishing one job."""

    company_name: str = Field(min_length=2, max_length=150)
    job_title: str
    job_description: str = Field(min_length=20, max_length=5000)
    required_skills: str = Field(min_length=2, max_length=1000)
    min_cgpa: float | None = Field(default=None, ge=0, le=10)
    eligible_branch: str = Field(default="All", min_length=2, max_length=500)
    location: str | None = Field(default=None, max_length=200)
    salary: str | None = Field(default=None, max_length=200)

    @field_validator("job_title")
    @classmethod
    def validate_supported_role(cls, value: str) -> str:
        if value not in TARGET_ROLES:
            raise ValueError("Select one of the supported job roles.")
        return value


class JobResponse(BaseModel):
    id: int
    company_name: str
    job_title: str
    job_description: str | None = None
    required_skills: str | None = None
    min_cgpa: float | None = None
    eligible_branch: str | None = None
    location: str | None = None
    salary: str | None = None


@router.post("", response_model=JobResponse, status_code=status.HTTP_201_CREATED)
def create_job(job: JobCreate):
    """Save a recruiter-created job in MongoDB."""
    new_job = jobs.create(job.model_dump())
    return new_job


@router.get("", response_model=list[JobResponse])
def get_jobs():
    """Return every available job, newest first."""
    return jobs.list(sort=[("id", -1)])


@router.get("/{job_id}", response_model=JobResponse)
def get_job(job_id: int):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job
