"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import {
  COLLEGE_SESSION_KEY,
  CollegeIdentity,
  getCollegeIdentity,
} from "../college-access";

const API_URL = "/api";

type CollegeOption = {
  name: string;
  student_count: number;
};

type StudentInsight = {
  id: number;
  name: string;
  branch: string | null;
  target_role: string | null;
  resume_score: number;
  mock_interview_score: number;
  application_count: number;
  outcome: string;
};

type CollegeInsights = {
  college: string;
  selected_students: number;
  applied_students: number;
  hired_students: number;
  rejected_students: number;
  students_in_process: number;
  students_not_applied: number;
  interviews_completed: number;
  average_resume_score: number;
  students: StudentInsight[];
};

export default function CollegeDashboardPage() {
  const router = useRouter();
  const [colleges, setColleges] = useState<CollegeOption[]>([]);
  const [identity, setIdentity] = useState<CollegeIdentity | null>(null);
  const [selectedCollege, setSelectedCollege] = useState("");
  const [studentLimit, setStudentLimit] = useState("50");
  const [insights, setInsights] = useState<CollegeInsights | null>(null);
  const [backendStatus, setBackendStatus] = useState("checking...");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function initialize() {
      const savedEmail = window.sessionStorage.getItem(COLLEGE_SESSION_KEY);
      const savedIdentity = savedEmail
        ? getCollegeIdentity(savedEmail)
        : null;

      if (!savedIdentity) {
        window.sessionStorage.removeItem(COLLEGE_SESSION_KEY);
        router.replace("/college");
        return;
      }

      setIdentity(savedIdentity);

      try {
        const [healthResponse, collegeResponse] = await Promise.all([
          fetch(`${API_URL}/health`),
          fetch(`${API_URL}/college/options`),
        ]);
        if (!healthResponse.ok || !collegeResponse.ok) {
          throw new Error("College data is not available.");
        }
        const health = await healthResponse.json();
        const options: CollegeOption[] = await collegeResponse.json();
        setBackendStatus(health.status);
        setColleges(options);
        const matchedCollege = savedIdentity.optionAliases
          .map((alias) =>
            options.find(
              (option) =>
                option.name.trim().toLowerCase() === alias.toLowerCase(),
            ),
          )
          .find((option): option is CollegeOption => Boolean(option));

        if (!matchedCollege) {
          throw new Error(
            `No student records are available for ${savedIdentity.collegeName} yet.`,
          );
        }

        setSelectedCollege(matchedCollege.name);
        setStudentLimit(String(matchedCollege.student_count));
        await fetchInsights(matchedCollege.name, matchedCollege.student_count);
      } catch (error) {
        setBackendStatus("not connected");
        setMessage(
          error instanceof Error
            ? error.message
            : "Could not load college options.",
        );
      }
    }
    void initialize();
  }, [router]);

  async function fetchInsights(college: string, limit: number) {
    setLoading(true);
    setMessage("");
    try {
      const query = new URLSearchParams({
        college,
        limit: String(limit),
      });
      const response = await fetch(`${API_URL}/college/insights?${query}`);
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.detail || "Could not load college insights.");
      }
      setInsights(result);
    } catch (error) {
      setInsights(null);
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not load college insights.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadInsights(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCollege) {
      setMessage("College records are not available.");
      return;
    }
    await fetchInsights(selectedCollege, Number(studentLimit));
  }

  function signOut() {
    window.sessionStorage.removeItem(COLLEGE_SESSION_KEY);
    router.replace("/college");
  }

  const outcomeTone = (outcome: string) => {
    if (outcome === "Hired") return "bg-emerald-50 text-emerald-700";
    if (outcome === "Rejected") return "bg-rose-50 text-rose-700";
    if (outcome === "In process") return "bg-amber-50 text-amber-700";
    return "bg-slate-100 text-slate-600";
  };

  return (
    <main className="surface-grid relative min-h-screen overflow-hidden bg-slate-50 px-5 py-7 text-slate-900 sm:px-8">
      <div className="pointer-events-none absolute -left-32 top-20 h-96 w-96 rounded-full bg-emerald-200/50 blur-3xl" />
      <div className="pointer-events-none absolute -right-36 top-[30rem] h-96 w-96 rounded-full bg-cyan-100/70 blur-3xl" />
      <div className="relative mx-auto max-w-6xl">
        <nav className="glass-card mb-7 flex items-center justify-between rounded-2xl border border-white/80 px-5 py-3 shadow-sm">
          <Link className="flex items-center gap-3" href="/">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-600 text-sm font-black text-white">
              AT
            </span>
            <div>
              <p className="text-sm font-bold leading-none">AI Talent</p>
              <p className="mt-1 text-xs text-slate-500">
                College placement insights
              </p>
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
              className="rounded-lg px-3 py-2 text-sm font-bold text-slate-600 hover:bg-white"
              onClick={signOut}
              type="button"
            >
              Sign out
            </button>
          </div>
        </nav>

        <header className="fade-up rounded-3xl bg-gradient-to-br from-slate-950 via-emerald-950 to-teal-900 px-7 py-9 text-white shadow-2xl shadow-slate-300/60 sm:px-10 sm:py-11">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-200">
            College placement command centre
          </p>
          <h1 className="mt-4 max-w-3xl text-3xl font-black tracking-tight sm:text-5xl">
            Turn student progress into{" "}
            <span className="text-emerald-300">placement insight.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-emerald-50/80 sm:text-base">
            Review applications, interviews, hires, rejections and students
            who still need support across {identity?.collegeName || "your college"}.
          </p>
        </header>

        <section className="glass-card mt-7 rounded-3xl border border-white p-6 shadow-xl shadow-slate-200/60 sm:p-8">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-600">
              Cohort controls
            </p>
            <h2 className="mt-2 text-2xl font-black">
              {identity?.collegeName || "College"} analytics
            </h2>
          </div>
          <form
            className="mt-6 grid gap-4 md:grid-cols-[1fr_220px_auto] md:items-end"
            onSubmit={loadInsights}
          >
            <div>
              <span className="mb-1 block text-sm font-medium">Signed in as</span>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3">
                <p className="font-bold text-emerald-950">
                  {identity?.collegeName || "Verifying college..."}
                </p>
                <p className="mt-1 text-xs text-emerald-700">
                  {identity?.email || ""}
                </p>
              </div>
            </div>
            <label>
              <span className="mb-1 block text-sm font-medium">
                Number of students
              </span>
              <input
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 outline-none focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                max={
                  colleges.find(
                    (college) => college.name === selectedCollege,
                  )?.student_count || 500
                }
                min="1"
                onChange={(event) => setStudentLimit(event.target.value)}
                required
                type="number"
                value={studentLimit}
              />
            </label>
            <button
              className="rounded-xl bg-emerald-600 px-5 py-3 font-bold text-white shadow-lg shadow-emerald-200 hover:bg-emerald-700 disabled:opacity-60"
              disabled={loading || backendStatus !== "ok"}
              type="submit"
            >
              {loading ? "Loading..." : "View insights"}
            </button>
          </form>
          {colleges.length === 0 && backendStatus === "ok" && (
            <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
              No student records are available for this college yet.
            </p>
          )}
          {message && (
            <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {message}
            </p>
          )}
        </section>

        {insights && (
          <>
            <section className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  label: "Selected cohort",
                  value: insights.selected_students,
                  tone: "bg-slate-500",
                },
                {
                  label: "Applied",
                  value: insights.applied_students,
                  tone: "bg-blue-500",
                },
                {
                  label: "Hired",
                  value: insights.hired_students,
                  tone: "bg-emerald-500",
                },
                {
                  label: "Rejected",
                  value: insights.rejected_students,
                  tone: "bg-rose-500",
                },
                {
                  label: "In process",
                  value: insights.students_in_process,
                  tone: "bg-amber-500",
                },
                {
                  label: "Not applied",
                  value: insights.students_not_applied,
                  tone: "bg-slate-400",
                },
                {
                  label: "Interviews completed",
                  value: insights.interviews_completed,
                  tone: "bg-indigo-500",
                },
                {
                  label: "Average resume score",
                  value: insights.average_resume_score,
                  tone: "bg-cyan-500",
                },
              ].map(({ label, value, tone }) => (
                <article
                  className="glass-card rounded-2xl border border-white p-5 shadow-lg shadow-slate-200/50"
                  key={label}
                >
                  <span className={`inline-flex h-2.5 w-2.5 rounded-full ${tone}`} />
                  <p className="mt-3 text-sm text-slate-500">{label}</p>
                  <p className="mt-1 text-3xl font-black">{value}</p>
                </article>
              ))}
            </section>

            <section className="glass-card mt-7 overflow-hidden rounded-3xl border border-white shadow-xl shadow-slate-200/60">
              <div className="border-b border-slate-200 px-6 py-5 sm:px-8">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-600">
                  Student-level view
                </p>
                <h2 className="mt-2 text-2xl font-black">{insights.college}</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      {[
                        "Student",
                        "Branch",
                        "Target role",
                        "Resume",
                        "Mock",
                        "Applications",
                        "Outcome",
                      ].map((heading) => (
                        <th className="px-6 py-3 font-bold" key={heading}>
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white/80">
                    {insights.students.map((student) => (
                      <tr key={student.id}>
                        <td className="px-6 py-4 font-bold">{student.name}</td>
                        <td className="px-6 py-4 text-slate-600">
                          {student.branch || "—"}
                        </td>
                        <td className="px-6 py-4 text-slate-600">
                          {student.target_role || "—"}
                        </td>
                        <td className="px-6 py-4">{student.resume_score}</td>
                        <td className="px-6 py-4">
                          {student.mock_interview_score}
                        </td>
                        <td className="px-6 py-4">
                          {student.application_count}
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-bold ${outcomeTone(student.outcome)}`}
                          >
                            {student.outcome}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
