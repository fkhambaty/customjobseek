import { daysBetween } from "../shared/engine/insights";
import { publicJobUrl } from "../shared/engine/listings";
import type { JobRecord } from "../shared/types";

/** Apply / posting link shown to the person — never a bare Ashby SPA dead-end. */
export function jobOpenUrl(url: string | null | undefined): string {
  if (!url?.trim()) return "";
  return publicJobUrl(url.trim());
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function compact(n: number, currency: string): string {
  if (currency === "INR") {
    const lakh = n / 100_000;
    return lakh >= 100 ? `${(lakh / 100).toFixed(1)}Cr` : `${Math.round(lakh)}L`;
  }
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
}

function symbol(currency: string): string {
  try {
    const part = new Intl.NumberFormat("en", { style: "currency", currency, currencyDisplay: "narrowSymbol" })
      .formatToParts(0)
      .find((p) => p.type === "currency");
    return part?.value ?? `${currency} `;
  } catch {
    return `${currency} `;
  }
}

/** "₹38–46L", "~₹42L", "$120k–150k". Estimates carry a tilde so they never read as an employer figure. */
export function formatPay(j: Pick<JobRecord, "payLow" | "payHigh" | "payEstimated">, currency: string): string {
  const { payLow: lo, payHigh: hi } = j;
  if (lo === null && hi === null) return "";
  const sym = symbol(currency);
  if (j.payEstimated) {
    const mid = lo !== null && hi !== null ? (lo + hi) / 2 : (hi ?? lo)!;
    return `~${sym}${compact(mid, currency)}`;
  }
  if (lo !== null && hi !== null && lo !== hi) return `${sym}${compact(lo, currency)}–${compact(hi, currency)}`;
  return `${sym}${compact((hi ?? lo)!, currency)}`;
}

export function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? "" : "Z"));
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear();
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" });
}

function parseStamp(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? "" : "Z"));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "14 Oct, 3:42 pm" in the viewer's own clock. */
export function dateTime(iso: string | null): string {
  const d = parseStamp(iso);
  if (!d) return "";
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
}

/** "just now", "12 min ago", "3 h ago", then the day count. */
export function timeAgo(iso: string | null): string {
  const d = parseStamp(iso);
  if (!d) return "";
  const minutes = Math.round((Date.now() - d.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  return ago(iso);
}

export function duration(seconds: number | null): string {
  if (seconds === null) return "–";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

export function ago(iso: string | null): string {
  const d = daysBetween(iso, today());
  if (d === null) return "";
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  return `${Math.round(d / 30)} months ago`;
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

/** Balances at or above this are a standing comp, not a number the person should see. */
export const UNLIMITED_CREDITS = 100_000;

export function isUnlimited(n: number): boolean {
  return n >= UNLIMITED_CREDITS;
}

export function creditAmount(n: number): string {
  return isUnlimited(n) ? "Unlimited" : String(n);
}

export function pct(n: number, d: number): string {
  return d ? `${Math.round((n / d) * 100)}%` : "–";
}
