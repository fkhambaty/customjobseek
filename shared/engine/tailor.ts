import type { Bullet, FitResult, Profile, ResumeCapabilityGroup, TailoredResume, TailoredRole } from "../types";
import { SKILL_CATALOGUE, mentionedNamesIn, mentions, normalise, termForName, type Term } from "./text";

const RECENT_ROLE_BULLETS = 6;
const OLDER_ROLE_BULLETS = 2;
const RECENT_ROLE_COUNT = 1;
const MIN_ROLE_BULLETS = 2;
const CORE_STRENGTHS = 8;

const DATA_ENGINEER_STRENGTHS = [
  "Snowflake",
  "dbt",
  "SQL",
  "Analytics Engineering",
  "PostgreSQL",
  "SQL Server",
  "Airflow",
  "Data Modelling",
  "ETL",
  "Data Pipelines",
  "Data Warehousing",
  "AWS",
  "S3",
  "Python",
] as const;

const ENVIRONMENT_TERMS = new Set([
  "Snowflake",
  "dbt",
  "SQL",
  "PostgreSQL",
  "SQL Server",
  "MySQL",
  "Airflow",
  "Redshift",
  "AWS",
  "S3",
  "Python",
  "C#",
  "Git",
  "SSIS",
  "Tableau",
  "Looker",
  "Qlik",
]);

const GROUPS = [
  "Warehousing & Transformation",
  "Orchestration & Quality",
  "Data Architecture & Modelling",
  "Reporting & Enablement",
  "Governance & Regulated Delivery",
  "Technical Leadership",
  "Additional Capabilities",
] as const;

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

function catalogueNames(text: string): string[] {
  const names = mentionedNamesIn([normalise(text)], SKILL_CATALOGUE)[0] ?? new Set<string>();
  return SKILL_CATALOGUE.filter((term) => names.has(term.name)).map((term) => term.name);
}

function displayStrength(name: string): string {
  if (name === "SQL Server") return "MSSQL";
  if (name === "Airflow") return "Apache Airflow";
  return name;
}

function capabilityGroup(name: string): (typeof GROUPS)[number] {
  const text = normalise(name);
  if (/lead|mentor|hiring|roadmap|design review|technology evaluation|distributed|executive/.test(text)) {
    return "Technical Leadership";
  }
  if (/kpi|metric|report|self-service|metabase|looker|tableau|qlik|ssrs|stakeholder|training|enablement/.test(text)) {
    return "Reporting & Enablement";
  }
  if (/airflow|pipeline|dependency|test|quality framework|validation|reconciliation|root-cause|code-review|release|git-based/.test(text)) {
    return "Orchestration & Quality";
  }
  if (/dimensional|model|dimension|grain|star schema|slowly changing|semantic|architecture standard|schema|lineage|olap|cube/.test(text)) {
    return "Data Architecture & Modelling";
  }
  if (/snowflake|redshift|postgres|mssql|mysql|sql|dbt|etl|elt|ssis|ssas|migration|warehouse|workload|query/.test(text)) {
    return "Warehousing & Transformation";
  }
  if (/governance|compliance|access control|authorisation|traceability|hipaa|hl7|enterprise|public-sector|aws|s3|python|c#|git/.test(text)) {
    return "Governance & Regulated Delivery";
  }
  return "Additional Capabilities";
}

function capabilityGroups(skills: string[], jobTitle: string): ResumeCapabilityGroup[] {
  const grouped = new Map<(typeof GROUPS)[number], string[]>();
  for (const skill of skills) {
    const group = capabilityGroup(skill);
    const items = grouped.get(group) ?? [];
    items.push(skill);
    grouped.set(group, items);
  }
  const dataRole = /\b(data|analytics)\s+(engineer|engineering|architect)\b/i.test(jobTitle);
  const order = dataRole
    ? GROUPS
    : [
        "Technical Leadership",
        "Data Architecture & Modelling",
        "Warehousing & Transformation",
        "Orchestration & Quality",
        "Reporting & Enablement",
        "Governance & Regulated Delivery",
        "Additional Capabilities",
      ] as const;
  return order.flatMap((name) => {
    const items = grouped.get(name) ?? [];
    return items.length > 0 ? [{ name, items }] : [];
  });
}

function selectCoreStrengths(profile: Profile, fit: FitResult, jobTitle: string, ownSkills: string[]): string[] {
  const held = new Set(ownSkills.flatMap(catalogueNames));
  const profileWords = normalise(`${profile.headline} ${profile.summary}`);
  if (/\banalytics engineer/.test(profileWords)) held.add("Analytics Engineering");
  const matched = new Set([...fit.matchedRequired, ...fit.matchedOther]);
  const title = normalise(jobTitle);
  const priority = /\bdata engineer/.test(title) ? DATA_ENGINEER_STRENGTHS : [...matched];
  const selected: string[] = [];
  for (const name of [...priority, ...matched]) {
    if (!held.has(name) || selected.includes(name)) continue;
    selected.push(name);
    if (selected.length === CORE_STRENGTHS) break;
  }
  if (selected.length < CORE_STRENGTHS) {
    for (const name of held) {
      if (selected.includes(name)) continue;
      selected.push(name);
      if (selected.length === CORE_STRENGTHS) break;
    }
  }
  return selected.map(displayStrength);
}

function tailoredHeadline(profile: Profile, jobTitle: string, strengths: string[]): string {
  if (!/\bdata engineer/.test(normalise(jobTitle))) return profile.headline;
  const preferred = ["Snowflake", "dbt", "SQL", "Apache Airflow", "Data Warehousing", "PostgreSQL", "MSSQL"]
    .filter((name) => strengths.includes(name))
    .slice(0, 4);
  return preferred.length > 0
    ? `DATA ENGINEER | ${preferred.join(", ")} & WAREHOUSE PLATFORMS`.toUpperCase()
    : profile.headline;
}

function selectedImpact(profile: Profile, weighted: { term: Term; weight: number }[]): string[] {
  const bullets = profile.experience.flatMap((role) => role.bullets);
  return bullets
    .map((bullet, index) => ({
      bullet,
      index,
      score: bulletScore(bullet.text, weighted) + (/\d|award|reduc|improv|cut|built|led/i.test(bullet.text) ? 2 : 0),
    }))
    .filter((row) => /\d|award|reduc|improv|cut|built|led/i.test(row.bullet.text))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 6)
    .map((row) => row.bullet.text);
}

function roleEnvironment(bullets: Bullet[]): string[] {
  const names = mentionedNamesIn([normalise(bullets.map((bullet) => bullet.text).join("\n"))], SKILL_CATALOGUE)[0] ?? new Set<string>();
  return SKILL_CATALOGUE.filter((term) => names.has(term.name) && ENVIRONMENT_TERMS.has(term.name))
    .map((term) => displayStrength(term.name))
    .slice(0, 12);
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
      environment: roleEnvironment(bullets),
      omittedBulletCount: exp.bullets.length - bullets.length,
    };
  });

  const never = profile.neverClaim.map((n) => termForName(n));
  const isNever = (name: string) => never.some((t) => mentions(normalise(name), t));
  const ownSkills = profile.skills.map((s) => s.name.trim()).filter((s) => s && !isNever(s));
  const matched = new Set([...fit.matchedRequired, ...fit.matchedOther].map((s) => s.toLowerCase()));
  const isMatched = (skill: string) => catalogueNames(skill).some((name) => matched.has(name.toLowerCase()));
  const skills = [
    ...ownSkills.filter(isMatched),
    ...ownSkills.filter((skill) => !isMatched(skill)),
  ];
  const coreStrengths = selectCoreStrengths(profile, fit, job.title, ownSkills);

  const contact = [profile.email, profile.phone, ...profile.links].map((c) => c.trim()).filter(Boolean);
  const aiAssistedDelivery = profile.experience
    .flatMap((role) => role.bullets)
    .find((bullet) => /\bAI-assisted\b/i.test(bullet.text))
    ?.text;

  const resume: Omit<TailoredResume, "provenance"> = {
    fullName: profile.fullName,
    headline: tailoredHeadline(profile, job.title, coreStrengths),
    contact,
    summary: profile.summary,
    coreStrengths,
    selectedImpact: selectedImpact(profile, weighted),
    capabilityGroups: capabilityGroups(skills, job.title),
    aiAssistedDelivery,
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
    ...(r.selectedImpact ?? []),
    ...(r.capabilityGroups ?? []).flatMap((group) => [group.name, ...group.items]),
    r.aiAssistedDelivery ?? "",
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
