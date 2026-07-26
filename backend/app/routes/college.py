from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Application, Student


router = APIRouter(prefix="/college", tags=["College"])


class CollegeOption(BaseModel):
    name: str
    student_count: int


class CollegeStudentInsight(BaseModel):
    id: int
    name: str
    branch: str | None
    target_role: str | None
    resume_score: float
    mock_interview_score: float
    application_count: int
    outcome: str


class CollegeInsightsResponse(BaseModel):
    college: str
    selected_students: int
    applied_students: int
    hired_students: int
    rejected_students: int
    students_in_process: int
    students_not_applied: int
    interviews_completed: int
    average_resume_score: float
    students: list[CollegeStudentInsight]


@router.get("/options", response_model=list[CollegeOption])
def get_college_options(db: Session = Depends(get_db)):
    """Return colleges already represented by student profiles."""
    students = (
        db.query(Student)
        .filter(Student.college.is_not(None))
        .order_by(Student.college.asc())
        .all()
    )
    counts: dict[str, int] = {}
    for student in students:
        college_name = (student.college or "").strip()
        if college_name:
            counts[college_name] = counts.get(college_name, 0) + 1
    return [
        CollegeOption(name=name, student_count=count)
        for name, count in sorted(counts.items())
    ]


@router.get("/insights", response_model=CollegeInsightsResponse)
def get_college_insights(
    college: str,
    limit: int = Query(default=50, ge=1, le=500),
    db: Session = Depends(get_db),
):
    """Summarize placement outcomes for a selected college cohort."""
    students = (
        db.query(Student)
        .filter(Student.college == college)
        .order_by(Student.id.desc())
        .limit(limit)
        .all()
    )
    if not students:
        raise HTTPException(
            status_code=404,
            detail="No student profiles were found for this college.",
        )

    student_ids = [student.id for student in students]
    applications = (
        db.query(Application)
        .filter(Application.student_id.in_(student_ids))
        .all()
    )
    applications_by_student: dict[int, list[Application]] = {
        student_id: [] for student_id in student_ids
    }
    for application in applications:
        applications_by_student.setdefault(application.student_id, []).append(
            application
        )

    hired_students = 0
    rejected_students = 0
    students_in_process = 0
    applied_students = 0
    interviews_completed = 0
    student_insights: list[CollegeStudentInsight] = []
    rejected_statuses = {"Rejected", "Not Eligible for AI Interview"}

    for student in students:
        records = applications_by_student.get(student.id, [])
        statuses = {record.status for record in records}
        if records:
            applied_students += 1
        if "Selected" in statuses:
            outcome = "Hired"
            hired_students += 1
        elif records and statuses.issubset(rejected_statuses):
            outcome = "Rejected"
            rejected_students += 1
        elif records:
            outcome = "In process"
            students_in_process += 1
        else:
            outcome = "Not applied"

        interviews_completed += sum(
            1 for record in records if (record.company_interview_score or 0) > 0
        )
        student_insights.append(
            CollegeStudentInsight(
                id=student.id,
                name=student.name,
                branch=student.branch,
                target_role=student.target_role,
                resume_score=student.resume_score or 0,
                mock_interview_score=student.mock_interview_score or 0,
                application_count=len(records),
                outcome=outcome,
            )
        )

    average_resume_score = round(
        sum(student.resume_score or 0 for student in students) / len(students),
        1,
    )
    return CollegeInsightsResponse(
        college=college,
        selected_students=len(students),
        applied_students=applied_students,
        hired_students=hired_students,
        rejected_students=rejected_students,
        students_in_process=students_in_process,
        students_not_applied=len(students) - applied_students,
        interviews_completed=interviews_completed,
        average_resume_score=average_resume_score,
        students=student_insights,
    )
