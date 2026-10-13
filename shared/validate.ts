import type { Profile, SkillLevel } from "./types";

type Raw = Record<string, unknown>;

const LEVELS: SkillLevel[] = ["expert", "working", "familiar"];

function obj(v: unknown): Raw {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {};
}

function text(v: unknown, max = 200): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function list<T>(v: unknown, max: number, map: (item: unknown, i: number) => T | null): T[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, max).map(map).filter((x): x is T => x !== null);
}

function words(v: unknown, max = 40): string[] {
  return list(v, max, (s) => text(s, 80) || null);
}

function num(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function id(v: unknown, fallback: string): string {
  const s = text(v, 40);
  return /^[\w-]+$/.test(s) ? s : fallback;
}

export function sanitiseProfile(input: unknown): Profile {
  const p = obj(input);
  const prefs = obj(p.preferences);
  return {
    fullName: text(p.fullName, 120),
    headline: text(p.headline, 160),
    email: text(p.email, 160),
    phone: text(p.phone, 40),
    links: words(p.links, 5),
    summary: text(p.summary, 1500),
    totalYears: num(p.totalYears, 0, 60),
    skills: list(p.skills, 80, (s) => {
      const o = obj(s);
      const name = text(o.name, 60);
      if (!name) return null;
      const level = LEVELS.includes(o.level as SkillLevel) ? (o.level as SkillLevel) : "working";
      const years = num(o.years, 0, 60);
      return years === null ? { name, level } : { name, level, years };
    }),
    neverClaim: words(p.neverClaim, 40),
    experience: list(p.experience, 15, (e, i) => {
      const o = obj(e);
      const company = text(o.company, 120);
      const title = text(o.title, 120);
      if (!company && !title) return null;
      const expId = id(o.id, `exp${i}`);
      return {
        id: expId,
        company,
        title,
        location: text(o.location, 80),
        start: text(o.start, 20),
        end: text(o.end, 20),
        bullets: list(o.bullets, 20, (b, j) => {
          const bo = obj(b);
          const t = text(bo.text, 400);
          return t ? { id: id(bo.id, `${expId}b${j}`), text: t } : null;
        }),
      };
    }),
    education: list(p.education, 6, (e, i) => {
      const o = obj(e);
      const institution = text(o.institution, 160);
      const degree = text(o.degree, 160);
      if (!institution && !degree) return null;
      return { id: id(o.id, `edu${i}`), institution, degree, year: text(o.year, 20) };
    }),
    certifications: list(p.certifications, 15, (e, i) => {
      const o = obj(e);
      const name = text(o.name, 160);
      return name ? { id: id(o.id, `cert${i}`), name, issuer: text(o.issuer, 120), year: text(o.year, 20) } : null;
    }),
    preferences: {
      cities: words(prefs.cities, 15),
      remoteOk: prefs.remoteOk !== false,
      minSalaryLpa: num(prefs.minSalaryLpa, 0, 1000),
      maxSalaryLpa: num(prefs.maxSalaryLpa, 0, 1000),
      targetRoles: words(prefs.targetRoles, 15),
      excludedTitleWords: words(prefs.excludedTitleWords, 20),
    },
  };
}

export function profileReadiness(p: Profile): string[] {
  const missing: string[] = [];
  if (!p.fullName) missing.push("your name");
  if (!p.email) missing.push("a contact email");
  if (!p.skills.length) missing.push("at least one skill");
  if (!p.experience.some((e) => e.bullets.length)) missing.push("at least one role with achievements");
  return missing;
}
