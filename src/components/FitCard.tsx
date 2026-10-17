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
    case "backfill":
      return "Backfill";
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
    case "closed":
      return "Closed";
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
        {fit.imported && !fit.score ? <div className="imported-mark">Not scored</div> : <ScoreRing score={fit.score} />}
        <div>
          <div className={`decision decision-${fit.imported ? "stretch" : fit.decision}`}>
            {fit.imported ? (fit.score ? "Score carried over from your own records" : "Imported from your records") : decisionLabel(fit.decision)}
          </div>
          <p className="muted small">
            {fit.imported
              ? "Re-check fit to score it against your profile here. Your earlier notes stay as they are."
              : "The score uses skills, licenses, and years that are already on your profile, plus how close the title is to the roles you named. It does not add a qualification you did not write down."}
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
