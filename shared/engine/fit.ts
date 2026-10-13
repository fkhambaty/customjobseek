import { COUNTRIES, cityNames, countryByCode, countryNames } from "../geo";
import type { Blocker, Decision, FitResult, ParsedSalary, Profile, SalaryPeriod } from "../types";
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

const CURRENCY_MARKS: [RegExp, string][] = [
  [/\ba\$|\baud\b/, "AUD"],
  [/\bc\$|\bcad\b/, "CAD"],
  [/\bs\$|\bsgd\b/, "SGD"],
  [/\bnz\$|\bnzd\b/, "NZD"],
  [/\bhk\$|\bhkd\b/, "HKD"],
  [/\bus\$|\busd\b/, "USD"],
  [/₹|\binr\b|\brs\.?\b/, "INR"],
  [/€|\beur\b/, "EUR"],
  [/£|\bgbp\b/, "GBP"],
  [/\baed\b/, "AED"],
  [/\bjpy\b|¥/, "JPY"],
  [/\bchf\b/, "CHF"],
  [/\bzar\b/, "ZAR"],
  [/\bbrl\b|r\$/, "BRL"],
  [/\bmxn\b/, "MXN"],
  [/\bpln\b/, "PLN"],
  [/\bsek\b/, "SEK"],
  [/\bnok\b/, "NOK"],
  [/\bdkk\b/, "DKK"],
  [/\bmyr\b/, "MYR"],
  [/\bthb\b/, "THB"],
  [/\bphp\b/, "PHP"],
  [/\bidr\b/, "IDR"],
  [/\bkrw\b/, "KRW"],
  [/\bcny\b/, "CNY"],
  [/\bsar\b/, "SAR"],
  [/\bqar\b/, "QAR"],
];

function detectCurrency(text: string): string | null {
  for (const [re, code] of CURRENCY_MARKS) if (re.test(text)) return code;
  if (text.includes("$")) return "USD";
  return null;
}

function scaleNumber(raw: string, textAfter: string): number {
  const n = Number(raw);
  if (/^\s*k\b/i.test(textAfter)) return n * 1000;
  if (/^\s*m\b/i.test(textAfter)) return n * 1_000_000;
  return n;
}

function writtenPeriod(text: string): SalaryPeriod | null {
  if (/\b(per hour|an hour|\/hour|\/hr|hourly|p\.h\.)\b/.test(text)) return "hour";
  if (/\b(per month|a month|\/month|monthly|p\.m\.|per mo)\b/.test(text)) return "month";
  if (/\b(per year|per annum|p\.a\.|annually|\/year|yearly)\b/.test(text)) return "year";
  return null;
}

export function annualise(amount: number, period: SalaryPeriod): number {
  switch (period) {
    case "year":
      return amount;
    case "month":
      return amount * 12;
    case "hour":
      return amount * 2080;
    case "lpa":
      return amount * 100_000;
    default: {
      const never: never = period;
      return never;
    }
  }
}

function salaryResult(min: number, max: number, currency: string, period: SalaryPeriod): ParsedSalary {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return { min: lo, max: hi, currency, period, annualMin: annualise(lo, period), annualMax: annualise(hi, period) };
}

// Reads a pay range in the currency and unit the posting actually used.
// Lakhs and crores are Indian. A trailing k means thousands. Hourly and monthly are kept as such
// and also converted to a year (hourly assumes 2,080 hours) so two ranges can be compared.
export function parseSalary(text: string): ParsedSalary | null {
  const t = normalise(text).replace(/,(?=\d{3}\b)/g, "");
  if (!t) return null;

  const lakhRange = t.match(/(\d+(?:\.\d+)?)\s*(?:lpa|lakhs?|lacs?|l)?\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(lpa|lakhs?|lacs?|l\b|cr|crores?)/);
  if (lakhRange) {
    const unit = lakhRange[3] ?? "";
    const crore = /cr/.test(unit);
    const min = Number(lakhRange[1]) * (crore ? 100 : 1);
    const max = Number(lakhRange[2]) * (crore ? 100 : 1);
    return salaryResult(min, max, "INR", "lpa");
  }
  const lakhSingle = t.match(/(\d+(?:\.\d+)?)\s*(lpa|lakhs?|lacs?|cr|crores?)\b/);
  if (lakhSingle) {
    const crore = /cr/.test(lakhSingle[2] ?? "");
    const v = Number(lakhSingle[1]) * (crore ? 100 : 1);
    return salaryResult(v, v, "INR", "lpa");
  }

  const currency = detectCurrency(t);
  const period = writtenPeriod(t) ?? "year";
  // Only the words next to the currency mark, so "3-5 years" elsewhere in the posting is not a salary.
  const mark = CURRENCY_MARKS.find(([re]) => re.test(t))?.[0].exec(t);
  const at = mark?.index ?? t.indexOf("$");
  const window = at >= 0 ? t.slice(Math.max(0, at - 24), at + 48) : t;
  const range = window.match(/(\d+(?:\.\d+)?)(\s*[km])?\s*(?:-|to)\s*\D{0,8}?(\d+(?:\.\d+)?)(\s*[km])?/i);
  if (range && currency) {
    return salaryResult(scaleNumber(range[1] ?? "0", range[2] ?? ""), scaleNumber(range[3] ?? "0", range[4] ?? ""), currency, period);
  }
  const single = window.match(/(\d+(?:\.\d+)?)(\s*[km])?/i);
  if (single && currency && Number(single[1]) >= (period === "hour" ? 5 : 1000)) {
    const v = scaleNumber(single[1] ?? "0", single[2] ?? "");
    return salaryResult(v, v, currency, period);
  }
  return null;
}

export function formatSalary(s: ParsedSalary): string {
  const symbol = s.currency === "INR" ? "₹" : s.currency === "USD" ? "$" : s.currency === "GBP" ? "£" : s.currency === "EUR" ? "€" : `${s.currency} `;
  const n = (v: number) => (s.period === "lpa" || v >= 100 ? v.toLocaleString("en-US") : String(v));
  const range = s.min === s.max ? n(s.min) : `${n(s.min)}–${n(s.max)}`;
  const unit = s.period === "lpa" ? " LPA" : s.period === "month" ? " per month" : s.period === "hour" ? " per hour" : " per year";
  return `${symbol}${range}${unit}`;
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

function mentionsPlace(haystack: string, name: string): boolean {
  return termPattern(name).test(normalise(haystack));
}

// Longest names first so "Papua New Guinea" wins over a shorter name inside it.
const COUNTRY_SCAN = [...COUNTRIES].sort((a, b) => b.name.length - a.name.length);

function countriesIn(location: string): string[] {
  const found: string[] = [];
  for (const country of COUNTRY_SCAN) {
    const names = countryNames(country.code);
    const named = names.some((n) => n.length > 2 && mentionsPlace(location, n));
    const coded = new RegExp(`\\b${country.code}\\b`).test(location);
    if (named || coded) found.push(country.code);
  }
  return found;
}

function locationCheck(job: JobInput, profile: Profile): { blocker?: Blocker; note?: string } {
  const prefs = profile.preferences;
  if (!prefs.country && !prefs.cities.length) return {};
  const where = `${job.location}`.trim();
  const head = job.description.slice(0, 400);
  const isRemote = /\b(remote|work from home|wfh)\b/i.test(`${where} ${head}`);
  const cityHaystack = where || head;
  const wanted = prefs.cities.flatMap((c) => cityNames(c));
  const cityHit = wanted.some((c) => mentionsPlace(cityHaystack, c));
  const found = countriesIn(where);
  const home = prefs.country;
  const foreign = found.filter((c) => c !== home);

  if (cityHit) return {};
  if (isRemote && prefs.remoteOk && foreign.length === 0) return { note: "Remote role, which you accept." };
  if (isRemote && !prefs.remoteOk) {
    return { blocker: { kind: "location", message: "This role is remote, and your profile says you do not want remote work." } };
  }
  if (isRemote && foreign.length && home) {
    const names = foreign.map((c) => countryByCode(c)?.name ?? c).join(", ");
    return { blocker: { kind: "location", message: `Remote, but limited to ${names}. Your country is ${countryByCode(home)?.name ?? home}.` } };
  }
  if (home && found.includes(home) && !prefs.cities.length) return {};
  if (!where && !isRemote) return { note: "The posting does not state a location. Confirm it before applying." };
  if (prefs.cities.length) {
    return {
      blocker: {
        kind: "location",
        message: `Location "${where || "as stated in the posting"}" is not one of your cities (${prefs.cities.join(", ")}).`,
      },
    };
  }
  if (foreign.length && home) {
    return {
      blocker: {
        kind: "location",
        message: `This role is in ${foreign.map((c) => countryByCode(c)?.name ?? c).join(", ")}, not ${countryByCode(home)?.name ?? home}.`,
      },
    };
  }
  return {};
}

function salaryCheck(job: JobInput, profile: Profile): { blocker?: Blocker; note?: string; parsed: ParsedSalary | null } {
  const parsed = parseSalary(job.salaryText || job.description.slice(0, 800));
  const { minSalary, maxSalary, currency, salaryPeriod } = profile.preferences;
  if (!parsed) {
    return { parsed, note: minSalary ? "Pay is not published. Ask for the band before investing time." : undefined };
  }
  if (parsed.currency !== currency) {
    return {
      parsed,
      note: `Pay is published in ${parsed.currency} (${formatSalary(parsed)}). Your range is in ${currency}, so this is not compared automatically.`,
    };
  }
  const floor = minSalary === null ? null : annualise(minSalary, salaryPeriod);
  const ceiling = maxSalary === null ? null : annualise(maxSalary, salaryPeriod);
  if (floor !== null && parsed.annualMax < floor) {
    return {
      parsed,
      blocker: {
        kind: "salary",
        message: `Pay tops out at ${formatSalary(parsed)}, below your minimum of ${formatSalary(salaryResult(minSalary ?? 0, minSalary ?? 0, currency, salaryPeriod))}.`,
      },
    };
  }
  if (ceiling !== null && parsed.annualMin > ceiling * 1.5) {
    return { parsed, note: `Pay starts at ${formatSalary(parsed)}, well above your stated range. Check the seniority is right for you.` };
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
    parsedSalary: pay.parsed,
  };
}
