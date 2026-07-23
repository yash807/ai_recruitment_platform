from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Job
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
    model_config = ConfigDict(from_attributes=True)

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
def create_job(job: JobCreate, db: Session = Depends(get_db)):
    """Save a recruiter-created job in SQLite."""
    new_job = Job(**job.model_dump())
    db.add(new_job)
    db.commit()
    db.refresh(new_job)
    return new_job


@router.get("", response_model=list[JobResponse])
def get_jobs(db: Session = Depends(get_db)):
    """Return every available job, newest first."""
    return db.query(Job).order_by(Job.id.desc()).all()


@router.get("/{job_id}", response_model=JobResponse)
def get_job(job_id: int, db: Session = Depends(get_db)):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job
