"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";

// All browser requests stay on the Next.js origin and are proxied to FastAPI.
const API_URL = "/api";

// Shape of one student returned by the FastAPI backend.
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
  ai_profile_summary: string | null;
};

// Shape of the complete resume-analysis response.
type ResumeResult = {
  message: string;
  student_id: number;
  original_filename: string;
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
  extracted_text_preview: string;
};

// Shape of one recruiter-created job.
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

// Student-safe application decision. Internal matching scores stay recruiter-only.
type ApplicationResult = {
  id: number;
  student_id: number;
  student_name: string;
  job_id: number;
  job_title: string;
  company_name: string;
  eligible: boolean;
  eligibility_reasons: string[];
  status: string;
  result_feedback: string | null;
};

type ProfileLinks = {
  linkedin_url: string;
  github_url: string;
  leetcode_url: string;
};

// Starting values for the student-profile form.
const emptyForm = {
  name: "",
  email: "",
  college: "",
  branch: "",
  cgpa: "",
  skills: "",
  target_role: "",
  linkedin_url: "",
  github_url: "",
  leetcode_url: "",
};

// Job roles currently supported by the prototype.
const TARGET_ROLES = [
  "AI/ML Intern",
  "Data Analyst",
  "Frontend Developer",
  "Backend Developer",
  "Full-Stack Developer",
  "Software Developer",
];

export default function Home() {
  // Page and backend data.
  const [backendStatus, setBackendStatus] = useState("checking...");
  const [students, setStudents] = useState<Student[]>([]);
  const [profileLinkDrafts, setProfileLinkDrafts] = useState<
    Record<number, ProfileLinks>
  >({});

  // Student-profile form state.
  const [form, setForm] = useState(emptyForm);
  const [profileResumeFile, setProfileResumeFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  // Resume-upload and analysis state.
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeResult, setResumeResult] = useState<ResumeResult | null>(null);
  const [resumeMessage, setResumeMessage] = useState("");
  const [uploadingResume, setUploadingResume] = useState(false);

  // Job-listing, application, and matching-result state.
  const [jobs, setJobs] = useState<Job[]>([]);
  const [applications, setApplications] = useState<ApplicationResult[]>([]);
  const [applyingJobId, setApplyingJobId] = useState<number | null>(null);
  const [applicationMessage, setApplicationMessage] = useState("");

  // Load all saved students from FastAPI.
  const loadStudents = useCallback(async () => {
    const response = await fetch(`${API_URL}/students`);
    if (!response.ok) throw new Error("Could not load students.");
    const result: Student[] = await response.json();
    setStudents(result);
    setProfileLinkDrafts(
      Object.fromEntries(
        result.map((student) => [
          student.id,
          {
            linkedin_url: student.linkedin_url || "",
            github_url: student.github_url || "",
            leetcode_url: student.leetcode_url || "",
          },
        ]),
      ),
    );
  }, []);

  // Load all jobs published from the recruiter page.
  const loadJobs = useCallback(async () => {
    const response = await fetch(`${API_URL}/jobs`);
    if (!response.ok) throw new Error("Could not load jobs.");
    setJobs(await response.json());
  }, []);

  // Check the backend and load students plus jobs when the page first opens.
  useEffect(() => {
    async function loadPage() {
      try {
        const healthResponse = await fetch(`${API_URL}/health`);
        const health = await healthResponse.json();
        setBackendStatus(health.status);
        await Promise.all([loadStudents(), loadJobs()]);
      } catch {
        setBackendStatus("not connected");
      }
    }

    loadPage();
  }, [loadJobs, loadStudents]);

  // Reload the selected student's application history.
  useEffect(() => {
    if (!selectedStudentId) {
      return;
    }

    async function loadApplications() {
      try {
        const response = await fetch(
          `${API_URL}/applications/student/${selectedStudentId}`,
        );
        if (!response.ok) throw new Error("Could not load applications.");
        setApplications(await response.json());
      } catch {
        setApplicationMessage("Could not load this student's applications.");
      }
    }

    void loadApplications();
  }, [selectedStudentId]);

  // Create the profile and upload its mandatory resume in one multipart request.
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profileResumeFile) {
      setMessage("Choose a PDF resume before creating the profile.");
      return;
    }
    setSaving(true);
    setMessage("");

    try {
      const profileData = new FormData();
      Object.entries(form).forEach(([key, value]) => {
        profileData.append(key, value);
      });
      profileData.append("file", profileResumeFile);

      const response = await fetch(`${API_URL}/students`, {
        method: "POST",
        body: profileData,
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.detail || "Could not save the student.");
      }

      setForm(emptyForm);
      setProfileResumeFile(null);
      setResumeResult(result);
      setResumeMessage(result.message);
      setApplications([]);
      setSelectedStudentId(String(result.student_id));

      // Profile creation has already succeeded at this point. Keep the
      // follow-up list refresh separate so a temporary GET failure cannot be
      // misreported as a failed profile creation.
      try {
        await loadStudents();
        setMessage("Student profile and resume saved successfully.");
      } catch {
        setMessage(
          "Student profile and resume were saved, but the list could not refresh. Refresh the page once.",
        );
      }
      window.requestAnimationFrame(() => {
        document
          .getElementById("resume-analysis")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  // Upload a PDF and receive ATS plus target-role analysis.
  async function handleResumeUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResumeMessage("");
    setResumeResult(null);

    if (!selectedStudentId) {
      setResumeMessage("Select a student first.");
      return;
    }
    if (!resumeFile) {
      setResumeMessage("Choose a PDF resume first.");
      return;
    }

    setUploadingResume(true);
    try {
      const uploadData = new FormData();
      uploadData.append("file", resumeFile);

      const response = await fetch(
        `${API_URL}/students/${selectedStudentId}/resume`,
        {
          method: "POST",
          body: uploadData,
        },
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(
          typeof result.detail === "string"
            ? result.detail
            : "Could not upload the resume.",
        );
      }

      setResumeResult(result);
      setResumeMessage(result.message);
      setResumeFile(null);
      await loadStudents();
    } catch (error) {
      setResumeMessage(
        error instanceof Error ? error.message : "Something went wrong.",
      );
    } finally {
      setUploadingResume(false);
    }
  }

  // Update an older student's role and recalculate their existing resume.
  async function updateTargetRole(
    studentId: number,
    targetRole: string,
    source: "profile" | "resume" = "profile",
  ) {
    const setStatusMessage = source === "resume" ? setResumeMessage : setMessage;
    setStatusMessage("");

    // Keep the selected option visible while FastAPI recalculates the saved
    // resume against the new role.
    setStudents((current) =>
      current.map((student) =>
        student.id === studentId
          ? { ...student, target_role: targetRole }
          : student,
      ),
    );
    try {
      const response = await fetch(
        `${API_URL}/students/${studentId}/target-role`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target_role: targetRole }),
        },
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.detail || "Could not update the target role.");
      }
      setStudents((current) =>
        current.map((student) =>
          student.id === studentId ? result : student,
        ),
      );
      setStatusMessage(
        `Target role updated to ${targetRole}. Existing resume matching was recalculated.`,
      );
      setResumeResult(null);
    } catch (error) {
      // Restore the authoritative database value if the update failed.
      await loadStudents().catch(() => undefined);
      setStatusMessage(
        error instanceof Error ? error.message : "Could not update the target role.",
      );
    }
  }

  // Select a saved profile, then move to its resume-upload controls.
  function openResumeUpload(studentId: number) {
    setSelectedStudentId(String(studentId));
    setResumeFile(null);
    setResumeResult(null);
    setResumeMessage("Choose a PDF resume for this student.");
    window.requestAnimationFrame(() => {
      document
        .getElementById("resume-analysis")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  // Save LinkedIn, GitHub, and LeetCode links for an existing student.
  async function updateProfileLinks(studentId: number) {
    const links = profileLinkDrafts[studentId];
    if (!links) return;
    setMessage("");
    try {
      const response = await fetch(
        `${API_URL}/students/${studentId}/profile-links`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(links),
        },
      );
      const result = await response.json();
      if (!response.ok) {
        const detail = Array.isArray(result.detail)
          ? result.detail[0]?.msg
          : result.detail;
        throw new Error(detail || "Could not save profile links.");
      }
      setMessage("Professional profile links saved successfully.");
      await loadStudents();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save profile links.",
      );
    }
  }

  // Create an application and receive the saved eligibility/matching result.
  async function applyToJob(jobId: number) {
    setApplicationMessage("");
    if (!selectedStudentId) {
      setApplicationMessage("Select a student profile before applying.");
      return;
    }

    setApplyingJobId(jobId);
    try {
      const response = await fetch(`${API_URL}/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_id: Number(selectedStudentId),
          job_id: jobId,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.detail || "Could not apply to this job.");
      }

      setApplications((current) => [
        result,
        ...current.filter((application) => application.id !== result.id),
      ]);
      setApplicationMessage(
        result.eligible
          ? "Application saved. You are eligible for the company AI interview."
          : "Application saved. You are not eligible for the company AI interview.",
      );
    } catch (error) {
      setApplicationMessage(
        error instanceof Error ? error.message : "Something went wrong.",
      );
    } finally {
      setApplyingJobId(null);
    }
  }

  // Find a saved result so each job card can show the student's application.
  function applicationForJob(jobId: number) {
    return applications.find((application) => application.job_id === jobId);
  }

  return (
    <main className="surface-grid relative min-h-screen overflow-hidden bg-slate-50 px-5 py-8 text-slate-900 sm:px-8">
      {/* Decorative background shapes */}
      <div className="pointer-events-none absolute -left-32 -top-40 h-96 w-96 rounded-full bg-indigo-200/50 blur-3xl" />
      <div className="pointer-events-none absolute -right-32 top-72 h-96 w-96 rounded-full bg-cyan-100/70 blur-3xl" />
      <div className="relative mx-auto max-w-6xl">
        {/* Top navigation and backend connection status */}
        <nav className="glass-card mb-7 flex items-center justify-between rounded-2xl border border-white/80 px-5 py-3 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-600 text-sm font-black text-white shadow-lg shadow-indigo-200">AT</span>
            <div>
              <p className="text-sm font-bold leading-none">AI Talent</p>
              <p className="mt-1 text-xs text-slate-500">Student workspace</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              className="rounded-lg px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 hover:text-slate-950"
              href="/recruiter"
            >
              Recruiter page
            </Link>
            <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${backendStatus === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
              <span className={`h-2 w-2 rounded-full ${backendStatus === "ok" ? "bg-emerald-500" : "bg-amber-500"}`} />
              {backendStatus === "ok" ? "System online" : backendStatus}
            </span>
          </div>
        </nav>

        {/* Introductory hero section */}
        <header className="fade-up mb-8 overflow-hidden rounded-3xl bg-slate-950 px-7 py-9 text-white shadow-2xl shadow-slate-300/60 sm:px-10 sm:py-11">
          <div className="relative z-10 max-w-3xl">
            <p className="mb-4 inline-flex rounded-full border border-indigo-300/20 bg-indigo-400/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-indigo-200">Career intelligence platform</p>
            <h1 className="text-3xl font-black tracking-tight sm:text-5xl">
              Build a profile that speaks <span className="text-indigo-300">before you do.</span>
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
              Create a verified student profile, measure resume readiness, and practice with a structured video interview.
            </p>
            <Link
              className="mt-7 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-slate-950 shadow-lg hover:-translate-y-0.5 hover:bg-indigo-50"
              href="#student-profiles"
            >
              Choose student profile <span aria-hidden="true">↓</span>
            </Link>
          </div>
        </header>

        {/* Profile form and saved-student list */}
        <div className="grid gap-7 lg:grid-cols-[0.92fr_1.08fr]">
          <section
            className="glass-card rounded-3xl border border-white p-6 shadow-xl shadow-slate-200/60 sm:p-7"
            id="student-profiles"
          >
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-50 font-bold text-indigo-600">01</span>
              <h2 className="text-xl font-extrabold">Create student profile</h2>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              This form sends student information to your FastAPI backend.
            </p>

            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
              {[
                ["name", "Name *", "Yash Mishra"],
                ["email", "Email", "yash@example.com"],
                ["college", "College", "Galgotias University"],
                ["branch", "Branch", "CSE AIML"],
                ["cgpa", "CGPA *", "8.04"],
                ["skills", "Skills", "Python, Machine Learning, SQL"],
                ["linkedin_url", "LinkedIn profile *", "https://linkedin.com/in/your-profile"],
                ["github_url", "GitHub profile", "https://github.com/your-username"],
                ["leetcode_url", "LeetCode profile", "https://leetcode.com/u/your-username"],
              ].map(([key, label, placeholder]) => (
                <label className="block" key={key}>
                  <span className="mb-1 block text-sm font-medium">{label}</span>
                  <input
                    className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 outline-none placeholder:text-slate-400 hover:border-slate-300 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                    name={key}
                    type={
                      key === "email"
                        ? "email"
                        : key === "cgpa"
                          ? "number"
                          : key.endsWith("_url")
                            ? "url"
                            : "text"
                    }
                    step={key === "cgpa" ? "0.01" : undefined}
                    min={key === "cgpa" ? "0" : undefined}
                    max={key === "cgpa" ? "10" : undefined}
                    placeholder={placeholder}
                    value={form[key as keyof typeof form]}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        [key]: event.target.value,
                      }))
                    }
                    required={
                      key === "name" ||
                      key === "email" ||
                      key === "cgpa" ||
                      key === "linkedin_url"
                    }
                  />
                </label>
              ))}

              <label className="block">
                <span className="mb-1 block text-sm font-medium">
                  Target job role *
                </span>
                <select
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 outline-none hover:border-slate-300 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                  value={form.target_role}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      target_role: event.target.value,
                    }))
                  }
                  required
                >
                  <option value="">Select your target job</option>
                  {TARGET_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
                <span className="mt-1.5 block text-xs leading-5 text-slate-500">
                  Resume matching and mock questions will use this role.
                </span>
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium">
                  Resume PDF *
                </span>
                <input
                  accept="application/pdf,.pdf"
                  className="block w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-100 file:px-3 file:py-1.5 file:font-semibold file:text-indigo-700 hover:file:bg-indigo-200"
                  key={profileResumeFile ? "profile-selected" : "profile-empty"}
                  onChange={(event) =>
                    setProfileResumeFile(event.target.files?.[0] ?? null)
                  }
                  required
                  type="file"
                />
                <span className="mt-1.5 block text-xs leading-5 text-slate-500">
                  A readable PDF of up to 5 MB is required to create the profile.
                </span>
              </label>

              <button
                className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-bold text-white shadow-lg shadow-indigo-200 hover:-translate-y-0.5 hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={saving || backendStatus !== "ok"}
                type="submit"
              >
                {saving ? "Creating and analyzing..." : "Create profile and analyze resume"}
              </button>

              {message && (
                <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm">{message}</p>
              )}
            </form>
          </section>

          <section className="glass-card rounded-3xl border border-white p-6 shadow-xl shadow-slate-200/60 sm:p-7">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-extrabold">Saved students</h2>
                <p className="mt-1 text-sm text-slate-500">
                  These records are coming back from SQLite through the API.
                </p>
              </div>
              <span className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-semibold text-indigo-700">
                {students.length}
              </span>
            </div>

            <div className="mt-6 space-y-4">
              {students.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
                  No student saved yet. Complete the form to create the first profile.
                </p>
              ) : (
                students.map((student) => (
                  <article className="group rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-sm hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md" key={student.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 font-bold text-white shadow-md">{student.name.charAt(0).toUpperCase()}</div>
                        <h3 className="font-bold text-slate-900">{student.name}</h3>
                        <p className="text-sm text-slate-500">{student.email}</p>
                      </div>
                      <span className="text-xs font-semibold text-slate-400">ID {student.id}</span>
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div><dt className="text-slate-500">College</dt><dd>{student.college || "—"}</dd></div>
                      <div><dt className="text-slate-500">Branch</dt><dd>{student.branch || "—"}</dd></div>
                      <div><dt className="text-slate-500">CGPA</dt><dd>{student.cgpa ?? "—"}</dd></div>
                      <div><dt className="text-slate-500">Skills</dt><dd>{student.skills || "—"}</dd></div>
                      <div className="col-span-2">
                        <dt className="text-slate-500">Target role</dt>
                        <dd className="mt-1">
                          <select
                            aria-label={`Target role for ${student.name}`}
                            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                            value={student.target_role || ""}
                            onChange={(event) =>
                              void updateTargetRole(
                                student.id,
                                event.target.value,
                              )
                            }
                          >
                            <option value="" disabled>
                              Select target role
                            </option>
                            {TARGET_ROLES.map((role) => (
                              <option key={role} value={role}>
                                {role}
                              </option>
                            ))}
                          </select>
                        </dd>
                      </div>
                      <div><dt className="text-slate-500">Resume score</dt><dd>{student.resume_score}/100</dd></div>
                      <div><dt className="text-slate-500">Role match</dt><dd>{student.role_match_score}/100</dd></div>
                    </dl>
                    {(student.linkedin_url || student.github_url || student.leetcode_url) && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {[
                          ["LinkedIn", student.linkedin_url],
                          ["GitHub", student.github_url],
                          ["LeetCode", student.leetcode_url],
                        ].map(([label, url]) =>
                          url ? (
                            <a
                              className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100"
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
                    <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <summary className="cursor-pointer text-sm font-bold text-slate-700">
                        Add or edit professional profiles
                      </summary>
                      <div className="mt-3 space-y-2">
                        {[
                          ["linkedin_url", "LinkedIn URL"],
                          ["github_url", "GitHub URL"],
                          ["leetcode_url", "LeetCode URL"],
                        ].map(([key, label]) => (
                          <label className="block" key={key}>
                            <span className="mb-1 block text-xs font-medium text-slate-500">
                              {label}{key === "linkedin_url" ? " *" : ""}
                            </span>
                            <input
                              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                              placeholder={`https://${key.replace("_url", "")}.com/...`}
                              type="url"
                              value={
                                profileLinkDrafts[student.id]?.[
                                  key as keyof ProfileLinks
                                ] || ""
                              }
                              onChange={(event) =>
                                setProfileLinkDrafts((current) => ({
                                  ...current,
                                  [student.id]: {
                                    ...(current[student.id] || {
                                      linkedin_url: "",
                                      github_url: "",
                                      leetcode_url: "",
                                    }),
                                    [key]: event.target.value,
                                  },
                                }))
                              }
                            />
                          </label>
                        ))}
                        <button
                          className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white hover:bg-indigo-700"
                          onClick={() => void updateProfileLinks(student.id)}
                          type="button"
                        >
                          Save profile links
                        </button>
                      </div>
                    </details>
                    <button
                      className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-bold text-indigo-700 hover:-translate-y-0.5 hover:bg-indigo-100"
                      onClick={() => openResumeUpload(student.id)}
                      type="button"
                    >
                      {student.resume_score > 0 ? "Replace resume" : "Upload resume"}
                      <span aria-hidden="true">↓</span>
                    </button>
                    {student.target_role && student.resume_score > 0 ? (
                      <Link
                        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:-translate-y-0.5 hover:bg-indigo-700"
                        href={`/mock-interview?student_id=${student.id}`}
                      >
                        Start {student.target_role} mock interview
                        <span aria-hidden="true">→</span>
                      </Link>
                    ) : (
                      <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                        Select a target role and upload a resume to unlock the mock interview.
                      </p>
                    )}
                  </article>
                ))
              )}
            </div>
          </section>
        </div>

        {/* Resume upload and dual-score results */}
        <section
          className="glass-card mt-7 rounded-3xl border border-white p-6 shadow-xl shadow-slate-200/60 sm:p-8"
          id="resume-analysis"
        >
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-50 font-bold text-cyan-700">02</span>
            <h2 className="text-xl font-extrabold">Upload and analyze resume</h2>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Select a saved student, upload a text-based PDF, and receive an explainable ATS-readiness score.
          </p>

          <form className="mt-6 grid gap-4 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end" onSubmit={handleResumeUpload}>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Student</span>
              <select
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 outline-none focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                value={selectedStudentId}
                onChange={(event) => {
                  setApplications([]);
                  setSelectedStudentId(event.target.value);
                }}
              >
                <option value="">Select a student</option>
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.name} — {student.email}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">
                Target role
              </span>
              <select
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 outline-none focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                disabled={!selectedStudentId}
                value={
                  students.find(
                    (student) => String(student.id) === selectedStudentId,
                  )?.target_role || ""
                }
                onChange={(event) =>
                  void updateTargetRole(
                    Number(selectedStudentId),
                    event.target.value,
                    "resume",
                  )
                }
                required
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
                className="block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-100 file:px-3 file:py-1.5 file:font-semibold file:text-indigo-700 hover:file:bg-indigo-200"
                key={resumeFile ? "selected" : "empty"}
                onChange={(event) => setResumeFile(event.target.files?.[0] ?? null)}
                type="file"
              />
            </label>

            <button
              className="rounded-xl bg-indigo-600 px-5 py-3 font-bold text-white shadow-lg shadow-indigo-200 hover:-translate-y-0.5 hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={uploadingResume || backendStatus !== "ok" || students.length === 0}
              type="submit"
            >
              {uploadingResume ? "Analyzing..." : "Upload resume"}
            </button>
          </form>

          {students.length === 0 && (
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Create a student profile before uploading a resume.
            </p>
          )}
          {resumeMessage && (
            <p className="mt-4 rounded-lg bg-slate-100 px-3 py-2 text-sm">{resumeMessage}</p>
          )}

          {resumeResult && (
            <div className="mt-6 grid gap-6 lg:grid-cols-[280px_1fr]">
              <div className="space-y-4">
                <div className="rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-700 p-6 text-white shadow-xl shadow-indigo-200">
                  <p className="text-sm font-medium text-indigo-100">General ATS readiness</p>
                  <p className="mt-2 text-5xl font-bold">{resumeResult.resume_score}</p>
                  <p className="mt-1 text-indigo-100">out of 100</p>
                  <p className="mt-5 text-sm text-indigo-100">
                    {resumeResult.word_count} extracted words
                  </p>
                </div>
                <div className="rounded-2xl bg-gradient-to-br from-cyan-600 to-blue-700 p-6 text-white shadow-xl shadow-cyan-200">
                  <p className="text-sm font-medium text-cyan-100">
                    {resumeResult.target_role} match
                  </p>
                  <p className="mt-2 text-5xl font-bold">
                    {resumeResult.role_match_score}
                  </p>
                  <p className="mt-1 text-cyan-100">out of 100</p>
                </div>
                <Link
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white shadow-lg hover:-translate-y-0.5 hover:bg-indigo-700"
                  href={`/mock-interview?student_id=${resumeResult.student_id}`}
                >
                  Continue to mock interview
                  <span aria-hidden="true">→</span>
                </Link>
              </div>

              <div>
                <h3 className="font-bold">General ATS breakdown</h3>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {Object.entries(resumeResult.score_breakdown).map(([label, score]) => (
                    <div className="flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm" key={label}>
                      <span>{label}</span>
                      <strong>+{score}</strong>
                    </div>
                  ))}
                </div>

                <h3 className="mt-6 font-bold">
                  {resumeResult.target_role} match breakdown
                </h3>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {Object.entries(resumeResult.role_score_breakdown).map(
                    ([label, score]) => (
                      <div
                        className="flex justify-between rounded-lg bg-cyan-50 px-3 py-2 text-sm text-cyan-950"
                        key={label}
                      >
                        <span>{label}</span>
                        <strong>+{score}</strong>
                      </div>
                    ),
                  )}
                </div>

                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                    <h3 className="font-bold text-emerald-900">Skills matched</h3>
                    <p className="mt-2 text-sm leading-6 text-emerald-800">
                      {resumeResult.matched_skills.length
                        ? resumeResult.matched_skills.join(", ")
                        : "No role skills were confidently found yet."}
                    </p>
                  </div>
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <h3 className="font-bold text-amber-900">Core skills missing</h3>
                    <p className="mt-2 text-sm leading-6 text-amber-800">
                      {resumeResult.missing_skills.length
                        ? resumeResult.missing_skills.join(", ")
                        : "All core role skills were found."}
                    </p>
                  </div>
                </div>

                <h3 className="mt-6 font-bold">Advice for your target role</h3>
                <ul className="mt-2 space-y-2 text-sm leading-6 text-slate-600">
                  {resumeResult.role_recommendations.map((recommendation) => (
                    <li
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2"
                      key={recommendation}
                    >
                      {recommendation}
                    </li>
                  ))}
                </ul>

                <h3 className="mt-5 font-bold">Extracted text preview</h3>
                <p className="mt-2 rounded-lg border border-slate-200 p-3 text-sm leading-6 text-slate-600">
                  {resumeResult.extracted_text_preview}
                  {resumeResult.extracted_text_preview.length >= 600 ? "…" : ""}
                </p>
                {resumeResult.recommendations.length > 0 && (
                  <>
                    <h3 className="mt-5 font-bold">How to improve</h3>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-600">
                      {resumeResult.recommendations.map((recommendation) => (
                        <li key={recommendation}>{recommendation}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
          )}
          <p className="mt-5 text-xs leading-5 text-slate-500">
            This score measures general ATS readiness. A job-specific ATS match requires a job description and will be calculated during the application-matching stage.
          </p>
        </section>

        {/* Student job browsing, applying, and explainable matching. */}
        <section className="glass-card mt-7 rounded-3xl border border-white p-6 shadow-xl shadow-slate-200/60 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 font-bold text-emerald-700">
                  03
                </span>
                <h2 className="text-xl font-extrabold">Browse and apply to jobs</h2>
              </div>
              <p className="mt-2 text-sm text-slate-500">
                The platform checks the company requirements privately. Students
                see only whether they can proceed to the AI interview.
              </p>
            </div>
            <Link
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm hover:border-indigo-300 hover:text-indigo-700"
              href="/recruiter"
            >
              Post a job as recruiter
            </Link>
          </div>

          <label className="mt-6 block max-w-xl">
            <span className="mb-1 block text-sm font-medium">
              Apply using student profile
            </span>
            <select
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 outline-none focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-100"
              value={selectedStudentId}
              onChange={(event) => {
                setApplications([]);
                setSelectedStudentId(event.target.value);
                setApplicationMessage("");
              }}
            >
              <option value="">Select a student</option>
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.name} — {student.target_role || "No target role"}
                </option>
              ))}
            </select>
          </label>

          {applicationMessage && (
            <p className="mt-4 rounded-xl bg-slate-100 px-4 py-3 text-sm">
              {applicationMessage}
            </p>
          )}

          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            {jobs.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500 lg:col-span-2">
                No jobs are available yet. Open the recruiter page and publish
                the first job.
              </p>
            ) : (
              jobs.map((job) => {
                const application = applicationForJob(job.id);
                const finalDecision = application
                  ? ["Shortlisted", "Rejected", "Selected", "On Hold"].includes(
                      application.status,
                    )
                  : false;
                const interviewSubmitted =
                  application?.status === "Company AI Interview Submitted";
                const canOpenInterview =
                  application?.eligible &&
                  !finalDecision &&
                  !interviewSubmitted;

                return (
                  <article
                    className="rounded-2xl border border-slate-200 bg-white/85 p-5 shadow-sm"
                    key={job.id}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-indigo-600">
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
                    <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
                      <span className="rounded-full bg-indigo-50 px-3 py-1.5 text-indigo-700">
                        Skills: {job.required_skills}
                      </span>
                      <span className="rounded-full bg-cyan-50 px-3 py-1.5 text-cyan-700">
                        CGPA: {job.min_cgpa ?? "No minimum"}
                      </span>
                      <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-700">
                        Branch: {job.eligible_branch || "All"}
                      </span>
                    </div>
                    <p className="mt-4 text-sm font-medium text-slate-700">
                      {job.location || "Location not specified"} ·{" "}
                      {job.salary || "Pay not specified"}
                    </p>

                    {!application ? (
                      <button
                        className="mt-5 w-full rounded-xl bg-indigo-600 px-4 py-3 font-bold text-white shadow-lg shadow-indigo-100 hover:-translate-y-0.5 hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={
                          !selectedStudentId ||
                          applyingJobId === job.id ||
                          backendStatus !== "ok"
                        }
                        onClick={() => void applyToJob(job.id)}
                        type="button"
                      >
                        {applyingJobId === job.id
                          ? "Checking requirements..."
                          : "Apply and calculate match"}
                      </button>
                    ) : (
                      <div
                        className={`mt-5 rounded-2xl border p-4 ${
                          finalDecision
                            ? application.status === "Rejected"
                              ? "border-rose-200 bg-rose-50"
                              : "border-indigo-200 bg-indigo-50"
                            : application.eligible
                            ? "border-emerald-200 bg-emerald-50"
                            : "border-rose-200 bg-rose-50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p
                              className={`text-xs font-bold uppercase tracking-wider ${
                                finalDecision
                                  ? application.status === "Rejected"
                                    ? "text-rose-700"
                                    : "text-indigo-700"
                                  : application.eligible
                                  ? "text-emerald-700"
                                  : "text-rose-700"
                              }`}
                            >
                              {application.status}
                            </p>
                            <p className="mt-2 text-sm font-medium leading-6 text-slate-700">
                              {finalDecision
                                ? `Your recruitment result is ${application.status}.`
                                : interviewSubmitted
                                  ? "Your company interview is under recruiter review."
                                  : application.status.startsWith("Invited by Recruiter")
                                    ? "A recruiter matched your CGPA, skills and resume to this role and invited you directly."
                                  : application.eligible
                                    ? "Your profile meets the company requirements."
                                    : "Your profile cannot proceed to this company's AI interview."}
                            </p>
                          </div>
                          <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-bold text-slate-600">
                            Application {application.id}
                          </span>
                        </div>

                        {application.eligibility_reasons.length > 0 && (
                          <ul className="mt-3 space-y-1 text-sm text-rose-800">
                            {application.eligibility_reasons.map((reason) => (
                              <li key={reason}>• {reason}</li>
                            ))}
                          </ul>
                        )}

                        {finalDecision && application.result_feedback && (
                          <div className="mt-4 rounded-xl bg-white/80 p-4 text-sm leading-6 text-slate-700">
                            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                              Recruiter feedback
                            </p>
                            <p className="mt-1">{application.result_feedback}</p>
                          </div>
                        )}

                        {canOpenInterview && (
                          <Link
                            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-200 hover:-translate-y-0.5 hover:bg-emerald-700"
                            href={`/company-interview?application_id=${application.id}`}
                          >
                            Start company AI interview
                            <span aria-hidden="true">→</span>
                          </Link>
                        )}

                        {interviewSubmitted && (
                          <p className="mt-4 rounded-xl bg-white/80 px-4 py-3 text-center text-sm font-bold text-slate-700">
                            Awaiting recruiter decision
                          </p>
                        )}
                      </div>
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
