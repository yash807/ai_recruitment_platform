# AI Talent Intelligence Prototype

This repaired copy keeps the original SQLite data and uploaded resumes/interview
recordings while separating browser traffic from the FastAPI port.

## Start the backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Wait for `Application startup complete`.

## Start the frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`. Both workspaces should show `System online`.

## Recruiter invitations

For each published job, recruiters can choose **Find matching students**. The
backend ranks saved profiles using CGPA, eligible branch, required skills,
and resume availability as eligibility rules. The match score itself uses only
required skills found in the student skills/resume (70%) and resume ATS
readiness (30%); job-description text, target role, and mock-interview score do
not affect matching. Recruiters can invite one qualified student or
automatically invite all qualified students. Invited students see the job on
the student page and enter the same company-specific interview and final-decision
workflow as normal applicants.

## Verification

Backend API and database workflow:

```bash
cd backend
PYTHONDONTWRITEBYTECODE=1 venv/bin/python tests/smoke_test.py
sqlite3 talent_platform.db 'PRAGMA integrity_check;'
```

Frontend:

```bash
cd frontend
npm run lint
npm run build
```

The first interview analysis may download the configured local Whisper model.
That model is loaded only when analysis begins, so normal startup and health
checks remain fast.
