import { useEffect, useMemo, useRef, useState } from "react";
import { rowEvidence } from "../../shared/agency";
import { payMid } from "../../shared/engine/insights";
import { JOB_STATUSES, type JobRecord, type JobStatus } from "../../shared/types";
import { api } from "../api";
import { statusLabel } from "../components/FitCard";
import { useJobs } from "../data";
import { formatPay, shortDate, today } from "../format";

type SortKey = "added" | "applied" | "score" | "pay" | "company";

const GROUPS: { id: string; label: string; statuses: JobStatus[] }[] = [
  { id: "all", label: "All", statuses: [...JOB_STATUSES] },
  { id: "todo", label: "To apply", statuses: ["evaluated", "resume_ready"] },
  { id: "applied", label: "Applied", statuses: ["applied"] },
  { id: "live", label: "Interviewing", statuses: ["interview", "offer"] },
  { id: "rejected", label: "Rejected", statuses: ["rejected"] },
  { id: "closed", label: "Closed", statuses: ["closed", "withdrawn"] },
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

function sorter(key: SortKey): (a: JobRecord, b: JobRecord) => number {
  switch (key) {
    case "added":
      return (a, b) => b.createdAt.localeCompare(a.createdAt);
    case "applied":
      return (a, b) => (b.appliedAt ?? "").localeCompare(a.appliedAt ?? "");
    case "score":
      return (a, b) => b.fit.score - a.fit.score;
    case "pay":
      return (a, b) => (payMid(b) ?? 0) - (payMid(a) ?? 0);
    case "company":
      return (a, b) => a.company.localeCompare(b.company);
    default: {
      const never: never = key;
      return never;
    }
  }
}

export function PipelinePage() {
  const { jobs, error, notice, put, open, currency } = useJobs();
  const [group, setGroup] = useState("all");
  const [query, setQuery] = useState("");
  const [lane, setLane] = useState("");
  const [family, setFamily] = useState("");
  const [route, setRoute] = useState("");
  const [sort, setSort] = useState<SortKey>("added");
  const [cursor, setCursor] = useState(0);
  const search = useRef<HTMLInputElement>(null);

  const all = jobs ?? [];
  const shown = useMemo(() => {
    const g = GROUPS.find((x) => x.id === group)!;
    const q = query.trim().toLowerCase();
    return all
      .filter((j) => g.statuses.includes(j.status))
      .filter((j) => !lane || j.lane === lane)
      .filter((j) => !family || j.family === family)
      .filter((j) => !route || j.route === route)
      .filter((j) => !q || `${j.title} ${j.company} ${j.location} ${j.requisition}`.toLowerCase().includes(q))
      .sort(sorter(sort));
  }, [all, group, query, lane, family, route, sort]);

  useEffect(() => setCursor(0), [group, query, lane, family, route, sort]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
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

  const counts = (statuses: JobStatus[]) => all.filter((j) => statuses.includes(j.status)).length;

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
              {g.label} <span>{counts(g.statuses)}</span>
            </button>
          ))}
        </div>
        <div className="filter-row">
          <input ref={search} className="search" aria-label="Search title, company, or reference" placeholder="Search title, company, reference   /" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select value={lane} onChange={(e) => setLane(e.target.value)} aria-label="Lane">
            <option value="">Every lane</option>
            {uniq(all.map((j) => j.lane)).map((l) => <option key={l}>{l}</option>)}
          </select>
          <select value={family} onChange={(e) => setFamily(e.target.value)} aria-label="Role family">
            <option value="">Every role type</option>
            {uniq(all.map((j) => j.family)).map((l) => <option key={l}>{l}</option>)}
          </select>
          <select value={route} onChange={(e) => setRoute(e.target.value)} aria-label="Route">
            <option value="">Every route</option>
            {uniq(all.map((j) => j.route)).map((l) => <option key={l}>{l}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort">
            <option value="added">Newest first</option>
            <option value="applied">Recently applied</option>
            <option value="score">Best fit</option>
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
            <th scope="col">Role</th>
            <th scope="col">Lane</th>
            <th scope="col" className="num">Pay</th>
            <th scope="col" className="num">Fit</th>
            <th scope="col">Applied</th>
            <th scope="col">People</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((j, i) => (
            <tr
              key={j.id}
              className={i === cursor ? "cursor" : ""}
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
              </td>
              <td className="l-lane">{j.lane}</td>
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
        <p className="muted pad">{all.length ? "Nothing matches those filters." : "No jobs yet. Check a posting, or run a scan, and it shows up here."}</p>
      )}
      <p className="keys">j / k to move · Enter to open · / to search · Esc to close</p>
    </div>
  );
}
