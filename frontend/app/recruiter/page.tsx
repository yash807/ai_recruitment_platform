"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

// All browser requests stay on the Next.js origin and are proxied to FastAPI.
const API_URL = "/api";

const TARGET_ROLES = [
  "AI/ML Intern",
  "Data Analyst",
  "Frontend Developer",
  "Backend Developer",
  "Full-Stack Developer",
  "Software Developer",
];

type Job = {
  id: number;
  company_name: string;
  job_title: string;
  job_description: string | null;
  required_skills: string | null;
  min_cgpa: number | null;
  eligible_branch: string | null;
  location: string | null;
  salary: string | null;
};

type Applicant = {
  id: number;
  student_id: number;
  student_name: string;
  job_id: number;
  job_title: string;
  company_name: string;
  linkedin_url: string | null;
  github_url: string | null;
  leetcode_url: string | null;
  eligible: boolean;
  eligibility_reasons: string[];
  match_score: number;
  score_breakdown: Record<string, number>;
  matched_skills: string[];
  missing_skills: string[];
  resume_score: number;
  mock_interview_score: number;
  company_interview_score: number;
  recruiter_review_score: number;
  final_score: number;
  recruiter_feedback: string | null;
  company_interview_id: number | null;
  status: string;
  recommendation: string;
};

type CandidateMatch = {
  student_id: number;
  student_name: string;
  email: string;
  branch: string | null;
  cgpa: number | null;
  skills: string | null;
  target_role: string | null;
  resume_score: number;
  eligible: boolean;
  eligibility_reasons: string[];
  match_score: number;
  score_breakdown: Record<string, number>;
  matched_skills: string[];
  missing_skills: string[];
  existing_application_id: number | null;
  existing_status: string | null;
};

type InterviewEvaluation = {
  target_role: string;
  technical_score: number;
  communication_score: number;
  problem_solving_score: number;
  project_understanding_score: number;
  role_readiness_score: number;
  overall_score: number;
  strengths: string[];
  improvement_areas: string[];
  summary: string;
};

type RecruiterInterviewResult = {
  interview_id: number;
  application_id: number;
  transcripts: string[];
  evaluation: InterviewEvaluation;
};

const emptyJobForm = {
  company_name: "",
  job_title: "",
  job_description: "",
  required_skills: "",
  min_cgpa: "",
  eligible_branch: "All",
  location: "",
  salary: "",
};

export default function RecruiterPage() {
  // Data and form state for the recruiter workspace.
  const [jobs, setJobs] = useState<Job[]>([]);
  const [form, setForm] = useState(emptyJobForm);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [backendStatus, setBackendStatus] = useState("checking...");

  // Applicant-review and final-decision state.
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [loadingApplicants, setLoadingApplicants] = useState(false);
  const [savingApplicationId, setSavingApplicationId] = useState<number | null>(null);
  const [reviewScores, setReviewScores] = useState<Record<number, string>>({});
  const [feedback, setFeedback] = useState<Record<number, string>>({});
  const [interviewResults, setInterviewResults] = useState<
    Record<number, RecruiterInterviewResult>
  >({});
  const [dashboardMessage, setDashboardMessage] = useState("");
  const [candidateMatches, setCandidateMatches] = useState<CandidateMatch[]>([]);
  const [matchesJobId, setMatchesJobId] = useState<number | null>(null);
  const [matchMessage, setMatchMessage] = useState("");
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [invitingStudentId, setInvitingStudentId] = useState<number | null>(null);
  const [invitingAll, setInvitingAll] = useState(false);

  // Read all recruiter-created jobs from FastAPI.
  const loadJobs = useCallback(async () => {
    const response = await fetch(`${API_URL}/jobs`);
    if (!response.ok) throw new Error("Could not load jobs.");
    setJobs(await response.json());
  }, []);

  // Confirm that the backend is available when this page opens.
  useEffect(() => {
    async function loadPage() {
      try {
        const healthResponse = await fetch(`${API_URL}/health`);
        const health = await healthResponse.json();
        setBackendStatus(health.status);
        await loadJobs();
      } catch {
        setBackendStatus("not connected");
      }
    }

    void loadPage();
  }, [loadJobs]);

  // Send the completed job form to POST /jobs/.
  async function handleCreateJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      const response = await fetch(`${API_URL}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          min_cgpa: form.min_cgpa === "" ? null : Number(form.min_cgpa),
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        const detail = Array.isArray(result.detail)
          ? result.detail[0]?.msg
          : result.detail;
        throw new Error(detail || "Could not publish the job.");
      }

      setForm(emptyJobForm);
      setMessage(`${result.job_title} was published successfully.`);
      await loadJobs();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  // Load all applicants and private scores for one recruiter job.
  async function loadApplicants(jobId: number) {
    setSelectedJobId(jobId);
    setLoadingApplicants(true);
    setDashboardMessage("");
    try {
      const response = await fetch(`${API_URL}/applications/job/${jobId}`);
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.detail || "Could not load applicants.");
      }
      setApplicants(result);
      setReviewScores(
        Object.fromEntries(
          result.map((applicant: Applicant) => [
            applicant.id,
            applicant.recruiter_review_score
              ? String(applicant.recruiter_review_score)
              : "",
          ]),
        ),
      );
      setFeedback(
        Object.fromEntries(
          result.map((applicant: Applicant) => [
            applicant.id,
            applicant.recruiter_feedback || "",
          ]),
        ),
      );
    } catch (error) {
      setDashboardMessage(
        error instanceof Error ? error.message : "Could not load applicants.",
      );
    } finally {
      setLoadingApplicants(false);
    }
  }

  // Rank all saved student profiles against one job, including resume content.
  async function loadCandidateMatches(jobId: number) {
    setSelectedJobId(jobId);
    setMatchesJobId(jobId);
    setLoadingMatches(true);
    setDashboardMessage("");
    setMatchMessage("");
    window.requestAnimationFrame(() => {
      document
        .getElementById("matching-students")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    try {
      const response = await fetch(`${API_URL}/applications/job/${jobId}/matches`);
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.detail || "Could not find matching students.");
      }
      setCandidateMatches(result);
      setMatchMessage(
        "Eligibility was checked separately. The match score uses only required skills and the analyzed resume.",
      );
    } catch (error) {
      setCandidateMatches([]);
      setMatchMessage(
        error instanceof Error ? error.message : "Could not find matching students.",
      );
    } finally {
      setLoadingMatches(false);
    }
  }

  // Create one recruiter invitation after the backend verifies the match again.
  async function inviteCandidate(candidate: CandidateMatch) {
    if (!selectedJobId) return;
    setInvitingStudentId(candidate.student_id);
    setDashboardMessage("");
    setMatchMessage("");
    try {
      const response = await fetch(`${API_URL}/applications/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_id: candidate.student_id,
          job_id: selectedJobId,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.detail || "Could not invite this student.");
      }
      await Promise.all([
        loadCandidateMatches(selectedJobId),
        loadApplicants(selectedJobId),
      ]);
      setMatchMessage(
        `${candidate.student_name} was invited to the company AI interview.`,
      );
    } catch (error) {
      setMatchMessage(
        error instanceof Error ? error.message : "Could not invite this student.",
      );
    } finally {
      setInvitingStudentId(null);
    }
  }

  // Automatically invite every currently qualified student for the selected job.
  async function inviteAllQualified() {
    if (!selectedJobId) return;
    setInvitingAll(true);
    setDashboardMessage("");
    setMatchMessage("");
    try {
      const response = await fetch(
        `${API_URL}/applications/job/${selectedJobId}/invite-matches`,
        { method: "POST" },
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.detail || "Could not invite matching students.");
      }
      await Promise.all([
        loadCandidateMatches(selectedJobId),
        loadApplicants(selectedJobId),
      ]);
      setMatchMessage(result.message);
    } catch (error) {
      setMatchMessage(
        error instanceof Error
          ? error.message
          : "Could not invite matching students.",
      );
    } finally {
      setInvitingAll(false);
    }
  }

  // Load transcripts and the private company-interview evaluation on demand.
  async function loadInterviewResult(applicant: Applicant) {
    if (!applicant.company_interview_id) return;
    setDashboardMessage("");
    try {
      const response = await fetch(
        `${API_URL}/company-interviews/${applicant.company_interview_id}/recruiter-result`,
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.detail || "Could not load the interview result.");
      }
      setInterviewResults((current) => ({
        ...current,
        [applicant.id]: result,
      }));
    } catch (error) {
      setDashboardMessage(
        error instanceof Error
          ? error.message
          : "Could not load the interview result.",
      );
    }
  }

  // Save recruiter review, calculate final score, and publish the decision.
  async function saveDecision(applicant: Applicant, decision: string) {
    const reviewScore = Number(reviewScores[applicant.id]);
    const recruiterFeedback = feedback[applicant.id]?.trim();
    if (Number.isNaN(reviewScore) || reviewScore < 0 || reviewScore > 100) {
      setDashboardMessage("Enter a recruiter review score between 0 and 100.");
      return;
    }
    if (!recruiterFeedback) {
      setDashboardMessage("Add brief feedback before publishing a decision.");
      return;
    }

    setSavingApplicationId(applicant.id);
    setDashboardMessage("");
    try {
      const response = await fetch(
        `${API_URL}/applications/${applicant.id}/decision`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision,
            recruiter_review_score: reviewScore,
            feedback: recruiterFeedback,
          }),
        },
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.detail || "Could not save the decision.");
      }
      setApplicants((current) =>
        current.map((item) => (item.id === result.id ? result : item)),
      );
      setDashboardMessage(
        `${result.student_name} is now ${result.status}. Final score: ${result.final_score}/100.`,
      );
    } catch (error) {
      setDashboardMessage(
        error instanceof Error ? error.message : "Could not save the decision.",
      );
    } finally {
      setSavingApplicationId(null);
    }
  }

  const selectedJob = jobs.find((job) => job.id === selectedJobId);

  return (
    <main className="surface-grid relative min-h-screen overflow-hidden bg-slate-50 px-5 py-8 text-slate-900 sm:px-8">
      <div className="pointer-events-none absolute -left-40 top-20 h-96 w-96 rounded-full bg-blue-200/50 blur-3xl" />
      <div className="pointer-events-none absolute -right-32 top-96 h-96 w-96 rounded-full bg-indigo-100/70 blur-3xl" />

      <div className="relative mx-auto max-w-6xl">
        {/* Navigation between the student and recruiter prototypes. */}
        <nav className="glass-card mb-7 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/80 px-5 py-3 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-600 text-sm font-black text-white shadow-lg shadow-blue-200">
              AT
            </span>
            <div>
              <p className="text-sm font-bold leading-none">AI Talent</p>
              <p className="mt-1 text-xs text-slate-500">Recruiter workspace</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              className="rounded-lg px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 hover:text-slate-950"
              href="/"
            >
              Student page
            </Link>
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${
                backendStatus === "ok"
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-amber-50 text-amber-700"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  backendStatus === "ok" ? "bg-emerald-500" : "bg-amber-500"
                }`}
              />
              {backendStatus === "ok" ? "System online" : backendStatus}
            </span>
          </div>
        </nav>

        {/* Recruiter introduction. */}
        <header className="fade-up mb-8 rounded-3xl bg-gradient-to-br from-slate-950 via-blue-950 to-indigo-950 px-7 py-9 text-white shadow-2xl shadow-slate-300/60 sm:px-10 sm:py-11">
          <p className="mb-4 inline-flex rounded-full border border-blue-300/20 bg-blue-400/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-blue-200">
            Recruiter hiring workspace
          </p>
          <h1 className="max-w-3xl text-3xl font-black tracking-tight sm:text-5xl">
            Turn job requirements into an{" "}
            <span className="text-blue-300">explainable candidate match.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
            Publish a role with its hard eligibility rules and required skills.
            Students can then apply from their own workspace.
          </p>
        </header>

        <div className="grid gap-7 lg:grid-cols-[0.9fr_1.1fr]">
          {/* Job-posting form. */}
          <section className="glass-card rounded-3xl border border-white p-6 shadow-xl shadow-slate-200/60 sm:p-7">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 font-bold text-blue-700">
                01
              </span>
              <div>
                <h2 className="text-xl font-extrabold">Post a job</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Required skills can be separated with commas.
                </p>
              </div>
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleCreateJob}>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Company name</span>
                <input
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
                  placeholder="B-Hub AI Labs"
                  value={form.company_name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      company_name: event.target.value,
                    }))
                  }
                  required
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium">Job role</span>
                <select
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
                  value={form.job_title}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      job_title: event.target.value,
                    }))
                  }
                  required
                >
                  <option value="">Select a role</option>
                  {TARGET_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium">
                  Job description
                </span>
                <textarea
                  className="min-h-28 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
                  placeholder="Describe the responsibilities, tools, and expected outcomes for this role."
                  value={form.job_description}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      job_description: event.target.value,
                    }))
                  }
                  required
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium">
                  Required skills
                </span>
                <input
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
                  placeholder="Python, Machine Learning, SQL"
                  value={form.required_skills}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      required_skills: event.target.value,
                    }))
                  }
                  required
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">
                    Minimum CGPA
                  </span>
                  <input
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
                    max="10"
                    min="0"
                    placeholder="7.0"
                    step="0.01"
                    type="number"
                    value={form.min_cgpa}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        min_cgpa: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">
                    Eligible branches
                  </span>
                  <input
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
                    placeholder="CSE, IT, AIML or All"
                    value={form.eligible_branch}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        eligible_branch: event.target.value,
                      }))
                    }
                    required
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Location</span>
                  <input
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
                    placeholder="Remote / Noida"
                    value={form.location}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        location: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">
                    Salary or stipend
                  </span>
                  <input
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
                    placeholder="₹15,000/month"
                    value={form.salary}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        salary: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>

              <button
                className="w-full rounded-xl bg-blue-600 px-4 py-3 font-bold text-white shadow-lg shadow-blue-200 hover:-translate-y-0.5 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={saving || backendStatus !== "ok"}
                type="submit"
              >
                {saving ? "Publishing..." : "Publish job"}
              </button>
              {message && (
                <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm">
                  {message}
                </p>
              )}
            </form>
          </section>

          {/* Jobs already stored in SQLite. */}
          <section className="glass-card rounded-3xl border border-white p-6 shadow-xl shadow-slate-200/60 sm:p-7">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-extrabold">Published jobs</h2>
                <p className="mt-1 text-sm text-slate-500">
                  These roles are immediately visible on the student page.
                </p>
              </div>
              <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700">
                {jobs.length}
              </span>
            </div>

            <div className="mt-6 space-y-4">
              {jobs.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
                  No job has been posted yet.
                </p>
              ) : (
                jobs.map((job) => (
                  <article
                    className="rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-sm hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
                    key={job.id}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-blue-600">
                          {job.company_name}
                        </p>
                        <h3 className="mt-1 text-lg font-extrabold">
                          {job.job_title}
                        </h3>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                        Job {job.id}
                      </span>
                    </div>
                    <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">
                      {job.job_description}
                    </p>
                    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-slate-500">Required skills</dt>
                        <dd className="font-medium">{job.required_skills}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Minimum CGPA</dt>
                        <dd className="font-medium">{job.min_cgpa ?? "None"}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Eligible branches</dt>
                        <dd className="font-medium">
                          {job.eligible_branch || "All"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Location · Pay</dt>
                        <dd className="font-medium">
                          {job.location || "Not specified"} ·{" "}
                          {job.salary || "Not specified"}
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      <button
                        className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:-translate-y-0.5 hover:bg-blue-700"
                        onClick={() => void loadCandidateMatches(job.id)}
                        type="button"
                      >
                        Find matching students
                      </button>
                      <button
                        className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:-translate-y-0.5 hover:bg-violet-700"
                        onClick={() => void loadApplicants(job.id)}
                        type="button"
                      >
                        Review applicants
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>

        {/* Recruiter discovery: automatically rank profiles and send invitations. */}
        {selectedJob && matchesJobId === selectedJob.id && (
          <section
            className="glass-card mt-7 scroll-mt-6 rounded-3xl border border-white p-6 shadow-xl shadow-slate-200/60 sm:p-8"
            id="matching-students"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 font-bold text-blue-700">
                    02
                  </span>
                  <div>
                    <h2 className="text-xl font-extrabold">Matching students</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {selectedJob.company_name} · {selectedJob.job_title}
                    </p>
                  </div>
                </div>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                  CGPA and branch are separate eligibility rules. The match
                  score uses only required skills found in the student&apos;s
                  skills/resume (70 points) and resume ATS readiness (30 points).
                  The job description, target role and mock score are not used.
                </p>
              </div>
              <button
                className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={
                  invitingAll ||
                  !candidateMatches.some(
                    (candidate) =>
                      candidate.eligible && !candidate.existing_application_id,
                  )
                }
                onClick={() => void inviteAllQualified()}
                type="button"
              >
                {invitingAll ? "Inviting..." : "Invite all qualified"}
              </button>
            </div>

            {matchMessage && (
              <p className="mt-5 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700">
                {matchMessage}
              </p>
            )}

            <div className="mt-6 space-y-4">
              {loadingMatches ? (
                <p className="rounded-xl bg-blue-50 p-6 text-center text-blue-700">
                  Matching all student profiles...
                </p>
              ) : candidateMatches.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
                  No qualified students were found for this job.
                </p>
              ) : (
                candidateMatches.map((candidate) => (
                  <article
                    className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5"
                    key={candidate.student_id}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-extrabold">
                            {candidate.student_name}
                          </h3>
                          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">
                            Qualified
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-slate-500">
                          {candidate.email} · {candidate.branch || "Branch not provided"}
                          {" · "}CGPA {candidate.cgpa ?? "Not provided"}
                        </p>
                        <p className="mt-2 text-sm text-slate-600">
                          Target role: {candidate.target_role || "Not selected"}
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-950 px-4 py-2.5 text-center text-white">
                        <p className="text-xs text-slate-300">Internal match</p>
                        <p className="text-xl font-black">
                          {candidate.match_score}/100
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-xl bg-white/80 p-3">
                        <p className="text-xs text-slate-500">Resume ATS</p>
                        <p className="font-extrabold">{candidate.resume_score}/100</p>
                      </div>
                      <div className="rounded-xl bg-white/80 p-3">
                        <p className="text-xs text-slate-500">Matched skills</p>
                        <p className="text-sm font-semibold">
                          {candidate.matched_skills.join(", ") || "None"}
                        </p>
                      </div>
                      <div className="rounded-xl bg-white/80 p-3">
                        <p className="text-xs text-slate-500">Missing skills</p>
                        <p className="text-sm font-semibold">
                          {candidate.missing_skills.join(", ") || "None"}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 flex justify-end">
                      {candidate.existing_application_id ? (
                        <span className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-600">
                          {candidate.existing_status || "Already in recruitment pipeline"}
                        </span>
                      ) : (
                        <button
                          className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                          disabled={
                            invitingStudentId === candidate.student_id
                          }
                          onClick={() => void inviteCandidate(candidate)}
                          type="button"
                        >
                          {invitingStudentId === candidate.student_id
                            ? "Inviting..."
                            : "Invite to AI interview"}
                        </button>
                      )}
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        )}

        {/* Day 7 recruiter applicant review and final decision dashboard. */}
        <section className="glass-card mt-7 rounded-3xl border border-white p-6 shadow-xl shadow-slate-200/60 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-50 font-bold text-violet-700">
                  03
                </span>
                <div>
                  <h2 className="text-xl font-extrabold">Applicant decisions</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {selectedJob
                      ? `${selectedJob.company_name} · ${selectedJob.job_title}`
                      : "Choose Review applicants from a published job."}
                  </p>
                </div>
              </div>
            </div>
            {selectedJob && (
              <span className="rounded-full bg-violet-50 px-3 py-1 text-sm font-semibold text-violet-700">
                {applicants.length} applicant{applicants.length === 1 ? "" : "s"}
              </span>
            )}
          </div>

          {dashboardMessage && (
            <p className="mt-5 rounded-xl bg-slate-100 px-4 py-3 text-sm">
              {dashboardMessage}
            </p>
          )}

          <div className="mt-6 space-y-6">
            {loadingApplicants ? (
              <p className="rounded-xl bg-blue-50 p-6 text-center text-blue-700">
                Loading applicants...
              </p>
            ) : !selectedJob ? (
              <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
                Select a published job to open its recruitment pipeline.
              </p>
            ) : applicants.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
                No student has applied to this job yet.
              </p>
            ) : (
              applicants.map((applicant) => {
                const interviewResult = interviewResults[applicant.id];
                const interviewComplete = applicant.company_interview_score > 0;
                const finalDecision = [
                  "Shortlisted",
                  "Rejected",
                  "Selected",
                  "On Hold",
                ].includes(applicant.status);

                return (
                  <article
                    className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm sm:p-6"
                    key={applicant.id}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-violet-600">
                          Application {applicant.id}
                        </p>
                        <h3 className="mt-1 text-xl font-extrabold">
                          {applicant.student_name}
                        </h3>
                        <p className="mt-1 text-sm text-slate-500">
                          {applicant.status}
                        </p>
                        {(applicant.linkedin_url ||
                          applicant.github_url ||
                          applicant.leetcode_url) && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {[
                              ["LinkedIn", applicant.linkedin_url],
                              ["GitHub", applicant.github_url],
                              ["LeetCode", applicant.leetcode_url],
                            ].map(([label, url]) =>
                              url ? (
                                <a
                                  className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100"
                                  href={url}
                                  key={label}
                                  rel="noreferrer"
                                  target="_blank"
                                >
                                  {label} ↗
                                </a>
                              ) : null,
                            )}
                          </div>
                        )}
                      </div>
                      {finalDecision && (
                        <div className="rounded-2xl bg-slate-950 px-5 py-3 text-center text-white">
                          <p className="text-xs text-slate-300">Final score</p>
                          <p className="text-2xl font-black">
                            {applicant.final_score}/100
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                      {[
                        ["Resume", applicant.resume_score, "15%"],
                        ["Mock interview", applicant.mock_interview_score, "20%"],
                        ["Job match", applicant.match_score, "25%"],
                        ["Company interview", applicant.company_interview_score, "30%"],
                        ["Recruiter review", applicant.recruiter_review_score, "10%"],
                      ].map(([label, score, weight]) => (
                        <div className="rounded-xl bg-slate-50 p-3" key={String(label)}>
                          <p className="text-xs text-slate-500">{label}</p>
                          <p className="mt-1 text-xl font-extrabold">{score}/100</p>
                          <p className="text-xs font-semibold text-violet-600">Weight {weight}</p>
                        </div>
                      ))}
                    </div>

                    <div className="mt-5 grid gap-4 lg:grid-cols-2">
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                        <h4 className="font-bold text-emerald-900">Matched skills</h4>
                        <p className="mt-2 text-sm leading-6 text-emerald-800">
                          {applicant.matched_skills.join(", ") || "None identified"}
                        </p>
                      </div>
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                        <h4 className="font-bold text-amber-900">Missing skills</h4>
                        <p className="mt-2 text-sm leading-6 text-amber-800">
                          {applicant.missing_skills.join(", ") || "None identified"}
                        </p>
                      </div>
                    </div>

                    {applicant.company_interview_id && interviewComplete && (
                      <button
                        className="mt-5 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-bold text-violet-700 hover:bg-violet-100"
                        onClick={() => void loadInterviewResult(applicant)}
                        type="button"
                      >
                        {interviewResult
                          ? "Refresh interview result"
                          : "View interview evaluation and transcripts"}
                      </button>
                    )}

                    {interviewResult && (
                      <div className="mt-5 rounded-2xl bg-slate-950 p-5 text-white">
                        <h4 className="font-bold">Private AI interview evaluation</h4>
                        <p className="mt-2 text-sm leading-6 text-slate-300">
                          {interviewResult.evaluation.summary}
                        </p>
                        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {[
                            ["Technical", interviewResult.evaluation.technical_score],
                            ["Communication", interviewResult.evaluation.communication_score],
                            ["Problem solving", interviewResult.evaluation.problem_solving_score],
                            ["Projects", interviewResult.evaluation.project_understanding_score],
                            ["Role readiness", interviewResult.evaluation.role_readiness_score],
                            ["Overall", interviewResult.evaluation.overall_score],
                          ].map(([label, score]) => (
                            <div className="rounded-lg bg-white/10 px-3 py-2 text-sm" key={String(label)}>
                              <span className="text-slate-300">{label}</span>{" "}
                              <strong>{score}/100</strong>
                            </div>
                          ))}
                        </div>
                        <details className="mt-4 rounded-xl bg-white/5 p-4">
                          <summary className="cursor-pointer font-bold">
                            Read interview transcripts
                          </summary>
                          <ol className="mt-3 space-y-3 text-sm leading-6 text-slate-300">
                            {interviewResult.transcripts.map((transcript, index) => (
                              <li key={`${applicant.id}-${index}`}>
                                <strong className="text-white">Answer {index + 1}:</strong>{" "}
                                {transcript || "No clear speech detected."}
                              </li>
                            ))}
                          </ol>
                        </details>
                      </div>
                    )}

                    <div className="mt-5 grid gap-4 lg:grid-cols-[180px_1fr]">
                      <label>
                        <span className="mb-1 block text-sm font-medium">
                          Recruiter review /100
                        </span>
                        <input
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
                          max="100"
                          min="0"
                          placeholder="80"
                          type="number"
                          value={reviewScores[applicant.id] || ""}
                          onChange={(event) =>
                            setReviewScores((current) => ({
                              ...current,
                              [applicant.id]: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span className="mb-1 block text-sm font-medium">
                          Feedback shown to student
                        </span>
                        <textarea
                          className="min-h-24 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
                          placeholder="Strong project explanation. Proceeding to the next stage."
                          value={feedback[applicant.id] || ""}
                          onChange={(event) =>
                            setFeedback((current) => ({
                              ...current,
                              [applicant.id]: event.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {["Shortlisted", "Rejected", "On Hold", "Selected"].map(
                        (decision) => (
                          <button
                            className={`rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40 ${
                              decision === "Selected"
                                ? "bg-emerald-600 hover:bg-emerald-700"
                                : decision === "Rejected"
                                  ? "bg-rose-600 hover:bg-rose-700"
                                  : decision === "On Hold"
                                    ? "bg-amber-500 hover:bg-amber-600"
                                    : "bg-violet-600 hover:bg-violet-700"
                            }`}
                            disabled={
                              !interviewComplete ||
                              savingApplicationId === applicant.id
                            }
                            key={decision}
                            onClick={() => void saveDecision(applicant, decision)}
                            type="button"
                          >
                            {savingApplicationId === applicant.id
                              ? "Saving..."
                              : decision}
                          </button>
                        ),
                      )}
                    </div>
                    {!interviewComplete && (
                      <p className="mt-3 text-xs text-amber-700">
                        Decision buttons unlock after the company AI interview is submitted.
                      </p>
                    )}
                  </article>
                );
              })
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
