import { certificationLine, educationLine, profileParagraphs, roleDates, roleHeading } from "../../shared/resumeLayout";
import type { TailoredResume } from "../../shared/types";
import "./resume.css";

export function Resume({ resume }: { resume: TailoredResume }) {
  const paragraphs = profileParagraphs(resume);
  const education = educationLine(resume);
  const certifications = certificationLine(resume);
  return (
    <article className="resume">
      <header>
        <h1>{resume.fullName}</h1>
        {resume.headline && <div className="headline">{resume.headline}</div>}
        {resume.contact.length > 0 && <div className="contact">{resume.contact.join("  |  ")}</div>}
      </header>

      {paragraphs.length > 0 && (
        <section>
          <h2>Profile</h2>
          {paragraphs.map((p) => <p key={p}>{p}</p>)}
        </section>
      )}

      {(resume.selectedImpact?.length ?? 0) > 0 && (
        <section>
          <h2>Selected Impact</h2>
          <ul className="impact">
            {resume.selectedImpact?.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </section>
      )}

      {(resume.capabilityGroups?.length ?? 0) > 0 ? (
        <section>
          <h2>Core Capabilities</h2>
          {resume.capabilityGroups?.map((group) => (
            <p className="cap" key={group.name}>
              <strong>{group.name}:</strong> {group.items.join(", ")}
            </p>
          ))}
        </section>
      ) : resume.coreStrengths.length > 0 ? (
        <section>
          <h2>Core Strengths</h2>
          <p>{resume.coreStrengths.join("  •  ")}</p>
        </section>
      ) : null}

      {resume.aiAssistedDelivery && (
        <section>
          <h2>AI-Assisted Delivery</h2>
          <p>{resume.aiAssistedDelivery}</p>
        </section>
      )}

      {resume.roles.length > 0 && (
        <section>
          <h2>Professional Experience</h2>
          {resume.roles.map((r) => (
            <div className="job" key={r.experienceId}>
              <div className="job-header">
                <span className="job-title">{roleHeading(r.company, r.title)}</span>
                <span className="job-date">{roleDates(r.start, r.end, r.location)}</span>
              </div>
              <ul>
                {r.bullets.map((b) => (
                  <li key={b.id}>{b.text}</li>
                ))}
              </ul>
              {(r.environment?.length ?? 0) > 0 && (
                <div className="environment"><strong>Environment:</strong> {r.environment?.join(", ")}</div>
              )}
            </div>
          ))}
        </section>
      )}

      {(resume.capabilityGroups?.length ?? 0) === 0 && resume.skills.length > 0 && (
        <section>
          <h2>Skills</h2>
          <p>{resume.skills.join(", ")}</p>
        </section>
      )}

      {(education || certifications) && (
        <section>
          <h2>Education &amp; Certifications</h2>
          {education && <p className="education">{education}</p>}
          {certifications && <p className="education">{certifications}</p>}
        </section>
      )}
    </article>
  );
}
