import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useSession } from "../session";

const WEEK = [
  {
    when: "Once",
    title: "Write down what is true about you",
    body: "Your roles and what you did in them, the skills you can defend in an interview, the cities and pay you would accept, and anything you never want a resume to claim.",
  },
  {
    when: "Each job",
    title: "Paste the link, read the verdict",
    body: "Before you spend an evening on a form, you see the fit, the skills you match and the ones you do not, and anything that rules it out: pay under your floor, the wrong city, a title you do not want.",
  },
  {
    when: "Each job",
    title: "Send a resume made for that job",
    body: "Your own lines, picked and ordered so the most relevant work leads. One clean column that an applicant tracking system can read and a person can skim in thirty seconds.",
  },
  {
    when: "After applying",
    title: "Write to a person, then keep count",
    body: "A short note to the hiring manager, drafted from your record. Log it, and the list tells you who to nudge, what to drop and which kinds of roles actually answer.",
  },
];

const WONT = [
  ["Write things you did not do", "There is no AI writing your resume. It selects and orders sentences you wrote. If a line is not in your profile, it is not in the resume."],
  ["Apply on your behalf", "You read each job and you press apply. Mass-applying is how people end up with two hundred silent applications."],
  ["Promise you will beat the bots", "Nobody can. It makes your resume readable and relevant. The rest is the job market."],
  ["Sell or share your data", "Your profile, files and contacts are encrypted and only visible to you. Delete the account and they are gone."],
];

const FAQS: { q: string; a: ReactNode }[] = [
  {
    q: "Does it look for new jobs on its own?",
    a: (
      <>
        Yes, every hour, all day. It reads the next batch of career boards each hour, oldest first, so every board is
        refreshed a few times a day. You can see <Link to="/companies">every company it scans</Link> and when each was
        last read. Matches for your target titles appear on your Discover page.
      </>
    ),
  },
  {
    q: "Which websites does it read?",
    a: (
      <>
        Public employer boards on Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Workday, Teamtailor, Recruitee, Breezy, and company career sites.
        iCIMS, Oracle Recruiting, and SAP SuccessFactors are recognized on the <Link to="/companies">list</Link> and not
        scanned. LinkedIn, Indeed, Naukri, SEEK and similar job boards are not read. Paste the employer's posting, or the description.
      </>
    ),
  },
  {
    q: "What if it missed a company?",
    a: (
      <>
        Paste the employer's career page on the <Link to="/companies">Companies</Link> page. A public board we can read
        is scanned then. A job-board link is saved and not scanned.
      </>
    ),
  },
  {
    q: "Where are my resumes kept?",
    a: "On your Resumes page: the general one built from your profile, any you uploaded, and the one made for each job. Each opens as a page you can save as a PDF.",
  },
  {
    q: "Does it work outside India?",
    a: "Yes. India, the United States, the United Kingdom, Canada, Australia, Singapore, New Zealand, Ireland, and South Africa are listed first. Any other country still works, and you can type any job title. Pay is only compared when the job uses your currency. Nothing is converted by guesswork.",
  },
  {
    q: "Who can see my data?",
    a: "Only you. Profiles, resumes, notes and contacts are encrypted before they are stored, and deleting your account removes all of it.",
  },
];

function Faq() {
  const location = useLocation();
  useEffect(() => {
    if (location.hash === "#faq") document.getElementById("faq")?.scrollIntoView();
  }, [location.hash]);
  return (
    <section id="faq" className="section essay">
      <h2 className="section-title">Questions</h2>
      <div className="faq">
        {FAQS.map((f) => (
          <details key={f.q} className="faq-item">
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function Shot() {
  const rows = [
    { score: 82, title: "Senior Analytics Engineer", company: "Northwind Retail", facts: ["Pune · above floor", "₹38–46L", "posted 3 days ago"], action: "Apply ↗" },
    { score: 71, title: "Data Platform Lead", company: "Harbour Health", facts: ["Remote", "~₹52L", "2 people saved"], action: "Write message" },
    { score: 64, title: "BI Manager", company: "Kestrel Logistics", facts: ["Bengaluru · above floor", "applied 2 Oct", "messaged 9 days ago"], action: "Send nudge" },
  ];
  return (
    <div className="shot" aria-hidden>
      <div className="shot-bar">
        <span>Today · Tuesday 13 October</span>
        <span>day 43 of your search</span>
      </div>
      <div className="shot-body">
        <h3>Apply next, then message, then nudge</h3>
        <ul className="lines">
          {rows.map((r) => (
            <li className="line" key={r.title}>
              <span className={`score score-${r.score >= 70 ? "hi" : "mid"}`}>{r.score}</span>
              <span className="line-main">
                <span className="line-title">{r.title}</span>
                <span className="line-company">{r.company}</span>
                <span className="line-facts">{r.facts.map((f) => <span key={f}>{f}</span>)}</span>
              </span>
              <span className="line-actions"><span className="btn btn-ghost btn-sm">{r.action}</span></span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function Landing() {
  const { account } = useSession();
  const cta = account ? "/today" : "/signup";
  return (
    <>
      <section className="hero">
        <div className="hero-inner">
          <div>
            <p className="kicker">A job search you can keep track of</p>
            <h1>
              Apply to fewer jobs.
              <br />
              <em>Hear back from more.</em>
            </h1>
            <p className="lede">
              CustomJobSeek reads a job before you do, tells you plainly whether it is worth it, and gives you a resume made
              from your own record for that one job. Then it keeps the list: who to write to, who to nudge, and what is
              actually getting answers.
            </p>
            <div className="hero-cta">
              <Link to={cta} className="btn btn-primary btn-lg">{account ? "Open your search" : "Start free"}</Link>
              <span className="hero-note">3 fit checks and a resume, no card.</span>
            </div>
          </div>
          <Shot />
        </div>
      </section>

      <section className="section essay">
        <h2 className="section-title">How a week goes</h2>
        <ol className="week">
          {WEEK.map((w) => (
            <li key={w.title}>
              <span className="when">{w.when}</span>
              <div>
                <h3>{w.title}</h3>
                <p>{w.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="section essay">
        <h2 className="section-title">What it will not do</h2>
        <ul className="wont">
          {WONT.map(([t, b]) => (
            <li key={t}><strong>{t}</strong>{b}</li>
          ))}
        </ul>
      </section>

      <Faq />

      <section className="section closing">
        <h2>The same resume sent to every job is the reason most applications go quiet.</h2>
        <Link to={cta} className="btn btn-primary btn-lg">{account ? "Open your search" : "Make your profile"}</Link>
      </section>
    </>
  );
}
