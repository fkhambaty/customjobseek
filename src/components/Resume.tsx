import type { TailoredResume } from "../../shared/types";
import "./resume.css";

function dates(start: string, end: string): string {
  return [start, end].filter(Boolean).join(" – ");
}

export function Resume({ resume }: { resume: TailoredResume }) {
  return (
    <article className="resume">
      <header>
        <h1>{resume.fullName}</h1>
        {resume.headline && <div className="headline">{resume.headline}</div>}
        {resume.contact.length > 0 && <div className="contact">{resume.contact.join("  |  ")}</div>}
      </header>

      {resume.summary && (
        <section>
          <h2>Profile</h2>
          <p>{resume.summary}</p>
        </section>
      )}

      {resume.coreStrengths.length > 0 && (
        <section>
          <h2>Core Strengths</h2>
          <p>{resume.coreStrengths.join("  •  ")}</p>
        </section>
      )}

      {resume.roles.length > 0 && (
        <section>
          <h2>Professional Experience</h2>
          {resume.roles.map((r) => (
            <div className="job" key={r.experienceId}>
              <div className="job-header">
                <span className="job-title">
                  {r.title}
                  {r.company && <span className="job-company">, {r.company}</span>}
                </span>
                <span className="job-date">{dates(r.start, r.end)}</span>
              </div>
              {r.location && <div className="subrole">{r.location}</div>}
              <ul>
                {r.bullets.map((b) => (
                  <li key={b.id}>{b.text}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {resume.skills.length > 0 && (
        <section>
          <h2>Skills</h2>
          <p>{resume.skills.join(", ")}</p>
        </section>
      )}

      {resume.education.length > 0 && (
        <section>
          <h2>Education</h2>
          {resume.education.map((e) => (
            <p key={e.id}>
              <strong>{e.degree}</strong>
              {e.institution && `, ${e.institution}`}
              {e.year && ` (${e.year})`}
            </p>
          ))}
        </section>
      )}

      {resume.certifications.length > 0 && (
        <section>
          <h2>Certifications</h2>
          <ul>
            {resume.certifications.map((c) => (
              <li key={c.id}>
                {c.name}
                {c.issuer && `, ${c.issuer}`}
                {c.year && ` (${c.year})`}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
