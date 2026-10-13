import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { contextualUpgrade, type UpgradeBlock, type WalletView } from "../../shared/payments";
import { api } from "../api";
import { checkoutReturnPath, startPurchase } from "../checkout";
import { useJobsOptional } from "../data";
import { useSession } from "../session";
import { PayFacts, WalletLine } from "./PayFacts";

export function UpgradePrompt({ evidence, blocked }: { evidence: boolean; blocked: UpgradeBlock }) {
  const { account, refresh } = useSession();
  const jobs = useJobsOptional();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [paymentsEnabled, setPaymentsEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    api.billingStatus().then((status) => setPaymentsEnabled(status.paymentsEnabled)).catch(() => setPaymentsEnabled(false));
  }, []);
  if (!account) return null;
  const wallet: WalletView = {
    plan: account.plan,
    evalCredits: account.evalCredits,
    resumeCredits: account.resumeCredits,
    scanRuns: account.scanRuns,
    creditsExpireAt: account.creditsExpireAt,
  };
  const offer = contextualUpgrade({ ...wallet, evidence, blocked, displayCurrency: jobs?.currency });
  if (!offer) return null;
  const chosen = offer;

  async function buy() {
    if (!account || paymentsEnabled !== true) return;
    setBusy(true);
    setError("");
    try {
      await startPurchase({
        sku: chosen.sku,
        email: account.email,
        displayCurrency: jobs?.currency,
        onDone: (orderId, end) => navigate(checkoutReturnPath(orderId, end)),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout could not be opened.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="card upgrade-card">
      <h2>Continue this search</h2>
      <p>{offer.because}</p>
      <PayFacts facts={chosen.facts} />
      <WalletLine wallet={wallet} />
      <button type="button" className="btn btn-primary" onClick={buy} disabled={busy || paymentsEnabled !== true}>
        {paymentsEnabled === false ? "Checkout closed" : busy ? "Opening checkout…" : `Buy ${chosen.facts.name}`}
      </button>
      {paymentsEnabled === false && <p className="muted small">Checkout is closed. This button does not charge a card.</p>}
      {error && <div className="alert alert-info small">{error}</div>}
    </aside>
  );
}
