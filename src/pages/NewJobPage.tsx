import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError, type NewJob } from "../api";
import { Field } from "../components/fields";
import { UpgradePrompt } from "../components/UpgradePrompt";
import { useJobs } from "../data";
import { isUnlimited } from "../format";
import { useSession } from "../session";

const EMPTY: NewJob = { title: "", company: "", location: "", salaryText: "", description: "", url: "" };

export function NewJobPage() {
  const { account, refresh } = useSession();
  const { jobs } = useJobs();
  const navigate = useNavigate();
  const [job, setJob] = useState<NewJob>(EMPTY);
  const [link, setLink] = useState("");
  const [fetchMsg, setFetchMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"fetch" | "check" | null>(null);

  const set = (k: keyof NewJob, v: string) => setJob((j) => ({ ...j, [k]: v }));

  async function readLink() {
    setBusy("fetch");
    setFetchMsg("");
    setError("");
    try {
      const f = await api.fetchJob(link);
      setJob({ title: f.title, company: f.company, location: f.location, salaryText: f.salaryText, description: f.description, url: f.url });
      setFetchMsg(
        f.source === "structured"
          ? "Read the posting. Check the details below, then run the fit check."
          : "Read the page text. Trim anything that is not the job description, then run the fit check.",
      );
    } catch (e) {
      setError((e as Error).message);
      set("url", link);
    } finally {
      setBusy(null);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy("check");
    setError("");
    try {
      const created = await api.createJob(job);
      await refresh();
      navigate(`/jobs/${created.id}`);
    } catch (err) {
      setError((err as Error).message);
      if (err instanceof ApiError && err.status === 402) await refresh();
    } finally {
      setBusy(null);
    }
  }

  const outOfChecks = account !== null && account.evalCredits <= 0;
  const evidence = (jobs ?? []).some((job) => job.fit.score > 0);

  return (
    <div className="page narrow-wide">
      <h1>Check a job</h1>
      <p className="muted">Uses 1 fit check. You have {isUnlimited(account?.evalCredits ?? 0) ? "unlimited checks" : `${account?.evalCredits ?? 0} left`}.</p>

      {outOfChecks && <UpgradePrompt evidence={evidence} blocked="checks" />}
      {outOfChecks && !evidence && (
        <div className="alert alert-info">
          You have used your fit checks. <Link to="/pricing">See plans</Link>
        </div>
      )}

      <div className="card">
        <Field label="Job link (optional)" hint="Works with most career sites, LinkedIn, Greenhouse, Lever and Naukri pages. Reading a link is free.">
          <div className="row-inline">
            <input type="url" placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} />
            <button type="button" className="btn btn-ghost" onClick={readLink} disabled={!link || busy !== null}>
              {busy === "fetch" ? "Reading…" : "Read link"}
            </button>
          </div>
        </Field>
        {fetchMsg && <div className="alert alert-ok">{fetchMsg}</div>}
      </div>

      <form className="card stack" onSubmit={submit}>
        <div className="grid-2">
          <Field label="Job title"><input required value={job.title} onChange={(e) => set("title", e.target.value)} /></Field>
          <Field label="Company"><input value={job.company} onChange={(e) => set("company", e.target.value)} /></Field>
          <Field label="Location" hint="City, or Remote / Hybrid."><input value={job.location} onChange={(e) => set("location", e.target.value)} /></Field>
          <Field label="Pay, if published" hint="e.g. 30-40 LPA"><input value={job.salaryText} onChange={(e) => set("salaryText", e.target.value)} /></Field>
        </div>
        <Field label="Job description" hint="Paste all of it, including requirements and nice-to-haves.">
          <textarea required rows={14} value={job.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        {error && <div className="alert alert-error">{error}</div>}
        <button className="btn btn-primary btn-lg" disabled={busy !== null || outOfChecks}>
          {busy === "check" ? "Checking…" : "Run fit check"}
        </button>
      </form>
    </div>
  );
}
