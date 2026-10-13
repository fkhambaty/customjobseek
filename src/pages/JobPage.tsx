import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { JOB_STATUSES, type JobRecord, type JobStatus, type TailoredResume } from "../../shared/types";
import { api, ApiError } from "../api";
import { FitCard, statusLabel } from "../components/FitCard";
import { Resume } from "../components/Resume";
import { useSession } from "../session";

function Tracker({ job, onSaved }: { job: JobRecord; onSaved: (j: JobRecord) => void }) {
  const [notes, setNotes] = useState(job.notes);
  const [next, setNext] = useState(job.nextActionAt ?? "");
  const [msg, setMsg] = useState("");

  async function save(patch: { status?: JobStatus; notes?: string; nextActionAt?: string | null }) {
    setMsg("");
    try {
      onSaved(await api.updateJob(job.id, patch));
      setMsg("Saved.");
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  return (
    <div className="card">
      <h2>Track this application</h2>
      <div className="status-steps">
        {JOB_STATUSES.map((s) => (
          <button key={s} className={job.status === s ? "status-step active" : "status-step"} onClick={() => save({ status: s })}>
            {statusLabel(s)}
          </button>
        ))}
      </div>
      {job.appliedAt && <p className="muted small">Applied on {new Date(job.appliedAt).toLocaleDateString()}.</p>}
      <div className="grid-2">
        <label className="field">
          <span>Follow up on</span>
          <input type="date" value={next} onChange={(e) => setNext(e.target.value)} />
        </label>
        <label className="field">
          <span>Notes</span>
          <textarea rows={3} value={notes} placeholder="Recruiter name, referral, interview dates…" onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      <div className="row-end">
        {msg && <span className="muted small">{msg}</span>}
        <button className="btn btn-ghost" onClick={() => save({ notes, nextActionAt: next || null })}>Save notes</button>
      </div>
    </div>
  );
}

export function JobPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { account, refresh } = useSession();
  const [job, setJob] = useState<JobRecord | null>(null);
  const [resume, setResume] = useState<TailoredResume | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getJob(id).then(
      (j) => {
        setJob(j);
        if (j.hasResume) api.getResume(id).then(setResume, () => undefined);
      },
      (e: Error) => setError(e.message),
    );
  }, [id]);

  async function makeResume() {
    if (!job) return;
    setBusy(true);
    setError("");
    try {
      setResume(await api.makeResume(job.id));
      setJob(await api.getJob(job.id));
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.status === 402) await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function rescore() {
    if (!job) return;
    setJob(await api.rescoreJob(job.id));
  }

  async function remove() {
    if (!job || !confirm("Delete this job and its resume?")) return;
    await api.deleteJob(job.id);
    navigate("/jobs");
  }

  if (!job) return <div className="page">{error ? <div className="alert alert-error">{error}</div> : <p className="muted">Loading…</p>}</div>;

  const canMakeFirst = (account?.resumeCredits ?? 0) > 0;
  const provenanceOk = resume && !resume.provenance.untraceableLines.length && !resume.provenance.neverClaimHits.length;

  return (
    <div className="page">
      <Link to="/jobs" className="back">← All jobs</Link>
      <div className="page-head">
        <div>
          <h1>{job.title}</h1>
          <p className="muted">
            {[job.company, job.location, job.salaryText].filter(Boolean).join(" · ")}
            {job.url && (
              <>
                {" · "}
                <a href={job.url} target="_blank" rel="noreferrer">View posting</a>
              </>
            )}
          </p>
        </div>
        <div className="row-inline">
          <button className="btn btn-ghost btn-sm" onClick={rescore} title="Free. Use after you update your profile.">Re-check fit</button>
          <button className="btn btn-danger-ghost btn-sm" onClick={remove}>Delete</button>
        </div>
      </div>

      <FitCard fit={job.fit} />

      <div className="card">
        <div className="row-between">
          <div>
            <h2>Tailored resume</h2>
            <p className="muted small">
              Leads with the achievements most relevant to this job. Every line is taken word for word from your profile.
            </p>
          </div>
          <div className="row-inline">
            {resume && (
              <a className="btn btn-primary" href={`/print/${job.id}`} target="_blank" rel="noreferrer">Download PDF</a>
            )}
            <button className={resume ? "btn btn-ghost" : "btn btn-primary"} onClick={makeResume} disabled={busy || (!resume && !canMakeFirst)}>
              {busy ? "Building…" : resume ? "Rebuild (free)" : "Build resume · 1 credit"}
            </button>
          </div>
        </div>
        {!resume && !canMakeFirst && (
          <div className="alert alert-info">You have used your tailored resumes. <Link to="/pricing">See plans</Link></div>
        )}
        {job.fit.decision === "skip" && !resume && (
          <div className="alert alert-warn">This job looks like a poor fit. You can still build a resume, but it may not be worth the credit.</div>
        )}
        {error && <div className="alert alert-error">{error}</div>}
        {resume && (
          <>
            <div className={provenanceOk ? "alert alert-ok" : "alert alert-warn"}>
              {provenanceOk ? (
                "Truth check passed: every line traces to your profile and nothing on your never-claim list appears."
              ) : (
                <>
                  Truth check found problems. Fix your profile, then rebuild.
                  {resume.provenance.neverClaimHits.length > 0 && (
                    <> Never-claim items found in your text: <strong>{resume.provenance.neverClaimHits.join(", ")}</strong>.</>
                  )}
                </>
              )}
            </div>
            <div className="resume-preview">
              <Resume resume={resume} />
            </div>
          </>
        )}
      </div>

      <Tracker job={job} onSaved={setJob} />
    </div>
  );
}
