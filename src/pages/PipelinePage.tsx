import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { rowEvidence } from "../../shared/agency";
import { postingClosedCopy } from "../../shared/engine/liveness";
import { payMid } from "../../shared/engine/insights";
import {
  PAY_NOT_PUBLISHED,
  UNASSIGNED_PATH_FILTER,
  jobInPipelineGroup,
  matchesPathFilter,
  showPayNotPublished,
} from "../../shared/engine/searchPaths";
import { JOB_STATUSES, type JobRecord, type JobStatus } from "../../shared/types";
import { api } from "../api";
import { statusLabel } from "../components/FitCard";
import { SortableHeader } from "../components/SortableHeader";
import { useJobs } from "../data";
import { formatPay, shortDate, today } from "../format";
import { rowsInTableOrder, type ColumnMap } from "../tableSort";
import { useTableSort } from "../useTableSort";

type PipelineSortKey = "added" | "role" | "company" | "lane" | "pay" | "fit" | "applied" | "people" | "status";
type PipelinePreset = "added" | "applied" | "fit" | "pay" | "company";

const PIPELINE_COLUMNS: ColumnMap<JobRecord, PipelineSortKey> = {
  added: { key: "added", kind: "date", defaultDirection: "desc", value: (job) => job.createdAt },
  role: { key: "role", kind: "string", defaultDirection: "asc", value: (job) => [job.title, job.company] },
  company: { key: "company", kind: "string", defaultDirection: "asc", value: (job) => job.company },
  lane: { key: "lane", kind: "string", defaultDirection: "asc", value: (job) => job.lane },
  pay: { key: "pay", kind: "number", defaultDirection: "desc", value: (job) => payMid(job) },
  fit: { key: "fit", kind: "number", defaultDirection: "desc", value: (job) => (job.fit.imported && !job.fit.score ? null : job.fit.score) },
  applied: { key: "applied", kind: "date", defaultDirection: "desc", value: (job) => job.appliedAt },
  people: { key: "people", kind: "number", defaultDirection: "desc", value: (job) => [job.contactCount, job.messagesSent, job.replies] },
  status: { key: "status", kind: "status", defaultDirection: "asc", statusOrder: JOB_STATUSES, value: (job) => job.status },
};

const GROUPS: { id: string; label: string; statuses: JobStatus[] }[] = [
  { id: "all", label: "All", statuses: [...JOB_STATUSES] },
  { id: "todo", label: "To apply", statuses: ["evaluated", "resume_ready"] },
  { id: "applied", label: "Applied", statuses: ["applied"] },
  { id: "live", label: "Interviewing", statuses: ["interview", "offer"] },
  { id: "rejected", label: "Rejected", statuses: ["rejected"] },
  { id: "closed", label: "Closed", statuses: ["closed", "withdrawn"] },
  { id: "archived", label: "Archived", statuses: [] },
];

function PipelineSignal({ job }: { job: JobRecord }) {
  const evidence = rowEvidence(job, today());
  const bits = [
    evidence.freshness.label,
    evidence.payProvenance === "unknown" ? "" : evidence.payLabel,
    evidence.coverage === null ? "" : `${evidence.coverage}% covered`,
    evidence.stage,
    evidence.outreach.note,
  ].filter(Boolean);
  return <span className={`l-signal ${evidence.freshness.status}`}>{bits.join(" · ")}{evidence.blocker ? ` · ${evidence.blocker}` : ""}</span>;
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function isPreset(key: PipelineSortKey): key is PipelinePreset {
  switch (key) {
    case "added":
    case "applied":
    case "fit":
    case "pay":
    case "company":
      return true;
    case "role":
    case "lane":
    case "people":
    case "status":
      return false;
    default: {
      const never: never = key;
      return never;
    }
  }
}

function activePreset(sort: { key: PipelineSortKey; direction: "asc" | "desc" } | null): PipelinePreset | null {
  if (sort === null || !isPreset(sort.key) || sort.direction !== PIPELINE_COLUMNS[sort.key].defaultDirection) return null;
  return sort.key;
}

function presetKey(value: string): PipelinePreset | null {
  switch (value) {
    case "added":
    case "applied":
    case "fit":
    case "pay":
    case "company":
      return value;
    default:
      return null;
  }
}

export function PipelinePage() {
  const { jobs, error, notice, put, open, currency, searchPaths } = useJobs();
  const [params, setParams] = useSearchParams();
  const groupParam = params.get("group") ?? "all";
  const group = GROUPS.some((g) => g.id === groupParam) ? groupParam : "all";
  const setGroup = (id: string) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id === "all") next.delete("group");
      else next.set("group", id);
      return next;
    }, { replace: true });
  };
  const [query, setQuery] = useState("");
  const [pathId, setPathId] = useState("");
  const [family, setFamily] = useState("");
  const [route, setRoute] = useState("");
  const { sort, setSort, toggle } = useTableSort<PipelineSortKey>({ key: "added", direction: PIPELINE_COLUMNS.added.defaultDirection });
  const [cursor, setCursor] = useState(0);
  const search = useRef<HTMLInputElement>(null);

  const all = jobs ?? [];
  const shown = useMemo(() => {
    const g = GROUPS.find((x) => x.id === group)!;
    const q = query.trim().toLowerCase();
    const filtered = all
      .filter((j) => jobInPipelineGroup(j, group, g.statuses))
      .filter((j) => matchesPathFilter(j, pathId, searchPaths.length > 0))
      .filter((j) => !family || j.family === family)
      .filter((j) => !route || j.route === route)
      .filter((j) => !q || `${j.title} ${j.company} ${j.location} ${j.requisition}`.toLowerCase().includes(q));
    return rowsInTableOrder("application", filtered, PIPELINE_COLUMNS, sort);
  }, [all, group, query, pathId, family, route, sort, searchPaths.length]);

  useEffect(() => setCursor(0), [group, query, pathId, family, route, sort]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLButtonElement;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        search.current?.focus();
        return;
      }
      if (typing || document.body.classList.contains("drawer-open")) return;
      if (e.key === "j") setCursor((c) => Math.min(shown.length - 1, c + 1));
      if (e.key === "k") setCursor((c) => Math.max(0, c - 1));
      if (e.key === "Enter" && shown[cursor]) open(shown[cursor]!.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, cursor, open]);

  async function setStatus(j: JobRecord, status: JobStatus) {
    put({ ...j, status });
    put(await api.updateJob(j.id, { status }));
  }

  const counts = (g: (typeof GROUPS)[number]) => all.filter((j) => jobInPipelineGroup(j, g.id, g.statuses)).length;

  async function pathAction(job: JobRecord, action: "restore" | "reclassify") {
    put(action === "restore" ? await api.restoreJobPath(job.id) : await api.reclassifyJobPath(job.id));
  }

  if (error && !jobs) {
    return (
      <div className="page page-wide">
        <h1 className="page-title">Pipeline</h1>
        <div className="alert alert-error" role="alert">{error}</div>
      </div>
    );
  }

  return (
    <div className="page page-wide">
      <div className="page-top">
        <div>
          <h1 className="page-title">Pipeline</h1>
          <p className="lede">Every job you have looked at, where it stands, and when you last touched it.</p>
        </div>
      </div>
      {notice && <div className="alert alert-warn" role="status">{notice}</div>}

      <div className="filters">
        <div className="seg" role="group" aria-label="Pipeline stages">
          {GROUPS.map((g) => (
            <button key={g.id} type="button" className={group === g.id ? "on" : ""} aria-pressed={group === g.id} aria-current={group === g.id ? "true" : undefined} onClick={() => setGroup(g.id)}>
              {g.label} <span>{counts(g)}</span>
            </button>
          ))}
        </div>
        <div className="filter-row">
          <input ref={search} className="search" aria-label="Search title, company, or reference" placeholder="Search title, company, reference   /" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select value={pathId} onChange={(e) => setPathId(e.target.value)} aria-label="Search path">
            <option value="">Every search path</option>
            {searchPaths.length
              ? (
                <>
                  {searchPaths.map((path) => <option key={path.id} value={path.id}>{path.name}</option>)}
                  <option value={UNASSIGNED_PATH_FILTER}>Needs path / pay review</option>
                </>
              )
              : uniq(all.map((j) => j.lane)).map((label) => <option key={label} value={label}>{label}</option>)}
          </select>
          <select value={family} onChange={(e) => setFamily(e.target.value)} aria-label="Role family">
            <option value="">Every role type</option>
            {uniq(all.map((j) => j.family)).map((l) => <option key={l}>{l}</option>)}
          </select>
          <select value={route} onChange={(e) => setRoute(e.target.value)} aria-label="Route">
            <option value="">Every route</option>
            {uniq(all.map((j) => j.route)).map((l) => <option key={l}>{l}</option>)}
          </select>
          <select
            value={activePreset(sort) ?? "custom"}
            onChange={(e) => {
              const next = presetKey(e.target.value);
              if (next) setSort({ key: next, direction: PIPELINE_COLUMNS[next].defaultDirection });
            }}
            aria-label="Sort"
          >
            {activePreset(sort) === null && <option value="custom">Sorted by column</option>}
            <option value="added">Newest first</option>
            <option value="applied">Recently applied</option>
            <option value="fit">Best fit</option>
            <option value="pay">Highest pay</option>
            <option value="company">Company A–Z</option>
          </select>
        </div>
      </div>

      {shown.length > 0 && (
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Pipeline jobs">
      <table className="ledger">
        <thead>
          <tr>
            <SortableHeader label="Role" column="role" sort={sort} defaultDirection={PIPELINE_COLUMNS.role.defaultDirection} onSort={toggle} />
            <SortableHeader label="Search path" column="lane" sort={sort} defaultDirection={PIPELINE_COLUMNS.lane.defaultDirection} onSort={toggle} />
            <SortableHeader label="Pay" column="pay" sort={sort} defaultDirection={PIPELINE_COLUMNS.pay.defaultDirection} onSort={toggle} className="num" />
            <SortableHeader label="Fit" column="fit" sort={sort} defaultDirection={PIPELINE_COLUMNS.fit.defaultDirection} onSort={toggle} className="num" />
            <SortableHeader label="Applied" column="applied" sort={sort} defaultDirection={PIPELINE_COLUMNS.applied.defaultDirection} onSort={toggle} />
            <SortableHeader label="People" column="people" sort={sort} defaultDirection={PIPELINE_COLUMNS.people.defaultDirection} onSort={toggle} />
            <SortableHeader label="Status" column="status" sort={sort} defaultDirection={PIPELINE_COLUMNS.status.defaultDirection} onSort={toggle} />
          </tr>
        </thead>
        <tbody>
          {shown.map((j, i) => (
            <tr
              key={j.id}
              className={[i === cursor ? "cursor" : "", j.liveStatus === "closed" ? "posting-closed" : ""].filter(Boolean).join(" ")}
              tabIndex={0}
              aria-current={i === cursor ? "true" : undefined}
              onClick={() => open(j.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter") open(j.id);
              }}
            >
              <td>
                <span className="l-title">{j.title}</span>
                <span className="l-sub">{j.company}{j.route && ` · ${j.route}`}</span>
                <PipelineSignal job={j} />
                {j.liveStatus === "closed" && <span className="posting-closed-note">{postingClosedCopy(j.status)}</span>}
              </td>
              <td className="l-lane">
                <span>{j.lane || (showPayNotPublished(j, searchPaths.length > 0) ? PAY_NOT_PUBLISHED : "")}</span>
                {j.archivedAt && <span className="path-flag">Archived</span>}
                {j.lane && showPayNotPublished(j, searchPaths.length > 0) && <span className="path-flag">{PAY_NOT_PUBLISHED}</span>}
                {(j.archivedAt || (searchPaths.length > 0 && !j.searchPathId)) && (
                  <span className="path-card-actions">
                    {j.archivedAt && <button type="button" className="btn btn-ghost btn-xs" onClick={(event) => { event.stopPropagation(); void pathAction(j, "restore"); }}>Restore</button>}
                    <button type="button" className="btn btn-ghost btn-xs" onClick={(event) => { event.stopPropagation(); void pathAction(j, "reclassify"); }}>Reclassify</button>
                  </span>
                )}
              </td>
              <td className="num">{formatPay(j, currency)}</td>
              <td className="num">{j.fit.imported && !j.fit.score ? "" : j.fit.score}</td>
              <td className="l-date">{shortDate(j.appliedAt)}</td>
              <td className="l-people">
                {j.contactCount > 0 && <span>{j.contactCount}</span>}
                {j.messagesSent > 0 && <span className="sent">{j.messagesSent} sent</span>}
                {j.replies > 0 && <span className="replied">replied</span>}
              </td>
              <td onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                <select className={`status-pick s-${j.status}`} aria-label={`Status for ${j.title}`} value={j.status} onChange={(e) => setStatus(j, e.target.value as JobStatus)}>
                  {JOB_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      )}
      {!shown.length && (
        <p className="muted pad">{group === "archived" && all.some((job) => job.archivedAt) === false ? "No archived jobs." : all.length ? "Nothing matches those filters." : "No jobs yet. Check a posting, or run a scan, and it shows up here."}</p>
      )}
      <p className="keys">j / k to move · Enter to open · / to search · Esc to close</p>
    </div>
  );
}
