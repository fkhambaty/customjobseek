import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { postingClosedCopy } from "../../shared/engine/liveness";
import { JOB_STATUSES } from "../../shared/types";
import { resumeViewerPath } from "../../shared/resumeFile";
import { api, type ResumeLibrary } from "../api";
import { statusLabel } from "../components/FitCard";
import { SortableHeader } from "../components/SortableHeader";
import { useJobs } from "../data";
import { shortDate } from "../format";
import { rowsInTableOrder, type ColumnMap } from "../tableSort";
import { useTableSort } from "../useTableSort";

type TailoredRow = ResumeLibrary["tailored"][number];
type ResumeSortKey = "role" | "status" | "made";

const RESUME_COLUMNS: ColumnMap<TailoredRow, ResumeSortKey> = {
  role: { key: "role", kind: "string", defaultDirection: "asc", value: (row) => [row.title, row.company] },
  status: { key: "status", kind: "status", defaultDirection: "asc", statusOrder: JOB_STATUSES, value: (row) => row.status },
  made: { key: "made", kind: "date", defaultDirection: "desc", value: (row) => row.madeAt },
};

export function ResumesPage() {
  const { open } = useJobs();
  const [lib, setLib] = useState<ResumeLibrary | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const { sort, toggle } = useTableSort<ResumeSortKey>({ key: "made", direction: RESUME_COLUMNS.made.defaultDirection });

  useEffect(() => {
    api.resumes().then(setLib, (e: Error) => setError(e.message));
  }, []);

  const tailored = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = (lib?.tailored ?? []).filter((row) => !q || `${row.title} ${row.company}`.toLowerCase().includes(q));
    return rowsInTableOrder("application", matched, RESUME_COLUMNS, sort);
  }, [lib, query, sort]);

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
          <Link className="btn btn-primary btn-sm" to={resumeViewerPath("master", "master")}>Open PDF</Link>
          <Link to="/profile" className="btn btn-ghost btn-sm">Edit profile</Link>
        </div>
      </section>

      {lib && lib.base.length > 0 && (
      <section className="panel">
        <header>
          <h2>Resumes you brought over <span className="n">{lib.base.length}</span></h2>
          <p>Each uploaded file opens as a PDF. Older copies are filled in the first time you open them.</p>
        </header>
        <ul className="files">
          {lib.base.map((b) => (
            <li key={b.id}>
              <span className="file-name">{b.label}</span>
              <span className="muted small">{shortDate(b.createdAt)}</span>
              <span className="row-inline">
                <Link className="btn btn-ghost btn-xs" to={resumeViewerPath("upload", b.id)}>Open PDF</Link>
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
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Resumes made for a job">
        <table className="ledger compact">
          <thead>
            <tr>
              <SortableHeader label="Role" column="role" sort={sort} defaultDirection={RESUME_COLUMNS.role.defaultDirection} onSort={toggle} />
              <SortableHeader label="Status" column="status" sort={sort} defaultDirection={RESUME_COLUMNS.status.defaultDirection} onSort={toggle} />
              <SortableHeader label="Made" column="made" sort={sort} defaultDirection={RESUME_COLUMNS.made.defaultDirection} onSort={toggle} />
              <th scope="col"><span className="clip">PDF</span></th>
            </tr>
          </thead>
          <tbody>
            {tailored.map((t) => (
              <tr
                key={t.jobId}
                tabIndex={0}
                className={t.liveStatus === "closed" ? "posting-closed" : undefined}
                onClick={() => open(t.jobId, "resume")}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  open(t.jobId, "resume");
                }}
              >
                <td>
                  <span className="l-title">{t.title}</span>
                  <span className="l-sub">{t.company}</span>
                  {t.liveStatus === "closed" && <span className="posting-closed-note">{postingClosedCopy(t.status)}</span>}
                </td>
                <td>{statusLabel(t.status)}</td>
                <td className="l-date">{shortDate(t.madeAt)}</td>
                <td onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} className="row-inline">
                  {(t.built || t.saved) && <Link className="btn btn-ghost btn-xs" to={resumeViewerPath("job", t.jobId)}>PDF</Link>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {lib === null && !error && <p className="muted">Loading…</p>}
      </section>
    </div>
  );
}
