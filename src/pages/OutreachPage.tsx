import { useEffect, useMemo, useState } from "react";
import { todayQueues } from "../../shared/engine/insights";
import { api, type Activity, type Person } from "../api";
import { statusLabel } from "../components/FitCard";
import { CompanyThreads } from "../components/CompanyThreads";
import { JobLine } from "../components/JobLine";
import { useJobs } from "../data";
import { shortDate, today } from "../format";

type View = "send" | "companies" | "log" | "people";

export function OutreachPage() {
  const { jobs, error, notice, open } = useJobs();
  const [view, setView] = useState<View>("send");
  const [activity, setActivity] = useState<Activity[] | null>(null);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [query, setQuery] = useState("");
  const q = useMemo(() => (jobs ? todayQueues(jobs, today()) : null), [jobs]);

  useEffect(() => {
    if (view === "log" && activity === null) api.activity().then(setActivity, () => setActivity([]));
    if (view === "people" && people === null) api.people().then(setPeople, () => setPeople([]));
  }, [view, activity, people]);

  useEffect(() => {
    setActivity(null);
  }, [jobs]);

  const filteredPeople = (people ?? []).filter((p) => {
    const s = query.trim().toLowerCase();
    return !s || `${p.contact.name} ${p.contact.email} ${p.company} ${p.title}`.toLowerCase().includes(s);
  });

  if (error && !jobs) {
    return (
      <div className="page">
        <h1 className="page-title">Outreach</h1>
        <div className="alert alert-error" role="alert">{error}</div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-top">
        <div>
          <h1 className="page-title">Outreach</h1>
          <p className="lede">Applications go into a pile. A short note to a named person gets read. This is where you keep that honest.</p>
        </div>
      </div>
      {notice && <div className="alert alert-warn" role="status">{notice}</div>}
      <div className="seg" role="group" aria-label="Outreach">
        <button type="button" className={view === "send" ? "on" : ""} aria-pressed={view === "send"} aria-current={view === "send" ? "true" : undefined} onClick={() => setView("send")}>To send <span>{q ? q.messageNow.length + q.nudge.length : ""}</span></button>
        <button type="button" className={view === "companies" ? "on" : ""} aria-pressed={view === "companies"} aria-current={view === "companies" ? "true" : undefined} onClick={() => setView("companies")}>Companies</button>
        <button type="button" className={view === "log" ? "on" : ""} aria-pressed={view === "log"} aria-current={view === "log" ? "true" : undefined} onClick={() => setView("log")}>Sent and replies</button>
        <button type="button" className={view === "people" ? "on" : ""} aria-pressed={view === "people"} aria-current={view === "people" ? "true" : undefined} onClick={() => setView("people")}>People</button>
      </div>

      {view === "send" && q && (
        <>
          <section className="queue">
            <header>
              <h2>First message <span className="n">{q.messageNow.length}</span></h2>
              <p>Each one has a note, a first message and an email written from your profile. Open it, copy, send, log.</p>
            </header>
            {q.messageNow.length ? (
              <ul className="lines">{q.messageNow.map((j) => <JobLine key={j.id} job={j} mode="message" />)}</ul>
            ) : (
              <p className="queue-empty">Nobody waiting for a first message.</p>
            )}
          </section>
          {q.nudge.length > 0 && (
            <section className="queue">
              <header>
                <h2>One nudge <span className="n">{q.nudge.length}</span></h2>
                <p>Messaged over a week ago with no answer.</p>
              </header>
              <ul className="lines">{q.nudge.map((j) => <JobLine key={j.id} job={j} mode="nudge" />)}</ul>
            </section>
          )}
          {q.needContact > 0 && (
            <p className="muted">
              {q.needContact} recent applications have no named person. Open one, go to People &amp; messages, and add the hiring manager or recruiter when you find them.
            </p>
          )}
        </>
      )}

      {view === "companies" && <CompanyThreads />}

      {view === "log" && (
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Sent messages and replies">
          <table className="ledger">
            <thead>
              <tr><th scope="col">Date</th><th scope="col">What</th><th scope="col">Who</th><th scope="col">Role</th></tr>
            </thead>
            <tbody>
              {(activity ?? []).map((a) => (
                <tr
                  key={a.id}
                  tabIndex={0}
                  onClick={() => open(a.jobId, "history")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") open(a.jobId, "history");
                  }}
                >
                  <td className="l-date">{shortDate(a.at)}</td>
                  <td>{a.kind === "message" ? `Sent${a.channel ? ` · ${a.channel}` : ""}` : a.kind === "reply" ? <strong>Reply</strong> : "Note"}</td>
                  <td>{a.person || <span className="muted">–</span>}{a.note && <span className="l-sub">{a.note}</span>}</td>
                  <td><span className="l-title">{a.title}</span><span className="l-sub">{a.company}</span></td>
                </tr>
              ))}
            </tbody>
            {activity?.length === 0 && <caption className="muted">Nothing logged yet. Use “Log as sent” on a job's People &amp; messages tab.</caption>}
          </table>
        </div>
      )}

      {view === "people" && (
        <>
          <input className="search" aria-label="Search people or companies" placeholder="Search people or companies" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="table-scroll" tabIndex={0} role="region" aria-label="People">
          <table className="ledger">
            <thead>
              <tr><th scope="col">Person</th><th scope="col">Company and role</th><th scope="col">Status</th><th scope="col"><span className="clip">Profile</span></th></tr>
            </thead>
            <tbody>
              {filteredPeople.map((p) => (
                <tr
                  key={`${p.jobId}-${p.contact.id}`}
                  tabIndex={0}
                  onClick={() => open(p.jobId, "people")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") open(p.jobId, "people");
                  }}
                >
                  <td>
                    <span className="l-title">{p.contact.name || p.contact.email}</span>
                    {p.contact.role && <span className="l-sub">{p.contact.role}</span>}
                  </td>
                  <td><span className="l-title">{p.company}</span><span className="l-sub">{p.title}</span></td>
                  <td>{statusLabel(p.status)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {p.contact.url && <a href={p.contact.url} target="_blank" rel="noreferrer">Profile ↗</a>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {people === null && <p className="muted">Loading…</p>}
        </>
      )}
    </div>
  );
}
