import Link from "next/link";

import { ArrowIcon, BrandMark, SparkIcon } from "./ui/brand";
import { JourneyAnimation } from "./ui/journey-animation";

const portals = [
  {
    number: "01",
    title: "Students or professionals",
    description: "Turn your profile into a clear, evidence-backed path from resume readiness to interview confidence.",
    href: "/student",
    action: "Open student workspace",
    features: ["ATS resume intelligence", "Guided video introductions", "AI mock interviews"],
    accent: "orange",
  },
  {
    number: "02",
    title: "Recruitment",
    description: "Move from job requirements to a qualified shortlist with consistent, explainable candidate signals.",
    href: "/company",
    action: "Open hiring workspace",
    features: ["Structured job creation", "Candidate matching", "Interview decisions"],
    accent: "blue",
  },
  {
    number: "03",
    title: "Institutes",
    description: "See placement readiness and hiring outcomes across your student community in one focused view.",
    href: "/college",
    action: "Open college workspace",
    features: ["Placement analytics", "Student progress", "Outcome visibility"],
    accent: "cyan",
  },
] as const;

const capabilities = [
  ["Resume intelligence", "Analyze ATS readiness, role alignment and practical improvements before applying.", "ATS"],
  ["Adaptive interviews", "Generate role-aware questions and evaluate every response with consistent criteria.", "AI"],
  ["Candidate matching", "Connect job evidence, profile data and interview performance into a clear fit signal.", "MATCH"],
  ["Placement analytics", "Help placement teams understand progress, bottlenecks and published outcomes.", "INSIGHT"],
] as const;

export default function Home() {
  return (
    <main className="brand-landing min-h-screen overflow-hidden bg-[#07101f] text-white">
      <nav className="brand-public-nav">
        <BrandMark inverse />
        <div className="hidden items-center gap-8 lg:flex">
          <a href="#platform">Platform</a>
          <a href="#workspaces">Workspaces</a>
          <a href="#intelligence">Intelligence</a>
          <a href="#outcomes">How it works</a>
        </div>
        <Link className="brand-button brand-button-light" href="/student">
          Get started <ArrowIcon />
        </Link>
      </nav>

      <section className="brand-hero" id="platform">
        <div className="brand-orb brand-orb-one" />
        <div className="brand-orb brand-orb-two" />
        <div className="brand-hero-grid mx-auto grid max-w-7xl items-center gap-14 px-5 pb-20 pt-20 sm:px-8 lg:grid-cols-[1.04fr_.96fr] lg:pb-28 lg:pt-28">
          <div className="brand-reveal relative z-10">
            <p className="brand-kicker"><SparkIcon /> The talent intelligence operating system</p>
            <h1 className="mt-7 max-w-4xl text-5xl font-black leading-[.98] tracking-[-0.045em] sm:text-6xl lg:text-[5.35rem]">
              From potential to<br />
              <span className="brand-gradient-text">proof of talent.</span>
            </h1>
            <p className="mt-7 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
              AI Talent connects students and professionals, recruitment teams and institutes through one explainable system for readiness, interviews, matching and placement outcomes.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link className="brand-button brand-button-primary" href="/student">
                Start as a student <ArrowIcon />
              </Link>
              <Link className="brand-button brand-button-ghost" href="/company">
                Explore hiring workspace
              </Link>
            </div>
            <div className="mt-10 flex flex-wrap gap-x-7 gap-y-3 text-xs font-bold uppercase tracking-[.16em] text-slate-400">
              <span className="brand-check">Explainable scoring</span>
              <span className="brand-check">Role-aware AI</span>
              <span className="brand-check">Connected outcomes</span>
            </div>
          </div>

          <div className="brand-visual brand-reveal relative" style={{ animationDelay: "120ms" }}>
            <div className="brand-visual-glow" />
            <div className="brand-console">
              <div className="brand-console-top">
                <div className="flex items-center gap-2">
                  <span className="brand-status-dot" />
                  <span>Talent signal live</span>
                </div>
                <span>AI · 02:48</span>
              </div>
              <div className="brand-console-profile">
                <span className="brand-avatar">YM</span>
                <div>
                  <p className="text-sm font-extrabold text-white">Yash Mishra</p>
                  <p className="mt-1 text-xs text-slate-400">AI Engineer · Candidate profile</p>
                </div>
                <span className="ml-auto rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[10px] font-extrabold uppercase tracking-widest text-emerald-300">Ready</span>
              </div>
              <div className="brand-score-panel">
                <div className="brand-score-ring"><strong>86</strong><span>match</span></div>
                <div className="min-w-0 flex-1 space-y-4">
                  {[['Role alignment', '92%'], ['Resume strength', '81%'], ['Interview signal', '85%']].map(([label, score], index) => (
                    <div key={label}>
                      <div className="mb-1.5 flex justify-between text-[11px] text-slate-300"><span>{label}</span><strong>{score}</strong></div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full" style={{ width: score, animationDelay: `${300 + index * 100}ms` }} /></div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="brand-insight-row">
                <span><SparkIcon /></span>
                <div><strong>Strongest evidence</strong><p>Machine learning delivery and clear project ownership</p></div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[['Resume', 'Analyzed'], ['Interview', '5/5'], ['Outcome', 'Qualified']].map(([label, value]) => (
                  <div className="brand-mini-stat" key={label}><span>{label}</span><strong>{value}</strong></div>
                ))}
              </div>
            </div>
            <div className="brand-floating-card brand-floating-left"><span>+18%</span><small>readiness lift</small></div>
            <div className="brand-floating-card brand-floating-right"><span>5 signals</span><small>fully explained</small></div>
          </div>
        </div>
      </section>

      <section className="brand-proof-strip">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-px px-5 sm:px-8 lg:grid-cols-4">
          {[['01', 'Connected talent profile'], ['03', 'Purpose-built workspaces'], ['05', 'Evidence signals per candidate'], ['100%', 'Decision transparency']].map(([value, label]) => (
            <div className="brand-proof" key={label}><strong>{value}</strong><span>{label}</span></div>
          ))}
        </div>
      </section>

      <section className="brand-light-section px-5 py-24 text-[#091426] sm:px-8 lg:py-32" id="workspaces">
        <div className="mx-auto max-w-7xl">
          <div className="brand-section-heading">
            <div><p className="brand-eyebrow">One system. Every perspective.</p><h2>Focused workspaces.<br /><span>Shared intelligence.</span></h2></div>
            <p>Each stakeholder gets exactly what they need, while every action contributes to one connected view of professional readiness and recruitment outcomes.</p>
          </div>
          <div className="mt-14 grid gap-5 lg:grid-cols-3">
            {portals.map((portal, index) => (
              <article className={`brand-portal-card brand-portal-${portal.accent}`} key={portal.title}>
                <div className="flex items-center justify-between"><span className="brand-card-number">{portal.number}</span><span className="brand-card-arrow">↗</span></div>
                <h3>{portal.title}</h3>
                <p>{portal.description}</p>
                <ul>{portal.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
                <Link href={portal.href}>{portal.action} <ArrowIcon /></Link>
                <span className="brand-card-line" style={{ animationDelay: `${index * 100}ms` }} />
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="brand-dark-section px-5 py-24 sm:px-8 lg:py-32" id="intelligence">
        <div className="mx-auto max-w-7xl">
          <div className="brand-section-heading brand-section-heading-dark">
            <div><p className="brand-eyebrow">Intelligence with a reason</p><h2>More signal.<br /><span>Less guesswork.</span></h2></div>
            <p>Every score is connected to candidate evidence, role expectations and structured responses—so people can understand what the AI sees.</p>
          </div>
          <div className="mt-14 grid gap-4 md:grid-cols-2">
            {capabilities.map(([title, description, tag], index) => (
              <article className="brand-capability" key={title}>
                <div><span>0{index + 1}</span><b>{tag}</b></div>
                <h3>{title}</h3><p>{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="brand-journey px-5 py-24 text-[#091426] sm:px-8 lg:py-32" id="outcomes">
        <div className="mx-auto max-w-7xl">
          <p className="brand-eyebrow text-center">How it works</p>
          <h2 className="mx-auto mt-4 max-w-3xl text-center text-4xl font-black tracking-[-.035em] sm:text-6xl">One continuous journey.<br /><span className="text-[#2165f5]">Every signal connected.</span></h2>
          <p className="mx-auto mt-5 max-w-2xl text-center text-sm leading-7 text-slate-500 sm:text-base">Follow the path from a professional profile to a clear, explainable recruitment outcome.</p>
          <JourneyAnimation />
        </div>
      </section>

      <section className="px-5 pb-10 sm:px-8">
        <div className="brand-cta mx-auto max-w-7xl">
          <div><p className="brand-kicker"><SparkIcon /> Ready to move talent forward?</p><h2>Build the evidence.<br />Make the right match.</h2></div>
          <div className="flex flex-col gap-3 sm:flex-row"><Link className="brand-button brand-button-light" href="/student">Create your profile <ArrowIcon /></Link><Link className="brand-button brand-button-ghost" href="/company">Start hiring</Link></div>
        </div>
      </section>

      <footer className="border-t border-white/10 px-5 py-10 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-7 sm:flex-row sm:items-end sm:justify-between">
          <BrandMark inverse subtitle="From potential to placement" />
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-400"><Link href="/student">Students & professionals</Link><Link href="/company">Recruitment</Link><Link href="/college">Institutes</Link><span>© 2026 AI Talent</span></div>
        </div>
      </footer>
    </main>
  );
}
