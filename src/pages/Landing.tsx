import { Link } from "react-router-dom";
import { useSession } from "../session";

const STEPS = [
  {
    n: "1",
    title: "Tell it the truth once",
    body: "Your roles, achievements and skills, plus the cities, pay and titles you will accept. Add anything you never want claimed.",
  },
  {
    n: "2",
    title: "Paste a job",
    body: "Drop in a link or the description. You get a fit score, the skills you match, the gaps, and any deal-breakers, before you spend an evening on it.",
  },
  {
    n: "3",
    title: "Get a resume for that job",
    body: "A clean, ATS-friendly resume that leads with your most relevant work. Every line comes from your own profile. Nothing is invented.",
  },
];

const PROMISES = [
  ["No invented claims", "The resume reorders and selects what you wrote. It never paraphrases you into skills you do not have."],
  ["Deal-breakers first", "Salary below your floor, the wrong city, a title you ruled out: you see it before you apply, not after the interview."],
  ["Readable by people and parsers", "Single-column, real text, standard headings. It prints to a two-page PDF that applicant tracking systems can read."],
  ["Every application tracked", "Status, notes and a follow-up date for each job, so nothing quietly goes cold."],
];

function SampleFit() {
  return (
    <div className="sample-card" aria-hidden>
      <div className="sample-head">
        <div>
          <div className="sample-title">Senior Analytics Engineer</div>
          <div className="muted small">Acme Retail · Pune / Hybrid · ₹38–46 LPA</div>
        </div>
        <div className="score-ring" style={{ ["--p" as string]: 82 }}>
          <span>82</span>
        </div>
      </div>
      <div className="decision decision-apply">Apply: strong fit, no deal-breakers</div>
      <div className="sample-row">
        <span className="label">You match</span>
        <span className="chips">
          {["SQL", "dbt", "Snowflake", "Data Modelling", "Airflow"].map((s) => (
            <span key={s} className="chip chip-ok">{s}</span>
          ))}
        </span>
      </div>
      <div className="sample-row">
        <span className="label">Gaps</span>
        <span className="chips">
          <span className="chip chip-gap">Looker</span>
        </span>
      </div>
    </div>
  );
}

export function Landing() {
  const { account } = useSession();
  const cta = account ? "/jobs/new" : "/signup";
  return (
    <>
      <section className="hero">
        <div className="hero-inner">
          <div className="hero-copy">
            <span className="eyebrow">Your job search, done properly</span>
            <h1>
              Jobs that fit.
              <br />
              <span className="accent">A resume made for each one.</span>
            </h1>
            <p className="lede">
              Paste a job. Get an honest fit decision and a tailored, ATS-friendly resume built only from your verified
              experience. Then track it until you hear back.
            </p>
            <div className="hero-cta">
              <Link to={cta} className="btn btn-primary btn-lg">
                {account ? "Check a job" : "Start free: 3 checks, 1 resume"}
              </Link>
              <a href="#how" className="btn btn-ghost btn-lg">
                How it works
              </a>
            </div>
            <p className="muted small">No card needed. Your data is encrypted and you can delete it any time.</p>
          </div>
          <SampleFit />
        </div>
      </section>

      <section id="how" className="section">
        <h2 className="section-title">Three steps, about ten minutes the first time</h2>
        <div className="steps">
          {STEPS.map((s) => (
            <div className="step" key={s.n}>
              <span className="step-n">{s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section section-alt">
        <h2 className="section-title">Built on rules, not hype</h2>
        <div className="promises">
          {PROMISES.map(([t, b]) => (
            <div className="promise" key={t}>
              <h3>{t}</h3>
              <p>{b}</p>
            </div>
          ))}
        </div>
        <p className="disclaimer">
          No tool can promise you get past every screening system or land an interview. This one makes sure every
          application you send is relevant, truthful and easy to read.
        </p>
      </section>

      <section className="section cta-band">
        <h2>Stop sending the same resume to every job.</h2>
        <Link to={cta} className="btn btn-primary btn-lg">
          {account ? "Check a job" : "Create your free profile"}
        </Link>
      </section>
    </>
  );
}
