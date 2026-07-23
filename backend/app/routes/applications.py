import json
import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Application, CompanyInterview, Job, Student


router = APIRouter(prefix="/applications", tags=["Applications"])


class ApplicationCreate(BaseModel):
    student_id: int
    job_id: int


class ApplicationResponse(BaseModel):
    id: int
    student_id: int
    student_name: str
    job_id: int
    job_title: str
    company_name: str
    linkedin_url: str | None
    github_url: str | None
    leetcode_url: str | None
    eligible: bool
    eligibility_reasons: list[str]
    match_score: float
    score_breakdown: dict[str, float]
    matched_skills: list[str]
    missing_skills: list[str]
    resume_score: float
    mock_interview_score: float
    company_interview_score: float
    recruiter_review_score: float
    final_score: float
    recruiter_feedback: str | None
    company_interview_id: int | None
    status: str
    recommendation: str
    created_at: datetime | None = None


class StudentApplicationResponse(BaseModel):
    """Limited decision shown to students; recruiter-only scores are excluded."""

    id: int
    student_id: int
    student_name: str
    job_id: int
    job_title: str
    company_name: str
    eligible: bool
    eligibility_reasons: list[str]
    status: str
    result_feedback: str | None


class RecruiterDecisionUpdate(BaseModel):
    decision: str
    recruiter_review_score: float = Field(ge=0, le=100)
    feedback: str = Field(min_length=2, max_length=1000)


class RecruiterInvitationCreate(BaseModel):
    student_id: int
    job_id: int


class CandidateMatchResponse(BaseModel):
    student_id: int
    student_name: str
    email: str
    branch: str | None
    cgpa: float | None
    skills: str | None
    target_role: str | None
    resume_score: float
    eligible: bool
    eligibility_reasons: list[str]
    match_score: float
    score_breakdown: dict[str, float]
    matched_skills: list[str]
    missing_skills: list[str]
    existing_application_id: int | None
    existing_status: str | None


class BulkInvitationResponse(BaseModel):
    message: str
    invited_count: int
    skipped_count: int


def split_requirements(value: str | None) -> list[str]:
    """Turn comma/slash-separated recruiter text into clean unique values."""
    if not value:
        return []
    items = [item.strip() for item in re.split(r"[,;/|\n]+", value) if item.strip()]
    return list(dict.fromkeys(items))


def phrase_exists(phrase: str, text: str) -> bool:
    normalized_phrase = " ".join(phrase.lower().split())
    normalized_text = " ".join(text.lower().split())
    return normalized_phrase in normalized_text


def branch_is_allowed(student_branch: str | None, allowed_text: str | None) -> bool:
    allowed_branches = split_requirements(allowed_text)
    if not allowed_branches or any(
        branch.lower() in {"all", "any", "all branches"} for branch in allowed_branches
    ):
        return True
    if not student_branch:
        return False

    normalized_student = re.sub(r"[^a-z0-9]+", " ", student_branch.lower()).strip()
    return any(
        (
            re.sub(r"[^a-z0-9]+", " ", branch.lower()).strip()
            in normalized_student
            or normalized_student
            in re.sub(r"[^a-z0-9]+", " ", branch.lower()).strip()
        )
        for branch in allowed_branches
    )


def calculate_job_match(
    student: Student,
    job: Job,
) -> tuple[float, dict[str, float], list[str], list[str]]:
    """Match only required skills against profile/resume and ATS readiness."""
    profile_text = " ".join(
        filter(
            None,
            [
                student.skills,
                student.resume_text,
            ],
        )
    )

    required_skills = split_requirements(job.required_skills)
    matched_skills = [
        skill for skill in required_skills if phrase_exists(skill, profile_text)
    ]
    missing_skills = [
        skill for skill in required_skills if skill not in matched_skills
    ]
    skill_score = (
        70 * len(matched_skills) / len(required_skills)
        if required_skills
        else 70
    )
    resume_score = min(max(student.resume_score or 0, 0), 100) * 0.30

    breakdown = {
        "Required skills": round(skill_score, 1),
        "Resume ATS readiness": round(resume_score, 1),
    }
    return (
        round(sum(breakdown.values()), 1),
        breakdown,
        matched_skills,
        missing_skills,
    )


def eligibility_check(student: Student, job: Job) -> tuple[bool, list[str]]:
    """Check non-negotiable company rules before using the match score."""
    reasons: list[str] = []

    if job.min_cgpa is not None:
        if student.cgpa is None:
            reasons.append(f"CGPA is missing; the minimum is {job.min_cgpa}.")
        elif student.cgpa < job.min_cgpa:
            reasons.append(
                f"CGPA {student.cgpa} is below the required {job.min_cgpa}."
            )

    if not branch_is_allowed(student.branch, job.eligible_branch):
        reasons.append(
            f"Branch '{student.branch or 'Not provided'}' is not in "
            f"the eligible list: {job.eligible_branch}."
        )

    if not student.resume_text:
        reasons.append("Upload and analyze a resume before applying.")

    return not reasons, reasons


def evaluate_candidate(
    student: Student,
    job: Job,
) -> tuple[
    bool,
    list[str],
    float,
    dict[str, float],
    list[str],
    list[str],
]:
    """Run the one shared eligibility and matching policy for both entry paths."""
    passes_hard_rules, reasons = eligibility_check(student, job)
    match_score, breakdown, matched_skills, missing_skills = calculate_job_match(
        student,
        job,
    )
    interview_eligible = passes_hard_rules and match_score >= 60
    if passes_hard_rules and not interview_eligible:
        reasons = [
            "The profile did not meet the company's role-matching requirements."
        ]
    return (
        interview_eligible,
        reasons,
        match_score,
        breakdown,
        matched_skills,
        missing_skills,
    )


def make_application(
    student: Student,
    job: Job,
    *,
    recruiter_invitation: bool,
) -> Application:
    """Build an application record using the shared candidate evaluation."""
    (
        interview_eligible,
        reasons,
        match_score,
        breakdown,
        matched_skills,
        missing_skills,
    ) = evaluate_candidate(student, job)

    if not interview_eligible:
        status_text = "Not Eligible for AI Interview"
        recommendation = (
            "Eligibility requirements or the role-match threshold were not met."
        )
    elif recruiter_invitation:
        status_text = "Invited by Recruiter to AI Interview"
        recommendation = (
            "The recruiter invited this student after automatic profile matching."
        )
    else:
        status_text = "Eligible for AI Interview"
        recommendation = "Proceed to the company-specific AI interview."

    return Application(
        student_id=student.id,
        job_id=job.id,
        eligible=interview_eligible,
        eligibility_reasons=json.dumps(reasons),
        match_score=match_score,
        score_breakdown=json.dumps(breakdown),
        matched_skills=json.dumps(matched_skills),
        missing_skills=json.dumps(missing_skills),
        status=status_text,
        recommendation=recommendation,
    )


def build_response(
    application: Application,
    student: Student,
    job: Job,
    company_interview_id: int | None = None,
) -> ApplicationResponse:
    return ApplicationResponse(
        id=application.id,
        student_id=student.id,
        student_name=student.name,
        job_id=job.id,
        job_title=job.job_title,
        company_name=job.company_name,
        linkedin_url=student.linkedin_url,
        github_url=student.github_url,
        leetcode_url=student.leetcode_url,
        eligible=bool(application.eligible),
        eligibility_reasons=json.loads(application.eligibility_reasons or "[]"),
        match_score=application.match_score or 0,
        score_breakdown=json.loads(application.score_breakdown or "{}"),
        matched_skills=json.loads(application.matched_skills or "[]"),
        missing_skills=json.loads(application.missing_skills or "[]"),
        resume_score=student.resume_score or 0,
        mock_interview_score=student.mock_interview_score or 0,
        company_interview_score=application.company_interview_score or 0,
        recruiter_review_score=application.recruiter_review_score or 0,
        final_score=application.final_score or 0,
        recruiter_feedback=application.recruiter_feedback,
        company_interview_id=company_interview_id,
        status=application.status,
        recommendation=application.recommendation,
        created_at=application.created_at,
    )


def build_student_response(
    application: Application,
    student: Student,
    job: Job,
) -> StudentApplicationResponse:
    """Return only the interview decision, never the internal matching score."""
    return StudentApplicationResponse(
        id=application.id,
        student_id=student.id,
        student_name=student.name,
        job_id=job.id,
        job_title=job.job_title,
        company_name=job.company_name,
        eligible=bool(application.eligible),
        eligibility_reasons=json.loads(application.eligibility_reasons or "[]"),
        status=application.status,
        result_feedback=application.recruiter_feedback,
    )


@router.post(
    "",
    response_model=StudentApplicationResponse,
    status_code=status.HTTP_201_CREATED,
)
def apply_to_job(payload: ApplicationCreate, db: Session = Depends(get_db)):
    """Create an application, run matching, and save the explainable result."""
    student = db.query(Student).filter(Student.id == payload.student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")

    job = db.query(Job).filter(Job.id == payload.job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    duplicate = (
        db.query(Application)
        .filter(
            Application.student_id == student.id,
            Application.job_id == job.id,
        )
        .first()
    )
    if duplicate:
        raise HTTPException(
            status_code=409,
            detail="This student has already applied to this job.",
        )

    application = make_application(
        student,
        job,
        recruiter_invitation=False,
    )
    db.add(application)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="This student has already applied to this job.",
        ) from error
    db.refresh(application)
    return build_student_response(application, student, job)


@router.get(
    "/job/{job_id}/matches",
    response_model=list[CandidateMatchResponse],
)
def get_matching_students(job_id: int, db: Session = Depends(get_db)):
    """Rank every student for a job so recruiters can discover candidates."""
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    existing_applications = {
        application.student_id: application
        for application in db.query(Application)
        .filter(Application.job_id == job_id)
        .all()
    }
    responses: list[CandidateMatchResponse] = []
    for student in db.query(Student).order_by(Student.name.asc()).all():
        (
            interview_eligible,
            reasons,
            match_score,
            breakdown,
            matched_skills,
            missing_skills,
        ) = evaluate_candidate(student, job)
        # Recruiters should discover only students who can actually be invited.
        # Non-qualified student identities are intentionally excluded.
        if not interview_eligible:
            continue
        existing = existing_applications.get(student.id)
        responses.append(
            CandidateMatchResponse(
                student_id=student.id,
                student_name=student.name,
                email=student.email,
                branch=student.branch,
                cgpa=student.cgpa,
                skills=student.skills,
                target_role=student.target_role,
                resume_score=student.resume_score or 0,
                eligible=interview_eligible,
                eligibility_reasons=reasons,
                match_score=match_score,
                score_breakdown=breakdown,
                matched_skills=matched_skills,
                missing_skills=missing_skills,
                existing_application_id=existing.id if existing else None,
                existing_status=existing.status if existing else None,
            )
        )

    return sorted(
        responses,
        key=lambda candidate: (candidate.eligible, candidate.match_score),
        reverse=True,
    )


@router.post(
    "/invite",
    response_model=ApplicationResponse,
    status_code=status.HTTP_201_CREATED,
)
def invite_student(
    payload: RecruiterInvitationCreate,
    db: Session = Depends(get_db),
):
    """Create an interview invitation for one automatically matched student."""
    student = db.query(Student).filter(Student.id == payload.student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")
    job = db.query(Job).filter(Job.id == payload.job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    existing = (
        db.query(Application)
        .filter(
            Application.student_id == student.id,
            Application.job_id == job.id,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail="This student already has an application or invitation for the job.",
        )

    application = make_application(
        student,
        job,
        recruiter_invitation=True,
    )
    if not application.eligible:
        raise HTTPException(
            status_code=400,
            detail=(
                "This student does not meet the eligibility rules or the "
                "skills-and-resume match threshold for an invitation."
            ),
        )

    db.add(application)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="This student already has an application or invitation for the job.",
        ) from error
    db.refresh(application)
    return build_response(application, student, job)


@router.post(
    "/job/{job_id}/invite-matches",
    response_model=BulkInvitationResponse,
)
def invite_all_matching_students(
    job_id: int,
    db: Session = Depends(get_db),
):
    """Invite every qualified student who has not already applied to the job."""
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    existing_student_ids = {
        student_id
        for (student_id,) in db.query(Application.student_id)
        .filter(Application.job_id == job_id)
        .all()
    }
    invited_count = 0
    skipped_count = 0
    for student in db.query(Student).all():
        if student.id in existing_student_ids:
            skipped_count += 1
            continue
        application = make_application(
            student,
            job,
            recruiter_invitation=True,
        )
        if not application.eligible:
            skipped_count += 1
            continue
        db.add(application)
        invited_count += 1

    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Candidate invitations changed while the bulk invite was running. Retry once.",
        ) from error

    return BulkInvitationResponse(
        message=(
            f"Invited {invited_count} qualified student"
            f"{'s' if invited_count != 1 else ''} to the company AI interview."
        ),
        invited_count=invited_count,
        skipped_count=skipped_count,
    )


@router.get(
    "/student/{student_id}",
    response_model=list[StudentApplicationResponse],
)
def get_student_applications(student_id: int, db: Session = Depends(get_db)):
    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")

    records = (
        db.query(Application, Job)
        .join(Job, Job.id == Application.job_id)
        .filter(Application.student_id == student_id)
        .order_by(Application.id.desc())
        .all()
    )
    return [
        build_student_response(application, student, job)
        for application, job in records
    ]


@router.get("/job/{job_id}", response_model=list[ApplicationResponse])
def get_job_applications(job_id: int, db: Session = Depends(get_db)):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    records = (
        db.query(Application, Student)
        .join(Student, Student.id == Application.student_id)
        .filter(Application.job_id == job_id)
        .order_by(Application.match_score.desc())
        .all()
    )
    responses: list[ApplicationResponse] = []
    for application, student in records:
        company_interview = (
            db.query(CompanyInterview)
            .filter(CompanyInterview.application_id == application.id)
            .order_by(CompanyInterview.id.desc())
            .first()
        )
        responses.append(
            build_response(
                application,
                student,
                job,
                company_interview.id if company_interview else None,
            )
        )
    return responses


@router.patch(
    "/{application_id}/decision",
    response_model=ApplicationResponse,
)
def save_recruiter_decision(
    application_id: int,
    payload: RecruiterDecisionUpdate,
    db: Session = Depends(get_db),
):
    """Calculate the final score and publish the recruiter's decision."""
    allowed_decisions = {"Shortlisted", "Rejected", "Selected", "On Hold"}
    if payload.decision not in allowed_decisions:
        raise HTTPException(
            status_code=400,
            detail="Decision must be Shortlisted, Rejected, Selected, or On Hold.",
        )

    application = (
        db.query(Application)
        .filter(Application.id == application_id)
        .first()
    )
    if not application:
        raise HTTPException(status_code=404, detail="Application not found.")

    student = (
        db.query(Student).filter(Student.id == application.student_id).first()
    )
    job = db.query(Job).filter(Job.id == application.job_id).first()
    if not student or not job:
        raise HTTPException(
            status_code=404,
            detail="Student or job record could not be found.",
        )
    if not application.company_interview_score:
        raise HTTPException(
            status_code=400,
            detail="The company AI interview must be completed before a final decision.",
        )

    # Day 7 final score: Resume 15%, Mock 20%, Match 25%,
    # company interview 30%, and manual recruiter review 10%.
    final_score = round(
        (student.resume_score or 0) * 0.15
        + (student.mock_interview_score or 0) * 0.20
        + (application.match_score or 0) * 0.25
        + (application.company_interview_score or 0) * 0.30
        + payload.recruiter_review_score * 0.10,
        1,
    )

    application.recruiter_review_score = payload.recruiter_review_score
    application.recruiter_feedback = payload.feedback.strip()
    application.final_score = final_score
    application.status = payload.decision
    application.recommendation = f"Recruiter decision: {payload.decision}."
    db.commit()
    db.refresh(application)

    company_interview = (
        db.query(CompanyInterview)
        .filter(CompanyInterview.application_id == application.id)
        .order_by(CompanyInterview.id.desc())
        .first()
    )
    return build_response(
        application,
        student,
        job,
        company_interview.id if company_interview else None,
    )
