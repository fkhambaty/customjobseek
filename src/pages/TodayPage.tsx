import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { packageAudit } from "../../shared/agency";
import { computeAnalytics, todayQueues } from "../../shared/engine/insights";
import type { JobRecord, Profile } from "../../shared/types";
import { profileReadiness } from "../../shared/validate";
import { api } from "../api";
import { JobLine, type LineMode } from "../components/JobLine";
import { MarketScanConsole } from "../components/MarketScanConsole";
import { useJobs } from "../data";
import { pct, plural, today } from "../format";
import { useSession } from "../session";

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

function Welcome({ greeting, name, profile }: { greeting: string; name: string | undefined; profile: Profile | null }) {
  const { account } = useSession();
  const missing = profile ? profileReadiness(profile) : ["your profile"];
  const ready = missing.length === 0;
  const scanUsed = ready && (account?.scanRuns ?? 1) < 1;
  if (ready) {
    return (
      <div className="page">
        <p className="kicker">Your search starts here</p>
        <h1 className="page-title">{greeting}{name ? `, ${name}` : ""}.</h1>
        <p className="lede today-scan-lede">One scan reads the strongest openings for your roles and prepares the work worth doing next.</p>
        <MarketScanConsole />
        <p className="welcome-note">Prefer to start with one role? <Link to="/jobs/new">Paste a job yourself</Link>.</p>
      </div>
    );
  }
  const steps = [
    { when: ready ? "Done" : "Now", title: "Write what is true", body: ready ? "Your roles, skills and the places you accept are saved." : `Still needed: ${missing.join(", ")}.` },
    { when: !ready || scanUsed ? "Then" : "Now", title: "Let one scan prepare three jobs", body: scanUsed ? "Your free scan has been used." : "The strongest matches get a fit score, a resume and an application pack." },
    { when: "Then", title: "You apply", body: "Read the pack, write to a person if one is named, and send it yourself." },
  ];
  return (
    <div className="page">
      <p className="kicker">Your search starts here</p>
      <h1 className="page-title">{greeting}{name ? `, ${name}` : ""}.</h1>
      <div className="welcome">
        <div>
          <p className="lede">Nothing is on your list yet. Do the step in front of you. The rest can wait.</p>
          <ol className="welcome-steps">
            {steps.map((step, i) => (
              <li key={step.title} className={i === 0 && ready ? "done" : i > 0 && !ready ? "later" : i === 1 && scanUsed ? "done" : ""}>
                <span className="when">{step.when}</span>
                <div>
                  <h2>{step.title}</h2>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="welcome-actions">
            <Link to="/profile" className="btn btn-primary btn-lg">Finish your profile</Link>
          </div>
        </div>
        <div>
          <div className="shot" aria-hidden>
            <div className="shot-bar"><span>Prepared for you</span><span>1 of 3</span></div>
            <div className="shot-body">
              <h3>What one scan gives you</h3>
              <ul className="lines">
                <li className="line">
                  <span className="score score-hi">82</span>
                  <span className="line-main">
                    <span className="line-title">Internal Communications Lead</span>
                    <span className="line-company">Northwind</span>
                    <span className="line-facts"><span>resume ready</span><span>application pack</span><span>people to write to</span></span>
                  </span>
                </li>
              </ul>
            </div>
          </div>
          <p className="welcome-note">The free scan prepares the best three. The other matches stay visible, faded, until you have more packs.</p>
        </div>
      </div>
    </div>
  );
}

export function TodayPage() {
  const { jobs, error, notice, profile } = useJobs();
  const date = today();
  const [handpickedIds, setHandpickedIds] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    api.currentMarketScan()
      .then(({ scan }) => {
        if (scan?.status === "complete" && scan.prepared?.length) {
          setHandpickedIds(new Set(scan.prepared.map((job) => job.id)));
        } else {
          setHandpickedIds(new Set());
        }
      })
      .catch(() => setHandpickedIds(new Set()));
  }, [jobs]);
  const q = useMemo(
    () => (jobs ? todayQueues(jobs, date, { excludeIds: handpickedIds }) : null),
    [jobs, date, handpickedIds],
  );
  const a = useMemo(() => (jobs ? computeAnalytics(jobs, date) : null), [jobs, date]);
  const gaps = useMemo(() => (jobs ? packageAudit(jobs, date) : []), [jobs, date]);

  if (error) return <div className="page"><div className="alert alert-error">{error}</div></div>;
  if (!jobs || !q || !a) return <div className="page"><p className="muted">Loading your search…</p></div>;

  const count = (s: string[]) => jobs.filter((j) => s.includes(j.status)).length;
  const greeting = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening";
  const name = profile?.fullName.split(/\s+/)[0];

  if (!jobs.length) return <Welcome greeting={greeting} name={name} profile={profile} />;

  return (
    <div className="page">
      <div className="page-top">
        <div>
          <p className="kicker">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}{a.dayOfSearch ? ` · day ${a.dayOfSearch} of your search` : ""}</p>
          <h1 className="page-title">{greeting}{name ? `, ${name}` : ""}.</h1>
        </div>
        <Link to="/jobs/new" className="btn btn-ghost">Check a job</Link>
      </div>

      {notice && <div className="alert alert-warn" role="status">{notice}</div>}

      <MarketScanConsole compact />

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
        note={
          handpickedIds.size
            ? "Best fit first, then the higher pay. Roles from your latest scan are listed above, not repeated here."
            : "Best fit first, then the higher pay. Open one, read the resume, apply, and mark it applied."
        }
        empty="Nothing waiting. Check a job or look at Discover for new openings."
      />
      {gaps.length > 0 && (
        <details className="quiet-fold">
          <summary>{gaps.length === 1 ? "1 application pack is still missing a piece" : `${gaps.length} application packs are still missing a piece`}</summary>
          <ul>
            {gaps.slice(0, 8).map((gap) => (
              <li key={gap.id}>
                <Link to={`/pipeline?job=${encodeURIComponent(gap.id)}`}>{gap.title}</Link>
                <span className="muted"> · {gap.company} · {gap.gaps.join(", ")}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
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
