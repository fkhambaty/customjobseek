import { useEffect, useState } from "react";
import { capacityHeadline, capacityMessage, type CapacityPause } from "../../shared/dbCapacity";

export function CapacityNotice({ pause, compact = false }: { pause: CapacityPause; compact?: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const back = now.getTime() >= Date.parse(pause.resetAt);
  return (
    <section className={`capacity-notice${compact ? " capacity-compact" : ""}`} role="status" aria-live="polite">
      <p className="kicker">Short pause · not a bug</p>
      <h2>{back ? "We're back. Thanks for waiting" : capacityHeadline(pause.reason)}</h2>
      {back ? (
        <p>The daily allowance has refilled. Reload the page to carry on.</p>
      ) : (
        <p>{capacityMessage(pause.reason, pause.resetAt, now)}</p>
      )}
      {back && <button type="button" className="btn btn-primary btn-sm" onClick={() => window.location.reload()}>Reload</button>}
    </section>
  );
}
