import { useMemo } from "react";
import { agencyOutcomes, type SourceEffect } from "../../shared/agency";
import { computeAnalytics, type Analytics } from "../../shared/engine/insights";
import { BreakdownTable, Columns, Legend, Rows, WeeksChart } from "../components/Charts";
import { SortableHeader } from "../components/SortableHeader";
import { useJobs } from "../data";
import { pct, today } from "../format";
import { rowsInTableOrder, type ColumnMap } from "../tableSort";
import { useTableSort } from "../useTableSort";

type TargetingRow = Analytics["targeting"][number];
type SourceSortKey = "source" | "sent" | "replied" | "interviews" | "replyRate" | "interviewRate";
type RejectionSortKey = "family" | "sent" | "rejected" | "interviews" | "rejectionRate" | "queued";

function rate(part: number, whole: number): number | null {
  if (!whole) return null;
  return part / whole;
}

const SOURCE_COLUMNS: ColumnMap<SourceEffect, SourceSortKey> = {
  source: { key: "source", kind: "string", defaultDirection: "asc", value: (row) => row.source },
  sent: { key: "sent", kind: "number", defaultDirection: "desc", value: (row) => row.sent },
  replied: { key: "replied", kind: "number", defaultDirection: "desc", value: (row) => row.replied },
  interviews: { key: "interviews", kind: "number", defaultDirection: "desc", value: (row) => row.interviews },
  replyRate: { key: "replyRate", kind: "number", defaultDirection: "desc", value: (row) => rate(row.replied, row.sent) },
  interviewRate: { key: "interviewRate", kind: "number", defaultDirection: "desc", value: (row) => rate(row.interviews, row.sent) },
};

const REJECTION_COLUMNS: ColumnMap<TargetingRow, RejectionSortKey> = {
  family: { key: "family", kind: "string", defaultDirection: "asc", value: (row) => row.key },
  sent: { key: "sent", kind: "number", defaultDirection: "desc", value: (row) => row.sent },
  rejected: { key: "rejected", kind: "number", defaultDirection: "desc", value: (row) => row.rejected },
  interviews: { key: "interviews", kind: "number", defaultDirection: "desc", value: (row) => row.interviews },
  rejectionRate: { key: "rejectionRate", kind: "number", defaultDirection: "desc", value: (row) => rate(row.rejected, row.sent) },
  queued: { key: "queued", kind: "number", defaultDirection: "desc", value: (row) => row.queued },
};

function Figure({ label, value, note, tone }: { label: string; value: string | number; note: string; tone?: "good" | "bad" }) {
  return (
    <div className="figure">
      <dt>{label}</dt>
      <dd className={tone}>{value}</dd>
      <p>{note}</p>
    </div>
  );
}

export function AnalyticsPage() {
  const { jobs, error, notice } = useJobs();
  const a = useMemo(() => (jobs ? computeAnalytics(jobs, today()) : null), [jobs]);
  const outcomes = useMemo(() => (jobs ? agencyOutcomes(jobs, today()) : null), [jobs]);
  const { sort: sourceSort, toggle: toggleSource } = useTableSort<SourceSortKey>({ key: "sent", direction: SOURCE_COLUMNS.sent.defaultDirection });
  const { sort: rejectionSort, toggle: toggleRejection } = useTableSort<RejectionSortKey>({ key: "sent", direction: REJECTION_COLUMNS.sent.defaultDirection });
  const sources = useMemo(() => rowsInTableOrder("application", outcomes?.sources ?? [], SOURCE_COLUMNS, sourceSort), [outcomes, sourceSort]);
  const rejections = useMemo(() => rowsInTableOrder("application", a?.targeting ?? [], REJECTION_COLUMNS, rejectionSort), [a, rejectionSort]);
  if (error && !jobs) {
    return (
      <div className="page">
        <h1 className="page-title">Analytics</h1>
        <div className="alert alert-error" role="alert">{error}</div>
      </div>
    );
  }
  if (!a || !outcomes) return <div className="page"><p className="muted">Loading…</p></div>;
  if (!a.submitted) {
    return (
      <div className="page">
        <h1 className="page-title">Analytics</h1>
        {notice && <div className="alert alert-warn" role="status">{notice}</div>}
        <p className="lede">Mark a few jobs as applied and this page starts telling you which lanes, routes and role types answer.</p>
      </div>
    );
  }
  const answeredRate = a.answered / a.submitted;
  return (
    <div className="page page-wide">
      <div className="page-top">
        <div>
          <h1 className="page-title">What is working</h1>
          <p className="lede">Worked out from your own {a.submitted} applications. Nothing here is a benchmark from anyone else.</p>
        </div>
      </div>
      {notice && <div className="alert alert-warn" role="status">{notice}</div>}

      <dl className="figures">
        <Figure label="Last 7 days" value={a.last7} note={`applications · ${a.last30} in 30 days`} />
        <Figure label="Employers answered" value={pct(a.answered, a.submitted)} note={`${a.answered} of ${a.submitted}, including rejections`} />
        <Figure label="Interview rate" value={pct(a.interviews, a.submitted)} note={`${a.interviews} in conversation now`} tone={a.interviews ? "good" : undefined} />
        <Figure label="Reached a person" value={pct(a.messaged, a.submitted)} note={`${a.messaged} messaged · ${a.messageReplies} replied`} tone={a.messaged / a.submitted < 0.1 ? "bad" : undefined} />
        <Figure label="Days to a no" value={a.medianDaysToRejection ?? "–"} note={`median, from ${a.datedRejections} dated rejections`} />
        <Figure label="Resumes ready" value={`${a.openWithResume}/${a.openTotal}`} note="open roles with a resume" />
      </dl>

      {a.insights.length > 0 && (
        <aside className="insights">
          <h2>Read this first</h2>
          <ul>{a.insights.map((t) => <li key={t}>{t}</li>)}</ul>
          {answeredRate < 0.2 && <p className="muted">Under one in five answered. Fewer, better-matched applications plus a message to a person usually beat volume.</p>}
        </aside>
      )}

      <section className="panel">
        <header>
          <h2>Source effectiveness</h2>
          <p>
            Median silence {outcomes.medianSilenceDays ?? "–"} days
            {" · "}message reply rate {outcomes.replyRate === null ? "–" : pct(outcomes.messageReplies, outcomes.messaged)}
            {" · "}interview rate {outcomes.interviewRate === null ? "–" : pct(outcomes.interviews, outcomes.submitted)}
            {" · "}median days to a no {outcomes.medianRejectionDays ?? "–"}.
            These are only your own applications.
          </p>
        </header>
        {outcomes.sources.length ? (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Source effectiveness">
          <table className="ledger compact">
            <caption>Heard back counts applications where you logged at least one reply. It is not a count of messages, and it is not the job board answering.</caption>
            <thead>
              <tr>
                <SortableHeader label="Source" column="source" sort={sourceSort} defaultDirection={SOURCE_COLUMNS.source.defaultDirection} onSort={toggleSource} />
                <SortableHeader label="Sent" column="sent" sort={sourceSort} defaultDirection={SOURCE_COLUMNS.sent.defaultDirection} onSort={toggleSource} className="num" />
                <SortableHeader label="Heard back" column="replied" sort={sourceSort} defaultDirection={SOURCE_COLUMNS.replied.defaultDirection} onSort={toggleSource} className="num" />
                <SortableHeader label="Interviews" column="interviews" sort={sourceSort} defaultDirection={SOURCE_COLUMNS.interviews.defaultDirection} onSort={toggleSource} className="num" />
                <SortableHeader label="Heard-back rate" column="replyRate" sort={sourceSort} defaultDirection={SOURCE_COLUMNS.replyRate.defaultDirection} onSort={toggleSource} className="num" />
                <SortableHeader label="Interview rate" column="interviewRate" sort={sourceSort} defaultDirection={SOURCE_COLUMNS.interviewRate.defaultDirection} onSort={toggleSource} className="num" />
              </tr>
            </thead>
            <tbody>
              {sources.map((row) => (
                <tr key={row.source}>
                  <td>{row.source}</td>
                  <td className="num">{row.sent}</td>
                  <td className="num">{row.replied}</td>
                  <td className="num">{row.interviews}</td>
                  <td className="num">{pct(row.replied, row.sent)}</td>
                  <td className="num">{pct(row.interviews, row.sent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        ) : (
          <p className="muted">No applications yet.</p>
        )}
      </section>

      <section className="panel">
        <header><h2>Applications per week, by what happened</h2><Legend /></header>
        <WeeksChart weeks={a.weeks} />
      </section>

      <div className="panels-2">
        <section className="panel"><header><h2>By lane</h2></header><BreakdownTable rows={a.byLane} label="Lane" /></section>
        <section className="panel"><header><h2>By where you applied</h2></header><BreakdownTable rows={a.byRoute} label="Route" /></section>
        <section className="panel"><header><h2>By fit score</h2></header><BreakdownTable rows={a.byFit} label="Fit" /></section>
        <section className="panel"><header><h2>By role type</h2></header><BreakdownTable rows={a.byFamily} label="Role type" /></section>
        <section className="panel">
          <header><h2>Silent applications by age</h2><p>Nudge once at a week. Past a month, treat it as closed.</p></header>
          <Columns buckets={a.silentAges} tone="wait" />
        </section>
        <section className="panel">
          <header><h2>How long a no takes</h2><p>Days from applying to the rejection.</p></header>
          <Columns buckets={a.rejectionDays} tone="bad" />
        </section>
        <section className="panel">
          <header><h2>Reaching a person</h2><p>Open applications, from a named contact to a reply.</p></header>
          <Rows buckets={a.humanFunnel} />
        </section>
        <section className="panel">
          <header><h2>Asked for, not in your profile</h2><p>Gaps to learn or to answer honestly. Never to claim.</p></header>
          {a.skillGaps.length ? <Rows buckets={a.skillGaps} unit="jobs" /> : <p className="muted">No gaps recorded yet.</p>}
        </section>
      </div>

      <section className="panel">
        <header>
          <h2>Where the rejections came from</h2>
          <p>Role types from the job title. A high rejection rate with no interviews is a sign to stop applying to that type.</p>
        </header>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Rejections by role type">
        <table className="ledger compact">
          <thead>
            <tr>
              <SortableHeader label="Role type" column="family" sort={rejectionSort} defaultDirection={REJECTION_COLUMNS.family.defaultDirection} onSort={toggleRejection} />
              <SortableHeader label="Sent" column="sent" sort={rejectionSort} defaultDirection={REJECTION_COLUMNS.sent.defaultDirection} onSort={toggleRejection} className="num" />
              <SortableHeader label="Rejected" column="rejected" sort={rejectionSort} defaultDirection={REJECTION_COLUMNS.rejected.defaultDirection} onSort={toggleRejection} className="num" />
              <SortableHeader label="Interviews" column="interviews" sort={rejectionSort} defaultDirection={REJECTION_COLUMNS.interviews.defaultDirection} onSort={toggleRejection} className="num" />
              <SortableHeader label="Rejection rate" column="rejectionRate" sort={rejectionSort} defaultDirection={REJECTION_COLUMNS.rejectionRate.defaultDirection} onSort={toggleRejection} className="num" />
              <SortableHeader label="Waiting to apply" column="queued" sort={rejectionSort} defaultDirection={REJECTION_COLUMNS.queued.defaultDirection} onSort={toggleRejection} className="num" />
            </tr>
          </thead>
          <tbody>
            {rejections.map((r) => (
              <tr key={r.key}>
                <td>{r.key}</td>
                <td className="num">{r.sent}</td>
                <td className="num">{r.rejected}</td>
                <td className={r.interviews ? "num good" : "num"}>{r.interviews}</td>
                <td className="num">{pct(r.rejected, r.sent)}</td>
                <td className="num">{r.queued || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>
    </div>
  );
}
