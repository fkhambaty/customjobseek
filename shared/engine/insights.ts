import type { JobRecord } from "../types";

const DAY = 86_400_000;

function day(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? "" : "Z"));
  return Number.isNaN(t) ? null : Math.floor(t / DAY);
}

export function daysBetween(from: string | null, to: string | null): number | null {
  const a = day(from);
  const b = day(to);
  return a === null || b === null ? null : b - a;
}

export function payMid(j: JobRecord): number | null {
  if (j.payLow !== null && j.payHigh !== null) return (j.payLow + j.payHigh) / 2;
  return j.payHigh ?? j.payLow;
}

const TO_APPLY = new Set(["evaluated", "resume_ready"]);
const ANSWERED = new Set(["interview", "offer", "rejected"]);

export function hasAnswer(j: JobRecord): boolean {
  return ANSWERED.has(j.status) || j.replies > 0 || j.rejectedAt !== null;
}

export function wasSubmitted(j: JobRecord): boolean {
  return j.appliedAt !== null;
}

function byPayThenScore(a: JobRecord, b: JobRecord): number {
  return (payMid(b) ?? 0) - (payMid(a) ?? 0) || b.fit.score - a.fit.score;
}

function openPostingFirst(compare: (a: JobRecord, b: JobRecord) => number): (a: JobRecord, b: JobRecord) => number {
  return (a, b) => (a.liveStatus === "closed" ? 1 : 0) - (b.liveStatus === "closed" ? 1 : 0) || compare(a, b);
}

export interface TodayQueues {
  live: JobRecord[];
  applyNext: JobRecord[];
  messageNow: JobRecord[];
  nudge: JobRecord[];
  due: JobRecord[];
  needContact: number;
}

/** What to do today, in the order that pays off: live conversations, then fresh applications, then people. */
export function todayQueues(jobs: JobRecord[], today: string): TodayQueues {
  const active = jobs.filter((job) => !job.archivedAt);
  const age = (iso: string | null) => daysBetween(iso, today) ?? Infinity;
  const live = active
    .filter((j) => j.status === "interview" || j.status === "offer")
    .sort((a, b) => (a.liveStatus === "closed" ? 1 : 0) - (b.liveStatus === "closed" ? 1 : 0));
  const applyNext = active
    .filter((j) => TO_APPLY.has(j.status) && (j.fit.imported || j.fit.decision !== "skip"))
    .sort(openPostingFirst((a, b) => b.fit.score - a.fit.score || (payMid(b) ?? 0) - (payMid(a) ?? 0)));

  const recent = active.filter((j) => j.status === "applied" && age(j.appliedAt) <= 30);
  const seen = new Set<string>();
  const messageNow = recent
    .filter((j) => j.contactCount > 0 && j.messagesSent === 0)
    .sort(openPostingFirst(byPayThenScore))
    .filter((j) => {
      const key = j.company.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const needContact = recent.filter((j) => j.contactCount === 0).length;

  const nudge = active
    .filter((j) => j.status === "applied" && j.messagesSent > 0 && j.replies === 0 && age(j.lastTouchAt) >= 7 && age(j.appliedAt) <= 45)
    .sort(openPostingFirst(byPayThenScore));
  const due = active
    .filter((j) => j.nextActionAt !== null && j.nextActionAt <= today && !["rejected", "withdrawn", "closed"].includes(j.status))
    .sort(openPostingFirst((a, b) => (a.nextActionAt ?? "").localeCompare(b.nextActionAt ?? "")));
  return { live, applyNext, messageNow, nudge, due, needContact };
}

export interface Breakdown {
  key: string;
  sent: number;
  answered: number;
  interviews: number;
  rejected: number;
  closed: number;
  silent: number;
}

export interface Bucket {
  label: string;
  count: number;
}

export interface WeekBar {
  weekStart: string;
  interview: number;
  rejected: number;
  closed: number;
  silent: number;
}

export interface Analytics {
  submitted: number;
  last7: number;
  last30: number;
  answered: number;
  interviews: number;
  messaged: number;
  messageReplies: number;
  medianDaysToRejection: number | null;
  datedRejections: number;
  openWithResume: number;
  openTotal: number;
  dayOfSearch: number | null;
  weeks: WeekBar[];
  byLane: Breakdown[];
  byRoute: Breakdown[];
  byFamily: Breakdown[];
  byFit: Breakdown[];
  silentAges: Bucket[];
  rejectionDays: Bucket[];
  humanFunnel: Bucket[];
  skillGaps: Bucket[];
  targeting: (Breakdown & { queued: number })[];
  insights: string[];
}

function fitTier(j: JobRecord): string {
  if (j.fit.imported && !j.fit.score) return "Not scored";
  if (j.fit.score >= 75) return "Strong fit (75+)";
  if (j.fit.score >= 50) return "Worth applying (50–74)";
  return "Weak fit (under 50)";
}

function breakdown(jobs: JobRecord[], keyOf: (j: JobRecord) => string): Breakdown[] {
  const rows = new Map<string, Breakdown>();
  for (const j of jobs) {
    const key = keyOf(j) || "Not set";
    const r = rows.get(key) ?? { key, sent: 0, answered: 0, interviews: 0, rejected: 0, closed: 0, silent: 0 };
    r.sent++;
    if (hasAnswer(j)) r.answered++;
    if (j.status === "interview" || j.status === "offer") r.interviews++;
    else if (j.status === "rejected") r.rejected++;
    else if (j.status === "closed" || j.status === "withdrawn") r.closed++;
    else r.silent++;
    rows.set(key, r);
  }
  return [...rows.values()].sort((a, b) => b.sent - a.sent);
}

function bucket(values: number[], edges: [string, number, number][]): Bucket[] {
  return edges.map(([label, lo, hi]) => ({ label, count: values.filter((v) => v >= lo && v <= hi).length }));
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

function mondayOf(dayNumber: number): number {
  // Day 0 (1 Jan 1970) was a Thursday; shift so weeks start on Monday.
  return dayNumber - ((dayNumber + 3) % 7);
}

function isoOf(dayNumber: number): string {
  return new Date(dayNumber * DAY).toISOString().slice(0, 10);
}

function pct(n: number, d: number): string {
  return d ? `${Math.round((n / d) * 100)}%` : "0%";
}

function best(rows: Breakdown[], min: number): Breakdown | null {
  return rows.filter((r) => r.sent >= min && r.key !== "No link").sort((a, b) => b.answered / b.sent - a.answered / a.sent)[0] ?? null;
}

export function computeAnalytics(jobs: JobRecord[], today: string, weeks = 12): Analytics {
  const sent = jobs.filter(wasSubmitted);
  const todayN = day(today)!;
  const ago = (iso: string | null) => (day(iso) === null ? Infinity : todayN - day(iso)!);

  const rejectionGaps = sent
    .filter((j) => j.status === "rejected")
    .map((j) => daysBetween(j.appliedAt, j.rejectedAt))
    .filter((d): d is number => d !== null && d >= 0);

  const firstApplied = Math.min(...sent.map((j) => day(j.appliedAt) ?? Infinity));
  const lastWeek = mondayOf(todayN);
  const weekBars: WeekBar[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const start = lastWeek - w * 7;
    const inWeek = sent.filter((j) => {
      const d = day(j.appliedAt);
      return d !== null && d >= start && d < start + 7;
    });
    weekBars.push({
      weekStart: isoOf(start),
      interview: inWeek.filter((j) => j.status === "interview" || j.status === "offer").length,
      rejected: inWeek.filter((j) => j.status === "rejected").length,
      closed: inWeek.filter((j) => j.status === "closed" || j.status === "withdrawn").length,
      silent: inWeek.filter((j) => j.status === "applied").length,
    });
  }

  const silent = sent.filter((j) => j.status === "applied" && !hasAnswer(j));
  const current = jobs.filter((j) => !j.archivedAt);
  const open = current.filter((j) => j.status === "applied" || TO_APPLY.has(j.status));
  const openApps = current.filter((j) => j.status === "applied");

  const gapCount = new Map<string, number>();
  for (const j of current) {
    for (const g of new Set([...j.fit.missingRequired, ...j.fit.missingOther].map((s) => s.toLowerCase()))) {
      gapCount.set(g, (gapCount.get(g) ?? 0) + 1);
    }
  }
  const skillGaps = [...gapCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([label, count]) => ({ label, count }));

  const byLane = breakdown(sent, (j) => j.lane);
  const byRoute = breakdown(sent, (j) => j.route);
  const byFamily = breakdown(sent, (j) => j.family);
  const queued = new Map<string, number>();
  for (const j of current) if (TO_APPLY.has(j.status)) queued.set(j.family, (queued.get(j.family) ?? 0) + 1);

  const messaged = sent.filter((j) => j.messagesSent > 0);
  const messageReplies = messaged.filter((j) => j.replies > 0).length;
  const medianRejection = median(rejectionGaps);

  const insights: string[] = [];
  const lane = best(byLane, 5);
  if (lane) insights.push(`Your best reply rate by search path is ${lane.key}: ${pct(lane.answered, lane.sent)} of ${lane.sent} applications got an answer.`);
  const route = best(byRoute, 5);
  if (route) insights.push(`By route, ${route.key} answers most often (${pct(route.answered, route.sent)}).`);
  const contactable = openApps.filter((j) => j.contactCount > 0 && j.messagesSent === 0).length;
  if (contactable) insights.push(`${contactable} open applications have a named contact but no message sent yet. A short note to a person is the cheapest lift you have.`);
  if (medianRejection !== null) {
    insights.push(`Employers take a median of ${medianRejection} days to say no. Past 30 days of silence, treat a role as closed and move on.`);
  }
  if (skillGaps[0]) insights.push(`The skill asked for most that is not in your profile: ${skillGaps[0].label}, in ${skillGaps[0].count} job descriptions.`);

  return {
    submitted: sent.length,
    last7: sent.filter((j) => ago(j.appliedAt) < 7).length,
    last30: sent.filter((j) => ago(j.appliedAt) < 30).length,
    answered: sent.filter(hasAnswer).length,
    interviews: sent.filter((j) => j.status === "interview" || j.status === "offer").length,
    messaged: messaged.length,
    messageReplies,
    medianDaysToRejection: medianRejection,
    datedRejections: rejectionGaps.length,
    openWithResume: open.filter((j) => j.hasResume).length,
    openTotal: open.length,
    dayOfSearch: Number.isFinite(firstApplied) ? todayN - firstApplied + 1 : null,
    weeks: weekBars,
    byLane,
    byRoute,
    byFamily,
    byFit: breakdown(sent, fitTier),
    silentAges: bucket(
      silent.map((j) => ago(j.appliedAt)),
      [["0–7 days", 0, 7], ["8–14", 8, 14], ["15–30", 15, 30], ["31–60", 31, 60], ["60+", 61, Infinity]],
    ),
    rejectionDays: bucket(rejectionGaps, [["Within a week", 0, 7], ["8–14 days", 8, 14], ["15–30", 15, 30], ["Over 30", 31, Infinity]]),
    humanFunnel: [
      { label: "Open applications", count: openApps.length },
      { label: "Have a named contact", count: openApps.filter((j) => j.contactCount > 0).length },
      { label: "Messaged", count: openApps.filter((j) => j.messagesSent > 0).length },
      { label: "Replied", count: openApps.filter((j) => j.replies > 0).length },
    ],
    skillGaps,
    targeting: byFamily.map((r) => ({ ...r, queued: queued.get(r.key) ?? 0 })),
    insights,
  };
}
