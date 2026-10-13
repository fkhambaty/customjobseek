import type { Bullet, FitResult, Profile, TailoredResume, TailoredRole } from "../types";
import { mentions, normalise, termForName, type Term } from "./text";

const RECENT_ROLE_BULLETS = 6;
const OLDER_ROLE_BULLETS = 3;
const RECENT_ROLE_COUNT = 2;
const MIN_ROLE_BULLETS = 2;
const CORE_STRENGTHS = 8;

interface JobRef {
  id: string;
  title: string;
  company: string;
}

function bulletScore(text: string, weighted: { term: Term; weight: number }[]): number {
  const n = normalise(text);
  let score = 0;
  for (const { term, weight } of weighted) if (mentions(n, term)) score += weight;
  if (/\d/.test(text)) score += 0.5;
  return score;
}

// Lines with no bearing on the job are dropped once the role already shows MIN_ROLE_BULLETS.
function pickBullets(bullets: Bullet[], limit: number, weighted: { term: Term; weight: number }[]): Bullet[] {
  const ranked = bullets
    .map((b, index) => ({ b, index, score: bulletScore(b.text, weighted) }))
    .sort((x, y) => y.score - x.score || x.index - y.index);
  return ranked
    .filter((r, i) => r.score > 0 || i < MIN_ROLE_BULLETS)
    .slice(0, limit)
    .map((r) => r.b);
}

// Builds the resume only from lines the candidate wrote. Nothing is paraphrased or invented:
// the engine decides which verified lines to show and in what order.
export function tailorResume(profile: Profile, fit: FitResult, job: JobRef): TailoredResume {
  const weighted = [
    ...fit.matchedRequired.map((name) => ({ term: termForName(name), weight: 3 })),
    ...fit.matchedOther.map((name) => ({ term: termForName(name), weight: 1 })),
  ];

  const roles: TailoredRole[] = profile.experience.map((exp, i) => {
    const limit = i < RECENT_ROLE_COUNT ? RECENT_ROLE_BULLETS : OLDER_ROLE_BULLETS;
    const bullets = pickBullets(exp.bullets.filter((b) => b.text.trim()), limit, weighted);
    return {
      experienceId: exp.id,
      company: exp.company,
      title: exp.title,
      location: exp.location,
      start: exp.start,
      end: exp.end,
      bullets,
      omittedBulletCount: exp.bullets.length - bullets.length,
    };
  });

  const never = profile.neverClaim.map((n) => termForName(n));
  const isNever = (name: string) => never.some((t) => mentions(normalise(name), t));
  const ownSkills = profile.skills.map((s) => s.name.trim()).filter((s) => s && !isNever(s));
  const matched = new Set([...fit.matchedRequired, ...fit.matchedOther].map((s) => s.toLowerCase()));
  const canonical = (s: string) => termForName(s).name.toLowerCase();
  const skills = [
    ...ownSkills.filter((s) => matched.has(canonical(s))),
    ...ownSkills.filter((s) => !matched.has(canonical(s))),
  ];
  const coreStrengths = skills.filter((s) => matched.has(canonical(s))).slice(0, CORE_STRENGTHS);

  const contact = [profile.email, profile.phone, ...profile.links].map((c) => c.trim()).filter(Boolean);

  const resume: Omit<TailoredResume, "provenance"> = {
    fullName: profile.fullName,
    headline: profile.headline,
    contact,
    summary: profile.summary,
    coreStrengths,
    skills,
    roles,
    education: profile.education,
    certifications: profile.certifications,
    generatedFor: { jobId: job.id, title: job.title, company: job.company },
  };
  return { ...resume, provenance: checkProvenance(resume, profile) };
}

export function resumeText(r: Omit<TailoredResume, "provenance">): string {
  return [
    r.fullName,
    r.headline,
    r.summary,
    r.coreStrengths.join(" "),
    r.skills.join(" "),
    ...r.roles.flatMap((role) => [role.title, role.company, ...role.bullets.map((b) => b.text)]),
    ...r.education.map((e) => `${e.degree} ${e.institution}`),
    ...r.certifications.map((c) => `${c.name} ${c.issuer}`),
  ].join("\n");
}

export function checkProvenance(
  r: Omit<TailoredResume, "provenance">,
  profile: Profile,
): TailoredResume["provenance"] {
  const source = new Map(profile.experience.flatMap((e) => e.bullets.map((b) => [b.id, b.text] as const)));
  const untraceableLines = r.roles.flatMap((role) =>
    role.bullets.filter((b) => source.get(b.id) !== b.text).map((b) => b.text),
  );
  const text = normalise(resumeText(r));
  const neverClaimHits = profile.neverClaim
    .filter((n) => n.trim())
    .filter((n) => mentions(text, termForName(n)));
  return { untraceableLines, neverClaimHits };
}
