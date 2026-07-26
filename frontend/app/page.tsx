import Link from "next/link";

const pathways = [
  {
    title: "Student",
    eyebrow: "Build your career",
    description:
      "Create your profile, analyze your resume, practise interviews and discover matching companies.",
    href: "/student",
    action: "Enter student portal",
    icon: "ST",
    tone: "indigo",
    features: ["Resume intelligence", "Mock interviews", "Company discovery"],
  },
  {
    title: "Company",
    eyebrow: "Hire with clarity",
    description:
      "Publish jobs, discover qualified candidates and make evidence-based hiring decisions.",
    href: "/company",
    action: "Enter company portal",
    icon: "CO",
    tone: "blue",
    features: ["Post jobs", "Review applicants", "Candidate matching"],
  },
  {
    title: "College",
    eyebrow: "Improve placements",
    description:
      "Sign in with an official placement email to understand applications, interviews and final placement outcomes.",
    href: "/college",
    action: "Enter college portal",
    icon: "CL",
    tone: "emerald",
    features: ["Verified college access", "Placement outcomes", "Student insights"],
  },
] as const;

const toneClasses = {
  indigo: {
    icon: "bg-indigo-600 shadow-indigo-200",
    badge: "bg-indigo-50 text-indigo-700",
    link: "bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200",
    border: "hover:border-indigo-200",
  },
  blue: {
    icon: "bg-blue-600 shadow-blue-200",
    badge: "bg-blue-50 text-blue-700",
    link: "bg-blue-600 hover:bg-blue-700 shadow-blue-200",
    border: "hover:border-blue-200",
  },
  emerald: {
    icon: "bg-emerald-600 shadow-emerald-200",
    badge: "bg-emerald-50 text-emerald-700",
    link: "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200",
    border: "hover:border-emerald-200",
  },
};

export default function Home() {
  return (
    <main className="surface-grid relative min-h-screen overflow-hidden bg-slate-50 px-5 py-7 text-slate-900 sm:px-8">
      <div className="pointer-events-none absolute -left-40 top-10 h-96 w-96 rounded-full bg-indigo-200/50 blur-3xl" />
      <div className="pointer-events-none absolute -right-32 top-72 h-96 w-96 rounded-full bg-cyan-100/70 blur-3xl" />

      <div className="relative mx-auto max-w-6xl">
        <nav className="glass-card flex items-center justify-between rounded-2xl border border-white/80 px-5 py-3 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-950 text-sm font-black text-white shadow-lg">
              AT
            </span>
            <div>
              <p className="text-sm font-extrabold leading-none">AI Talent</p>
              <p className="mt-1 text-xs text-slate-500">
                Recruitment intelligence platform
              </p>
            </div>
          </div>
          <span className="hidden rounded-full bg-white px-3 py-1.5 text-xs font-bold text-slate-500 shadow-sm sm:inline-flex">
            One platform · Three perspectives
          </span>
        </nav>

        <header className="fade-up py-14 text-center sm:py-20">
          <p className="mx-auto inline-flex rounded-full border border-indigo-200 bg-white/80 px-4 py-2 text-xs font-bold uppercase tracking-[0.2em] text-indigo-700 shadow-sm">
            From potential to placement
          </p>
          <h1 className="mx-auto mt-6 max-w-4xl text-4xl font-black tracking-tight text-slate-950 sm:text-6xl">
            The shared workspace for{" "}
            <span className="bg-gradient-to-r from-indigo-600 via-blue-600 to-emerald-600 bg-clip-text text-transparent">
              talent, hiring and outcomes.
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
            Choose your role to enter a focused workspace built for students,
            companies or college placement teams.
          </p>
        </header>

        <section
          aria-label="Choose your portal"
          className="grid gap-5 pb-14 lg:grid-cols-3"
        >
          {pathways.map((pathway, index) => {
            const tone = toneClasses[pathway.tone];
            return (
              <article
                className={`glass-card fade-up flex min-h-[390px] flex-col rounded-3xl border border-white p-6 shadow-xl shadow-slate-200/60 transition hover:-translate-y-1 hover:shadow-2xl ${tone.border}`}
                key={pathway.title}
                style={{ animationDelay: `${index * 90}ms` }}
              >
                <div className="flex items-start justify-between">
                  <span
                    className={`grid h-12 w-12 place-items-center rounded-2xl text-sm font-black text-white shadow-lg ${tone.icon}`}
                  >
                    {pathway.icon}
                  </span>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-bold ${tone.badge}`}
                  >
                    {pathway.eyebrow}
                  </span>
                </div>
                <h2 className="mt-7 text-2xl font-black">{pathway.title}</h2>
                <p className="mt-3 min-h-20 text-sm leading-6 text-slate-600">
                  {pathway.description}
                </p>
                <ul className="mt-5 space-y-3">
                  {pathway.features.map((feature) => (
                    <li
                      className="flex items-center gap-3 text-sm font-semibold text-slate-700"
                      key={feature}
                    >
                      <span
                        aria-hidden="true"
                        className={`h-2 w-2 rounded-full ${tone.icon.split(" ")[0]}`}
                      />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Link
                  className={`mt-auto inline-flex items-center justify-between rounded-xl px-4 py-3 text-sm font-bold text-white shadow-lg ${tone.link}`}
                  href={pathway.href}
                >
                  {pathway.action}
                  <span aria-hidden="true">→</span>
                </Link>
              </article>
            );
          })}
        </section>

        <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-500">
          AI Talent brings resume readiness, interview practice, hiring and
          placement reporting into one connected workflow.
        </footer>
      </div>
    </main>
  );
}
