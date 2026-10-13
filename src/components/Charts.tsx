import type { Breakdown, Bucket, WeekBar } from "../../shared/engine/insights";
import { pct, shortDate } from "../format";

const SEGMENTS = [
  ["interview", "Interview"],
  ["rejected", "Rejected"],
  ["closed", "Closed without a word"],
  ["silent", "Still waiting"],
] as const;

export function Legend() {
  return (
    <div className="legend">
      {SEGMENTS.map(([k, label]) => (
        <span key={k}><i className={`sw sw-${k}`} />{label}</span>
      ))}
    </div>
  );
}

export function WeeksChart({ weeks }: { weeks: WeekBar[] }) {
  const total = (w: WeekBar) => w.interview + w.rejected + w.closed + w.silent;
  const max = Math.max(1, ...weeks.map(total));
  const H = 160;
  const W = 640;
  const step = W / weeks.length;
  const bar = Math.min(34, step * 0.62);
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H + 34}`} role="img" aria-label="Applications per week, by outcome">
        {[0.5, 1].map((f) => (
          <line key={f} x1={0} x2={W} y1={H - H * f} y2={H - H * f} className="grid" />
        ))}
        <line x1={0} x2={W} y1={H} y2={H} className="axis" />
        {weeks.map((w, i) => {
          let y = H;
          const x = i * step + (step - bar) / 2;
          return (
            <g key={w.weekStart}>
              {SEGMENTS.map(([k]) => {
                const h = (w[k] / max) * (H - 14);
                y -= h;
                return h > 0 ? <rect key={k} x={x} y={y} width={bar} height={h} className={`seg seg-${k}`} /> : null;
              })}
              {total(w) > 0 && <text x={x + bar / 2} y={y - 4} className="val">{total(w)}</text>}
              {i % 2 === 0 && <text x={x + bar / 2} y={H + 18} className="tick">{shortDate(w.weekStart)}</text>}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

export function BreakdownTable({ rows, label }: { rows: Breakdown[]; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r.sent));
  return (
    <table className="breakdown">
      <thead>
        <tr>
          <th>{label}</th>
          <th className="bar-col" aria-hidden />
          <th className="num">Sent</th>
          <th className="num">Answered</th>
          <th className="num">Interview</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td>{r.key}</td>
            <td className="bar-col">
              <span className="stack" style={{ width: `${(r.sent / max) * 100}%` }}>
                {SEGMENTS.map(([k]) => {
                  const n = k === "interview" ? r.interviews : r[k];
                  return n ? <i key={k} className={`seg-${k}`} style={{ flexGrow: n }} /> : null;
                })}
              </span>
            </td>
            <td className="num">{r.sent}</td>
            <td className="num">{pct(r.answered, r.sent)}</td>
            <td className={r.interviews ? "num good" : "num"}>{pct(r.interviews, r.sent)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Columns({ buckets, tone }: { buckets: Bucket[]; tone: "wait" | "bad" }) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div className="columns">
      {buckets.map((b) => (
        <div className="col" key={b.label}>
          <span className="col-n">{b.count}</span>
          <span className={`col-bar col-${tone}`} style={{ height: `${Math.max(2, (b.count / max) * 120)}px` }} />
          <span className="col-label">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Rows({ buckets, unit }: { buckets: Bucket[]; unit?: string }) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <ul className="rows">
      {buckets.map((b) => (
        <li key={b.label}>
          <span className="rows-label">{b.label}</span>
          <span className="rows-track"><span style={{ width: `${(b.count / max) * 100}%` }} /></span>
          <span className="rows-n">{b.count}{unit ? ` ${unit}` : ""}</span>
        </li>
      ))}
    </ul>
  );
}
