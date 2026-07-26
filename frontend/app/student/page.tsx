"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const API_URL = "/api";

const emptyRegistration = {
  name: "",
  email: "",
  password: "",
  college: "",
  branch: "",
  cgpa: "",
  skills: "",
  linkedin_url: "",
  github_url: "",
  leetcode_url: "",
};

export default function StudentAccessPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [signIn, setSignIn] = useState({ email: "", password: "" });
  const [registration, setRegistration] = useState(emptyRegistration);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function openDashboard(student: { id: number; name: string }) {
    window.sessionStorage.setItem("studentId", String(student.id));
    window.sessionStorage.setItem("studentName", student.name);
    router.push(`/student/dashboard?student_id=${student.id}`);
  }

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch(`${API_URL}/students/sign-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signIn),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.detail || "Could not sign in.");
      }
      openDashboard(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch(`${API_URL}/students/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...registration,
          cgpa: Number(registration.cgpa),
          skills: registration.skills || null,
          linkedin_url: registration.linkedin_url || null,
          github_url: registration.github_url || null,
          leetcode_url: registration.leetcode_url || null,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        const detail = Array.isArray(result.detail)
          ? result.detail[0]?.msg
          : result.detail;
        throw new Error(detail || "Could not create the profile.");
      }
      openDashboard(result);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not create the profile.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="surface-grid relative min-h-screen overflow-hidden bg-slate-50 px-5 py-7 text-slate-900 sm:px-8">
      <div className="pointer-events-none absolute -left-32 top-24 h-80 w-80 rounded-full bg-indigo-200/60 blur-3xl" />
      <div className="relative mx-auto max-w-5xl">
        <nav className="mb-8 flex items-center justify-between">
          <Link className="flex items-center gap-3" href="/">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-600 text-sm font-black text-white">
              AT
            </span>
            <span className="font-extrabold">AI Talent</span>
          </Link>
          <Link
            className="rounded-lg px-3 py-2 text-sm font-bold text-slate-600 hover:bg-white"
            href="/"
          >
            ← All portals
          </Link>
        </nav>

        <div className="grid overflow-hidden rounded-3xl border border-white bg-white shadow-2xl shadow-slate-300/50 lg:grid-cols-[0.82fr_1.18fr]">
          <section className="bg-gradient-to-br from-slate-950 via-indigo-950 to-indigo-800 p-8 text-white sm:p-10">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-200">
              Student portal
            </p>
            <h1 className="mt-5 text-3xl font-black tracking-tight sm:text-4xl">
              Your career workspace starts here.
            </h1>
            <p className="mt-4 text-sm leading-6 text-indigo-100">
              Create one profile, then use it to analyze your resume, practise
              interviews and apply to companies.
            </p>
            <ol className="mt-9 space-y-5 text-sm">
              {[
                "Build your verified profile",
                "Analyze your resume for a target role",
                "Practise a structured mock interview",
                "Discover and apply to companies",
              ].map((item, index) => (
                <li className="flex items-center gap-3" key={item}>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 font-bold text-indigo-100">
                    {index + 1}
                  </span>
                  {item}
                </li>
              ))}
            </ol>
          </section>

          <section className="p-6 sm:p-9">
            <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1">
              {[
                ["sign-in", "Sign in"],
                ["sign-up", "Create profile"],
              ].map(([value, label]) => (
                <button
                  className={`rounded-lg px-4 py-2.5 text-sm font-bold ${
                    mode === value
                      ? "bg-white text-indigo-700 shadow-sm"
                      : "text-slate-500"
                  }`}
                  key={value}
                  onClick={() => {
                    setMode(value as "sign-in" | "sign-up");
                    setMessage("");
                  }}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>

            {mode === "sign-in" ? (
              <form className="mt-7 space-y-4" onSubmit={handleSignIn}>
                <div>
                  <h2 className="text-2xl font-black">Welcome back</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Sign in to continue to your student dashboard.
                  </p>
                </div>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Email</span>
                  <input
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 outline-none focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                    onChange={(event) =>
                      setSignIn((current) => ({
                        ...current,
                        email: event.target.value,
                      }))
                    }
                    required
                    type="email"
                    value={signIn.email}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Password</span>
                  <input
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 outline-none focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                    minLength={8}
                    onChange={(event) =>
                      setSignIn((current) => ({
                        ...current,
                        password: event.target.value,
                      }))
                    }
                    required
                    type="password"
                    value={signIn.password}
                  />
                </label>
                <button
                  className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-bold text-white shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-60"
                  disabled={submitting}
                  type="submit"
                >
                  {submitting ? "Signing in..." : "Sign in"}
                </button>
              </form>
            ) : (
              <form className="mt-7 space-y-4" onSubmit={handleRegistration}>
                <div>
                  <h2 className="text-2xl font-black">Create your profile</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Resume analysis happens after your account is ready.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {[
                    ["name", "Full name", "text", true],
                    ["email", "Email", "email", true],
                    ["password", "Password", "password", true],
                    ["college", "College", "text", true],
                    ["branch", "Branch", "text", true],
                    ["cgpa", "CGPA", "number", true],
                    ["skills", "Skills", "text", false],
                    ["linkedin_url", "LinkedIn URL", "url", false],
                    ["github_url", "GitHub URL", "url", false],
                    ["leetcode_url", "LeetCode URL", "url", false],
                  ].map(([key, label, type, required]) => (
                    <label
                      className={
                        key === "skills" ||
                        key === "linkedin_url" ||
                        key === "github_url" ||
                        key === "leetcode_url"
                          ? "block sm:col-span-2"
                          : "block"
                      }
                      key={String(key)}
                    >
                      <span className="mb-1 block text-sm font-medium">
                        {label}
                        {required ? " *" : ""}
                      </span>
                      <input
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 outline-none focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                        max={key === "cgpa" ? 10 : undefined}
                        min={key === "cgpa" ? 0 : undefined}
                        minLength={key === "password" ? 8 : undefined}
                        onChange={(event) =>
                          setRegistration((current) => ({
                            ...current,
                            [String(key)]: event.target.value,
                          }))
                        }
                        required={Boolean(required)}
                        step={key === "cgpa" ? "0.01" : undefined}
                        type={String(type)}
                        value={
                          registration[
                            String(key) as keyof typeof registration
                          ]
                        }
                      />
                    </label>
                  ))}
                </div>
                <button
                  className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-bold text-white shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-60"
                  disabled={submitting}
                  type="submit"
                >
                  {submitting ? "Creating profile..." : "Create profile"}
                </button>
              </form>
            )}

            {message && (
              <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {message}
              </p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
