"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import { BrandMark } from "../../ui/brand";

function StudentGuidanceContent() {
  const searchParams = useSearchParams();
  const studentId = searchParams.get("student_id");
  const dashboardHref = studentId
    ? `/student/dashboard?student_id=${studentId}`
    : "/student/dashboard";

  return (
    <main className="brand-app-shell surface-grid min-h-screen bg-slate-50 px-5 py-7 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <nav className="brand-app-nav mb-7 flex items-center justify-between rounded-2xl border border-white/80 px-5 py-3 shadow-sm">
          <BrandMark subtitle="Student dashboard" />
          <Link className="rounded-xl px-3 py-2 text-sm font-bold text-slate-600 hover:bg-white" href={dashboardHref}>
            ← Back to dashboard
          </Link>
        </nav>

        <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-indigo-950 to-indigo-800 px-7 py-11 text-white shadow-2xl shadow-slate-300/60 sm:px-12 sm:py-16">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-indigo-200">Your next chapter</p>
          <div className="mt-5 grid gap-10 lg:grid-cols-[1.15fr_.85fr] lg:items-end">
            <div>
              <h1 className="max-w-3xl text-4xl font-black tracking-tight sm:text-6xl">Make career choices with more clarity and less pressure.</h1>
              <p className="mt-6 max-w-2xl text-base leading-7 text-indigo-100">A calm, student-first space to explore possibilities, talk through uncertainty, and create a path that feels right for you.</p>
              <a className="mt-8 inline-flex items-center gap-3 rounded-xl bg-white px-5 py-3.5 text-sm font-black text-indigo-700 shadow-lg shadow-indigo-950/30 transition hover:-translate-y-0.5 hover:bg-indigo-50" href="https://clariity.in/" rel="noreferrer" target="_blank">Explore your direction <span aria-hidden="true">↗</span></a>
              <p className="mt-3 text-xs text-indigo-200">Opens in a new tab</p>
            </div>
            <div className="rounded-3xl border border-white/15 bg-white/10 p-6 backdrop-blur-sm">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-200">Start where you are</p>
              <div className="mt-6 space-y-4">
                {[["01", "Understand what energises you"], ["02", "Talk with people who have been there"], ["03", "Choose a practical next step"]].map(([number, text]) => <div className="flex items-center gap-4" key={number}><span className="grid h-9 w-9 place-items-center rounded-xl bg-white/15 text-xs font-black text-white">{number}</span><p className="text-sm font-bold text-white">{text}</p></div>)}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-8 py-14 lg:grid-cols-[.85fr_1.15fr] lg:items-start">
          <div><p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-600">More than advice</p><h2 className="mt-4 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">A space to think out loud, then move forward.</h2></div>
          <p className="max-w-2xl text-sm leading-7 text-slate-600">There is no universal roadmap for college or a career. The right support helps you make sense of your strengths, interests, and options—without feeling like you need to have everything figured out today.</p>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {[
            ["01", "One-to-one mentorship", "Have honest conversations with mentors who understand the choices around college, portfolios, applications, and first roles."],
            ["02", "Career clarity", "Connect your interests and strengths to real opportunities, so your next decision feels considered rather than rushed."],
            ["03", "Practical next steps", "Turn reflection into momentum with useful resources, conversations, and actions that fit your goals."],
          ].map(([number, title, description]) => <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" key={number}><span className="text-xs font-black tracking-[0.14em] text-indigo-600">{number}</span><h3 className="mt-10 text-xl font-black tracking-tight text-slate-900">{title}</h3><p className="mt-3 text-sm leading-6 text-slate-600">{description}</p></article>)}
        </section>

        <section className="mt-5 flex flex-col items-start justify-between gap-5 rounded-2xl bg-orange-50 px-7 py-8 sm:flex-row sm:items-center">
          <p className="max-w-xl text-lg font-bold tracking-tight text-slate-800">The aim is not to hand you a map—it is to help you trust yourself enough to draw one.</p>
          <a className="inline-flex shrink-0 items-center gap-3 rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white transition hover:bg-indigo-800" href="https://clariity.in/" rel="noreferrer" target="_blank">Start exploring <span aria-hidden="true">→</span></a>
        </section>
      </div>
    </main>
  );
}

export default function StudentGuidancePage() {
  return (
    <Suspense fallback={null}>
      <StudentGuidanceContent />
    </Suspense>
  );
}
