import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { computeAnalytics, todayQueues } from "../../shared/engine/insights";
import type { JobRecord } from "../../shared/types";
import { JobLine, type LineMode } from "../components/JobLine";
import { useJobs } from "../data";
import { pct, plural, today } from "../format";

const PREVIEW = 6;

function Queue({ title, note, jobs, mode, empty }: { title: string; note: ReactNode; jobs: JobRecord[]; mode: LineMode; empty?: string }) {
  const [all, setAll] = useState(false);
  if (!jobs.length && !empty) return null;
  const shown = all ? jobs : jobs.slice(0, PREVIEW);
  return (
    <section className="queue">
      <header>
        <h2>{title} <span className="n">{jobs.length}</span></h2>
        <p>{note}</p>
      </header>
      {jobs.length ? (
        <ul className="lines">{shown.map((j) => <JobLine key={j.id} job={j} mode={mode} />)}</ul>
      ) : (
        <p className="queue-empty">{empty}</p>
      )}
      {jobs.length > PREVIEW && (
        <button className="linkish more" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${jobs.length}`}</button>
      )}
    </section>
  );
}

export function TodayPage() {
  const { jobs, error, profile } = useJobs();
  const date = today();
  const q = useMemo(() => (jobs ? todayQueues(jobs, date) : null), [jobs, date]);
  const a = useMemo(() => (jobs ? computeAnalytics(jobs, date) : null), [jobs, date]);

  if (error) return <div className="page"><div className="alert alert-error">{error}</div></div>;
  if (!jobs || !q || !a) return <div className="page"><p className="muted">Loading your search…</p></div>;

  const count = (s: string[]) => jobs.filter((j) => s.includes(j.status)).length;
  const greeting = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening";
  const name = profile?.fullName.split(/\s+/)[0];

  if (!jobs.length) {
    return (
      <div className="page">
        <h1 className="page-title">{greeting}{name ? `, ${name}` : ""}.</h1>
        <div className="first-run">
          <p>Nothing on your list yet. Start with a job you were going to apply for anyway.</p>
          <ol>
            <li><Link to="/profile">Fill in your profile</Link>: your roles, achievements and the pay and places you accept.</li>
            <li><Link to="/jobs/new">Check a job</Link>: paste a link and see the fit before you spend an evening on it.</li>
            <li>Or browse <Link to="/discover">openings we found for you</Link> on the career pages we scan.</li>
          </ol>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-top">
        <div>
          <p className="kicker">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}{a.dayOfSearch ? ` · day ${a.dayOfSearch} of your search` : ""}</p>
          <h1 className="page-title">{greeting}{name ? `, ${name}` : ""}.</h1>
        </div>
        <Link to="/jobs/new" className="btn btn-ghost">Check a job</Link>
      </div>

      <dl className="tally">
        <div><dt>To apply</dt><dd>{count(["evaluated", "resume_ready"])}</dd></div>
        <div><dt>Applied</dt><dd>{count(["applied"])}</dd></div>
        <div><dt>Interviewing</dt><dd>{count(["interview", "offer"])}</dd></div>
        <div><dt>Rejected</dt><dd>{count(["rejected"])}</dd></div>
        <div><dt>Closed</dt><dd>{count(["closed", "withdrawn"])}</dd></div>
        <div><dt>Messages to send</dt><dd>{q.messageNow.length}</dd></div>
      </dl>

      <Queue
        title="In conversation"
        mode="live"
        jobs={q.live}
        note="A live conversation is worth more than ten new applications. Prepare for these first."
      />
      <Queue
        title="Follow-ups due"
        mode="due"
        jobs={q.due}
        note="Dates you set yourself. Do these, then set the next one."
      />
      <Queue
        title="Apply next"
        mode="apply"
        jobs={q.applyNext}
        note="Best fit first, then the higher pay. Open one, read the resume, apply, and mark it applied."
        empty="Nothing waiting. Check a job or look at Discover for new openings."
      />
      <Queue
        title="Message now"
        mode="message"
        jobs={q.messageNow}
        note={
          <>
            Applied in the last 30 days, with a person you can name, and nothing sent yet. One conversation per company, highest pay first.
            {q.needContact > 0 && ` ${plural(q.needContact, "more has", "more have")} no contact saved yet.`}
          </>
        }
      />
      <Queue
        title="Nudge once"
        mode="nudge"
        jobs={q.nudge}
        note="You messaged someone over a week ago and heard nothing. One short follow-up, then let it go."
      />

      <section className="funnel-line">
        <p>
          <strong>{a.submitted}</strong> applications, <strong>{a.answered}</strong> answered ({pct(a.answered, a.submitted)}),{" "}
          <strong>{a.interviews}</strong> interviewing ({pct(a.interviews, a.submitted)}).{" "}
          {a.messaged > 0 ? `${plural(a.messaged, "role")} where you messaged a person, ${a.messageReplies} replied.` : "No messages logged yet."}{" "}
          <Link to="/analytics">See what is working</Link>
        </p>
      </section>
    </div>
  );
}
