"use client";

import Link from "next/link";
import {
  FormEvent,
  Suspense,
  useCallback,
  useEffect,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { checkBackendHealth } from "../../backend-health";

const API_URL = "/api";

const TARGET_ROLES = [
  "AI/ML Intern",
  "Data Analyst",
  "Frontend Developer",
  "Backend Developer",
  "Full-Stack Developer",
  "Software Developer",
];

type Student = {
  id: number;
  name: string;
  email: string;
  college: string | null;
  branch: string | null;
  cgpa: number | null;
  skills: string | null;
  target_role: string | null;
  linkedin_url: string | null;
  github_url: string | null;
  leetcode_url: string | null;
  resume_score: number;
  role_match_score: number;
  mock_interview_score: number;
  ai_profile_summary?: string | null;
  self_introduction_status?: string | null;
  identity_enrollment_status?: string | null;
};

type ResumeResult = {
  message: string;
  student_id: number;
  resume_score: number;
  score_breakdown: Record<string, number>;
  recommendations: string[];
  target_role: string;
  role_match_score: number;
  role_score_breakdown: Record<string, number>;
  matched_skills: string[];
  missing_skills: string[];
  role_recommendations: string[];
  word_count: number;
};

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

type ApplicationResult = {
  id: number;
  job_id: number;
  job_title: string;
  company_name: string;
  eligible: boolean;
  eligibility_reasons: string[];
  status: string;
  result_feedback: string | null;
};

function StudentDashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [studentId, setStudentId] = useState<number | null>(null);
  const [student, setStudent] = useState<Student | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [applications, setApplications] = useState<ApplicationResult[]>([]);
  const [backendStatus, setBackendStatus] = useState("checking...");
  const [pageMessage, setPageMessage] = useState("");

  const [targetRole, setTargetRole] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeResult, setResumeResult] = useState<ResumeResult | null>(null);
  const [resumeMessage, setResumeMessage] = useState("");
  const [uploadingResume, setUploadingResume] = useState(false);
  const [applyingJobId, setApplyingJobId] = useState<number | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profilePanelOpen, setProfilePanelOpen] = useState(false);

  const loadDashboard = useCallback(async (id: number, signal?: AbortSignal) => {
    const [studentResponse, jobsResponse, applicationsResponse] =
      await Promise.all([
        fetch(`${API_URL}/students/${id}`, { signal }),
        fetch(`${API_URL}/jobs`, { signal }),
        fetch(`${API_URL}/applications/student/${id}`, { signal }),
      ]);
    if (!studentResponse.ok) {
      throw new Error("Could not load the student profile.");
    }
    const [studentData, jobData, applicationData]: [
      Student,
      Job[],
      ApplicationResult[],
    ] = await Promise.all([
      studentResponse.json(),
      jobsResponse.ok ? jobsResponse.json() : Promise.resolve([]),
      applicationsResponse.ok
        ? applicationsResponse.json()
        : Promise.resolve([]),
    ]);
    signal?.throwIfAborted();
    setStudent(studentData);
    setTargetRole(studentData.target_role || "");
    setJobs(jobData);
    setApplications(applicationData);
    return studentData;
  }, []);

  useEffect(() => {
    const queryStudentId = Number(searchParams.get("student_id"));
    const storedStudentId = Number(
      window.sessionStorage.getItem("studentId"),
    );
    // A successful sign-in or registration updates sessionStorage before
    // navigating. Prefer that authenticated profile over a stale dashboard URL
    // restored from browser history.
    const resolvedStudentId = storedStudentId || queryStudentId;
    if (!resolvedStudentId) {
      router.replace("/student");
      return;
    }
    if (queryStudentId !== resolvedStudentId) {
      router.replace(`/student/dashboard?student_id=${resolvedStudentId}`);
      return;
    }

    const controller = new AbortController();
    let active = true;

    async function initialize() {
      // A query-string navigation can reuse this component. Clear the previous
      // profile before loading so its data and actions are never shown for the new ID.
      await Promise.resolve();
      if (!active) return;
      setStudentId(resolvedStudentId);
      setStudent(null);
      setJobs([]);
      setApplications([]);
      setTargetRole("");
      setResumeFile(null);
      setResumeResult(null);
      setResumeMessage("");
      setPageMessage("");
      setBackendStatus("checking...");

      try {
        await checkBackendHealth();
        if (!active) return;
        setBackendStatus("ok");
      } catch (error) {
        if (!active) return;
        setBackendStatus("not connected");
        setPageMessage(
          error instanceof Error
            ? error.message
            : "The backend health check failed.",
        );
        return;
      }

      try {
        const loadedStudent = await loadDashboard(
          resolvedStudentId,
          controller.signal,
        );
        if (!active) return;
        window.sessionStorage.setItem("studentId", String(loadedStudent.id));
        window.sessionStorage.setItem("studentName", loadedStudent.name);
      } catch (error) {
        if (!active || (error instanceof Error && error.name === "AbortError")) {
          return;
        }
        setPageMessage(
          error instanceof Error
            ? error.message
            : "Could not load the dashboard.",
        );
      }
    }
    void initialize();

    return () => {
      active = false;
      controller.abort();
    };
  }, [loadDashboard, router, searchParams]);

  useEffect(() => {
    function closeProfileUi(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setProfileMenuOpen(false);
        setProfilePanelOpen(false);
      }
    }

    document.addEventListener("keydown", closeProfileUi);
    return () => {
      document.removeEventListener("keydown", closeProfileUi);
    };
  }, []);

  async function handleResumeAnalysis(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!studentId || !targetRole || !resumeFile) {
      setResumeMessage("Select a target role and choose a PDF resume.");
      return;
    }
    setUploadingResume(true);
    setResumeMessage("");
    setResumeResult(null);
    try {
      const roleResponse = await fetch(
        `${API_URL}/students/${studentId}/target-role`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target_role: targetRole }),
        },
      );
      const roleResult = await roleResponse.json();
      if (!roleResponse.ok) {
        throw new Error(roleResult.detail || "Could not save the target role.");
      }

      const formData = new FormData();
      formData.append("file", resumeFile);
      const resumeResponse = await fetch(
        `${API_URL}/students/${studentId}/resume`,
        { method: "POST", body: formData },
      );
      const result = await resumeResponse.json();
      if (!resumeResponse.ok) {
        throw new Error(result.detail || "Could not analyze the resume.");
      }
      setResumeResult(result);
      setResumeMessage(result.message);
      setResumeFile(null);
      await loadDashboard(studentId);
    } catch (error) {
      setResumeMessage(
        error instanceof Error ? error.message : "Could not analyze the resume.",
      );
    } finally {
      setUploadingResume(false);
    }
  }

  async function applyToJob(jobId: number) {
    if (!studentId) return;
    setApplyingJobId(jobId);
    setPageMessage("");
    try {
      const response = await fetch(`${API_URL}/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_id: studentId, job_id: jobId }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.detail || "Could not apply to this job.");
      }
      setApplications((current) => [
        result,
        ...current.filter((application) => application.id !== result.id),
      ]);
      setPageMessage(
        result.eligible
          ? "Application saved. You can proceed to the company AI interview."
          : "Application saved. The company requirements were not met.",
      );
    } catch (error) {
      setPageMessage(
        error instanceof Error ? error.message : "Could not apply to this job.",
      );
    } finally {
      setApplyingJobId(null);
    }
  }

  function signOut() {
    window.sessionStorage.removeItem("studentId");
    window.sessionStorage.removeItem("studentName");
    router.push("/student");
  }

  function openMockInterview() {
    if (!resumeReady) {
      setResumeMessage(
        "Analyze your resume first to unlock the self-introduction.",
      );
      document
        .getElementById("resume-analysis")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    if (!studentId) return;
    router.push(
      selfIntroductionReady
        ? `/mock-interview?student_id=${studentId}`
        : `/self-introduction?student_id=${studentId}`,
    );
  }

  function openSelfIntroduction() {
    if (selfIntroductionReady && studentId) {
      router.push(`/mock-interview?student_id=${studentId}`);
      return;
    }
    if (!resumeReady) {
      setResumeMessage(
        "Analyze your resume first to unlock the self-introduction.",
      );
      document
        .getElementById("resume-analysis")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (studentId) {
      router.push(`/self-introduction?student_id=${studentId}`);
    }
  }

  const applicationForJob = (jobId: number) =>
    applications.find((application) => application.job_id === jobId);
  const resumeReady =
    Boolean(student?.target_role) && (student?.resume_score || 0) > 0;
  const selfIntroductionCompleted = ["completed", "complete"].includes(
    (student?.self_introduction_status || "").toLowerCase(),
  );
  const identityEnrollmentVerified = ["verified", "completed", "enrolled"].includes(
    (student?.identity_enrollment_status || "").toLowerCase(),
  );
  const selfIntroductionReady =
    selfIntroductionCompleted && identityEnrollmentVerified;
  const profileInitials = (student?.name || "Student")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <main className="surface-grid relative min-h-screen overflow-hidden bg-slate-50 px-5 py-7 text-slate-900 sm:px-8">
      <div className="pointer-events-none absolute -left-32 top-32 h-96 w-96 rounded-full bg-indigo-200/50 blur-3xl" />
      <div className="pointer-events-none absolute -right-32 top-[36rem] h-96 w-96 rounded-full bg-emerald-100/70 blur-3xl" />
      <div className="relative mx-auto max-w-6xl">
        <nav className="glass-card relative z-30 mb-7 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/80 px-5 py-3 shadow-sm">
          <Link className="flex items-center gap-3" href="/">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-600 text-sm font-black text-white">
              AT
            </span>
            <div>
              <p className="text-sm font-bold leading-none">AI Talent</p>
              <p className="mt-1 text-xs text-slate-500">Student dashboard</p>
            </div>
          </Link>
          <div className="relative">
            <button
              aria-expanded={profileMenuOpen}
              aria-haspopup="menu"
              aria-label="Open profile menu"
              className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-left transition hover:bg-slate-100"
              onClick={() => setProfileMenuOpen((open) => !open)}
              type="button"
            >
              <span className="relative grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-indigo-600 to-violet-500 text-sm font-black text-white shadow-md shadow-indigo-200">
                {profileInitials || "S"}
                <span
                  className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white ${
                    backendStatus === "ok" ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                />
              </span>
              <span className="hidden sm:block">
                <span className="block max-w-36 truncate text-sm font-bold text-slate-800">
                  {student?.name || "Student"}
                </span>
                <span className="block text-xs text-slate-500">
                  {backendStatus === "ok" ? "System online" : backendStatus}
                </span>
              </span>
              <svg
                aria-hidden="true"
                className={`h-4 w-4 text-slate-400 transition ${
                  profileMenuOpen ? "rotate-180" : ""
                }`}
                fill="none"
                viewBox="0 0 24 24"
              >
                <path
                  d="m7 10 5 5 5-5"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                />
              </svg>
            </button>

            {profileMenuOpen && (
              <div
                className="absolute right-0 top-[calc(100%+0.6rem)] z-40 w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-300/60"
                role="menu"
              >
                <div className="border-b border-slate-100 px-3 py-2.5">
                  <p className="truncate text-sm font-bold text-slate-900">
                    {student?.name || "Student"}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {student?.email || "Profile loading…"}
                  </p>
                </div>
                <button
                  className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700"
                  onClick={() => {
                    setProfileMenuOpen(false);
                    setProfilePanelOpen(true);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-100 text-indigo-700">
                    ◉
                  </span>
                  Profile
                </button>
                <button
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold text-rose-600 hover:bg-rose-50"
                  onClick={signOut}
                  role="menuitem"
                  type="button"
                >
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-rose-100">
                    ↗
                  </span>
                  Log out
                </button>
              </div>
            )}
          </div>
        </nav>

        <header className="fade-up overflow-hidden rounded-3xl bg-slate-950 px-7 py-9 text-white shadow-2xl shadow-slate-300/60 sm:px-10">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-300">
            Welcome back
          </p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-6">
            <div>
              <h1 className="text-3xl font-black sm:text-5xl">
                {student?.name || "Student"}
              </h1>
              <p className="mt-3 text-sm text-slate-300">
                {student?.college || "College not added"} ·{" "}
                {student?.branch || "Branch not added"}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-white/10 px-5 py-3">
                <p className="text-xs text-slate-300">Resume score</p>
                <p className="mt-1 text-2xl font-black">
                  {student?.resume_score || 0}
                </p>
              </div>
              <div className="rounded-2xl bg-white/10 px-5 py-3">
                <p className="text-xs text-slate-300">Mock score</p>
                <p className="mt-1 text-2xl font-black">
                  {student?.mock_interview_score || 0}
                </p>
              </div>
            </div>
          </div>
        </header>

        <section className="mt-7 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Link
            className="glass-card rounded-2xl border border-white p-5 shadow-lg shadow-slate-200/50 hover:-translate-y-0.5 hover:border-indigo-200"
            href="#resume-analysis"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-black text-indigo-600">01</span>
              <span
                className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${
                  resumeReady
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-slate-100 text-slate-500"
                }`}
              >
                {resumeReady ? "Complete" : "Required"}
              </span>
            </div>
            <h2 className="mt-3 font-extrabold">Analyze resume</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Choose your target role and upload a PDF.
            </p>
          </Link>

          <button
            className="glass-card rounded-2xl border border-white p-5 text-left shadow-lg shadow-slate-200/50 hover:-translate-y-0.5 hover:border-indigo-200"
            onClick={openSelfIntroduction}
            type="button"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-black text-indigo-600">02</span>
              <span
                className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${
                  selfIntroductionReady
                    ? "bg-emerald-50 text-emerald-700"
                    : resumeReady
                      ? "bg-indigo-50 text-indigo-700"
                      : "bg-slate-100 text-slate-500"
                }`}
              >
                {selfIntroductionReady
                  ? "Verified"
                  : resumeReady
                    ? "Ready"
                    : "Locked"}
              </span>
            </div>
            <h2 className="mt-3 font-extrabold">Self-introduction</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              {selfIntroductionReady
                ? "Your introduction and identity reference are complete."
                : resumeReady
                  ? "Record a 60–90 second introduction and identity check."
                  : "Analyze a resume to unlock this required step."}
            </p>
          </button>

          <button
            className="glass-card rounded-2xl border border-white p-5 text-left shadow-lg shadow-slate-200/50 hover:-translate-y-0.5 hover:border-indigo-200"
            onClick={openMockInterview}
            type="button"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-black text-indigo-600">03</span>
              <span
                className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${
                  selfIntroductionReady
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-slate-100 text-slate-500"
                }`}
              >
                {selfIntroductionReady ? "Unlocked" : "Locked"}
              </span>
            </div>
            <h2 className="mt-3 font-extrabold">Mock interview</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              {selfIntroductionReady
                ? `Start your ${student?.target_role} practice interview.`
                : resumeReady
                  ? "Complete your self-introduction to unlock practice."
                  : "Analyze a resume to begin the interview journey."}
            </p>
          </button>

          <Link
            className="glass-card rounded-2xl border border-white p-5 shadow-lg shadow-slate-200/50 hover:-translate-y-0.5 hover:border-indigo-200"
            href="#companies"
          >
            <span className="text-xs font-black text-indigo-600">04</span>
            <h2 className="mt-3 font-extrabold">Browse companies</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Explore roles and apply using your profile.
            </p>
          </Link>
        </section>

        <section
          className="glass-card mt-7 scroll-mt-6 rounded-3xl border border-white p-6 shadow-xl shadow-slate-200/60 sm:p-8"
          id="resume-analysis"
        >
          <div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">
                Resume intelligence
              </p>
              <h2 className="mt-2 text-2xl font-black">
                Analyze your resume
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Only a target role and readable PDF are required.
              </p>
            </div>
          </div>

          <form
            className="mt-6 grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end"
            onSubmit={handleResumeAnalysis}
          >
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Target role</span>
              <select
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 outline-none focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                onChange={(event) => setTargetRole(event.target.value)}
                required
                value={targetRole}
              >
                <option value="">Select target role</option>
                {TARGET_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Resume PDF</span>
              <input
                accept="application/pdf,.pdf"
                className="block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-100 file:px-3 file:py-1.5 file:font-semibold file:text-indigo-700"
                key={resumeFile ? "selected" : "empty"}
                onChange={(event) =>
                  setResumeFile(event.target.files?.[0] || null)
                }
                required
                type="file"
              />
            </label>
            <button
              className="rounded-xl bg-indigo-600 px-5 py-3 font-bold text-white shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-60"
              disabled={uploadingResume || backendStatus !== "ok"}
              type="submit"
            >
              {uploadingResume ? "Analyzing..." : "Analyze resume"}
            </button>
          </form>

          {resumeMessage && (
            <p className="mt-4 rounded-xl bg-slate-100 px-4 py-3 text-sm">
              {resumeMessage}
            </p>
          )}

          {resumeResult && (
            <div className="mt-6 grid gap-5 lg:grid-cols-[260px_1fr]">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                <div className="rounded-2xl bg-indigo-600 p-5 text-white">
                  <p className="text-sm text-indigo-100">ATS readiness</p>
                  <p className="mt-2 text-4xl font-black">
                    {resumeResult.resume_score}
                  </p>
                  <p className="text-xs text-indigo-100">out of 100</p>
                </div>
                <div className="rounded-2xl bg-cyan-600 p-5 text-white">
                  <p className="text-sm text-cyan-100">
                    {resumeResult.target_role} match
                  </p>
                  <p className="mt-2 text-4xl font-black">
                    {resumeResult.role_match_score}
                  </p>
                  <p className="text-xs text-cyan-100">out of 100</p>
                </div>
              </div>
              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <h3 className="font-extrabold">Score breakdown</h3>
                  <div className="mt-3 space-y-2">
                    {Object.entries(resumeResult.score_breakdown).map(
                      ([label, score]) => (
                        <div
                          className="flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"
                          key={label}
                        >
                          <span>{label}</span>
                          <strong>+{score}</strong>
                        </div>
                      ),
                    )}
                  </div>
                </div>
                <div>
                  <h3 className="font-extrabold">Recommended improvements</h3>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                    {[
                      ...resumeResult.role_recommendations,
                      ...resumeResult.recommendations,
                    ]
                      .slice(0, 6)
                      .map((recommendation) => (
                        <li
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2"
                          key={recommendation}
                        >
                          {recommendation}
                        </li>
                      ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </section>

        <section
          className="glass-card mt-7 scroll-mt-6 rounded-3xl border border-white p-6 shadow-xl shadow-slate-200/60 sm:p-8"
          id="companies"
        >
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-600">
              Opportunities
            </p>
            <h2 className="mt-2 text-2xl font-black">Browse companies</h2>
            <p className="mt-1 text-sm text-slate-500">
              Apply to published roles using your signed-in profile.
            </p>
          </div>

          {pageMessage && (
            <p className="mt-5 rounded-xl bg-slate-100 px-4 py-3 text-sm">
              {pageMessage}
            </p>
          )}

          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            {jobs.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500 lg:col-span-2">
                No company jobs are available yet.
              </p>
            ) : (
              jobs.map((job) => {
                const application = applicationForJob(job.id);
                return (
                  <article
                    className="rounded-2xl border border-slate-200 bg-white/85 p-5 shadow-sm"
                    key={job.id}
                  >
                    <p className="text-xs font-bold uppercase tracking-wider text-emerald-600">
                      {job.company_name}
                    </p>
                    <h3 className="mt-1 text-lg font-extrabold">
                      {job.job_title}
                    </h3>
                    <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">
                      {job.job_description}
                    </p>
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="text-slate-500">Location</dt>
                        <dd className="font-medium">
                          {job.location || "Not specified"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Salary</dt>
                        <dd className="font-medium">
                          {job.salary || "Not specified"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Minimum CGPA</dt>
                        <dd className="font-medium">
                          {job.min_cgpa ?? "None"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Eligible branches</dt>
                        <dd className="font-medium">
                          {job.eligible_branch || "All"}
                        </dd>
                      </div>
                    </dl>
                    {application ? (
                      <div className="mt-5">
                        <p
                          className={`rounded-xl px-4 py-3 text-sm font-semibold ${
                            application.eligible
                              ? "bg-emerald-50 text-emerald-800"
                              : "bg-amber-50 text-amber-800"
                          }`}
                        >
                          {application.status}
                        </p>
                        {application.eligible &&
                          ![
                            "Selected",
                            "Rejected",
                            "Company AI Interview Submitted",
                          ].includes(application.status) && (
                            <Link
                              className="mt-3 inline-flex w-full justify-center rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700"
                              href={
                                selfIntroductionReady
                                  ? `/company-interview?application_id=${application.id}`
                                  : `/self-introduction?student_id=${studentId}`
                              }
                            >
                              {selfIntroductionReady
                                ? "Start company AI interview"
                                : "Complete self-introduction first"}
                            </Link>
                          )}
                      </div>
                    ) : (
                      <button
                        className="mt-5 w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
                        disabled={
                          applyingJobId === job.id ||
                          !student ||
                          student.resume_score <= 0
                        }
                        onClick={() => void applyToJob(job.id)}
                        type="button"
                      >
                        {applyingJobId === job.id
                          ? "Applying..."
                          : student && student.resume_score > 0
                            ? "Apply now"
                            : "Analyze resume before applying"}
                      </button>
                    )}
                  </article>
                );
              })
            )}
          </div>
        </section>
      </div>

      {profilePanelOpen && (
        <>
          <button
            aria-label="Close profile"
            className="fixed inset-0 z-40 cursor-default bg-slate-950/45 backdrop-blur-sm"
            onClick={() => setProfilePanelOpen(false)}
            type="button"
          />
          <aside
            aria-labelledby="student-profile-title"
            aria-modal="true"
            className="fixed inset-y-0 right-0 z-50 w-full max-w-xl overflow-y-auto bg-slate-50 shadow-2xl shadow-slate-950/30"
            role="dialog"
          >
            <div className="bg-gradient-to-br from-slate-950 via-indigo-950 to-indigo-800 px-6 pb-7 pt-6 text-white sm:px-8">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-4">
                  <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-white/15 text-xl font-black ring-1 ring-white/20">
                    {profileInitials || "S"}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-200">
                      Student profile
                    </p>
                    <h2
                      className="mt-1 truncate text-2xl font-black"
                      id="student-profile-title"
                    >
                      {student?.name || "Student"}
                    </h2>
                    <p className="mt-1 truncate text-sm text-indigo-100">
                      {student?.email || "Profile loading…"}
                    </p>
                  </div>
                </div>
                <button
                  aria-label="Close profile"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10 text-xl hover:bg-white/20"
                  onClick={() => setProfilePanelOpen(false)}
                  type="button"
                >
                  ×
                </button>
              </div>

              <div className="mt-6 grid grid-cols-3 gap-3">
                {[
                  ["Resume", student?.resume_score || 0],
                  ["Role match", student?.role_match_score || 0],
                  ["Mock", student?.mock_interview_score || 0],
                ].map(([label, score]) => (
                  <div
                    className="rounded-2xl bg-white/10 px-3 py-3 ring-1 ring-white/10"
                    key={label}
                  >
                    <p className="text-xs text-indigo-100">{label}</p>
                    <p className="mt-1 text-2xl font-black">{score}</p>
                    <p className="text-[10px] text-indigo-200">out of 100</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-5 p-6 sm:p-8">
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-black uppercase tracking-[0.14em] text-slate-500">
                  Personal and academic details
                </h3>
                <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                  {[
                    ["College", student?.college || "Not added"],
                    ["Branch", student?.branch || "Not added"],
                    ["CGPA", student?.cgpa ?? "Not added"],
                    ["Target role", student?.target_role || "Not selected"],
                  ].map(([label, value]) => (
                    <div className="rounded-xl bg-slate-50 px-4 py-3" key={label}>
                      <dt className="text-xs font-semibold text-slate-500">
                        {label}
                      </dt>
                      <dd className="mt-1 text-sm font-bold text-slate-900">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-black uppercase tracking-[0.14em] text-slate-500">
                  Skills
                </h3>
                <div className="mt-4 flex flex-wrap gap-2">
                  {student?.skills ? (
                    student.skills.split(",").map((skill) => (
                      <span
                        className="rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700"
                        key={skill.trim()}
                      >
                        {skill.trim()}
                      </span>
                    ))
                  ) : (
                    <p className="text-sm text-slate-500">No skills added yet.</p>
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-black uppercase tracking-[0.14em] text-slate-500">
                  Progress
                </h3>
                <dl className="mt-4 space-y-3 text-sm">
                  {[
                    [
                      "Self-introduction",
                      student?.self_introduction_status || "Not Started",
                    ],
                    [
                      "Identity enrollment",
                      student?.identity_enrollment_status || "Not Started",
                    ],
                    ["Applications", applications.length],
                  ].map(([label, value]) => (
                    <div
                      className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 px-4 py-3"
                      key={label}
                    >
                      <dt className="text-slate-500">{label}</dt>
                      <dd className="text-right font-bold text-slate-900">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-black uppercase tracking-[0.14em] text-slate-500">
                  Professional profiles
                </h3>
                <div className="mt-4 grid gap-2">
                  {[
                    ["LinkedIn", student?.linkedin_url],
                    ["GitHub", student?.github_url],
                    ["LeetCode", student?.leetcode_url],
                  ].map(([label, url]) =>
                    url ? (
                      <a
                        className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm font-bold text-indigo-700 hover:bg-indigo-50"
                        href={String(url)}
                        key={label}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {label}
                        <span aria-hidden="true">↗</span>
                      </a>
                    ) : (
                      <div
                        className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm"
                        key={label}
                      >
                        <span className="font-bold text-slate-700">{label}</span>
                        <span className="text-slate-400">Not added</span>
                      </div>
                    ),
                  )}
                </div>
              </section>

              {student?.ai_profile_summary && (
                <section className="rounded-2xl border border-indigo-100 bg-indigo-50 p-5">
                  <h3 className="text-sm font-black uppercase tracking-[0.14em] text-indigo-700">
                    AI profile summary
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-slate-700">
                    {student.ai_profile_summary}
                  </p>
                </section>
              )}

              <button
                className="w-full rounded-xl border border-rose-200 bg-white px-4 py-3 text-sm font-black text-rose-600 hover:bg-rose-50"
                onClick={signOut}
                type="button"
              >
                Log out
              </button>
            </div>
          </aside>
        </>
      )}
    </main>
  );
}

export default function StudentDashboard() {
  return (
    <Suspense fallback={null}>
      <StudentDashboardContent />
    </Suspense>
  );
}
