"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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
  target_role: string | null;
  resume_score: number;
  role_match_score: number;
  mock_interview_score: number;
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

export default function StudentDashboard() {
  const router = useRouter();
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

  const loadDashboard = useCallback(async (id: number) => {
    const [studentResponse, jobsResponse, applicationsResponse] =
      await Promise.all([
        fetch(`${API_URL}/students/${id}`),
        fetch(`${API_URL}/jobs`),
        fetch(`${API_URL}/applications/student/${id}`),
      ]);
    if (!studentResponse.ok) {
      throw new Error("Could not load the student profile.");
    }
    const studentData: Student = await studentResponse.json();
    setStudent(studentData);
    setTargetRole(studentData.target_role || "");
    setJobs(jobsResponse.ok ? await jobsResponse.json() : []);
    setApplications(
      applicationsResponse.ok ? await applicationsResponse.json() : [],
    );
  }, []);

  useEffect(() => {
    const queryStudentId = Number(
      new URLSearchParams(window.location.search).get("student_id"),
    );
    const storedStudentId = Number(
      window.sessionStorage.getItem("studentId"),
    );
    const resolvedStudentId = queryStudentId || storedStudentId;
    if (!resolvedStudentId) {
      router.replace("/student");
      return;
    }

    async function initialize() {
      try {
        await checkBackendHealth();
        setStudentId(resolvedStudentId);
        setBackendStatus("ok");
      } catch (error) {
        setBackendStatus("not connected");
        setPageMessage(
          error instanceof Error
            ? error.message
            : "The backend health check failed.",
        );
        return;
      }

      try {
        await loadDashboard(resolvedStudentId);
      } catch (error) {
        setPageMessage(
          error instanceof Error
            ? error.message
            : "Could not load the dashboard.",
        );
      }
    }
    void initialize();
  }, [loadDashboard, router]);

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

  return (
    <main className="surface-grid relative min-h-screen overflow-hidden bg-slate-50 px-5 py-7 text-slate-900 sm:px-8">
      <div className="pointer-events-none absolute -left-32 top-32 h-96 w-96 rounded-full bg-indigo-200/50 blur-3xl" />
      <div className="pointer-events-none absolute -right-32 top-[36rem] h-96 w-96 rounded-full bg-emerald-100/70 blur-3xl" />
      <div className="relative mx-auto max-w-6xl">
        <nav className="glass-card mb-7 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/80 px-5 py-3 shadow-sm">
          <Link className="flex items-center gap-3" href="/">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-600 text-sm font-black text-white">
              AT
            </span>
            <div>
              <p className="text-sm font-bold leading-none">AI Talent</p>
              <p className="mt-1 text-xs text-slate-500">Student dashboard</p>
            </div>
          </Link>
          <div className="flex items-center gap-3">
            <span
              className={`rounded-full px-3 py-1.5 text-xs font-bold ${
                backendStatus === "ok"
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-amber-50 text-amber-700"
              }`}
            >
              {backendStatus === "ok" ? "System online" : backendStatus}
            </span>
            <button
              className="rounded-lg px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"
              onClick={signOut}
              type="button"
            >
              Sign out
            </button>
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
    </main>
  );
}
