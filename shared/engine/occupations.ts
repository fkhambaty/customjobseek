import { normalise } from "./text";

/** Bump when titles or aliases change meaning. Stored resolutions keep this number. */
export const OCCUPATION_TAXONOMY_VERSION = 1;

export const OCCUPATION_FAMILIES = [
  "professional",
  "technical",
  "operations",
  "creative",
  "healthcare",
  "education",
  "legal",
  "finance",
  "retail",
  "hospitality",
  "agriculture",
  "transport",
  "manufacturing",
  "trades",
  "public_sector",
  "nonprofit",
  "entry_level",
] as const;

export type OccupationFamily = (typeof OCCUPATION_FAMILIES)[number];

export const SENIORITY_LEVELS = ["intern", "junior", "mid", "senior", "lead", "principal", "executive"] as const;
export type Seniority = (typeof SENIORITY_LEVELS)[number];

export interface Occupation {
  id: string;
  family: OccupationFamily;
  title: string;
  aliases: string[];
}

export interface ResolvedRole {
  input: string;
  /** Catalogue title when the wording matches. Otherwise the user's text, unchanged. */
  canonical: string;
  family: OccupationFamily | null;
  occupationId: string | null;
  seniority: Seniority;
  taxonomyVersion: number;
}

// One primary family each. Aliases are market wordings (US attorney, UK solicitor, IN chartered accountant).
// Short codes are matched only as whole words. Free text that misses this list is still a valid target.
export const OCCUPATIONS: Occupation[] = [
  { id: "management-consultant", family: "professional", title: "Management Consultant", aliases: ["strategy consultant"] },
  { id: "business-analyst", family: "professional", title: "Business Analyst", aliases: ["business analysis"] },
  { id: "project-manager", family: "professional", title: "Project Manager", aliases: ["programme manager", "program manager"] },
  { id: "human-resources", family: "professional", title: "Human Resources Generalist", aliases: ["hr generalist", "people operations", "hr business partner"] },
  { id: "executive-assistant", family: "professional", title: "Executive Assistant", aliases: ["personal assistant"] },
  { id: "software-engineer", family: "technical", title: "Software Engineer", aliases: ["software developer", "sde", "swe"] },
  { id: "data-engineer", family: "technical", title: "Data Engineer", aliases: ["etl developer"] },
  { id: "data-analyst", family: "technical", title: "Data Analyst", aliases: ["bi analyst"] },
  { id: "analytics-engineer", family: "technical", title: "Analytics Engineer", aliases: ["analytics developer"] },
  { id: "product-manager", family: "technical", title: "Product Manager", aliases: ["product owner"] },
  { id: "it-support", family: "technical", title: "IT Support Specialist", aliases: ["it support", "help desk", "service desk"] },
  { id: "security-analyst", family: "technical", title: "Cybersecurity Analyst", aliases: ["security analyst", "information security analyst"] },
  { id: "qa-engineer", family: "technical", title: "QA Engineer", aliases: ["quality assurance engineer", "test engineer"] },
  { id: "devops-engineer", family: "technical", title: "DevOps Engineer", aliases: ["site reliability engineer", "sre"] },
  { id: "operations-manager", family: "operations", title: "Operations Manager", aliases: ["ops manager"] },
  { id: "supply-chain", family: "operations", title: "Supply Chain Analyst", aliases: ["supply chain manager"] },
  { id: "logistics", family: "operations", title: "Logistics Coordinator", aliases: ["logistics manager"] },
  { id: "procurement", family: "operations", title: "Procurement Specialist", aliases: ["procurement officer"] },
  { id: "customer-support", family: "operations", title: "Customer Support", aliases: ["customer service representative", "contact centre agent", "contact center agent"] },
  { id: "warehouse", family: "operations", title: "Warehouse Supervisor", aliases: ["warehouse operative", "warehouse associate"] },
  { id: "graphic-designer", family: "creative", title: "Graphic Designer", aliases: ["visual designer"] },
  { id: "ux-designer", family: "creative", title: "UX Designer", aliases: ["ui designer", "product designer"] },
  { id: "content-writer", family: "creative", title: "Content Writer", aliases: ["copywriter", "content editor"] },
  { id: "video-editor", family: "creative", title: "Video Editor", aliases: ["film editor"] },
  { id: "photographer", family: "creative", title: "Photographer", aliases: ["photojournalist"] },
  { id: "registered-nurse", family: "healthcare", title: "Registered Nurse", aliases: ["staff nurse", "rn", "rgn", "director of nursing"] },
  { id: "physician", family: "healthcare", title: "Physician", aliases: ["medical doctor", "general practitioner", "gp"] },
  { id: "pharmacist", family: "healthcare", title: "Pharmacist", aliases: ["clinical pharmacist"] },
  { id: "physiotherapist", family: "healthcare", title: "Physiotherapist", aliases: ["physical therapist"] },
  { id: "caregiver", family: "healthcare", title: "Caregiver", aliases: ["care assistant", "healthcare assistant", "home health aide"] },
  { id: "dentist", family: "healthcare", title: "Dentist", aliases: ["dental surgeon"] },
  { id: "teacher", family: "education", title: "Teacher", aliases: ["school teacher", "classroom teacher", "primary teacher"] },
  { id: "teaching-assistant", family: "education", title: "Teaching Assistant", aliases: ["classroom assistant", "teacher aide"] },
  { id: "lecturer", family: "education", title: "Lecturer", aliases: ["university lecturer"] },
  { id: "instructional-designer", family: "education", title: "Instructional Designer", aliases: ["learning designer"] },
  { id: "lawyer", family: "legal", title: "Lawyer", aliases: ["attorney", "solicitor", "barrister", "advocate"] },
  { id: "paralegal", family: "legal", title: "Paralegal", aliases: ["legal assistant"] },
  { id: "compliance", family: "legal", title: "Compliance Officer", aliases: ["compliance analyst"] },
  { id: "accountant", family: "finance", title: "Accountant", aliases: ["chartered accountant", "cpa", "staff accountant"] },
  { id: "financial-analyst", family: "finance", title: "Financial Analyst", aliases: ["fp and a analyst"] },
  { id: "bookkeeper", family: "finance", title: "Bookkeeper", aliases: ["accounts clerk"] },
  { id: "auditor", family: "finance", title: "Auditor", aliases: ["internal auditor"] },
  { id: "banker", family: "finance", title: "Banker", aliases: ["personal banker", "relationship banker"] },
  { id: "retail-associate", family: "retail", title: "Retail Associate", aliases: ["sales associate", "shop assistant"] },
  { id: "store-manager", family: "retail", title: "Store Manager", aliases: ["shop manager", "retail manager"] },
  { id: "cashier", family: "retail", title: "Cashier", aliases: ["checkout operator"] },
  { id: "merchandiser", family: "retail", title: "Merchandiser", aliases: ["visual merchandiser"] },
  { id: "chef", family: "hospitality", title: "Chef", aliases: ["head chef", "sous chef", "line cook"] },
  { id: "waiter", family: "hospitality", title: "Waiter", aliases: ["waitress", "food server"] },
  { id: "hotel-manager", family: "hospitality", title: "Hotel Manager", aliases: ["front office manager"] },
  { id: "housekeeper", family: "hospitality", title: "Housekeeper", aliases: ["room attendant"] },
  { id: "bartender", family: "hospitality", title: "Bartender", aliases: ["bar staff"] },
  { id: "farm-manager", family: "agriculture", title: "Farm Manager", aliases: ["farm supervisor"] },
  { id: "agronomist", family: "agriculture", title: "Agronomist", aliases: ["crop advisor"] },
  { id: "farm-worker", family: "agriculture", title: "Farm Worker", aliases: ["farmhand", "agricultural worker"] },
  { id: "vet-tech", family: "agriculture", title: "Veterinary Technician", aliases: ["vet tech", "veterinary nurse"] },
  { id: "truck-driver", family: "transport", title: "Truck Driver", aliases: ["hgv driver", "lorry driver", "cdl driver", "heavy goods vehicle driver"] },
  { id: "delivery-driver", family: "transport", title: "Delivery Driver", aliases: ["van driver", "courier"] },
  { id: "pilot", family: "transport", title: "Pilot", aliases: ["airline pilot", "first officer"] },
  { id: "bus-driver", family: "transport", title: "Bus Driver", aliases: ["coach driver"] },
  { id: "dispatcher", family: "transport", title: "Dispatcher", aliases: ["transport dispatcher"] },
  { id: "production-operator", family: "manufacturing", title: "Production Operator", aliases: ["machine operator", "process operator"] },
  { id: "quality-inspector", family: "manufacturing", title: "Quality Inspector", aliases: ["quality control inspector"] },
  { id: "plant-manager", family: "manufacturing", title: "Plant Manager", aliases: ["factory manager"] },
  { id: "assembler", family: "manufacturing", title: "Assembler", aliases: ["assembly technician"] },
  { id: "cnc-machinist", family: "manufacturing", title: "CNC Machinist", aliases: ["machinist"] },
  { id: "electrician", family: "trades", title: "Electrician", aliases: ["electrical technician", "journeyman electrician"] },
  { id: "plumber", family: "trades", title: "Plumber", aliases: ["pipefitter"] },
  { id: "carpenter", family: "trades", title: "Carpenter", aliases: ["joiner"] },
  { id: "welder", family: "trades", title: "Welder", aliases: ["welding technician"] },
  { id: "mechanic", family: "trades", title: "Mechanic", aliases: ["auto mechanic", "automotive technician"] },
  { id: "hvac", family: "trades", title: "HVAC Technician", aliases: ["refrigeration technician"] },
  { id: "civil-servant", family: "public_sector", title: "Civil Servant", aliases: ["public servant", "government officer"] },
  { id: "policy-analyst", family: "public_sector", title: "Policy Analyst", aliases: ["policy advisor"] },
  { id: "social-worker", family: "public_sector", title: "Social Worker", aliases: ["case worker"] },
  { id: "police-officer", family: "public_sector", title: "Police Officer", aliases: ["constable", "garda"] },
  { id: "firefighter", family: "public_sector", title: "Firefighter", aliases: ["fire fighter"] },
  { id: "librarian", family: "public_sector", title: "Librarian", aliases: ["library assistant"] },
  { id: "fundraiser", family: "nonprofit", title: "Fundraiser", aliases: ["fundraising manager", "fundraising", "development officer"] },
  { id: "program-coordinator", family: "nonprofit", title: "Program Coordinator", aliases: ["programme coordinator"] },
  { id: "grant-writer", family: "nonprofit", title: "Grant Writer", aliases: ["grants manager"] },
  { id: "community-organizer", family: "nonprofit", title: "Community Organizer", aliases: ["community organiser", "outreach worker"] },
  { id: "intern", family: "entry_level", title: "Intern", aliases: ["internship", "graduate trainee", "management trainee"] },
  { id: "apprentice", family: "entry_level", title: "Apprentice", aliases: ["apprenticeship"] },
  { id: "administrative-assistant", family: "entry_level", title: "Administrative Assistant", aliases: ["receptionist", "office administrator"] },
  { id: "general-laborer", family: "entry_level", title: "General Laborer", aliases: ["general labourer", "labourer", "laborer"] },
  { id: "crew-member", family: "entry_level", title: "Crew Member", aliases: ["team member"] },
];

const SHORT_CODES = new Set(["rn", "rgn", "sde", "swe", "sre", "cpa", "hgv", "cdl", "gp"]);

const SEARCH_STOP = new Set([
  "and", "the", "for", "with", "head", "line", "staff", "general", "support", "service",
  "worker", "manager", "officer", "assistant", "senior", "junior", "lead", "associate",
  "specialist", "consultant", "human", "registered", "public", "machine", "quality",
  "store", "shop", "team", "crew", "food", "care", "school", "room", "center", "centre",
  "internal", "personal", "visual", "clinical", "medical", "heavy", "goods", "vehicle",
]);

const LEADING: { level: Seniority; pattern: RegExp }[] = [
  { level: "executive", pattern: /^(vice president of|vice president|vp of|vp|chief|director of|director|executive)\s+/ },
  { level: "principal", pattern: /^principal\s+/ },
  { level: "lead", pattern: /^(head of|head|lead|staff)\s+/ },
  { level: "senior", pattern: /^(senior|sr)\s+/ },
  { level: "junior", pattern: /^(junior|jr)\s+/ },
  { level: "intern", pattern: /^(intern|trainee|apprentice|entry level|graduate)\s+/ },
];

interface AliasRow {
  key: string;
  occupation: Occupation;
}

const EXACT = new Map<string, Occupation>();
const ALIASES: AliasRow[] = [];
const BY_ID = new Map<string, Occupation>();

for (const occupation of OCCUPATIONS) {
  BY_ID.set(occupation.id, occupation);
  for (const alias of [occupation.title, ...occupation.aliases]) {
    const key = roleKey(alias);
    if (!key || EXACT.has(key)) continue;
    EXACT.set(key, occupation);
    ALIASES.push({ key, occupation });
  }
}
ALIASES.sort((a, b) => b.key.length - a.key.length);

export function roleKey(value: string): string {
  return normalise(value).replace(/&/g, " and ").replace(/[^a-z0-9+#]+/g, " ").trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasPhrase(haystack: string, phrase: string): boolean {
  return new RegExp(`(?:^|\\s)${escapeRegex(phrase)}(?:$|\\s)`).test(haystack);
}

function matchOccupation(key: string): Occupation | null {
  const exact = EXACT.get(key);
  if (exact) return exact;
  for (const alias of ALIASES) {
    if (alias.key.length < 4 && !SHORT_CODES.has(alias.key)) continue;
    if (hasPhrase(key, alias.key)) return alias.occupation;
  }
  return null;
}

function leadingSeniority(key: string): { level: Seniority; rest: string } | null {
  for (const marker of LEADING) {
    const match = marker.pattern.exec(key);
    if (!match) continue;
    return { level: marker.level, rest: key.slice(match[0].length).trim() };
  }
  return null;
}

function trailingSeniority(key: string): { level: Seniority; rest: string } | null {
  const match = /\s+(intern|trainee|apprentice)$/.exec(key);
  if (!match || match.index === undefined) return null;
  return { level: "intern", rest: key.slice(0, match.index).trim() };
}

function seniorityOf(key: string): Seniority {
  return leadingSeniority(key)?.level ?? trailingSeniority(key)?.level ?? "mid";
}

export function occupationById(id: string): Occupation | undefined {
  return BY_ID.get(id);
}

/** Always returns a role. Unknown wording stays free text and is still searched. */
export function resolveRole(input: string): ResolvedRole {
  const original = input.trim();
  const key = roleKey(original);
  let occupation = matchOccupation(key);
  let seniority = seniorityOf(key);
  if (!occupation) {
    const lead = leadingSeniority(key);
    if (lead) {
      occupation = matchOccupation(lead.rest);
      seniority = lead.level;
    }
  }
  if (!occupation) {
    const trail = trailingSeniority(key);
    if (trail) {
      occupation = matchOccupation(trail.rest);
      if (seniority === "mid") seniority = trail.level;
    }
  }
  if ((occupation?.id === "intern" || occupation?.id === "apprentice") && seniority === "mid") seniority = "intern";
  return {
    input: original,
    canonical: occupation?.title ?? original,
    family: occupation?.family ?? null,
    occupationId: occupation?.id ?? null,
    seniority,
    taxonomyVersion: OCCUPATION_TAXONOMY_VERSION,
  };
}

export function familyLabel(family: OccupationFamily): string {
  switch (family) {
    case "professional":
      return "Professional";
    case "technical":
      return "Technical";
    case "operations":
      return "Operations";
    case "creative":
      return "Creative";
    case "healthcare":
      return "Healthcare";
    case "education":
      return "Education";
    case "legal":
      return "Legal";
    case "finance":
      return "Finance";
    case "retail":
      return "Retail";
    case "hospitality":
      return "Hospitality";
    case "agriculture":
      return "Agriculture";
    case "transport":
      return "Transport";
    case "manufacturing":
      return "Manufacturing";
    case "trades":
      return "Trades";
    case "public_sector":
      return "Public sector";
    case "nonprofit":
      return "Nonprofit";
    case "entry_level":
      return "Entry level";
    default: {
      const unexpected: never = family;
      return unexpected;
    }
  }
}

export function seniorityLabel(level: Seniority): string {
  switch (level) {
    case "intern":
      return "Intern";
    case "junior":
      return "Junior";
    case "mid":
      return "Mid-level";
    case "senior":
      return "Senior";
    case "lead":
      return "Lead";
    case "principal":
      return "Principal";
    case "executive":
      return "Executive";
    default: {
      const unexpected: never = level;
      return unexpected;
    }
  }
}

export function describeRole(role: ResolvedRole): string {
  if (!role.family) {
    return role.seniority === "mid" ? "Kept as typed" : `Kept as typed · ${seniorityLabel(role.seniority)}`;
  }
  return `${familyLabel(role.family)} · ${seniorityLabel(role.seniority)}`;
}

export function familyExamples(): { family: OccupationFamily; label: string; title: string }[] {
  return OCCUPATION_FAMILIES.map((family) => {
    const occupation = OCCUPATIONS.find((item) => item.family === family);
    if (!occupation) throw new Error(`Add an occupation for ${family}`);
    return { family, label: familyLabel(family), title: occupation.title };
  });
}

function pushWord(words: string[], seen: Set<string>, word: string): void {
  if (word.length < 3 || SEARCH_STOP.has(word) || seen.has(word)) return;
  seen.add(word);
  words.push(word);
}

/** Extra title words so "RN" can find "Registered Nurse" without matching every short word. */
export function occupationSearchWords(roles: string[]): string[] {
  const words: string[] = [];
  const seen = new Set<string>();
  for (const role of roles) {
    const resolved = resolveRole(role);
    const occupation = resolved.occupationId ? occupationById(resolved.occupationId) : undefined;
    if (!occupation) continue;
    for (const word of roleKey(occupation.title).split(" ")) pushWord(words, seen, word);
    for (const alias of occupation.aliases) {
      for (const word of roleKey(alias).split(" ")) pushWord(words, seen, word);
    }
  }
  return words;
}
