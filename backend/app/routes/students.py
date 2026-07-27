import hashlib
import hmac
import re
import secrets
from pathlib import Path
from uuid import uuid4

import fitz
from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field, ValidationError, field_validator
from pymongo.errors import DuplicateKeyError

from ..models import Doc, DuplicateRecordError, students
from ..role_profiles import TARGET_ROLES, get_role_profile


router = APIRouter(prefix="/students", tags=["Students"])

# Resume files are stored outside MongoDB; MongoDB stores only their file paths.
PROJECT_ROOT = Path(__file__).resolve().parents[3]
RESUME_UPLOAD_DIR = PROJECT_ROOT / "uploads" / "resumes"
MAX_RESUME_SIZE = 5 * 1024 * 1024


# Data required when the frontend creates a student profile.
class StudentCreate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: str = Field(min_length=5, max_length=255)
    college: str | None = None
    branch: str | None = None
    cgpa: float = Field(ge=0, le=10)
    skills: str | None = None
    target_role: str = Field(min_length=2, max_length=100)
    linkedin_url: str = Field(min_length=5, max_length=500)
    github_url: str | None = Field(default=None, max_length=500)
    leetcode_url: str | None = Field(default=None, max_length=500)

    @field_validator("linkedin_url", "github_url", "leetcode_url")
    @classmethod
    def validate_profile_url(cls, value: str | None, info):
        if not value or not value.strip():
            if info.field_name == "linkedin_url":
                raise ValueError("LinkedIn profile is required.")
            return None

        normalized = value.strip()
        if not normalized.startswith(("http://", "https://")):
            normalized = f"https://{normalized}"

        expected_domains = {
            "linkedin_url": "linkedin.com",
            "github_url": "github.com",
            "leetcode_url": "leetcode.com",
        }
        expected_domain = expected_domains[info.field_name]
        if expected_domain not in normalized.lower():
            raise ValueError(f"Enter a valid {expected_domain} profile URL.")
        return normalized


class StudentRegistration(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: str = Field(min_length=5, max_length=255)
    password: str = Field(min_length=8, max_length=128)
    college: str = Field(min_length=2, max_length=200)
    branch: str = Field(min_length=2, max_length=100)
    cgpa: float = Field(ge=0, le=10)
    skills: str | None = Field(default=None, max_length=1000)
    linkedin_url: str | None = Field(default=None, max_length=500)
    github_url: str | None = Field(default=None, max_length=500)
    leetcode_url: str | None = Field(default=None, max_length=500)


class StudentSignIn(BaseModel):
    email: str = Field(min_length=5, max_length=255)
    password: str = Field(min_length=8, max_length=128)


# Safe student fields returned from the backend to the frontend.
class StudentResponse(BaseModel):
    id: int
    name: str
    email: str
    college: str | None = None
    branch: str | None = None
    cgpa: float | None = None
    skills: str | None = None
    target_role: str | None = None
    linkedin_url: str | None = None
    github_url: str | None = None
    leetcode_url: str | None = None
    resume_score: float
    role_match_score: float
    mock_interview_score: float
    ai_profile_summary: str | None = None


# Complete result returned after a resume is uploaded and analyzed.
class ResumeUploadResponse(BaseModel):
    message: str
    student_id: int
    original_filename: str
    resume_score: float
    score_breakdown: dict[str, int]
    recommendations: list[str]
    target_role: str
    role_match_score: float
    role_score_breakdown: dict[str, int]
    matched_skills: list[str]
    missing_skills: list[str]
    role_recommendations: list[str]
    word_count: int
    extracted_text_preview: str


# Small response model used by the target-role options endpoint.
class TargetRoleOption(BaseModel):
    name: str


class TargetRoleUpdate(BaseModel):
    target_role: str


class ProfileLinksUpdate(BaseModel):
    linkedin_url: str = Field(min_length=5, max_length=500)
    github_url: str | None = Field(default=None, max_length=500)
    leetcode_url: str | None = Field(default=None, max_length=500)

    @field_validator("linkedin_url", "github_url", "leetcode_url")
    @classmethod
    def validate_profile_url(cls, value: str | None, info):
        if not value or not value.strip():
            if info.field_name == "linkedin_url":
                raise ValueError("LinkedIn profile is required.")
            return None
        normalized = value.strip()
        if not normalized.startswith(("http://", "https://")):
            normalized = f"https://{normalized}"
        expected_domains = {
            "linkedin_url": "linkedin.com",
            "github_url": "github.com",
            "leetcode_url": "leetcode.com",
        }
        if expected_domains[info.field_name] not in normalized.lower():
            raise ValueError(
                f"Enter a valid {expected_domains[info.field_name]} profile URL."
            )
        return normalized


def hash_password(password: str) -> str:
    """Create a salted password hash for prototype student sign-in."""
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        bytes.fromhex(salt),
        210_000,
    ).hex()
    return f"{salt}${digest}"


def verify_password(password: str, stored_hash: str | None) -> bool:
    if not stored_hash or "$" not in stored_hash:
        return False
    salt, expected_digest = stored_hash.split("$", 1)
    try:
        calculated_digest = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            bytes.fromhex(salt),
            210_000,
        ).hex()
    except ValueError:
        return False
    return hmac.compare_digest(calculated_digest, expected_digest)


# Calculates general ATS readiness without using a particular job role.
def calculate_resume_score(
    text: str,
    page_count: int,
) -> tuple[float, dict[str, int], list[str]]:
    normalized_text = text.lower()
    word_count = len(text.split())
    recommendations: list[str] = []

    def has_section(*headings: str) -> bool:
        alternatives = "|".join(re.escape(heading) for heading in headings)
        return bool(
            re.search(
                rf"(?im)^\s*(?:{alternatives})\s*:?[ \t]*$",
                text,
            )
        )

    # 1. Contact details and professional links: 10 points.
    contact_score = 0
    if re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", text):
        contact_score += 4
    else:
        recommendations.append("Add a professional email address.")

    compact_text = re.sub(r"[\s()-]", "", text)
    if re.search(r"(?:\+?91)?[6-9]\d{9}", compact_text):
        contact_score += 3
    else:
        recommendations.append("Add a valid phone number.")

    if "linkedin.com" in normalized_text:
        contact_score += 2
    else:
        recommendations.append("Add your LinkedIn profile link.")

    if any(link in normalized_text for link in ("github.com", "portfolio", "behance.net")):
        contact_score += 1

    # 2. Standard ATS section headings: 20 points.
    section_rules = {
        "Summary": (3, ("summary", "professional summary", "career objective", "objective")),
        "Education": (4, ("education", "academic background", "academics")),
        "Skills": (4, ("skills", "technical skills", "core competencies")),
        "Projects": (4, ("projects", "academic projects", "personal projects")),
        "Experience": (4, ("experience", "work experience", "internships", "internship")),
        "Certifications": (1, ("certifications", "certificates", "achievements", "awards")),
    }
    section_score = 0
    found_sections = 0
    for section, (points, headings) in section_rules.items():
        if has_section(*headings):
            section_score += points
            found_sections += 1
        elif section in {"Summary", "Education", "Skills", "Projects", "Experience"}:
            recommendations.append(f"Add a clearly labelled {section} section.")

    # 3. Appropriate resume length: 15 points.
    if 400 <= word_count <= 850:
        length_score = 12
    elif 250 <= word_count < 400 or 851 <= word_count <= 1000:
        length_score = 8
    elif 150 <= word_count < 250 or 1001 <= word_count <= 1200:
        length_score = 4
    else:
        length_score = 0
        recommendations.append("Keep the resume focused at roughly 400–850 words.")

    page_score = 3 if 1 <= page_count <= 2 else 1
    if page_count > 2:
        recommendations.append("For an early-career profile, keep the resume to one or two pages.")

    # 4. Evidence of impact and strong bullet writing: 20 points.
    metric_matches = re.findall(
        r"(?:₹|\$|€)?\s*\d+(?:\.\d+)?\s*(?:%|x|users?|clients?|projects?|hours?|days?|months?|records?|models?|accuracy|revenue|downloads?)",
        normalized_text,
    )
    metrics_score = min(len(metric_matches) * 2, 10)
    if metrics_score < 4:
        recommendations.append("Add measurable results, such as percentages, users, accuracy, time saved, or project scale.")

    action_verbs = {
        "achieved", "analyzed", "automated", "built", "created", "designed",
        "developed", "implemented", "improved", "increased", "led", "managed",
        "optimized", "reduced", "trained", "deployed",
    }
    used_action_verbs = sum(
        1 for verb in action_verbs if re.search(rf"\b{verb}\b", normalized_text)
    )
    action_score = min(used_action_verbs, 5)
    if action_score < 3:
        recommendations.append("Start more bullet points with strong action verbs such as Built, Developed, Improved, or Led.")

    bullet_count = sum(
        1 for line in text.splitlines() if re.match(r"^\s*(?:[-*•▪●])\s+", line)
    )
    bullet_score = 5 if bullet_count >= 5 else 3 if bullet_count >= 2 else 0
    if bullet_score == 0:
        recommendations.append("Use concise bullet points for projects and experience.")

    # 5. Technical and workplace skills supported by project language: 15 points.
    skill_keywords = {
        "python", "java", "javascript", "typescript", "react", "next.js", "node.js",
        "fastapi", "django", "sql", "postgresql", "mongodb", "machine learning",
        "deep learning", "nlp", "data analysis", "pandas", "numpy", "tensorflow",
        "pytorch", "docker", "aws", "azure", "git", "github", "excel", "power bi",
        "tableau", "communication", "leadership", "problem solving",
    }
    found_skills = {skill for skill in skill_keywords if skill in normalized_text}
    if len(found_skills) >= 12:
        skills_score = 10
    elif len(found_skills) >= 8:
        skills_score = 8
    elif len(found_skills) >= 5:
        skills_score = 6
    elif len(found_skills) >= 3:
        skills_score = 4
    elif found_skills:
        skills_score = 2
    else:
        skills_score = 0
        recommendations.append("Add role-relevant technical and workplace skills.")

    evidence_words = {"built", "developed", "implemented", "deployed", "designed", "analyzed"}
    evidence_score = min(
        sum(1 for word in evidence_words if re.search(rf"\b{word}\b", normalized_text)),
        5,
    )

    # 6. Dates and recognizable role history: 10 points.
    date_matches = re.findall(
        r"\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[\s,.-]+\d{4}\b|\b(?:19|20)\d{2}\b",
        normalized_text,
    )
    dates_score = 6 if len(date_matches) >= 4 else 4 if len(date_matches) >= 2 else 2 if date_matches else 0
    if dates_score < 4:
        recommendations.append("Include clear dates for education, internships, and experience.")

    role_terms = ("intern", "engineer", "developer", "analyst", "designer", "manager", "trainee", "assistant")
    role_score = 4 if any(re.search(rf"\b{role}\b", normalized_text) for role in role_terms) else 0

    # 7. Text readability for an ATS parser: 10 points.
    nonempty_lines = [line.strip() for line in text.splitlines() if line.strip()]
    long_line_ratio = (
        sum(1 for line in nonempty_lines if len(line) > 160) / len(nonempty_lines)
        if nonempty_lines
        else 1
    )
    readability_score = 5
    readability_score += 2 if "�" not in text else 0
    readability_score += 3 if long_line_ratio <= 0.10 else 1 if long_line_ratio <= 0.25 else 0
    if readability_score < 8:
        recommendations.append("Use a simple, single-column layout with short readable lines for better ATS parsing.")

    breakdown = {
        "Contact & links": contact_score,
        "Standard sections": section_score,
        "Length & pages": length_score + page_score,
        "Impact & bullet quality": metrics_score + action_score + bullet_score,
        "Skills & evidence": skills_score + evidence_score,
        "Dates & role history": dates_score + role_score,
        "ATS readability": readability_score,
    }

    return float(sum(breakdown.values())), breakdown, recommendations[:8]


# Compares resume text with the requirements of the selected target role.
def calculate_role_match(
    text: str,
    target_role: str,
) -> tuple[float, dict[str, int], list[str], list[str], list[str]]:
    profile = get_role_profile(target_role)
    if not profile:
        raise ValueError("Unsupported target role.")

    normalized_text = " ".join(text.lower().split())

    # A skill is matched when any accepted keyword appears in the resume.
    def contains_any(keywords: tuple[str, ...]) -> bool:
        return any(keyword.lower() in normalized_text for keyword in keywords)

    # Separate found and missing essential skills.
    matched_core = [
        label
        for label, keywords in profile["core_skills"].items()
        if contains_any(keywords)
    ]
    missing_core = [
        label
        for label, keywords in profile["core_skills"].items()
        if not contains_any(keywords)
    ]
    # Supporting skills improve the match but are not treated as essential.
    matched_supporting = [
        label
        for label, keywords in profile["supporting_skills"].items()
        if contains_any(keywords)
    ]

    # Role score: core 60 + supporting 20 + evidence 15 + alignment 5.
    core_score = round(
        60 * len(matched_core) / len(profile["core_skills"])
    )
    supporting_score = round(
        20 * len(matched_supporting) / len(profile["supporting_skills"])
    )

    project_evidence_score = 0
    if "project" in normalized_text:
        project_evidence_score += 5
    if any(
        word in normalized_text
        for word in ("built", "developed", "implemented", "analyzed", "deployed")
    ):
        project_evidence_score += 5
    if any(
        term in normalized_text
        for term in ("accuracy", "improved", "reduced", "%", "users", "records")
    ):
        project_evidence_score += 5

    role_alignment_score = (
        5 if contains_any(profile["role_terms"]) else 0
    )

    breakdown = {
        "Core role skills": core_score,
        "Supporting skills": supporting_score,
        "Project evidence": project_evidence_score,
        "Role alignment": role_alignment_score,
    }
    matched_skills = matched_core + matched_supporting

    # Advice identifies genuine gaps; it never invents skills or experience.
    advice: list[str] = []
    if missing_core:
        advice.append(
            "Your resume does not yet show these core skills: "
            + ", ".join(missing_core)
            + ". Add them only after you have genuinely learned or used them."
        )
    advice.append(profile["project_advice"])
    if project_evidence_score < 10:
        advice.append(
            "Explain what you personally built, the technical decision you made, "
            "and the result of the project."
        )
    if project_evidence_score < 15:
        advice.append(
            "Add truthful measurable evidence such as accuracy, records analyzed, "
            "users served, performance improved, or time saved."
        )
    if role_alignment_score == 0:
        advice.append(
            f"Use a short professional summary that clearly states your interest "
            f"in {target_role} opportunities."
        )

    return (
        float(sum(breakdown.values())),
        breakdown,
        matched_skills,
        missing_core,
        advice[:5],
    )


# Create a profile and analyze its mandatory resume in one workflow.
@router.post("", response_model=ResumeUploadResponse, status_code=status.HTTP_201_CREATED)
async def create_student(
    name: str = Form(...),
    email: str = Form(...),
    cgpa: float = Form(...),
    target_role: str = Form(...),
    linkedin_url: str = Form(...),
    file: UploadFile = File(...),
    college: str | None = Form(default=None),
    branch: str | None = Form(default=None),
    skills: str | None = Form(default=None),
    github_url: str | None = Form(default=None),
    leetcode_url: str | None = Form(default=None),
):
    # Reuse the same Pydantic validation as the rest of the student APIs.
    try:
        student_payload = StudentCreate(
            name=name,
            email=email,
            college=college,
            branch=branch,
            cgpa=cgpa,
            skills=skills,
            target_role=target_role,
            linkedin_url=linkedin_url,
            github_url=github_url,
            leetcode_url=leetcode_url,
        )
    except ValidationError as error:
        first_error = error.errors()[0]
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=first_error.get("msg", "Invalid student profile."),
        ) from error

    normalized_email = student_payload.email.strip().lower()
    if students.get_by_email(normalized_email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A student with this email already exists.",
        )
    if student_payload.target_role not in TARGET_ROLES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Select one of the supported target job roles.",
        )

    try:
        new_student = students.create(
            {
                "name": student_payload.name.strip(),
                "email": normalized_email,
                "college": student_payload.college.strip() if student_payload.college else None,
                "branch": student_payload.branch.strip() if student_payload.branch else None,
                "cgpa": student_payload.cgpa,
                "skills": student_payload.skills.strip() if student_payload.skills else None,
                "target_role": student_payload.target_role,
                "linkedin_url": student_payload.linkedin_url,
                "github_url": student_payload.github_url,
                "leetcode_url": student_payload.leetcode_url,
            }
        )
    except (DuplicateRecordError, DuplicateKeyError) as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A student with this email already exists.",
        ) from error

    # The resume endpoint performs PDF validation, extraction, and scoring.
    # If it fails, delete the profile we just created so we don't leave a
    # student record behind with no resume (this replaces the SQL rollback).
    try:
        result = await upload_resume(new_student.id, file)
    except Exception:
        students.delete(new_student.id)
        raise

    result.message = "Student profile created and resume analyzed successfully."
    return result


@router.post(
    "/register",
    response_model=StudentResponse,
    status_code=status.HTTP_201_CREATED,
)
def register_student(registration: StudentRegistration):
    """Create a student account before resume analysis."""
    normalized_email = registration.email.strip().lower()
    existing_student = students.get_by_email(normalized_email)
    if existing_student:
        if existing_student.password_hash:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A student account with this email already exists.",
            )
        # Profiles created before sign-in was introduced can be activated from
        # the new Create profile screen without losing resume or interview data.
        existing_student.password_hash = hash_password(registration.password)
        existing_student.name = registration.name.strip()
        existing_student.college = registration.college.strip()
        existing_student.branch = registration.branch.strip()
        existing_student.cgpa = registration.cgpa
        existing_student.skills = (
            registration.skills.strip() if registration.skills else None
        )
        existing_student.linkedin_url = (
            registration.linkedin_url.strip()
            if registration.linkedin_url
            else existing_student.linkedin_url
        )
        existing_student.github_url = (
            registration.github_url.strip()
            if registration.github_url
            else existing_student.github_url
        )
        existing_student.leetcode_url = (
            registration.leetcode_url.strip()
            if registration.leetcode_url
            else existing_student.leetcode_url
        )
        students.save(existing_student)
        return existing_student

    new_student = students.create(
        {
            "name": registration.name.strip(),
            "email": normalized_email,
            "password_hash": hash_password(registration.password),
            "college": registration.college.strip(),
            "branch": registration.branch.strip(),
            "cgpa": registration.cgpa,
            "skills": registration.skills.strip() if registration.skills else None,
            "linkedin_url": (
                registration.linkedin_url.strip()
                if registration.linkedin_url
                else None
            ),
            "github_url": (
                registration.github_url.strip() if registration.github_url else None
            ),
            "leetcode_url": (
                registration.leetcode_url.strip()
                if registration.leetcode_url
                else None
            ),
        }
    )
    return new_student


@router.post("/sign-in", response_model=StudentResponse)
def sign_in_student(credentials: StudentSignIn):
    """Verify a student email and password for the prototype dashboard."""
    normalized_email = credentials.email.strip().lower()
    student = students.get_by_email(normalized_email)
    if not student or not verify_password(
        credentials.password,
        student.password_hash,
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
        )
    return student


# Return the supported role list for frontend forms.
@router.get("/target-roles", response_model=list[TargetRoleOption])
def get_target_roles():
    return [TargetRoleOption(name=role) for role in TARGET_ROLES]


# Add or update external professional profiles for an existing student.
@router.patch("/{student_id}/profile-links", response_model=StudentResponse)
def update_profile_links(student_id: int, update: ProfileLinksUpdate):
    student = students.get(student_id)
    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student not found.",
        )

    student.linkedin_url = update.linkedin_url
    student.github_url = update.github_url
    student.leetcode_url = update.leetcode_url
    students.save(student)
    return student


# Change an existing student's role and recalculate their saved resume match.
@router.patch("/{student_id}/target-role", response_model=StudentResponse)
def update_target_role(student_id: int, update: TargetRoleUpdate):
    student = students.get(student_id)
    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student not found.",
        )
    if update.target_role not in TARGET_ROLES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Select one of the supported target job roles.",
        )

    student.target_role = update.target_role
    if student.resume_text:
        student.role_match_score = calculate_role_match(
            student.resume_text,
            update.target_role,
        )[0]
    else:
        student.role_match_score = 0
    students.save(student)
    return student


# Return every saved student, newest first.
@router.get("", response_model=list[StudentResponse])
def get_students():
    return students.list(sort=[("id", -1)])


# Return one student. The mock-interview page uses this endpoint.
@router.get("/{student_id}", response_model=StudentResponse)
def get_student(student_id: int):
    student = students.get(student_id)
    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student not found.",
        )
    return student


# Upload a PDF, extract its text, calculate both scores, and save the result.
@router.post("/{student_id}/resume", response_model=ResumeUploadResponse)
async def upload_resume(
    student_id: int,
    file: UploadFile = File(...),
):
    student = students.get(student_id)
    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student not found.",
        )
    if not student.target_role or not get_role_profile(student.target_role):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This student does not have a supported target job role. Create a profile with a target role before analyzing the resume.",
        )

    original_filename = file.filename or "resume.pdf"
    if Path(original_filename).suffix.lower() != ".pdf":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF resumes are supported in this prototype.",
        )

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The uploaded PDF is empty.",
        )
    if len(file_bytes) > MAX_RESUME_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="Resume must be 5 MB or smaller.",
        )

    # PyMuPDF reads text from every page of the uploaded PDF.
    try:
        document = fitz.open(stream=file_bytes, filetype="pdf")
        page_count = document.page_count
        resume_text = "\n".join(page.get_text("text") for page in document).strip()
        document.close()
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The PDF could not be read. Please upload a valid PDF resume.",
        ) from error

    if not resume_text:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="No readable text was found. Scanned-image PDFs are not supported yet.",
        )

    # Score 1: general resume structure and ATS readability.
    resume_score, score_breakdown, recommendations = calculate_resume_score(
        resume_text,
        page_count,
    )
    # Score 2: compatibility with the student's selected target role.
    (
        role_match_score,
        role_score_breakdown,
        matched_skills,
        missing_skills,
        role_recommendations,
    ) = calculate_role_match(resume_text, student.target_role)
    # Give the resume a unique name, then store it in the uploads folder.
    stored_filename = f"student-{student_id}-{uuid4().hex}.pdf"
    RESUME_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    stored_path = RESUME_UPLOAD_DIR / stored_filename
    stored_path.write_bytes(file_bytes)

    previous_resume_path = Path(student.resume_path) if student.resume_path else None
    # Save extracted text and scores in the student database record.
    student.resume_path = str(stored_path)
    student.resume_text = resume_text
    student.resume_score = resume_score
    student.role_match_score = role_match_score
    students.save(student)

    if previous_resume_path and previous_resume_path != stored_path:
        previous_resume_path.unlink(missing_ok=True)

    # Return only a short text preview so the frontend result stays readable.
    preview = " ".join(resume_text.split())[:600]
    return ResumeUploadResponse(
        message="Resume uploaded and analyzed successfully.",
        student_id=student.id,
        original_filename=original_filename,
        resume_score=resume_score,
        score_breakdown=score_breakdown,
        recommendations=recommendations,
        target_role=student.target_role,
        role_match_score=role_match_score,
        role_score_breakdown=role_score_breakdown,
        matched_skills=matched_skills,
        missing_skills=missing_skills,
        role_recommendations=role_recommendations,
        word_count=len(resume_text.split()),
        extracted_text_preview=preview,
    )
