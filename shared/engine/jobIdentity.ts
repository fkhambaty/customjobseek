import { canonicalJobUrl, normalizedTitle } from "./sources";

/**
 * Stable key so the same opening is not saved twice for one person.
 * Same employer + same title wins over URL: ATS boards often republish one
 * role under a new greenhouse/lever id, which must not appear twice.
 */
export function jobIdentityKey(input: { title: string; company: string; url: string }): string {
  const company = normalizedTitle(input.company);
  const title = normalizedTitle(input.title);
  if (company && title) return `role:${company}:${title}`;
  const url = canonicalJobUrl(input.url);
  if (url) return `url:${url}`;
  return "";
}

export function sameJobOpening(
  a: { title: string; company: string; url: string },
  b: { title: string; company: string; url: string },
): boolean {
  const left = jobIdentityKey(a);
  const right = jobIdentityKey(b);
  if (left && right && left === right) return true;
  const aUrl = canonicalJobUrl(a.url);
  const bUrl = canonicalJobUrl(b.url);
  if (aUrl && bUrl && aUrl === bUrl) return true;
  return normalizedTitle(a.company) === normalizedTitle(b.company)
    && normalizedTitle(a.title) === normalizedTitle(b.title)
    && Boolean(normalizedTitle(a.company))
    && Boolean(normalizedTitle(a.title));
}

/** Keep the first of each opening. Later copies are dropped. */
export function dedupeJobOpenings<T extends { title: string; company: string; url: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const row of rows) {
    const key = jobIdentityKey(row) || `raw:${normalizedTitle(row.company)}:${normalizedTitle(row.title)}:${row.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(row);
  }
  return kept;
}

/**
 * Collapse duplicate pipeline rows for display.
 * Prefers an applied/interviewing row over a still-to-apply copy of the same opening.
 */
export function collapseDuplicateJobs<T extends { id: string; title: string; company: string; url: string; status: string; createdAt?: string }>(
  jobs: T[],
): T[] {
  const rank = (status: string) => {
    switch (status) {
      case "offer":
        return 6;
      case "interview":
        return 5;
      case "applied":
        return 4;
      case "resume_ready":
        return 3;
      case "evaluated":
        return 2;
      default:
        return 1;
    }
  };
  const best = new Map<string, T>();
  const order: string[] = [];
  for (const job of jobs) {
    const key = jobIdentityKey(job) || `id:${job.id}`;
    const current = best.get(key);
    if (!current) {
      best.set(key, job);
      order.push(key);
      continue;
    }
    const better = rank(job.status) - rank(current.status)
      || String(job.createdAt ?? "").localeCompare(String(current.createdAt ?? ""));
    if (better > 0) best.set(key, job);
  }
  return order.map((key) => best.get(key)!).filter(Boolean);
}
