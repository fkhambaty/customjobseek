import type { Decision, FitResult, JobStatus } from "../../shared/types";

export function decisionLabel(d: Decision): string {
  switch (d) {
    case "apply":
      return "Apply: strong fit";
    case "stretch":
      return "Stretch: worth it if you can close the gaps";
    case "skip":
      return "Skip: not a good use of your time";
    default: {
      const never: never = d;
      return never;
    }
  }
}

export function statusLabel(s: JobStatus): string {
  switch (s) {
    case "evaluated":
      return "Checked";
    case "resume_ready":
      return "Resume ready";
    case "applied":
      return "Applied";
    case "interview":
      return "Interviewing";
    case "offer":
      return "Offer";
    case "rejected":
      return "Rejected";
    case "withdrawn":
      return "Withdrawn";
    default: {
      const never: never = s;
      return never;
    }
  }
}

export function ScoreRing({ score, size = "md" }: { score: number; size?: "sm" | "md" }) {
  return (
    <div className={`score-ring score-${size}`} style={{ ["--p" as string]: score }}>
      <span>{score}</span>
    </div>
  );
}

function Chips({ items, kind }: { items: string[]; kind: "ok" | "gap" | "soft" }) {
  if (!items.length) return <span className="muted small">None</span>;
  return (
    <span className="chips">
      {items.map((s) => (
        <span key={s} className={`chip chip-${kind}`}>{s}</span>
      ))}
    </span>
  );
}

export function FitCard({ fit }: { fit: FitResult }) {
  return (
    <div className="card fit-card">
      <div className="fit-head">
        <ScoreRing score={fit.score} />
        <div>
          <div className={`decision decision-${fit.decision}`}>{decisionLabel(fit.decision)}</div>
          <p className="muted small">
            The score weighs required skills you hold, other skills mentioned, how close the title is to your targets,
            and years of experience. It is evidence, not a promise of an interview.
          </p>
        </div>
      </div>

      {fit.blockers.length > 0 && (
        <div className="blockers">
          <h3>Deal-breakers</h3>
          <ul>
            {fit.blockers.map((b) => (
              <li key={b.kind + b.message}>{b.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="fit-grid">
        <div>
          <h3>Required skills you have</h3>
          <Chips items={fit.matchedRequired} kind="ok" />
        </div>
        <div>
          <h3>Required skills you lack</h3>
          <Chips items={fit.missingRequired} kind="gap" />
        </div>
        <div>
          <h3>Other skills you have</h3>
          <Chips items={fit.matchedOther} kind="ok" />
        </div>
        <div>
          <h3>Nice-to-haves you lack</h3>
          <Chips items={fit.missingOther} kind="soft" />
        </div>
      </div>

      {fit.notes.length > 0 && (
        <ul className="notes">
          {fit.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
