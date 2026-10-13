import type { Blocker, Decision, FitResult, Profile } from "../types";
import { SKILL_CATALOGUE, mentions, normalise, termForName, termPattern, uniqueBy, type Term } from "./text";

export interface JobInput {
  title: string;
  company: string;
  location: string;
  salaryText: string;
  description: string;
}

const PREFERRED_LINE = /\b(nice to have|good to have|preferred|bonus|desirable|an advantage|a plus|is a plus|would be great|optional)\b/i;
const PREFERRED_HEADER = /^\W*(nice to have|good to have|preferred|bonus|desirable|plus points?)\b/i;
const REQUIRED_HEADER = /^\W*(requirements?|qualifications?|must have|what you('| wi)ll need|you have|skills|responsibilities|what we('| a)re looking for|about you)\b/i;

const CITY_ALIASES: Record<string, string[]> = {
  bengaluru: ["bengaluru", "bangalore"],
  bangalore: ["bengaluru", "bangalore"],
  mumbai: ["mumbai", "bombay", "navi mumbai", "thane"],
  gurugram: ["gurugram", "gurgaon"],
  gurgaon: ["gurugram", "gurgaon"],
  delhi: ["delhi", "new delhi", "ncr", "delhi ncr"],
  "new delhi": ["delhi", "new delhi", "ncr"],
  noida: ["noida", "ncr"],
  chennai: ["chennai", "madras"],
  kolkata: ["kolkata", "calcutta"],
};

const TITLE_STOPWORDS = new Set(["and", "of", "the", "for", "in", "a", "an", "to", "with", "-", "&", "i", "ii", "iii"]);

export function splitLines(description: string): string[] {
  return description
    .replace(/<\/(p|li|div|h\d)>|<br\s*\/?>/gi, "\n")
    .split(/\n|(?<=[.;])\s+(?=[A-Z])/)
    .map((l) => normalise(l))
    .filter(Boolean);
}

// A term is "required" when it appears in any line that is not marked optional, either by its own
// wording or by sitting under a "nice to have" heading.
export function classifyTerms(description: string, terms: Term[]): { required: Term[]; other: Term[] } {
  const lines = splitLines(description);
  let inPreferredSection = false;
  const requiredNames = new Set<string>();
  const seenNames = new Set<string>();

  for (const line of lines) {
    if (PREFERRED_HEADER.test(line)) inPreferredSection = true;
    else if (REQUIRED_HEADER.test(line)) inPreferredSection = false;
    const optional = inPreferredSection || PREFERRED_LINE.test(line);
    for (const term of terms) {
      if (!mentions(line, term)) continue;
      seenNames.add(term.name);
      if (!optional) requiredNames.add(term.name);
    }
  }

  const found = terms.filter((t) => seenNames.has(t.name));
  return {
    required: found.filter((t) => requiredNames.has(t.name)),
    other: found.filter((t) => !requiredNames.has(t.name)),
  };
}

export function parseYearsRequired(description: string): number | null {
  const text = normalise(description);
  const re = /(\d{1,2})\s*\+?\s*(?:(?:-|to)\s*\d{1,2}\s*\+?\s*)?(?:years?|yrs?)\b(?:\s+of)?(?:[^.]{0,60}?\bexperience)?/g;
  let best: number | null = null;
  for (const m of text.matchAll(re)) {
    const n = Number(m[1]);
    const context = text.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + m[0].length + 60);
    if (!/experience|exp\b/.test(context) || n > 30) continue;
    if (best === null || n > best) best = n;
  }
  return best;
}

// Indian salaries are compared in lakhs per annum. Monthly figures are ignored rather than guessed.
export function parseSalaryLpa(text: string): { min: number; max: number } | null {
  const t = normalise(text).replace(/,(?=\d{2,3}\b)/g, "");
  if (!t || /per month|\/month|monthly|p\.m\./.test(t)) return null;

  const range = t.match(/(\d+(?:\.\d+)?)\s*(?:lpa|lakhs?|lacs?|l)?\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(lpa|lakhs?|lacs?|l\b|cr|crores?)/);
  if (range) {
    const mult = /cr/.test(range[3] ?? "") ? 100 : 1;
    return { min: Number(range[1]) * mult, max: Number(range[2]) * mult };
  }
  const single = t.match(/(\d+(?:\.\d+)?)\s*(lpa|lakhs?|lacs?|cr|crores?)\b/);
  if (single) {
    const v = Number(single[1]) * (/cr/.test(single[2] ?? "") ? 100 : 1);
    return { min: v, max: v };
  }
  const rupees = t.match(/(?:₹|inr|rs\.?)\s*(\d{6,9})(?:\s*(?:-|to)\s*(?:₹|inr|rs\.?)?\s*(\d{6,9}))?/);
  if (rupees) {
    const min = Number(rupees[1]) / 100000;
    const max = rupees[2] ? Number(rupees[2]) / 100000 : min;
    return { min: Math.round(min * 10) / 10, max: Math.round(max * 10) / 10 };
  }
  return null;
}

function titleTokens(s: string): string[] {
  return normalise(s)
    .split(/[^a-z0-9+#.]+/)
    .filter((w) => w && !TITLE_STOPWORDS.has(w));
}

export function titleAlignment(jobTitle: string, targetRoles: string[]): number {
  const job = new Set(titleTokens(jobTitle));
  if (!job.size || !targetRoles.length) return 0;
  let best = 0;
  for (const role of targetRoles) {
    const tokens = titleTokens(role);
    if (!tokens.length) continue;
    const hit = tokens.filter((t) => job.has(t)).length;
    best = Math.max(best, hit / tokens.length);
  }
  return best;
}

function locationCheck(job: JobInput, profile: Profile): { blocker?: Blocker; note?: string } {
  const prefs = profile.preferences;
  if (!prefs.cities.length) return {};
  const where = normalise(`${job.location} ${job.title}`);
  const body = normalise(job.description).slice(0, 1500);
  const isRemote = /\b(remote|work from home|wfh|anywhere in india)\b/.test(`${where} ${body}`);
  const wanted = prefs.cities.flatMap((c) => CITY_ALIASES[c.trim().toLowerCase()] ?? [c.trim().toLowerCase()]);
  const cityHit = wanted.some((c) => termPattern(c).test(where) || termPattern(c).test(body));

  if (cityHit) return {};
  if (isRemote && prefs.remoteOk) return { note: "Remote role, which you accept." };
  if (!where.trim() && !isRemote) return { note: "The posting does not state a location. Confirm it before applying." };
  return {
    blocker: {
      kind: "location",
      message: `Location "${job.location || "as stated in the posting"}" is not one of your cities (${prefs.cities.join(", ")})${isRemote && !prefs.remoteOk ? " and you do not accept remote" : ""}.`,
    },
  };
}

function salaryCheck(job: JobInput, profile: Profile): { blocker?: Blocker; note?: string; parsed: FitResult["parsedSalaryLpa"] } {
  const parsed = parseSalaryLpa(`${job.salaryText} ${job.salaryText ? "" : job.description}`);
  const { minSalaryLpa, maxSalaryLpa } = profile.preferences;
  if (!parsed) {
    return { parsed, note: minSalaryLpa ? "Pay is not published. Ask the recruiter for the band before investing time." : undefined };
  }
  if (minSalaryLpa && parsed.max < minSalaryLpa) {
    return {
      parsed,
      blocker: { kind: "salary", message: `Pay tops out at ₹${parsed.max} LPA, below your minimum of ₹${minSalaryLpa} LPA.` },
    };
  }
  if (maxSalaryLpa && parsed.min > maxSalaryLpa * 1.5) {
    return { parsed, note: `Pay starts at ₹${parsed.min} LPA, well above your stated range. Check the seniority is right for you.` };
  }
  return { parsed };
}

export function heldTerms(profile: Profile): Term[] {
  const never = profile.neverClaim.map((n) => termForName(n));
  const blocked = (t: Term) => never.some((n) => n.name.toLowerCase() === t.name.toLowerCase());

  const fromSkills = profile.skills.map((s) => termForName(s.name));
  const evidence = normalise(profile.experience.flatMap((e) => e.bullets.map((b) => b.text)).join(" \n "));
  const fromBullets = SKILL_CATALOGUE.filter((t) => mentions(evidence, t));
  return uniqueBy([...fromSkills, ...fromBullets], (t) => t.name.toLowerCase()).filter((t) => !blocked(t));
}

export function evaluateFit(job: JobInput, profile: Profile): FitResult {
  const held = heldTerms(profile);
  const heldNames = new Set(held.map((t) => t.name.toLowerCase()));
  const jdTerms = uniqueBy([...SKILL_CATALOGUE, ...held], (t) => t.name.toLowerCase());
  const { required, other } = classifyTerms(`${job.title}\n${job.description}`, jdTerms);

  const isHeld = (t: Term) => heldNames.has(t.name.toLowerCase());
  const matchedRequired = required.filter(isHeld).map((t) => t.name);
  const missingRequired = required.filter((t) => !isHeld(t)).map((t) => t.name);
  const matchedOther = other.filter(isHeld).map((t) => t.name);
  const missingOther = other.filter((t) => !isHeld(t)).map((t) => t.name);

  const blockers: Blocker[] = [];
  const notes: string[] = [];

  const loc = locationCheck(job, profile);
  if (loc.blocker) blockers.push(loc.blocker);
  if (loc.note) notes.push(loc.note);

  const pay = salaryCheck(job, profile);
  if (pay.blocker) blockers.push(pay.blocker);
  if (pay.note) notes.push(pay.note);

  const titleLower = normalise(job.title);
  const excluded = profile.preferences.excludedTitleWords.find((w) => w.trim() && termPattern(w.trim()).test(titleLower));
  if (excluded) blockers.push({ kind: "title", message: `The title contains "${excluded}", which you asked to exclude.` });

  const never = profile.neverClaim.map((n) => termForName(n).name.toLowerCase());
  const requiredNever = required.filter((t) => never.includes(t.name.toLowerCase()));
  if (requiredNever.length) {
    blockers.push({
      kind: "never_claim",
      message: `The role requires ${requiredNever.map((t) => t.name).join(", ")}, which you said you do not have. The resume will not claim it.`,
    });
  }

  const jdYears = parseYearsRequired(job.description);
  let yearsPoints = 10;
  if (jdYears !== null && profile.totalYears !== null) {
    const gap = jdYears - profile.totalYears;
    if (gap > 3) {
      blockers.push({ kind: "experience", message: `Asks for ${jdYears}+ years; you have ${profile.totalYears}.` });
      yearsPoints = 0;
    } else if (gap > 0) {
      notes.push(`Asks for ${jdYears}+ years; you have ${profile.totalYears}. Close enough to try if the rest fits.`);
      yearsPoints = 5;
    }
  }

  const coverage = (hit: number, miss: number) => (hit + miss === 0 ? null : hit / (hit + miss));
  const reqCov = coverage(matchedRequired.length, missingRequired.length);
  const otherCov = coverage(matchedOther.length, missingOther.length);
  if (reqCov === null && otherCov === null) {
    notes.push("Few recognisable skills in this posting. Paste the full description for a sharper score.");
  }
  const skillPoints = 60 * (reqCov ?? otherCov ?? 0.5) + 15 * (otherCov ?? reqCov ?? 0.5);

  const titleScore = profile.preferences.targetRoles.length ? titleAlignment(job.title, profile.preferences.targetRoles) : 0.66;
  if (profile.preferences.targetRoles.length && titleScore < 0.34) {
    notes.push("The title is far from the roles you target. Read the responsibilities before deciding.");
  }

  const score = Math.round(Math.min(100, skillPoints + 15 * titleScore + yearsPoints));
  const decision: Decision = blockers.length ? "skip" : score >= 70 ? "apply" : score >= 50 ? "stretch" : "skip";

  return {
    score,
    decision,
    matchedRequired,
    matchedOther,
    missingRequired,
    missingOther,
    blockers,
    notes,
    jdYearsRequired: jdYears,
    parsedSalaryLpa: pay.parsed,
  };
}
