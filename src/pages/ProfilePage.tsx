import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Bullet, Experience, Profile } from "../../shared/types";
import { api } from "../api";
import { Field, ListInput, NumberInput, newId } from "../components/fields";

function BulletsEditor({ bullets, onChange }: { bullets: Bullet[]; onChange: (b: Bullet[]) => void }) {
  const [raw, setRaw] = useState(bullets.map((b) => b.text).join("\n"));
  return (
    <textarea
      rows={Math.max(4, bullets.length + 1)}
      value={raw}
      placeholder={"One achievement per line, e.g.\nCut monthly reporting from 5 days to 1 by automating 40 SQL reports in dbt"}
      onChange={(e) => {
        setRaw(e.target.value);
        const lines = e.target.value.split("\n").map((l) => l.replace(/^[\s•\-*]+/, "").trim()).filter(Boolean);
        onChange(lines.map((text, i) => ({ id: bullets[i]?.id ?? newId("b"), text })));
      }}
    />
  );
}

function ExperienceEditor({
  exp,
  onChange,
  onRemove,
  onMove,
}: {
  exp: Experience;
  onChange: (e: Experience) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const set = <K extends keyof Experience>(k: K, v: Experience[K]) => onChange({ ...exp, [k]: v });
  return (
    <div className="card sub-card">
      <div className="grid-2">
        <Field label="Job title"><input value={exp.title} onChange={(e) => set("title", e.target.value)} /></Field>
        <Field label="Company"><input value={exp.company} onChange={(e) => set("company", e.target.value)} /></Field>
        <Field label="Location"><input value={exp.location} onChange={(e) => set("location", e.target.value)} /></Field>
        <div className="grid-2">
          <Field label="Start"><input value={exp.start} placeholder="Jan 2021" onChange={(e) => set("start", e.target.value)} /></Field>
          <Field label="End"><input value={exp.end} placeholder="Present" onChange={(e) => set("end", e.target.value)} /></Field>
        </div>
      </div>
      <Field label="Achievements" hint="Write these exactly as you would defend them in an interview. The resume uses your words, never rewritten ones.">
        <BulletsEditor bullets={exp.bullets} onChange={(b) => set("bullets", b)} />
      </Field>
      <div className="row-end">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onMove(-1)}>Move up</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onMove(1)}>Move down</button>
        <button type="button" className="btn btn-danger-ghost btn-sm" onClick={onRemove}>Remove role</button>
      </div>
    </div>
  );
}

export function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getProfile().then((r) => {
      setProfile(r.profile);
      setMissing(r.missing);
    }, (e: Error) => setStatus({ kind: "error", text: e.message }));
  }, []);

  if (!profile) return <div className="page"><p className="muted">{status?.text ?? "Loading your profile…"}</p></div>;

  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setProfile({ ...profile, [k]: v });
  const setPref = <K extends keyof Profile["preferences"]>(k: K, v: Profile["preferences"][K]) =>
    setProfile({ ...profile, preferences: { ...profile.preferences, [k]: v } });

  const updateExp = (i: number, e: Experience) => set("experience", profile.experience.map((x, j) => (j === i ? e : x)));
  const moveExp = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= profile.experience.length) return;
    const next = [...profile.experience];
    [next[i], next[j]] = [next[j]!, next[i]!];
    set("experience", next);
  };

  async function save() {
    if (!profile) return;
    setSaving(true);
    setStatus(null);
    try {
      const r = await api.saveProfile(profile);
      setMissing(r.missing);
      setStatus({ kind: "ok", text: "Saved." });
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Your career profile</h1>
          <p className="muted">Fill this in once. Every fit check and resume is built from it, and only from it.</p>
        </div>
        <div className="save-bar">
          {status && <span className={status.kind === "ok" ? "text-ok" : "text-error"}>{status.text}</span>}
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save profile"}</button>
        </div>
      </div>

      {missing.length > 0 ? (
        <div className="alert alert-info">To check jobs, add {missing.join(", ")}, then save.</div>
      ) : (
        <div className="alert alert-ok">Your profile is ready. <Link to="/jobs/new">Check a job →</Link></div>
      )}

      <section className="card">
        <h2>Basics</h2>
        <div className="grid-2">
          <Field label="Full name"><input value={profile.fullName} onChange={(e) => set("fullName", e.target.value)} /></Field>
          <Field label="Headline" hint="Shown under your name, e.g. Analytics Engineer · SQL, dbt, Snowflake">
            <input value={profile.headline} onChange={(e) => set("headline", e.target.value)} />
          </Field>
          <Field label="Email on resume"><input type="email" value={profile.email} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Phone"><input value={profile.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
          <Field label="Links" hint="LinkedIn, portfolio. Comma-separated.">
            <ListInput value={profile.links} onChange={(v) => set("links", v)} placeholder="linkedin.com/in/you" />
          </Field>
          <Field label="Total years of experience">
            <NumberInput value={profile.totalYears} onChange={(v) => set("totalYears", v)} placeholder="8" />
          </Field>
        </div>
        <Field label="Summary" hint="Three or four sentences about what you do and the results you get.">
          <textarea rows={4} value={profile.summary} onChange={(e) => set("summary", e.target.value)} />
        </Field>
      </section>

      <section className="card">
        <h2>What you will accept</h2>
        <p className="muted small">Jobs that break these rules are flagged as deal-breakers before you spend a credit on a resume.</p>
        <div className="grid-2">
          <Field label="Cities" hint="Comma-separated. Leave empty to accept any city.">
            <ListInput value={profile.preferences.cities} onChange={(v) => setPref("cities", v)} placeholder="Pune, Mumbai, Bengaluru" />
          </Field>
          <Field label="Remote">
            <select value={profile.preferences.remoteOk ? "yes" : "no"} onChange={(e) => setPref("remoteOk", e.target.value === "yes")}>
              <option value="yes">Remote roles are fine</option>
              <option value="no">No remote roles</option>
            </select>
          </Field>
          <Field label="Minimum pay (₹ LPA)"><NumberInput value={profile.preferences.minSalaryLpa} onChange={(v) => setPref("minSalaryLpa", v)} placeholder="30" /></Field>
          <Field label="Target pay ceiling (₹ LPA)"><NumberInput value={profile.preferences.maxSalaryLpa} onChange={(v) => setPref("maxSalaryLpa", v)} placeholder="55" /></Field>
          <Field label="Roles you target" hint="Comma-separated job titles.">
            <ListInput value={profile.preferences.targetRoles} onChange={(v) => setPref("targetRoles", v)} placeholder="Analytics Engineer, BI Manager" />
          </Field>
          <Field label="Title words to exclude" hint="Any job title containing these is a deal-breaker.">
            <ListInput value={profile.preferences.excludedTitleWords} onChange={(v) => setPref("excludedTitleWords", v)} placeholder="Intern, Sales" />
          </Field>
        </div>
      </section>

      <section className="card">
        <h2>Skills</h2>
        <Field label="Skills you can defend in an interview" hint="Comma or line separated.">
          <ListInput
            multiline
            value={profile.skills.map((s) => s.name)}
            onChange={(names) =>
              set("skills", names.map((name) => profile.skills.find((s) => s.name === name) ?? { name, level: "working" as const }))
            }
            placeholder="SQL, Python, dbt, Snowflake, Stakeholder Management"
          />
        </Field>
        <Field
          label="Never claim these"
          hint="Tools or skills you do not have. They will never appear on a resume, and jobs that require them are flagged."
        >
          <ListInput multiline value={profile.neverClaim} onChange={(v) => set("neverClaim", v)} placeholder="Power BI, Databricks, Kubernetes" />
        </Field>
      </section>

      <section className="card">
        <div className="row-between">
          <h2>Experience</h2>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() =>
              set("experience", [...profile.experience, { id: newId("exp"), company: "", title: "", location: "", start: "", end: "", bullets: [] }])
            }
          >
            + Add role
          </button>
        </div>
        <p className="muted small">Most recent first. The two most recent roles show up to six achievements; older roles show three.</p>
        {profile.experience.length === 0 && <p className="muted">No roles yet.</p>}
        {profile.experience.map((exp, i) => (
          <ExperienceEditor
            key={exp.id}
            exp={exp}
            onChange={(e) => updateExp(i, e)}
            onRemove={() => set("experience", profile.experience.filter((_, j) => j !== i))}
            onMove={(dir) => moveExp(i, dir)}
          />
        ))}
      </section>

      <section className="card">
        <div className="row-between">
          <h2>Education</h2>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => set("education", [...profile.education, { id: newId("edu"), institution: "", degree: "", year: "" }])}
          >
            + Add
          </button>
        </div>
        {profile.education.map((ed, i) => (
          <div className="grid-3 row-item" key={ed.id}>
            <input placeholder="Degree" value={ed.degree} onChange={(e) => set("education", profile.education.map((x, j) => (j === i ? { ...x, degree: e.target.value } : x)))} />
            <input placeholder="Institution" value={ed.institution} onChange={(e) => set("education", profile.education.map((x, j) => (j === i ? { ...x, institution: e.target.value } : x)))} />
            <div className="row-inline">
              <input placeholder="Year" value={ed.year} onChange={(e) => set("education", profile.education.map((x, j) => (j === i ? { ...x, year: e.target.value } : x)))} />
              <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => set("education", profile.education.filter((_, j) => j !== i))}>✕</button>
            </div>
          </div>
        ))}
      </section>

      <section className="card">
        <div className="row-between">
          <h2>Certifications</h2>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => set("certifications", [...profile.certifications, { id: newId("cert"), name: "", issuer: "", year: "" }])}
          >
            + Add
          </button>
        </div>
        {profile.certifications.map((c, i) => (
          <div className="grid-3 row-item" key={c.id}>
            <input placeholder="Certification" value={c.name} onChange={(e) => set("certifications", profile.certifications.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <input placeholder="Issuer" value={c.issuer} onChange={(e) => set("certifications", profile.certifications.map((x, j) => (j === i ? { ...x, issuer: e.target.value } : x)))} />
            <div className="row-inline">
              <input placeholder="Year" value={c.year} onChange={(e) => set("certifications", profile.certifications.map((x, j) => (j === i ? { ...x, year: e.target.value } : x)))} />
              <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => set("certifications", profile.certifications.filter((_, j) => j !== i))}>✕</button>
            </div>
          </div>
        ))}
      </section>

      <div className="save-bar sticky-save">
        {status && <span className={status.kind === "ok" ? "text-ok" : "text-error"}>{status.text}</span>}
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save profile"}</button>
      </div>
    </div>
  );
}
