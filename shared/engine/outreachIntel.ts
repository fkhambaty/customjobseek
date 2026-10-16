import { daysBetween, payMid } from "./insights";
import type { Channel, JobEvent, JobRecord, JobStatus } from "../types";

/** Which draft the person actually sent or got a reply on. */
export const MESSAGE_TEMPLATES = ["connection", "first", "nudge", "email"] as const;
export type MessageTemplate = (typeof MESSAGE_TEMPLATES)[number];

export function isMessageTemplate(value: unknown): value is MessageTemplate {
  return typeof value === "string" && (MESSAGE_TEMPLATES as readonly string[]).includes(value);
}

export function templateLabel(template: MessageTemplate): string {
  switch (template) {
    case "connection":
      return "Connection note";
    case "first":
      return "First message";
    case "nudge":
      return "Nudge";
    case "email":
      return "Email";
    default: {
      const never: never = template;
      return never;
    }
  }
}

/** Recommended send order for a cold contact. */
export const TEMPLATE_ORDER: MessageTemplate[] = ["connection", "first", "email", "nudge"];

export interface TemplateTouch {
  template: MessageTemplate;
  at: string;
  channel: Channel | "";
  eventId: string;
}

export interface ContactOutreachState {
  personKey: string;
  sent: Partial<Record<MessageTemplate, TemplateTouch>>;
  replies: TemplateTouch[];
  /** Latest outbound touch, if any. */
  lastSent: TemplateTouch | null;
  /** Latest inbound reply, if any. */
  lastReply: TemplateTouch | null;
  /** Next draft to send, or null when waiting / done. */
  nextTemplate: MessageTemplate | null;
  /** Short status for the contact card. */
  status: "not_started" | "in_flight" | "waiting" | "replied";
  statusNote: string;
}

function personKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Rebuild per-contact outreach state from the job event log. */
export function contactOutreachState(events: JobEvent[], person: string, today: string): ContactOutreachState {
  const key = personKey(person);
  const sent: Partial<Record<MessageTemplate, TemplateTouch>> = {};
  const replies: TemplateTouch[] = [];
  const forPerson = events
    .filter((e) => (e.kind === "message" || e.kind === "reply") && personKey(e.person) === key)
    .slice()
    .sort((a, b) => a.at.localeCompare(b.at));

  for (const event of forPerson) {
    const template = isMessageTemplate(event.template) ? event.template : "first";
    const touch: TemplateTouch = { template, at: event.at, channel: event.channel, eventId: event.id };
    if (event.kind === "message") {
      if (!sent[template] || sent[template]!.at < touch.at) sent[template] = touch;
    } else {
      replies.push(touch);
    }
  }

  const sentList = Object.values(sent).filter(Boolean) as TemplateTouch[];
  const lastSent = sentList.sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
  const lastReply = replies.slice().sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;

  if (lastReply) {
    return {
      personKey: key,
      sent,
      replies,
      lastSent,
      lastReply,
      nextTemplate: null,
      status: "replied",
      statusNote: `They replied${lastReply.template ? ` to your ${templateLabel(lastReply.template).toLowerCase()}` : ""} · ${formatTouchDay(lastReply.at, today)}`,
    };
  }

  const nextTemplate = TEMPLATE_ORDER.find((t) => !sent[t]) ?? null;
  if (!lastSent) {
    return {
      personKey: key,
      sent,
      replies,
      lastSent: null,
      lastReply: null,
      nextTemplate: nextTemplate ?? "connection",
      status: "not_started",
      statusNote: "Not messaged yet — start with the connection note or first message",
    };
  }

  const quietDays = daysBetween(lastSent.at.slice(0, 10), today) ?? 0;
  if (nextTemplate === "nudge" && quietDays < 7) {
    const left = 7 - quietDays;
    return {
      personKey: key,
      sent,
      replies,
      lastSent,
      lastReply: null,
      nextTemplate: null,
      status: "waiting",
      statusNote: `Waiting on them · nudge available in ${left} day${left === 1 ? "" : "s"}`,
    };
  }

  if (nextTemplate) {
    return {
      personKey: key,
      sent,
      replies,
      lastSent,
      lastReply: null,
      nextTemplate,
      status: "in_flight",
      statusNote: `Sent ${templateLabel(lastSent.template).toLowerCase()} · next: ${templateLabel(nextTemplate).toLowerCase()}`,
    };
  }

  return {
    personKey: key,
    sent,
    replies,
    lastSent,
    lastReply: null,
    nextTemplate: quietDays >= 7 ? "nudge" : null,
    status: quietDays >= 7 ? "in_flight" : "waiting",
    statusNote: quietDays >= 7
      ? "All drafts logged once — send a fresh nudge or mark a reply"
      : `Waiting on them · last touch ${formatTouchDay(lastSent.at, today)}`,
  };
}

function formatTouchDay(at: string, today: string): string {
  const day = at.slice(0, 10);
  if (day === today) return "today";
  const ago = daysBetween(day, today);
  if (ago === 1) return "yesterday";
  if (ago !== null && ago < 14) return `${ago} days ago`;
  return day;
}

export interface OutreachProspect {
  score: number;
  reasons: string[];
  nextAction: string;
  phase: "first_touch" | "nudge" | "waiting" | "replied" | "needs_person";
}

/**
 * Higher score = message this application sooner.
 * Used to order the Outreach queue across many applied jobs.
 */
export function outreachProspect(
  job: Pick<
    JobRecord,
    | "status"
    | "fit"
    | "contactCount"
    | "messagesSent"
    | "replies"
    | "appliedAt"
    | "lastTouchAt"
    | "payLow"
    | "payHigh"
    | "liveStatus"
    | "route"
  >,
  today: string,
): OutreachProspect {
  if (job.replies > 0) {
    return { score: -1000, reasons: ["They already replied"], nextAction: "Continue the conversation in History", phase: "replied" };
  }
  if (job.contactCount < 1) {
    return { score: 10, reasons: ["No named person yet"], nextAction: "Find a hiring manager or recruiter", phase: "needs_person" };
  }

  let score = 0;
  const reasons: string[] = [];
  const appliedAge = daysBetween(job.appliedAt, today) ?? 99;
  const quiet = daysBetween(job.lastTouchAt, today);

  if (job.messagesSent === 0) {
    score += 40;
    reasons.push("First touch still open");
    // Sweet spot: day of apply through day 3.
    if (appliedAge <= 1) {
      score += 25;
      reasons.push("Applied today or yesterday");
    } else if (appliedAge <= 3) {
      score += 18;
      reasons.push("Still in the first 3 days");
    } else if (appliedAge <= 7) {
      score += 8;
      reasons.push("Applied this week");
    } else if (appliedAge > 14) {
      score -= 8;
      reasons.push("Application is getting cold");
    }
  } else if (quiet !== null && quiet >= 7) {
    score += 35;
    reasons.push("Quiet for a week — one nudge");
    if (quiet <= 14) score += 10;
    else score -= 5;
  } else {
    score -= 20;
    reasons.push("Waiting on them");
    return {
      score,
      reasons,
      nextAction: quiet === null ? "Wait for a reply" : `Wait ${Math.max(0, 7 - quiet)} more day(s) before nudging`,
      phase: "waiting",
    };
  }

  if (job.fit.score >= 70) {
    score += 20;
    reasons.push(`Strong fit (${job.fit.score})`);
  } else if (job.fit.score >= 55) {
    score += 10;
    reasons.push(`Decent fit (${job.fit.score})`);
  }

  const mid = payMid(job as JobRecord);
  if (mid !== null && mid >= 3_500_000) {
    score += 12;
    reasons.push("Higher pay band");
  } else if (mid !== null && mid >= 2_500_000) {
    score += 6;
  }

  if (job.liveStatus === "live") {
    score += 8;
    reasons.push("Posting still open");
  } else if (job.liveStatus === "closed") {
    score -= 25;
    reasons.push("Posting looks closed");
  }

  if (job.route === "Greenhouse" || job.route === "Lever" || job.route === "Ashby") {
    score += 4;
  }

  const phase: OutreachProspect["phase"] = job.messagesSent === 0 ? "first_touch" : "nudge";
  const nextAction = phase === "first_touch"
    ? "Copy the connection note or first message, send it, then log which one"
    : "Send the nudge once, then stop until they reply";

  return { score, reasons: reasons.slice(0, 3), nextAction, phase };
}

export function sortByOutreachProspect<T extends Parameters<typeof outreachProspect>[0]>(jobs: T[], today: string): T[] {
  return jobs
    .map((job, index) => ({ job, index, prospect: outreachProspect(job, today) }))
    .sort((a, b) => b.prospect.score - a.prospect.score || a.index - b.index)
    .map((row) => row.job);
}

export function activeStatusesForOutreach(): JobStatus[] {
  return ["applied", "interview", "offer"];
}
