import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ResumeLibrary } from "../api";
import { statusLabel } from "../components/FitCard";
import { useJobs } from "../data";
import { shortDate } from "../format";

export function ResumesPage() {
  const { open } = useJobs();
  const [lib, setLib] = useState<ResumeLibrary | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    api.resumes().then(setLib, (e: Error) => setError(e.message));
  }, []);

  const tailored = (lib?.tailored ?? []).filter((t) => {
    const q = query.trim().toLowerCase();
    return !q || `${t.title} ${t.company}`.toLowerCase().includes(q);
  });

  return (
    <div className="page">
      <div className="page-top">
        <div>
          <h1 className="page-title">Resumes</h1>
          <p className="lede">The general one built from your profile, any formatted resume you brought with you, and the one made for each job.</p>
        </div>
      </div>
      {error && <div className="alert alert-error">{error}</div>}

      <section className="panel">
        <header>
          <h2>From your profile</h2>
          <p>Your strongest lines in their usual order, for when there is no specific job. Always current with your profile.</p>
        </header>
        <div className="row-inline">
          <a className="btn btn-primary btn-sm" href="/print/master" target="_blank" rel="noreferrer">Open and save as PDF</a>
          <Link to="/profile" className="btn btn-ghost btn-sm">Edit profile</Link>
        </div>
      </section>

      {lib && lib.base.length > 0 && (
      <section className="panel">
        <header>
          <h2>Resumes you brought over <span className="n">{lib.base.length}</span></h2>
          <p>Formatted copies kept as they were. Print them to PDF from the browser.</p>
        </header>
        <ul className="files">
          {lib.base.map((b) => (
            <li key={b.id}>
              <span className="file-name">{b.label}</span>
              <span className="muted small">{shortDate(b.createdAt)}</span>
              <span className="row-inline">
                <a className="btn btn-ghost btn-xs" href={`/api/resumes/base/${b.id}`} target="_blank" rel="noreferrer">Open</a>
                <button
                  className="btn btn-quiet btn-xs"
                  onClick={async () => {
                    if (!confirm(`Remove "${b.label}"?`)) return;
                    await api.deleteBaseResume(b.id);
                    setLib({ ...lib, base: lib.base.filter((x) => x.id !== b.id) });
                  }}
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>
      )}

      <section className="panel">
        <header>
          <h2>Made for a job <span className="n">{lib?.tailored.length ?? ""}</span></h2>
          <p>One per job, ordered so the most relevant work leads.</p>
        </header>
        <input className="search" placeholder="Search by role or company" value={query} onChange={(e) => setQuery(e.target.value)} />
        <table className="ledger compact">
          <thead>
            <tr><th>Role</th><th>Status</th><th>Made</th><th /></tr>
          </thead>
          <tbody>
            {tailored.map((t) => (
              <tr key={t.jobId} onClick={() => open(t.jobId, "resume")}>
                <td><span className="l-title">{t.title}</span><span className="l-sub">{t.company}</span></td>
                <td>{statusLabel(t.status)}</td>
                <td className="l-date">{shortDate(t.madeAt)}</td>
                <td onClick={(e) => e.stopPropagation()} className="row-inline">
                  {t.built && <a className="btn btn-ghost btn-xs" href={`/print/${encodeURIComponent(t.jobId)}`} target="_blank" rel="noreferrer">PDF</a>}
                  {t.saved && <a className="btn btn-ghost btn-xs" href={`/api/jobs/${encodeURIComponent(t.jobId)}/resume.html`} target="_blank" rel="noreferrer">Saved copy</a>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {lib === null && !error && <p className="muted">Loading…</p>}
      </section>
    </div>
  );
}
