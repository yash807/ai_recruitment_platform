# AI Talent Intelligence Prototype

This prototype uses a Next.js frontend, a FastAPI backend, and MongoDB. Small
browser requests use the Next.js API proxy. Video recordings upload directly
to FastAPI so they do not exceed Vercel's serverless request-size limit.

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

Open `http://localhost:3000`. The base page now provides three portals:

- **Student** — profile creation/sign-in, resume analysis, self-introduction,
  mock interview, and company job applications.
- **Company** — the complete job-posting, candidate-matching, applicant-review,
  and hiring-decision workflow.
- **College** — college/cohort selection with application, interview, hiring,
  rejection, and student-level placement insights.

Each workspace should show `System online` when FastAPI and MongoDB are available.

## Required student interview flow

The server enforces this order:

1. Create a student profile and analyze a resume.
2. Record a continuous 60–90 second self-introduction using the on-screen
   template and random spoken verification phrase.
3. The backend transcribes the introduction, extracts self-reported project,
   skill, experience, and career-goal highlights, and enrolls a compact face
   continuity reference.
4. Start the mock interview. Every mock and company interview recording must
   match the enrolled reference before it can be saved or analyzed.

## Adaptive company AI interview

The company interview asks one question at a time. The first question is
grounded in the selected job description. After every video answer, the
backend verifies face continuity, transcribes the answer locally with Whisper,
and sends only the job description, required skills, previous questions, and
answer transcripts to the language model. Resume content, recordings, face
references, and other identity data are not sent to the model.

The language model returns a structured question with its assessed competency
and an exact job-description evidence phrase. The backend rejects repeated,
multi-part, ungrounded, and protected-topic questions. If the model or API is
unavailable, a deterministic job-description question keeps the interview
usable. Final scoring remains the local, explainable recruiter evaluation.

Local configuration in `backend/.env`:

```text
OPENAI_API_KEY=your server-side API key
OPENAI_MODEL=gpt-5.6-terra
COMPANY_INTERVIEW_MAX_QUESTIONS=5
```

Never use a `NEXT_PUBLIC_` variable for the API key.

The face checker is a prototype continuity control, not proof of legal
identity. It performs no emotion or demographic inference. Production use
requires a reviewed biometric provider, explicit consent, access controls, a
retention/deletion policy, and a manual appeal path.

## Vercel and Render configuration

Keep the existing Vercel and Render projects connected to this repository.

In Vercel, set:

```text
BACKEND_URL=https://your-render-service.onrender.com
```

In Render, set:

```text
MONGODB_URI=your MongoDB connection string
FRONTEND_ORIGINS=https://your-production-vercel-domain.vercel.app
OPENAI_API_KEY=your server-side API key
OPENAI_MODEL=gpt-5.6-terra
COMPANY_INTERVIEW_MAX_QUESTIONS=5
```

`FRONTEND_ORIGINS` accepts comma-separated origins for additional production
or preview domains. After changing environment variables, redeploy both
services. The backend requirements now include OpenCV and NumPy for the
prototype identity-continuity checks.

## Student access

New students create a profile before entering the dashboard. Passwords are
stored as salted PBKDF2 hashes. The current sign-in flow is suitable for the
prototype UI, but protected production accounts will still require server-side
sessions or signed access tokens before public launch.

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

Backend checks:

```bash
cd backend
MONGODB_URI='mongodb://127.0.0.1:27017/unit_test' \
  venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v

# Requires a reachable MONGODB_URI and uses a disposable test database.
venv/bin/python tests/smoke_test.py
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
