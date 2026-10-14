import { Link } from "react-router-dom";
import { inrLabel, type OfferFacts, type WalletView } from "../../shared/payments";
import { creditAmount } from "../format";

export function PayFacts({ facts }: { facts: OfferFacts }) {
  return (
    <dl className="pay-facts">
      <div><dt>SKU</dt><dd><code>{facts.sku}</code></dd></div>
      <div><dt>Price</dt><dd>{inrLabel(facts.amountInr)}</dd></div>
      <div><dt>Billing</dt><dd>{facts.oneTimeNote}</dd></div>
      <div><dt>Expiry</dt><dd>{facts.expiresNote}</dd></div>
      <div>
        <dt>Refunds</dt>
        <dd>
          Unused purchased credits only. <Link to="/refunds" title={facts.refundNote}>Read the policy</Link>
        </dd>
      </div>
      {facts.regionalNote && <div><dt>Currency</dt><dd>{facts.regionalNote}</dd></div>}
    </dl>
  );
}

export function WalletLine({ wallet }: { wallet: WalletView }) {
  const expiry = wallet.creditsExpireAt
    ? ` Paid credits expire ${new Date(wallet.creditsExpireAt).toLocaleDateString()}.`
    : "";
  return (
    <p className="wallet-line">
      Wallet: {creditAmount(wallet.evalCredits)} fit checks, {creditAmount(wallet.resumeCredits)} tailored resumes, {creditAmount(wallet.scanRuns)} scans on the {wallet.plan} plan.{expiry}
    </p>
  );
}
