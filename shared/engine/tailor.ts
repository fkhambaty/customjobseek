import type { Bullet, Certification, FitResult, Profile, ResumeCapabilityGroup, TailoredResume, TailoredRole } from "../types";
import { SKILL_CATALOGUE, mentionedNamesIn, mentions, normalise, termForName } from "./text";

// The resume follows the CommandCenter standard: it selects and orders the candidate's own
// lines for the role's shape (track and seniority). Nothing is paraphrased from the posting.

const CORE_STRENGTHS = 8;
const IMPACT_COUNT = 6;
export const MIN_IMPACT = 4;
export const MIN_BULLETS_PER_ROLE = 2;

export type Track = "product" | "bi" | "data_eng";
export type Seniority = "ic" | "lead";

// keyword -> evidence tags. Used only to rank existing lines.
const TAG_SIGNALS: Record<string, string[]> = {
  dbt: ["dbt"], sql: ["sql"], airflow: ["airflow"], orchestration: ["airflow"],
  redshift: ["redshift"], warehouse: ["warehouse"],
  snowflake: ["snowflake", "warehouse", "sql"], "dynamic table": ["snowflake", "warehouse"],
  streams: ["snowflake", "etl"], snowpipe: ["snowflake", "etl"],
  databricks: ["warehouse", "etl"], spark: ["etl", "engineering"], bigquery: ["warehouse", "sql"],
  ingestion: ["etl", "integration"], integration: ["integration"],
  etl: ["etl"], elt: ["etl"], pipeline: ["etl", "reliability"],
  model: ["modelling"], modeling: ["modelling"], modelling: ["modelling"],
  dimensional: ["modelling"], "star schema": ["modelling"], semantic: ["semantic"],
  kpi: ["kpi"], metric: ["kpi"], reconcil: ["reconciliation"],
  "data quality": ["quality"], governance: ["quality"], lineage: ["quality"],
  test: ["testing"], documentation: ["documentation"],
  reliability: ["reliability"], monitor: ["monitoring", "reliability"],
  incident: ["reliability"], performance: ["performance"], tun: ["performance"],
  bi: ["bi"], "business intelligence": ["bi"], report: ["reporting"],
  dashboard: ["bi", "reporting"], "self-service": ["enablement"],
  tableau: ["bi"], looker: ["bi"], metabase: ["bi"], "power bi": ["bi"], qlik: ["bi"],
  finance: ["finance"], invoice: ["finance"], procurement: ["finance"],
  spend: ["finance"], payment: ["finance"], healthcare: ["healthcare"],
  stakeholder: ["stakeholders"], requirement: ["requirements", "ba"],
  "business analyst": ["ba"], architect: ["architecture"],
  mentor: ["mentoring"], coach: ["mentoring"], lead: ["leadership"], led: ["leadership"],
  manage: ["leadership"], hiring: ["leadership"], team: ["leadership"],
  "operating model": ["process"], prioriti: ["process"], intake: ["process"],
  standard: ["standards"], pattern: ["patterns"], "code review": ["standards"], "code-review": ["standards"],
  training: ["enablement"], enablement: ["enablement"], adoption: ["enablement"],
  automat: ["automation"], python: ["engineering"],
  enterprise: ["enterprise"], implementation: ["delivery"], delivery: ["delivery"], saas: ["delivery"],
  roadmap: ["process", "product"], backlog: ["product"], "user stor": ["product"],
};

const LEAD_TAGS = new Set(["leadership", "mentoring", "process", "stakeholders", "enablement",
  "delivery", "efficiency", "patterns", "standards", "architecture"]);
const HANDS_TAGS = new Set(["sql", "dbt", "snowflake", "redshift", "etl", "airflow", "warehouse",
  "modelling", "quality", "testing", "reliability", "automation", "performance", "engineering", "integration"]);

const TRACK_WORDS: Record<Track, readonly string[]> = {
  product: ["product manager", "product owner", "product lead", "project manager",
    "programme manager", "program manager", "delivery manager", "delivery lead",
    "implementation manager", "implementation lead", "engagement manager", "transformation",
    "scrum", "technical program"],
  bi: ["business intelligence", " bi ", "bi ", "analytics", "analyst", "reporting", "insights",
    "semantic", "dashboard", "metrics"],
  data_eng: ["data engineer", "data engineering", "platform engineer", "etl", "pipeline",
    "warehouse", "data architect", "analytics engineer"],
};
const LEAD_WORDS = ["head", "director", "vp", "vice president", "chief", "principal",
  "manager", "lead", "leader", "avp", "associate director", "staff"];
const PM_MARKERS = ["prd", "product requirement", "product vision", "roadmap", "mvp", "user stories",
  "acceptance criteria", "backlog", "sprint review", "product lifecycle", "go-to-market",
  "feature prioritization", "feature prioritisation", "release plan"];

type Slot =
  | "analytics_engineer" | "data_engineer" | "data_engineering_lead" | "data_architect"
  | "solution_architect" | "bi_lead" | "analytics_manager" | "business_analyst"
  | "product" | "technical_delivery_lead" | "implementation_lead";

// Longest key wins, so "data engineering lead" beats "data engineer".
const HEADLINE_MAP: Record<string, Slot> = {
  "analytics engineer": "analytics_engineer", "senior data analyst": "analytics_engineer",
  dbt: "analytics_engineer", analytics: "analytics_engineer",
  "data engineer": "data_engineer", "data platform": "data_engineer", pipeline: "data_engineer",
  "snowflake engineer": "data_engineer", "etl developer": "data_engineer",
  "data engineering lead": "data_engineering_lead", "lead data engineer": "data_engineering_lead",
  "data engineering manager": "data_engineering_lead", "head of data engineering": "data_engineering_lead",
  "director of data engineering": "data_engineering_lead", "engineering manager, data": "data_engineering_lead",
  architect: "data_architect", "data architect": "data_architect", "data modeller": "data_architect",
  "data modeler": "data_architect",
  solution: "solution_architect", "solution architect": "solution_architect", "solutions architect": "solution_architect",
  "business intelligence": "bi_lead", "bi ": "bi_lead", insights: "bi_lead",
  "analytics manager": "analytics_manager", "bi manager": "analytics_manager", "head of bi": "analytics_manager",
  "business intelligence manager": "analytics_manager", "reporting manager": "analytics_manager",
  "team lead": "analytics_manager", "manager, analytics": "analytics_manager",
  "business analyst": "business_analyst", analyst: "business_analyst",
  "product manager": "product", "product owner": "product", "technical program manager": "product",
  "delivery manager": "technical_delivery_lead", "delivery lead": "technical_delivery_lead",
  "technical lead": "technical_delivery_lead", "programme manager": "technical_delivery_lead",
  "program manager": "technical_delivery_lead",
  "implementation lead": "implementation_lead", "implementation manager": "implementation_lead",
  "implementation consultant": "implementation_lead",
};

// toolsFirst: "DATA ENGINEER | SNOWFLAKE, DBT, SQL, AIRFLOW & WAREHOUSE PLATFORMS".
// Otherwise the focus leads: "ANALYTICS & BI MANAGER | PEOPLE LEADERSHIP & KPI GOVERNANCE | TABLEAU, LOOKER".
const SLOT_HEADLINES: Record<Slot, { label: string; terms: string[]; max: number; tail: string; toolsFirst: boolean }> = {
  data_engineer: { label: "Data Engineer", terms: ["Snowflake", "dbt", "SQL", "Airflow", "Databricks", "Apache Spark", "Kafka", "Redshift", "BigQuery"], max: 4, tail: "Warehouse Platforms", toolsFirst: true },
  data_engineering_lead: { label: "Data Engineering Lead", terms: ["Snowflake", "dbt", "Airflow", "Databricks", "Apache Spark", "Redshift"], max: 3, tail: "Warehouse Platforms | Team Building & Delivery Standards", toolsFirst: true },
  analytics_engineer: { label: "Analytics Engineer", terms: ["dbt", "SQL", "Snowflake", "BigQuery", "Redshift"], max: 3, tail: "Warehouse Modelling & Reconciliation", toolsFirst: true },
  data_architect: { label: "Data Architect", terms: ["Snowflake", "dbt", "Redshift", "Databricks", "BigQuery"], max: 2, tail: "Warehouse Foundations, Dimensional Modelling & Governance", toolsFirst: true },
  solution_architect: { label: "Solution Architect", terms: ["Snowflake", "dbt", "Airflow", "AWS", "Azure", "GCP"], max: 3, tail: "Enterprise Data Delivery, Integration & Governance", toolsFirst: false },
  bi_lead: { label: "Business Intelligence Lead", terms: ["Power BI", "Tableau", "Looker", "Qlik", "SQL"], max: 3, tail: "Semantic Layers, KPI Governance & Enablement", toolsFirst: false },
  analytics_manager: { label: "Analytics & BI Manager", terms: ["Power BI", "Tableau", "Looker", "Qlik", "dbt"], max: 3, tail: "People Leadership, Semantic Layers & KPI Governance", toolsFirst: false },
  business_analyst: { label: "Technical Business Analyst", terms: ["SQL", "Excel", "Power BI", "Tableau"], max: 3, tail: "Data Requirements, Modelling & Reconciliation", toolsFirst: false },
  product: { label: "Technical Product Manager", terms: ["SQL", "Snowflake", "dbt"], max: 3, tail: "Data Platform Requirements, KPI Definition & Delivery Ownership", toolsFirst: false },
  technical_delivery_lead: { label: "Technical Delivery Lead", terms: ["SQL", "Snowflake", "dbt"], max: 3, tail: "Enterprise Implementations, Integrations & Reporting", toolsFirst: false },
  implementation_lead: { label: "Implementation Lead", terms: ["SQL", "SQL Server", "Snowflake"], max: 3, tail: "Enterprise Delivery, Integrations & Stakeholder Governance", toolsFirst: false },
};

const DATA_SLOTS = new Set<Slot>(["analytics_engineer", "data_engineer", "data_architect", "bi_lead", "business_analyst", "solution_architect"]);
const IC_DATA_SLOTS = new Set<Slot>(["analytics_engineer", "data_engineer", "business_analyst"]);

const DATA_ENGINEER_STRENGTHS = ["Snowflake", "dbt", "SQL", "Analytics Engineering", "PostgreSQL", "SQL Server",
  "Airflow", "Data Modelling", "ETL", "Data Pipelines", "Data Warehousing", "AWS", "S3", "Python"] as const;

const ENVIRONMENT_TERMS = new Set(["Snowflake", "dbt", "SQL", "PostgreSQL", "SQL Server", "MySQL", "Airflow",
  "Redshift", "BigQuery", "Databricks", "Apache Spark", "Kafka", "AWS", "Azure", "GCP", "S3", "Python", "C#",
  "Git", "SSIS", "Tableau", "Looker", "Qlik", "Power BI", "Excel", "Java", "TypeScript", "React", "Node.js",
  "Docker", "Kubernetes", "Terraform", "Informatica", "Fivetran", "Oracle", "MongoDB"]);

const GROUPS = [
  "Warehousing & Transformation",
  "Orchestration & Quality",
  "Data Architecture & Modelling",
  "Reporting & Enablement",
  "Governance & Regulated Delivery",
  "Technical Leadership",
  "Additional Capabilities",
] as const;
type GroupName = (typeof GROUPS)[number];

const IMPACT_SIGNAL = /\d|award|innovation|promoted|from scratch/i;
const AI_LINE = /\bAI-assisted\b/i;

interface JobRef {
  id: string;
  title: string;
  company: string;
  description?: string;
}

/** Resumes use commas and the word "to". A hyphen inside a word stays. */
export function resumePunctuation(text: string): string {
  return text
    .replace(/ — /g, ", ")
    .replace(/—/g, ", ")
    .replace(/ – /g, " to ")
    .replace(/–/g, " to ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function keywordHits(text: string, keyword: string): number {
  const escaped = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = keyword.length <= 4 ? `(?<![a-z0-9])${escaped}` : escaped;
  const lead = keyword.startsWith(" ") ? " " : "";
  return (text.match(new RegExp(lead + pattern, "g")) ?? []).length;
}

function tagWeights(text: string): Map<string, number> {
  const low = ` ${normalise(text)} `;
  const weights = new Map<string, number>();
  for (const [keyword, tags] of Object.entries(TAG_SIGNALS)) {
    const n = keywordHits(low, keyword);
    if (!n) continue;
    for (const tag of tags) weights.set(tag, (weights.get(tag) ?? 0) + n);
  }
  return weights;
}

function lineTags(text: string): Set<string> {
  return new Set(tagWeights(text).keys());
}

export function roleShape(title: string, description = ""): { track: Track; seniority: Seniority } {
  const t = ` ${normalise(title)} `;
  const blob = `${t} ${normalise(description).slice(0, 1200)}`;
  let track: Track | null = null;
  for (const key of ["product", "data_eng", "bi"] as const) {
    if (TRACK_WORDS[key].some((w) => t.includes(w))) {
      track = key;
      break;
    }
  }
  if (!track) {
    if (PM_MARKERS.filter((m) => blob.includes(m)).length >= 2) track = "product";
    else {
      const scores = (Object.keys(TRACK_WORDS) as Track[]).map((k) => ({
        k,
        score: TRACK_WORDS[k].reduce((sum, w) => sum + blob.split(w).length - 1, 0),
      }));
      const best = scores.reduce((a, b) => (b.score > a.score ? b : a));
      track = best.score > 0 ? best.k : "bi";
    }
  }
  const seniority: Seniority = LEAD_WORDS.some((w) => new RegExp(`(?<![a-z])${w}(?![a-z])`).test(t)) ? "lead" : "ic";
  return { track, seniority };
}

function shapeWeights(base: Map<string, number>, track: Track, seniority: Seniority): Map<string, number> {
  const w = new Map(base);
  const bump = (tag: string, by: number) => w.set(tag, Math.max(0, (w.get(tag) ?? 0) + by));
  for (const tag of seniority === "lead" ? LEAD_TAGS : HANDS_TAGS) bump(tag, seniority === "lead" ? 6 : 4);
  if (seniority === "ic") for (const tag of ["leadership", "mentoring"]) bump(tag, -3);
  switch (track) {
    case "product":
      for (const tag of ["ba", "requirements", "stakeholders", "kpi", "delivery", "process", "reconciliation", "finance", "product"]) bump(tag, 5);
      break;
    case "bi":
      for (const tag of ["bi", "reporting", "semantic", "kpi", "enablement"]) bump(tag, 5);
      break;
    case "data_eng":
      for (const tag of ["dbt", "snowflake", "redshift", "airflow", "etl", "sql", "warehouse"]) bump(tag, 5);
      break;
    default: {
      const unexpected: never = track;
      throw new Error(String(unexpected));
    }
  }
  return w;
}

function scoreTags(tags: Set<string>, weights: Map<string, number>): number {
  let score = 0;
  for (const tag of tags) score += weights.get(tag) ?? 0;
  return score;
}

function rankLines<T>(items: T[], text: (item: T) => string, weights: Map<string, number>): T[] {
  return items
    .map((item, index) => ({ item, index, score: scoreTags(lineTags(text(item)), weights) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((row) => row.item);
}

function roleLimit(index: number, seniority: Seniority): number {
  const limits = seniority === "lead" ? [8, 8, 3] : [9, 5, 2];
  return limits[index] ?? MIN_BULLETS_PER_ROLE;
}

function pickBullets(bullets: Bullet[], limit: number, weights: Map<string, number>, seniority: Seniority): Bullet[] {
  const ranked = rankLines(bullets, (b) => b.text, weights);
  const lead = seniority === "lead" ? LEAD_TAGS : HANDS_TAGS;
  const first = ranked.filter((b) => [...lineTags(b.text)].some((t) => lead.has(t)));
  const rest = ranked.filter((b) => !first.includes(b));
  return [...first, ...rest].slice(0, limit).map((b) => ({ id: b.id, text: resumePunctuation(b.text) }));
}

function catalogueNames(text: string): string[] {
  const names = mentionedNamesIn([normalise(text)], SKILL_CATALOGUE)[0] ?? new Set<string>();
  return SKILL_CATALOGUE.filter((term) => names.has(term.name)).map((term) => term.name);
}

function displayTerm(name: string): string {
  if (name === "SQL Server") return "MSSQL";
  if (name === "Airflow") return "Apache Airflow";
  return name;
}

// First match wins. The order settles skills that name two things ("Semantic and Governed Metric Layers").
const GROUP_RULES: [RegExp, GroupName][] = [
  [/architecture governance|leading through|mentor|hiring|team building|design review|technology evaluation|roadmap|distributed and global|^executive reporting$|people leadership|coaching|line management/, "Technical Leadership"],
  [/^(snowflake|dbt(?!-test)|redshift|amazon redshift|postgres|mssql|ms sql|sql server|mysql|oracle|bigquery|databricks|apache spark|spark|kafka|expert sql|advanced sql|sql$|etl|elt|ssis|ssas|informatica|fivetran)|migration|workload|query/, "Warehousing & Transformation"],
  [/traceability|compliance|access control|authoris|authoriz|hipaa|gdpr|sox|hl7|enterprise and|public-sector|^aws$|^s3$|^python$|^c#$|^git$|^azure|^gcp|^java$/, "Governance & Regulated Delivery"],
  [/dimensional|model|dimension|grain|star schema|slowly changing|semantic|architecture standard|schema|lineage|olap|cube/, "Data Architecture & Modelling"],
  [/airflow|pipeline|dependency|test|validation|reconciliation|root-cause|code-review|release|git-based|orchestrat|monitor|data quality/, "Orchestration & Quality"],
  [/kpi|metric|report|self-service|metabase|looker|tableau|qlik|power bi|ssrs|stakeholder|training|enablement|dashboard|written documentation/, "Reporting & Enablement"],
  [/sql|warehouse|lakehouse/, "Warehousing & Transformation"],
  [/governance|enterprise|aws|azure|gcp|cloud/, "Governance & Regulated Delivery"],
];

function capabilityGroup(name: string): GroupName {
  const text = normalise(name);
  return GROUP_RULES.find(([rule]) => rule.test(text))?.[1] ?? "Additional Capabilities";
}

function capabilityGroups(
  skills: string[],
  weights: Map<string, number>,
  jobText: string,
  seniority: Seniority,
  slot: Slot | null,
): ResumeCapabilityGroup[] {
  const grouped = new Map<GroupName, string[]>();
  for (const skill of skills) {
    const group = capabilityGroup(skill);
    grouped.set(group, [...(grouped.get(group) ?? []), resumePunctuation(skill)]);
  }
  const score = (name: GroupName, items: string[]) => {
    const blob = normalise(`${name} ${items.join(" ")}`);
    let total = 0;
    for (const [tag, weight] of weights) if (blob.includes(tag)) total += weight;
    return total;
  };
  const low = normalise(jobText);
  const leadsWithTransformation = low.includes("dbt") || low.includes("analytics engineer");
  const rank = (name: GroupName): number => {
    if (name === "Additional Capabilities") return 3;
    if (name === "Technical Leadership") return seniority === "lead" ? 0 : 2;
    if (slot === "data_architect" && name === "Data Architecture & Modelling") return 0.25;
    if ((slot === "bi_lead" || slot === "analytics_manager") && name === "Reporting & Enablement") return 0.25;
    if (leadsWithTransformation && name === "Warehousing & Transformation") return 0.5;
    return 1;
  };
  return GROUPS.flatMap((name) => {
    const items = grouped.get(name) ?? [];
    return items.length > 0 ? [{ name, items, score: score(name, items) }] : [];
  })
    .sort((a, b) => rank(a.name) - rank(b.name) || b.score - a.score)
    .map(({ name, items }) => ({ name, items }));
}

function selectCoreStrengths(profile: Profile, fit: FitResult, jobTitle: string, ownSkills: string[]): string[] {
  const held = new Set(ownSkills.flatMap(catalogueNames));
  const profileWords = normalise(`${profile.headline} ${profile.summary}`);
  if (/\banalytics engineer/.test(profileWords)) held.add("Analytics Engineering");
  const matched = new Set([...fit.matchedRequired, ...fit.matchedOther]);
  const priority = /\bdata engineer/.test(normalise(jobTitle)) ? DATA_ENGINEER_STRENGTHS : [...matched];
  const selected: string[] = [];
  for (const name of [...priority, ...matched, ...held]) {
    if (!held.has(name) || selected.includes(name)) continue;
    selected.push(name);
    if (selected.length === CORE_STRENGTHS) break;
  }
  return selected.map(displayTerm);
}

function headlineSlot(title: string, track: Track, seniority: Seniority): Slot | null {
  const t = ` ${normalise(title)} `;
  let slot: Slot | null = null;
  for (const key of Object.keys(HEADLINE_MAP).sort((a, b) => b.length - a.length)) {
    if (t.includes(key)) {
      slot = HEADLINE_MAP[key] ?? null;
      break;
    }
  }
  if (track === "product" && slot !== null && DATA_SLOTS.has(slot)) slot = "product";
  if (seniority === "lead" && slot !== null && IC_DATA_SLOTS.has(slot)) {
    slot = track === "bi" ? "analytics_manager" : "data_engineering_lead";
  }
  return slot;
}

function tailoredHeadline(profile: Profile, held: Set<string>, slot: Slot | null, jobText = ""): string {
  if (!slot) return profile.headline;
  const spec = SLOT_HEADLINES[slot];
  const lowJob = normalise(jobText);
  const heldTerms = spec.terms.filter((name) => held.has(name));
  // Tools named in the posting lead, so a Snowflake-heavy JD never drops Snowflake from the header.
  const ranked = [
    ...heldTerms.filter((name) => lowJob.includes(normalise(name))),
    ...heldTerms.filter((name) => !lowJob.includes(normalise(name))),
  ];
  const terms = ranked.slice(0, spec.max);
  if (terms.length === 0) return profile.headline;
  const focusHasAnd = (spec.tail.split(" | ")[0] ?? "").includes("&");
  const text = spec.toolsFirst
    ? `${spec.label} | ${terms.join(", ")}${focusHasAnd ? ", " : " & "}${spec.tail}`
    : `${spec.label} | ${spec.tail} | ${terms.join(", ")}`;
  return text.toUpperCase();
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function monthIndex(value: string): number | null {
  const match = /([a-z]{3})[a-z]*\.?\s+(\d{4})/i.exec(value.trim());
  if (!match?.[1] || !match[2]) return null;
  const month = MONTHS.indexOf(match[1].toLowerCase());
  return month < 0 ? null : Number(match[2]) * 12 + month;
}

function tenure(start: string, end: string): string | null {
  const from = monthIndex(start);
  const to = monthIndex(end);
  if (from === null || to === null || to <= from) return null;
  const years = Math.floor((to - from) / 12);
  const months = (to - from) % 12;
  const parts = [years ? `${years} year${years === 1 ? "" : "s"}` : "", months ? `${months} month${months === 1 ? "" : "s"}` : ""].filter(Boolean);
  return parts.join(" and ") || null;
}

function careerLine(profile: Profile): string {
  const [current, previous] = profile.experience;
  const bare = (s: string) => s.trim().replace(/[.\s]+$/, "");
  if (!current?.title.trim() || !current.company.trim()) return "";
  let line = `Most recently ${bare(current.title)} at ${bare(current.company)}.`;
  if (previous?.title.trim() && previous.company.trim()) {
    const span = tenure(previous.start, previous.end);
    line += span
      ? ` Previously ${span} at ${bare(previous.company)}, ending as ${bare(previous.title)}.`
      : ` Previously ${bare(previous.title)} at ${bare(previous.company)}.`;
  }
  return resumePunctuation(line);
}

function condense(text: string): string {
  const clean = resumePunctuation(text);
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
  const semi = clean.indexOf("; ");
  let cut = semi > 0 ? clean.slice(0, semi) : clean;
  if (words(cut) > 22) {
    const commas = [...cut.matchAll(/, /g)].map((m) => m.index ?? 0);
    const boundary = commas.find((i) => words(cut.slice(0, i)) >= 8);
    if (boundary) cut = cut.slice(0, boundary);
  }
  cut = cut.replace(/[.,;:\s]+$/, "");
  return `${cut}.`;
}

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;
// "HL7" or "S3" is a name, not a measured outcome.
const hasImpact = (s: string) => IMPACT_SIGNAL.test(s.replace(/[A-Za-z]+\d+/g, ""));

function impactLine(text: string): string | null {
  const short = condense(text);
  if (hasImpact(short) && wordCount(short) <= 26) return short;
  const full = condense(text.replace(/;.*$/, ""));
  if (hasImpact(full) && wordCount(full) <= 32) return full;
  return null;
}

// Quantified or recognised outcomes lead. When there are fewer than six, the strongest
// short lines for this role shape fill the grid.
function selectedImpact(profile: Profile, weights: Map<string, number>): string[] {
  const bullets = profile.experience.flatMap((role) => role.bullets.filter((b) => b.text.trim() && !AI_LINE.test(b.text)));
  const measured = bullets.filter((b) => hasImpact(b.text));
  const picked: string[] = [];
  const add = (line: string | null) => {
    if (line && !picked.includes(line) && picked.length < IMPACT_COUNT) picked.push(line);
  };
  for (const b of rankLines(measured, (x) => x.text, weights)) add(impactLine(b.text));
  for (const b of rankLines(bullets.filter((x) => !measured.includes(x)), (x) => x.text, weights)) {
    const short = condense(b.text);
    if (wordCount(short) <= 18) add(short);
  }
  return picked;
}

function roleEnvironment(bullets: Bullet[], held: Set<string>): string[] {
  const names = mentionedNamesIn([normalise(bullets.map((b) => b.text).join("\n"))], SKILL_CATALOGUE)[0] ?? new Set<string>();
  return SKILL_CATALOGUE
    .filter((term) => names.has(term.name) && ENVIRONMENT_TERMS.has(term.name) && held.has(term.name))
    .map((term) => displayTerm(term.name))
    .slice(0, 14);
}

const CERT_STOPWORDS = new Set(["with", "from", "what", "getting", "started", "building", "creating",
  "certification", "certified", "professional", "associate", "introduction", "basics", "course", "data"]);

function selectCertifications(certs: Certification[], jobText: string, isNever: (s: string) => boolean): Certification[] {
  const allowed = certs.filter((c) => c.name.trim() && !isNever(`${c.name} ${c.issuer}`));
  if (!jobText.trim()) return allowed.slice(0, 3);
  const jd = normalise(jobText);
  const jdTerms = new Set(catalogueNames(jobText));
  const scored = allowed.map((cert, index) => {
    const text = `${cert.name} ${cert.issuer}`;
    const termScore = catalogueNames(text).filter((n) => jdTerms.has(n)).length * 2;
    const wordScore = normalise(cert.name)
      .split(/[^a-z0-9+#]+/)
      .filter((w) => w.length > 3 && !CERT_STOPWORDS.has(w) && jd.includes(w)).length * 0.5;
    return { cert, index, score: termScore + wordScore };
  });
  const relevant = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  const chosen = relevant.slice(0, 3).map((s) => s.cert);
  for (const cert of allowed) {
    if (chosen.length >= 2) break;
    if (!chosen.includes(cert)) chosen.push(cert);
  }
  return allowed.filter((cert) => chosen.includes(cert));
}

const GITHUB_PROFILE = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)(?:\/.*)?$/i;
export const DEFAULT_GITHUB = "https://github.com/fkhambaty";

/** Canonical https://github.com/{user} from a profile or repo URL. */
export function githubProfileUrl(link: string): string {
  const match = link.trim().match(GITHUB_PROFILE);
  return match ? `https://github.com/${match[1]}` : "";
}

function contactKey(value: string): string {
  return value.replace(/\/+$/, "").toLowerCase();
}

function uniqueContact(parts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const value = part.trim();
    if (!value) continue;
    const key = contactKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function isEmailContact(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isPhoneContact(value: string): boolean {
  return /^[+()\d\s.-]{7,}$/.test(value);
}

/** Inserts the canonical GitHub URL after phone/email. Used when drawing stored contact lines too. */
export function ensureGithubContact(contact: readonly string[]): string[] {
  const items = contact.map((item) => item.trim()).filter(Boolean);
  const github = items.map(githubProfileUrl).find(Boolean) || DEFAULT_GITHUB;
  const rest = items.filter((item) => {
    const profileUrl = githubProfileUrl(item);
    if (profileUrl && contactKey(profileUrl) === contactKey(github)) return /github\.com\/[^/]+\/.+/i.test(item);
    return contactKey(item) !== contactKey(github);
  });
  const head: string[] = [];
  const tail: string[] = [];
  for (const item of rest) {
    if (isEmailContact(item) || isPhoneContact(item)) head.push(item);
    else tail.push(item);
  }
  return uniqueContact([...head, github, ...tail]);
}

export function ensureGithubContactLine(text: string): string {
  return ensureGithubContact(text.split(/\s*\|\s*/)).join(" | ");
}

/** Phone, email, then GitHub (canonical), then other links. A GitHub URL is always printed. */
export function resumeContact(profile: Pick<Profile, "phone" | "email" | "links">): string[] {
  return ensureGithubContact([profile.phone, profile.email, ...profile.links]);
}

// Builds the resume only from lines the candidate wrote. Nothing is invented:
// the engine decides which verified lines to show and in what order.
export function tailorResume(profile: Profile, fit: FitResult, job: JobRef): TailoredResume {
  const jobText = `${job.title} ${job.description ?? ""}`;
  const { track, seniority } = roleShape(job.title, job.description ?? "");
  const signals = tagWeights(jobText);
  for (const name of fit.matchedRequired) for (const tag of lineTags(name)) signals.set(tag, (signals.get(tag) ?? 0) + 3);
  for (const name of fit.matchedOther) for (const tag of lineTags(name)) signals.set(tag, (signals.get(tag) ?? 0) + 1);
  const weights = shapeWeights(signals, track, seniority);

  const never = profile.neverClaim.filter((n) => n.trim()).map((n) => termForName(n));
  const isNever = (text: string) => never.some((t) => mentions(normalise(text), t));
  const ownSkills = profile.skills.map((s) => s.name.trim()).filter((s) => s && !isNever(s));
  const held = new Set(ownSkills.flatMap(catalogueNames));
  for (const role of profile.experience) for (const b of role.bullets) for (const n of catalogueNames(b.text)) if (!isNever(n)) held.add(n);

  const roles: TailoredRole[] = profile.experience.map((exp, i) => {
    const usable = exp.bullets.filter((b) => b.text.trim() && !AI_LINE.test(b.text));
    const bullets = pickBullets(usable, roleLimit(i, seniority), weights, seniority);
    return {
      experienceId: exp.id,
      company: exp.company,
      title: exp.title,
      location: exp.location,
      start: exp.start,
      end: exp.end,
      bullets,
      environment: roleEnvironment(exp.bullets, held),
      omittedBulletCount: exp.bullets.length - bullets.length,
    };
  });

  const matched = new Set([...fit.matchedRequired, ...fit.matchedOther].map((s) => s.toLowerCase()));
  const isMatched = (skill: string) => catalogueNames(skill).some((name) => matched.has(name.toLowerCase()));
  const skills = [...ownSkills.filter(isMatched), ...ownSkills.filter((skill) => !isMatched(skill))];
  const coreStrengths = selectCoreStrengths(profile, fit, job.title, ownSkills);

  const contact = resumeContact(profile);
  const aiLine = profile.experience.flatMap((role) => role.bullets).find((b) => AI_LINE.test(b.text))?.text;
  const summary = resumePunctuation(profile.summary);
  const profileParagraphs = [summary, careerLine(profile)].filter(Boolean);

  const slot = headlineSlot(job.title, track, seniority);
  const resume: Omit<TailoredResume, "provenance"> = {
    fullName: profile.fullName,
    headline: resumePunctuation(tailoredHeadline(profile, held, slot, jobText)),
    contact,
    summary,
    profileParagraphs,
    coreStrengths,
    selectedImpact: selectedImpact(profile, weights),
    capabilityGroups: capabilityGroups(ownSkills, weights, jobText, seniority, slot),
    aiAssistedDelivery: aiLine ? resumePunctuation(aiLine) : undefined,
    skills,
    roles,
    education: profile.education,
    certifications: selectCertifications(profile.certifications, job.description ? jobText : "", isNever),
    generatedFor: { jobId: job.id, title: job.title, company: job.company },
  };
  return { ...resume, provenance: checkProvenance(resume, profile) };
}

/**
 * Removes the least load-bearing line, CommandCenter order: the oldest role's last
 * bullet first, then the impact grid, never below the floors. False when nothing may go.
 */
export function dropWeakestLine(resume: TailoredResume): boolean {
  for (const role of [...resume.roles].reverse()) {
    if (role.bullets.length > MIN_BULLETS_PER_ROLE) {
      role.bullets = role.bullets.slice(0, -1);
      role.omittedBulletCount += 1;
      return true;
    }
  }
  if ((resume.selectedImpact?.length ?? 0) > MIN_IMPACT) {
    resume.selectedImpact = resume.selectedImpact?.slice(0, -1);
    return true;
  }
  return false;
}

export function resumeText(r: Omit<TailoredResume, "provenance">): string {
  return [
    r.fullName,
    r.headline,
    r.summary,
    ...(r.profileParagraphs ?? []),
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
  const source = new Map(profile.experience.flatMap((e) => e.bullets.map((b) => [b.id, resumePunctuation(b.text)] as const)));
  const untraceableLines = r.roles.flatMap((role) =>
    role.bullets.filter((b) => source.get(b.id) !== b.text).map((b) => b.text),
  );
  const text = normalise(resumeText(r));
  const neverClaimHits = profile.neverClaim
    .filter((n) => n.trim())
    .filter((n) => mentions(text, termForName(n)));
  return { untraceableLines, neverClaimHits };
}
