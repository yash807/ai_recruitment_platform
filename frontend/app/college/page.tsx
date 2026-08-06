"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { COLLEGE_SESSION_KEY, getCollegeIdentity } from "./college-access";
import { BrandMark } from "../ui/brand";

export default function CollegeLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const identity = getCollegeIdentity(email);

    if (!identity) {
      setError(
        "Use an approved placement email, such as placement@galgotiasuniversity.edu or placement@amityuniversity.edu.",
      );
      return;
    }

    setError("");
    window.sessionStorage.setItem(COLLEGE_SESSION_KEY, identity.email);
    router.push("/college/dashboard");
  }

  return (
    <main className="brand-app-shell surface-grid relative grid min-h-screen overflow-hidden bg-slate-50 px-5 py-7 text-slate-900 sm:px-8">
      <div className="pointer-events-none absolute -left-32 top-20 h-96 w-96 rounded-full bg-emerald-200/50 blur-3xl" />
      <div className="pointer-events-none absolute -right-36 bottom-10 h-96 w-96 rounded-full bg-cyan-100/70 blur-3xl" />

      <div className="relative mx-auto flex w-full max-w-6xl flex-col">
        <nav className="brand-app-nav glass-card flex items-center justify-between rounded-2xl border border-white/80 px-5 py-3 shadow-sm">
          <BrandMark subtitle="College workspace" />
          <Link
            className="rounded-lg px-3 py-2 text-sm font-bold text-slate-600 hover:bg-white"
            href="/"
          >
            All portals
          </Link>
        </nav>

        <div className="grid flex-1 items-center gap-8 py-10 lg:grid-cols-[1.08fr_0.92fr] lg:py-14">
          <section className="brand-app-hero fade-up rounded-3xl bg-gradient-to-br from-slate-950 via-emerald-950 to-teal-900 px-7 py-10 text-white shadow-2xl shadow-slate-300/60 sm:px-10 sm:py-14">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-200">
              Verified college access
            </p>
            <h1 className="mt-5 max-w-2xl text-4xl font-black tracking-tight sm:text-5xl">
              Placement insight for{" "}
              <span className="text-emerald-300">your institution.</span>
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-7 text-emerald-50/80 sm:text-base">
              Sign in with the official placement-office email to open your
              college&apos;s student outcomes, interviews and hiring analytics.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {["Placement outcomes", "Interview progress", "Student insights"].map(
                (feature) => (
                  <div
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm font-bold text-emerald-50"
                    key={feature}
                  >
                    <span className="mb-3 block h-2 w-2 rounded-full bg-emerald-300" />
                    {feature}
                  </div>
                ),
              )}
            </div>
          </section>

          <section className="glass-card rounded-3xl border border-white p-6 shadow-xl shadow-slate-200/60 sm:p-8">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-100 text-lg font-black text-emerald-700">
              CL
            </span>
            <p className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-emerald-600">
              College login
            </p>
            <h2 className="mt-2 text-2xl font-black">
              Use your placement email
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Your email identifies the college whose analytics you can view.
            </p>

            <form className="mt-7 space-y-5" onSubmit={handleLogin}>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">
                  Official placement email
                </span>
                <input
                  aria-describedby={error ? "college-login-error" : undefined}
                  aria-invalid={Boolean(error)}
                  autoComplete="email"
                  autoFocus
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 outline-none placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (error) setError("");
                  }}
                  placeholder="placement@university.edu"
                  required
                  type="email"
                  value={email}
                />
              </label>

              {error && (
                <p
                  className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700"
                  id="college-login-error"
                  role="alert"
                >
                  {error}
                </p>
              )}

              <button
                className="w-full rounded-xl bg-emerald-600 px-5 py-3 font-bold text-white shadow-lg shadow-emerald-200 hover:-translate-y-0.5 hover:bg-emerald-700"
                type="submit"
              >
                Continue to analytics
              </button>
            </form>

            <div className="mt-6 rounded-2xl bg-slate-50 px-4 py-4 text-xs leading-6 text-slate-500">
              <p className="font-bold text-slate-700">Prototype access</p>
              <p>placement@galgotiasuniversity.edu</p>
              <p>placement@amityuniversity.edu</p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
