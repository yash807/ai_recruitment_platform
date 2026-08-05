"use client";

import Link from "next/link";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const API_URL = "/api";

type Basics = {
  full_name: string;
  professional_title: string;
  email: string;
  phone: string;
  location: string;
  summary: string;
  linkedin_url: string;
  github_url: string;
  portfolio_url: string;
};

type Education = {
  entry_id: string;
  institution: string;
  degree: string;
  field_of_study: string;
  location: string;
  start_date: string;
  end_date: string;
  score: string;
  highlights: string[];
};

type Experience = {
  entry_id: string;
  role: string;
  organization: string;
  location: string;
  start_date: string;
  end_date: string;
  current: boolean;
  highlights: string[];
};

type Project = {
  entry_id: string;
  name: string;
  role: string;
  technologies: string;
  project_url: string;
  start_date: string;
  end_date: string;
  highlights: string[];
};

type Certification = {
  entry_id: string;
  name: string;
  issuer: string;
  issue_date: string;
  credential_url: string;
};

type Detail = {
  entry_id: string;
  title: string;
  organization: string;
  description: string;
};

type Language = {
  entry_id: string;
  name: string;
  proficiency: string;
};

type ResumeData = {
  student_id?: number;
  template: "two-column" | "single-column";
  basics: Basics;
  education: Education[];
  experience: Experience[];
  projects: Project[];
  skills: string[];
  certifications: Certification[];
  achievements: Detail[];
  leadership: Detail[];
  languages: Language[];
  interests: string[];
  updated_at?: string | null;
};

type SectionKey =
  | "personal"
  | "education"
  | "experience"
  | "projects"
  | "skills"
  | "certifications"
  | "achievements"
  | "leadership"
  | "languages"
  | "interests";

const EMPTY_RESUME: ResumeData = {
  template: "two-column",
  basics: {
    full_name: "",
    professional_title: "",
    email: "",
    phone: "",
    location: "",
    summary: "",
    linkedin_url: "",
    github_url: "",
    portfolio_url: "",
  },
  education: [],
  experience: [],
  projects: [],
  skills: [],
  certifications: [],
  achievements: [],
  leadership: [],
  languages: [],
  interests: [],
};

const SECTIONS: { key: SectionKey; label: string; optional?: boolean }[] = [
  { key: "personal", label: "Personal & summary" },
  { key: "education", label: "Education" },
  { key: "experience", label: "Experience" },
  { key: "projects", label: "Projects" },
  { key: "skills", label: "Skills" },
  { key: "certifications", label: "Certifications" },
  { key: "achievements", label: "Achievements", optional: true },
  { key: "leadership", label: "Leadership", optional: true },
  { key: "languages", label: "Languages", optional: true },
  { key: "interests", label: "Interests", optional: true },
];

function newId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
}

function draftItems(value: string) {
  return value
    .split(/[,\n]/)
    .map((item) => item.trimStart());
}

function cleanItems(items: string[]) {
  return items.map((item) => item.trim()).filter(Boolean);
}

function formatRange(start: string, end: string, current = false) {
  return [start, current ? "Present" : end].filter(Boolean).join(" – ");
}

function displayUrl(value: string) {
  return value.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
}

function updateAt<T>(items: T[], index: number, updates: Partial<T>) {
  return items.map((item, itemIndex) =>
    itemIndex === index ? { ...item, ...updates } : item,
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block text-xs font-bold text-slate-600">
      {label}
      <input
        className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        value={value}
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label className="block text-xs font-bold text-slate-600">
      {label}
      <textarea
        className="mt-1.5 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium leading-6 text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        value={value}
      />
    </label>
  );
}

function EditorCard({
  title,
  onRemove,
  children,
}: {
  title: string;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm font-black text-slate-800">{title}</p>
        <button className="text-xs font-bold text-rose-600 hover:text-rose-800" onClick={onRemove} type="button">Remove</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="w-full rounded-xl border border-dashed border-indigo-300 bg-indigo-50/70 px-4 py-3 text-sm font-black text-indigo-700 hover:bg-indigo-100" onClick={onClick} type="button">+ {label}</button>
  );
}

function ResumeSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="resume-section">
      <h2 className="resume-section-title">{title}</h2>
      <div className="resume-section-content">{children}</div>
    </section>
  );
}

function BulletList({ items }: { items: string[] }) {
  const visibleItems = cleanItems(items);
  if (!visibleItems.length) return null;
  return <ul className="resume-bullets">{visibleItems.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>;
}

function ExperiencePreview({ entries }: { entries: Experience[] }) {
  if (!entries.length) return null;
  return <ResumeSection title="Experience">{entries.map((entry) => (
    <article className="resume-entry" key={entry.entry_id}>
      <div className="resume-entry-heading"><div><h3>{entry.role || "Role"}</h3><p>{entry.organization}{entry.location ? ` · ${entry.location}` : ""}</p></div><time>{formatRange(entry.start_date, entry.end_date, entry.current)}</time></div>
      <BulletList items={entry.highlights} />
    </article>
  ))}</ResumeSection>;
}

function EducationPreview({ entries }: { entries: Education[] }) {
  if (!entries.length) return null;
  return <ResumeSection title="Education">{entries.map((entry) => (
    <article className="resume-entry" key={entry.entry_id}>
      <div className="resume-entry-heading"><div><h3>{[entry.degree, entry.field_of_study].filter(Boolean).join(" in ") || "Degree"}</h3><p>{entry.institution}{entry.location ? ` · ${entry.location}` : ""}</p></div><time>{formatRange(entry.start_date, entry.end_date)}</time></div>
      {entry.score && <p className="resume-meta">{entry.score}</p>}<BulletList items={entry.highlights} />
    </article>
  ))}</ResumeSection>;
}

function ProjectsPreview({ entries }: { entries: Project[] }) {
  if (!entries.length) return null;
  return <ResumeSection title="Projects">{entries.map((entry) => (
    <article className="resume-entry" key={entry.entry_id}>
      <div className="resume-entry-heading"><div><h3>{entry.name || "Project"}{entry.role ? ` · ${entry.role}` : ""}</h3><p>{entry.technologies}</p></div><time>{formatRange(entry.start_date, entry.end_date)}</time></div>
      {entry.project_url && <p className="resume-link">{displayUrl(entry.project_url)}</p>}<BulletList items={entry.highlights} />
    </article>
  ))}</ResumeSection>;
}

function DetailPreview({ title, entries }: { title: string; entries: Detail[] }) {
  if (!entries.length) return null;
  return <ResumeSection title={title}>{entries.map((entry) => (
    <article className="resume-entry" key={entry.entry_id}>
      <div className="resume-entry-heading"><div><h3>{entry.title}</h3><p>{entry.organization}</p></div></div>
      {entry.description && <p>{entry.description}</p>}
    </article>
  ))}</ResumeSection>;
}

function ResumeHeader({ basics, compact = false }: { basics: Basics; compact?: boolean }) {
  const contacts = [basics.email, basics.phone, basics.location].filter(Boolean);
  const links = [basics.linkedin_url, basics.github_url, basics.portfolio_url].filter(Boolean);
  return (
    <header className={compact ? "resume-header resume-header-compact" : "resume-header"}>
      <h1>{basics.full_name || "Your Name"}</h1>
      <p className="resume-professional-title">{basics.professional_title || "Professional title"}</p>
      {!compact && <><p className="resume-contact-line">{contacts.join("  •  ")}</p><p className="resume-contact-line">{links.map(displayUrl).join("  •  ")}</p></>}
    </header>
  );
}

function TwoColumnResume({ data }: { data: ResumeData }) {
  const contacts = [data.basics.email, data.basics.phone, data.basics.location].filter(Boolean);
  const links = [data.basics.linkedin_url, data.basics.github_url, data.basics.portfolio_url].filter(Boolean);
  return (
    <div className="resume-document resume-two-column">
      <ResumeHeader basics={data.basics} compact />
      <div className="resume-column-grid">
        <aside className="resume-sidebar">
          {(contacts.length > 0 || links.length > 0) && <ResumeSection title="Contact"><div className="resume-stack">{contacts.map((value) => <p key={value}>{value}</p>)}{links.map((value) => <p className="resume-link" key={value}>{displayUrl(value)}</p>)}</div></ResumeSection>}
          {cleanItems(data.skills).length > 0 && <ResumeSection title="Skills"><div className="resume-tags">{cleanItems(data.skills).map((skill, index) => <span key={`${skill}-${index}`}>{skill}</span>)}</div></ResumeSection>}
          {data.certifications.length > 0 && <ResumeSection title="Certifications"><div className="resume-stack">{data.certifications.map((item) => <div key={item.entry_id}><strong>{item.name}</strong><p>{[item.issuer, item.issue_date].filter(Boolean).join(" · ")}</p></div>)}</div></ResumeSection>}
          {data.languages.length > 0 && <ResumeSection title="Languages"><div className="resume-stack">{data.languages.map((item) => <p key={item.entry_id}><strong>{item.name}</strong>{item.proficiency ? ` · ${item.proficiency}` : ""}</p>)}</div></ResumeSection>}
          {cleanItems(data.interests).length > 0 && <ResumeSection title="Interests"><p>{cleanItems(data.interests).join(" · ")}</p></ResumeSection>}
        </aside>
        <div className="resume-main-column">
          {data.basics.summary && <ResumeSection title="Profile"><p>{data.basics.summary}</p></ResumeSection>}
          <ExperiencePreview entries={data.experience} />
          <ProjectsPreview entries={data.projects} />
          <EducationPreview entries={data.education} />
          <DetailPreview entries={data.achievements} title="Achievements" />
          <DetailPreview entries={data.leadership} title="Leadership & responsibility" />
        </div>
      </div>
    </div>
  );
}

function SingleColumnResume({ data }: { data: ResumeData }) {
  return (
    <div className="resume-document resume-single-column">
      <ResumeHeader basics={data.basics} />
      {data.basics.summary && <ResumeSection title="Professional Summary"><p>{data.basics.summary}</p></ResumeSection>}
      <ExperiencePreview entries={data.experience} />
      <ProjectsPreview entries={data.projects} />
      <EducationPreview entries={data.education} />
      {cleanItems(data.skills).length > 0 && <ResumeSection title="Skills"><p>{cleanItems(data.skills).join("  •  ")}</p></ResumeSection>}
      {data.certifications.length > 0 && <ResumeSection title="Certifications"><div className="resume-compact-list">{data.certifications.map((item) => <p key={item.entry_id}><strong>{item.name}</strong>{item.issuer ? ` — ${item.issuer}` : ""}{item.issue_date ? ` · ${item.issue_date}` : ""}</p>)}</div></ResumeSection>}
      <DetailPreview entries={data.achievements} title="Achievements" />
      <DetailPreview entries={data.leadership} title="Leadership & responsibility" />
      {(data.languages.length > 0 || cleanItems(data.interests).length > 0) && <ResumeSection title="Additional Information"><div className="resume-compact-list">{data.languages.length > 0 && <p><strong>Languages:</strong> {data.languages.map((item) => `${item.name}${item.proficiency ? ` (${item.proficiency})` : ""}`).join(", ")}</p>}{cleanItems(data.interests).length > 0 && <p><strong>Interests:</strong> {cleanItems(data.interests).join(", ")}</p>}</div></ResumeSection>}
    </div>
  );
}

export default function ResumeBuilderPage() {
  const router = useRouter();
  const [studentId, setStudentId] = useState<number | null>(null);
  const [data, setData] = useState<ResumeData>(EMPTY_RESUME);
  const [activeSection, setActiveSection] = useState<SectionKey>("personal");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const queryId = Number(new URLSearchParams(window.location.search).get("student_id"));
    const storedId = Number(window.sessionStorage.getItem("studentId"));
    const resolvedId = storedId || queryId;
    if (!resolvedId) {
      router.replace("/student");
      return;
    }
    let active = true;
    async function loadDraft() {
      await Promise.resolve();
      if (!active) return;
      setStudentId(resolvedId);
      try {
        const response = await fetch(`${API_URL}/resume-builders/student/${resolvedId}`, { cache: "no-store" });
        const result = (await response.json()) as ResumeData & { detail?: string };
        if (!response.ok) throw new Error(result.detail || "Could not load the resume draft.");
        if (!active) return;
        setData(result);
      } catch (error) {
        if (active) setErrorMessage(error instanceof Error ? error.message : "Could not load the resume builder.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadDraft();
    return () => {
      active = false;
    };
  }, [router]);

  const completedSections = useMemo(() => {
    const checks = [
      Boolean(data.basics.full_name && data.basics.email && data.basics.summary),
      data.education.length > 0,
      data.experience.length > 0,
      data.projects.length > 0,
      cleanItems(data.skills).length > 0,
      data.certifications.length > 0,
      data.achievements.length > 0,
      data.leadership.length > 0,
      data.languages.length > 0,
      cleanItems(data.interests).length > 0,
    ];
    return checks.filter(Boolean).length;
  }, [data]);

  function updateBasics(updates: Partial<Basics>) {
    setData((current) => ({ ...current, basics: { ...current.basics, ...updates } }));
  }

  async function saveDraft() {
    if (!studentId) return;
    setSaving(true);
    setMessage("");
    setErrorMessage("");
    try {
      const cleanedData: ResumeData = {
        ...data,
        education: data.education.map((entry) => ({
          ...entry,
          highlights: cleanItems(entry.highlights),
        })),
        experience: data.experience.map((entry) => ({
          ...entry,
          highlights: cleanItems(entry.highlights),
        })),
        projects: data.projects.map((entry) => ({
          ...entry,
          highlights: cleanItems(entry.highlights),
        })),
        skills: cleanItems(data.skills),
        interests: cleanItems(data.interests),
      };
      const response = await fetch(`${API_URL}/resume-builders/student/${studentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cleanedData),
      });
      const result = (await response.json()) as ResumeData & { detail?: string };
      if (!response.ok) throw new Error(result.detail || "Could not save the resume.");
      setData(result);
      setMessage("Resume draft saved.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not save the resume.");
    } finally {
      setSaving(false);
    }
  }

  function renderEditor() {
    if (activeSection === "personal") return <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Full name" onChange={(value) => updateBasics({ full_name: value })} placeholder="Yash Mishra" value={data.basics.full_name} />
      <Field label="Professional title" onChange={(value) => updateBasics({ professional_title: value })} placeholder="AI Engineer" value={data.basics.professional_title} />
      <Field label="Email" onChange={(value) => updateBasics({ email: value })} type="email" value={data.basics.email} />
      <Field label="Phone" onChange={(value) => updateBasics({ phone: value })} value={data.basics.phone} />
      <Field label="City / location" onChange={(value) => updateBasics({ location: value })} value={data.basics.location} />
      <Field label="LinkedIn URL" onChange={(value) => updateBasics({ linkedin_url: value })} value={data.basics.linkedin_url} />
      <Field label="GitHub URL" onChange={(value) => updateBasics({ github_url: value })} value={data.basics.github_url} />
      <Field label="Portfolio URL" onChange={(value) => updateBasics({ portfolio_url: value })} value={data.basics.portfolio_url} />
      <div className="sm:col-span-2"><TextArea label="Professional summary" onChange={(value) => updateBasics({ summary: value })} placeholder="Write 2–3 concise lines about your skills, experience, and target role." rows={5} value={data.basics.summary} /></div>
    </div>;

    if (activeSection === "education") return <div className="space-y-4">{data.education.map((entry, index) => <EditorCard key={entry.entry_id} onRemove={() => setData((current) => ({ ...current, education: current.education.filter((_, itemIndex) => itemIndex !== index) }))} title={`Education ${index + 1}`}>
      <Field label="Institution" onChange={(value) => setData((current) => ({ ...current, education: updateAt(current.education, index, { institution: value }) }))} value={entry.institution} />
      <Field label="Degree" onChange={(value) => setData((current) => ({ ...current, education: updateAt(current.education, index, { degree: value }) }))} value={entry.degree} />
      <Field label="Field of study" onChange={(value) => setData((current) => ({ ...current, education: updateAt(current.education, index, { field_of_study: value }) }))} value={entry.field_of_study} />
      <Field label="Location" onChange={(value) => setData((current) => ({ ...current, education: updateAt(current.education, index, { location: value }) }))} value={entry.location} />
      <Field label="Start date" onChange={(value) => setData((current) => ({ ...current, education: updateAt(current.education, index, { start_date: value }) }))} placeholder="2022" value={entry.start_date} />
      <Field label="End date" onChange={(value) => setData((current) => ({ ...current, education: updateAt(current.education, index, { end_date: value }) }))} placeholder="2026" value={entry.end_date} />
      <Field label="CGPA / percentage" onChange={(value) => setData((current) => ({ ...current, education: updateAt(current.education, index, { score: value }) }))} value={entry.score} />
      <div className="sm:col-span-2"><TextArea label="Highlights — use Enter or commas" onChange={(value) => setData((current) => ({ ...current, education: updateAt(current.education, index, { highlights: draftItems(value) }) }))} rows={3} value={entry.highlights.join("\n")} /></div>
    </EditorCard>)}<AddButton label="Add education" onClick={() => setData((current) => ({ ...current, education: [...current.education, { entry_id: newId(), institution: "", degree: "", field_of_study: "", location: "", start_date: "", end_date: "", score: "", highlights: [] }] }))} /></div>;

    if (activeSection === "experience") return <div className="space-y-4">{data.experience.map((entry, index) => <EditorCard key={entry.entry_id} onRemove={() => setData((current) => ({ ...current, experience: current.experience.filter((_, itemIndex) => itemIndex !== index) }))} title={`Experience ${index + 1}`}>
      <Field label="Role / designation" onChange={(value) => setData((current) => ({ ...current, experience: updateAt(current.experience, index, { role: value }) }))} value={entry.role} />
      <Field label="Company / organization" onChange={(value) => setData((current) => ({ ...current, experience: updateAt(current.experience, index, { organization: value }) }))} value={entry.organization} />
      <Field label="Location" onChange={(value) => setData((current) => ({ ...current, experience: updateAt(current.experience, index, { location: value }) }))} value={entry.location} />
      <Field label="Start date" onChange={(value) => setData((current) => ({ ...current, experience: updateAt(current.experience, index, { start_date: value }) }))} value={entry.start_date} />
      <Field label="End date" onChange={(value) => setData((current) => ({ ...current, experience: updateAt(current.experience, index, { end_date: value }) }))} value={entry.end_date} />
      <label className="flex items-center gap-2 pt-6 text-sm font-bold text-slate-700"><input checked={entry.current} onChange={(event) => setData((current) => ({ ...current, experience: updateAt(current.experience, index, { current: event.target.checked }) }))} type="checkbox" /> I currently work here</label>
      <div className="sm:col-span-2"><TextArea label="Achievement bullets — use Enter or commas" onChange={(value) => setData((current) => ({ ...current, experience: updateAt(current.experience, index, { highlights: draftItems(value) }) }))} placeholder="Built…\nImproved…\nCollaborated…" rows={5} value={entry.highlights.join("\n")} /></div>
    </EditorCard>)}<AddButton label="Add experience or internship" onClick={() => setData((current) => ({ ...current, experience: [...current.experience, { entry_id: newId(), role: "", organization: "", location: "", start_date: "", end_date: "", current: false, highlights: [] }] }))} /></div>;

    if (activeSection === "projects") return <div className="space-y-4">{data.projects.map((entry, index) => <EditorCard key={entry.entry_id} onRemove={() => setData((current) => ({ ...current, projects: current.projects.filter((_, itemIndex) => itemIndex !== index) }))} title={`Project ${index + 1}`}>
      <Field label="Project name" onChange={(value) => setData((current) => ({ ...current, projects: updateAt(current.projects, index, { name: value }) }))} value={entry.name} />
      <Field label="Your role" onChange={(value) => setData((current) => ({ ...current, projects: updateAt(current.projects, index, { role: value }) }))} value={entry.role} />
      <Field label="Technologies" onChange={(value) => setData((current) => ({ ...current, projects: updateAt(current.projects, index, { technologies: value }) }))} value={entry.technologies} />
      <Field label="Project URL" onChange={(value) => setData((current) => ({ ...current, projects: updateAt(current.projects, index, { project_url: value }) }))} value={entry.project_url} />
      <Field label="Start date" onChange={(value) => setData((current) => ({ ...current, projects: updateAt(current.projects, index, { start_date: value }) }))} value={entry.start_date} />
      <Field label="End date" onChange={(value) => setData((current) => ({ ...current, projects: updateAt(current.projects, index, { end_date: value }) }))} value={entry.end_date} />
      <div className="sm:col-span-2"><TextArea label="Impact bullets — use Enter or commas" onChange={(value) => setData((current) => ({ ...current, projects: updateAt(current.projects, index, { highlights: draftItems(value) }) }))} rows={5} value={entry.highlights.join("\n")} /></div>
    </EditorCard>)}<AddButton label="Add project" onClick={() => setData((current) => ({ ...current, projects: [...current.projects, { entry_id: newId(), name: "", role: "", technologies: "", project_url: "", start_date: "", end_date: "", highlights: [] }] }))} /></div>;

    if (activeSection === "skills") return <TextArea label="Skills — separate with commas or new lines" onChange={(value) => setData((current) => ({ ...current, skills: draftItems(value) }))} placeholder="Python, Machine Learning, SQL, React" rows={8} value={data.skills.join(", ")} />;

    if (activeSection === "certifications") return <div className="space-y-4">{data.certifications.map((entry, index) => <EditorCard key={entry.entry_id} onRemove={() => setData((current) => ({ ...current, certifications: current.certifications.filter((_, itemIndex) => itemIndex !== index) }))} title={`Certification ${index + 1}`}>
      <Field label="Certification" onChange={(value) => setData((current) => ({ ...current, certifications: updateAt(current.certifications, index, { name: value }) }))} value={entry.name} />
      <Field label="Issuing organization" onChange={(value) => setData((current) => ({ ...current, certifications: updateAt(current.certifications, index, { issuer: value }) }))} value={entry.issuer} />
      <Field label="Issue date" onChange={(value) => setData((current) => ({ ...current, certifications: updateAt(current.certifications, index, { issue_date: value }) }))} value={entry.issue_date} />
      <Field label="Credential URL" onChange={(value) => setData((current) => ({ ...current, certifications: updateAt(current.certifications, index, { credential_url: value }) }))} value={entry.credential_url} />
    </EditorCard>)}<AddButton label="Add certification" onClick={() => setData((current) => ({ ...current, certifications: [...current.certifications, { entry_id: newId(), name: "", issuer: "", issue_date: "", credential_url: "" }] }))} /></div>;

    if (activeSection === "achievements" || activeSection === "leadership") {
      const collection = data[activeSection];
      const sectionLabel = activeSection === "achievements" ? "achievement" : "leadership position";
      return <div className="space-y-4">{collection.map((entry, index) => <EditorCard key={entry.entry_id} onRemove={() => setData((current) => ({ ...current, [activeSection]: current[activeSection].filter((_, itemIndex) => itemIndex !== index) }))} title={`${sectionLabel[0].toUpperCase()}${sectionLabel.slice(1)} ${index + 1}`}>
        <Field label="Title / role" onChange={(value) => setData((current) => ({ ...current, [activeSection]: updateAt(current[activeSection], index, { title: value }) }))} value={entry.title} />
        <Field label="Organization" onChange={(value) => setData((current) => ({ ...current, [activeSection]: updateAt(current[activeSection], index, { organization: value }) }))} value={entry.organization} />
        <div className="sm:col-span-2"><TextArea label="Description" onChange={(value) => setData((current) => ({ ...current, [activeSection]: updateAt(current[activeSection], index, { description: value }) }))} value={entry.description} /></div>
      </EditorCard>)}<AddButton label={`Add ${sectionLabel}`} onClick={() => setData((current) => ({ ...current, [activeSection]: [...current[activeSection], { entry_id: newId(), title: "", organization: "", description: "" }] }))} /></div>;
    }

    if (activeSection === "languages") return <div className="space-y-4">{data.languages.map((entry, index) => <EditorCard key={entry.entry_id} onRemove={() => setData((current) => ({ ...current, languages: current.languages.filter((_, itemIndex) => itemIndex !== index) }))} title={`Language ${index + 1}`}>
      <Field label="Language" onChange={(value) => setData((current) => ({ ...current, languages: updateAt(current.languages, index, { name: value }) }))} value={entry.name} />
      <Field label="Proficiency" onChange={(value) => setData((current) => ({ ...current, languages: updateAt(current.languages, index, { proficiency: value }) }))} placeholder="Native / Professional / Conversational" value={entry.proficiency} />
    </EditorCard>)}<AddButton label="Add language" onClick={() => setData((current) => ({ ...current, languages: [...current.languages, { entry_id: newId(), name: "", proficiency: "" }] }))} /></div>;

    return <TextArea label="Interests — separate with commas or new lines" onChange={(value) => setData((current) => ({ ...current, interests: draftItems(value) }))} placeholder="Open-source, Robotics, Public speaking" rows={7} value={data.interests.join(", ")} />;
  }

  const activeLabel = SECTIONS.find((section) => section.key === activeSection)?.label;
  const backHref = studentId ? `/student/dashboard?student_id=${studentId}` : "/student";

  return (
    <main className="resume-builder-page min-h-screen bg-slate-100 px-4 py-6 text-slate-900 sm:px-7">
      <div className="mx-auto max-w-[1500px]">
        <nav className="no-print flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white bg-white/90 px-5 py-3 shadow-sm">
          <Link className="text-sm font-black text-slate-600 hover:text-indigo-700" href={backHref}>← Student dashboard</Link>
          <div className="flex items-center gap-3"><span className="text-xs font-bold text-slate-500">{completedSections}/10 sections added</span><button className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white disabled:opacity-50" disabled={saving || loading} onClick={() => void saveDraft()} type="button">{saving ? "Saving…" : "Save draft"}</button><button className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50" disabled={loading} onClick={() => window.print()} type="button">Download PDF</button></div>
        </nav>

        <header className="no-print mt-5 rounded-3xl bg-gradient-to-br from-indigo-950 to-slate-950 px-7 py-7 text-white shadow-xl">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-indigo-300">ATS-friendly resume builder</p>
          <h1 className="mt-2 text-3xl font-black sm:text-4xl">Build once. Preview every change.</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">Complete only the sections that apply to you. Keep bullets truthful, concise, and focused on actions and measurable outcomes.</p>
          <div className="mt-5 grid max-w-2xl gap-3 sm:grid-cols-2">
            <button className={`rounded-2xl border p-4 text-left ${data.template === "two-column" ? "border-cyan-300 bg-cyan-300/15" : "border-white/15 bg-white/5"}`} onClick={() => setData((current) => ({ ...current, template: "two-column" }))} type="button"><span className="text-sm font-black">Two-column</span><span className="mt-1 block text-xs text-slate-300">Compact left sidebar + detailed right column</span></button>
            <button className={`rounded-2xl border p-4 text-left ${data.template === "single-column" ? "border-cyan-300 bg-cyan-300/15" : "border-white/15 bg-white/5"}`} onClick={() => setData((current) => ({ ...current, template: "single-column" }))} type="button"><span className="text-sm font-black">Plain top-to-bottom</span><span className="mt-1 block text-xs text-slate-300">Simple linear layout for maximum ATS readability</span></button>
          </div>
        </header>

        {errorMessage && <p className="no-print mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{errorMessage}</p>}
        {message && <p className="no-print mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{message}</p>}

        <div className="mt-5 grid gap-5 xl:grid-cols-[560px_minmax(0,1fr)]">
          <section className="no-print rounded-3xl bg-white p-5 shadow-lg">
            <div className="flex gap-2 overflow-x-auto pb-3 xl:grid xl:grid-cols-2 xl:overflow-visible">
              {SECTIONS.map((section, index) => <button className={`shrink-0 rounded-xl px-3 py-2.5 text-left text-xs font-black ${activeSection === section.key ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-indigo-50"}`} key={section.key} onClick={() => setActiveSection(section.key)} type="button"><span className="mr-2 opacity-60">{String(index + 1).padStart(2, "0")}</span>{section.label}{section.optional ? " · Optional" : ""}</button>)}
            </div>
            <div className="mt-4 border-t border-slate-100 pt-5"><h2 className="mb-4 text-xl font-black">{activeLabel}</h2>{loading ? <p className="py-12 text-center text-sm font-bold text-slate-400">Loading your draft…</p> : renderEditor()}</div>
          </section>

          <section className="resume-preview-shell min-w-0 overflow-auto rounded-3xl bg-slate-300/60 p-3 shadow-inner sm:p-6">
            <div className="resume-print-area mx-auto min-h-[1123px] w-[794px] max-w-none bg-white shadow-2xl">
              {data.template === "two-column" ? <TwoColumnResume data={data} /> : <SingleColumnResume data={data} />}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
