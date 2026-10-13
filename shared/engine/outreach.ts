import type { Contact, FitResult, Profile } from "../types";

export interface MessageSet {
  contactId: string;
  to: string;
  /** LinkedIn connection notes are capped at 200 characters. */
  connectionNote: string;
  firstMessage: string;
  nudge: string;
  emailSubject: string;
  emailBody: string;
  /** The profile line the first message quotes, so the person can see where it came from. */
  quotedLine: string;
}

export interface OutreachJob {
  title: string;
  company: string;
  requisition: string;
}

const NOTE_LIMIT = 200;

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? "";
}

function listPhrase(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function bestLine(profile: Profile, fit: FitResult): string {
  const wanted = [...fit.matchedRequired, ...fit.matchedOther].map((s) => s.toLowerCase());
  let best = "";
  let bestScore = -1;
  for (const exp of profile.experience) {
    for (const b of exp.bullets) {
      const text = b.text.toLowerCase();
      const score = wanted.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0) * 10 - Math.max(0, b.text.length - 220) / 40;
      if (score > bestScore) {
        best = b.text;
        bestScore = score;
      }
    }
  }
  return best;
}

/** A short, true hook: years plus the skills this job asks for that the person holds. */
function hook(profile: Profile, fit: FitResult): string {
  const matched = [...fit.matchedRequired, ...fit.matchedOther];
  const skills = (matched.length ? matched : profile.skills.map((s) => s.name)).slice(0, 3);
  const years = profile.totalYears ? `${profile.totalYears} years` : "";
  if (years && skills.length) return `${years} in ${listPhrase(skills)}`;
  if (skills.length) return `hands-on with ${listPhrase(skills)}`;
  return years ? `${years} of relevant work` : "relevant experience";
}

function fitNote(parts: string[]): string {
  const joined = parts.join(" ");
  if (joined.length <= NOTE_LIMIT) return joined;
  const withoutHook = parts.filter((_, i) => i !== 2).join(" ");
  if (withoutHook.length <= NOTE_LIMIT) return withoutHook;
  return `${withoutHook.slice(0, NOTE_LIMIT - 1).replace(/\s+\S*$/, "")}…`;
}

export function buildMessages(profile: Profile, fit: FitResult, job: OutreachJob, contact: Contact): MessageSet {
  const hi = contact.name ? `Hi ${firstName(contact.name)},` : "Hello,";
  const role = job.requisition ? `${job.title} (${job.requisition})` : job.title;
  const at = job.company ? ` at ${job.company}` : "";
  const h = hook(profile, fit);
  const line = bestLine(profile, fit);
  const proof = line ? ` ${line.replace(/\.$/, "")}.` : "";
  const sign = [profile.fullName, profile.phone, profile.email, profile.links[0] ?? ""].filter(Boolean).join(" · ");

  const connectionNote = fitNote([hi, `I applied for ${job.title}${at}.`, `${capital(h)}.`, "Are you the right person to speak with?"]);
  const firstMessage = `${hi} I applied for the ${role} role${at}.${proof} Are you the right person to speak with about it?`;
  const nudge = `${hi} following up on my application for ${job.title}${at}. ${capital(h)}. Is there someone else I should speak with?`;
  return {
    contactId: contact.id,
    to: contact.name || contact.email,
    connectionNote,
    firstMessage,
    nudge,
    emailSubject: `${job.title} application: ${profile.fullName}`.trim(),
    emailBody: `${firstMessage}\n\n${sign}`,
    quotedLine: line,
  };
}

function capital(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}
