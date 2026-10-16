/**
 * Grade-benchmark pay when a posting publishes no salary.
 * Ported from CommandCenter band_model — a filing aid for expected CTC, never an employer figure.
 */

export type EmployerTier = "T1" | "T2" | "T3" | "T4" | "T5" | "T6";
export type TitleGrade = "junior" | "senior_ic" | "staff_principal" | "senior_manager" | "director_plus";

export interface PayEstimate {
  lowLpa: number;
  highLpa: number;
  midLpa: number;
  tier: EmployerTier;
  grade: TitleGrade;
  source: "grade_benchmark";
  /** Short label for UI, e.g. "~₹28–45L (estimate)". */
  label: string;
  /** Copy-paste line for expected CTC forms. */
  expectedCtc: string;
  note: string;
}

/** ₹L annual total CTC ranges by employer tier × title grade (India, 2026). */
const GRADE_TABLE: Record<EmployerTier, Record<TitleGrade, [number, number]>> = {
  T1: { junior: [25, 40], senior_ic: [40, 65], staff_principal: [65, 100], senior_manager: [90, 140], director_plus: [140, 220] },
  T2: { junior: [15, 28], senior_ic: [28, 45], staff_principal: [38, 60], senior_manager: [50, 80], director_plus: [80, 140] },
  T3: { junior: [12, 22], senior_ic: [24, 40], staff_principal: [38, 58], senior_manager: [55, 80], director_plus: [80, 120] },
  T4: { junior: [18, 32], senior_ic: [32, 52], staff_principal: [48, 75], senior_manager: [65, 95], director_plus: [90, 140] },
  T5: { junior: [8, 16], senior_ic: [16, 30], staff_principal: [28, 45], senior_manager: [42, 62], director_plus: [60, 90] },
  T6: { junior: [8, 18], senior_ic: [18, 32], staff_principal: [30, 48], senior_manager: [45, 70], director_plus: [65, 100] },
};

const COMPANY_TIER: Record<string, EmployerTier> = {
  amazon: "T1", microsoft: "T1", databricks: "T1", google: "T1", snowflake: "T1", stripe: "T1",
  atlassian: "T1", adobe: "T1", salesforce: "T1", gitlab: "T1", twilio: "T1", fivetran: "T1",
  citi: "T2", jpmorgan: "T2", barclays: "T2", "morgan stanley": "T2", hsbc: "T2", goldman: "T2",
  amgen: "T3", novartis: "T3", pfizer: "T3", siemens: "T3", syngenta: "T3",
  euler: "T4", highlevel: "T4", gohighlevel: "T4", zendesk: "T4", clickhouse: "T4",
  phdata: "T5", precisionaq: "T5", "precision aq": "T5", epam: "T5", infosys: "T5", accenture: "T5",
  cognizant: "T5", deloitte: "T5", tcs: "T5", wipro: "T5", persistent: "T5", nagarro: "T5",
  mindtickle: "T6", hevo: "T6", keka: "T6",
};

const TIER_LABEL: Record<EmployerTier, string> = {
  T1: "global product / big tech",
  T2: "global bank or finance GCC",
  T3: "global enterprise GCC",
  T4: "remote-first US SaaS / scale-up hiring India",
  T5: "IT services / analytics consultancy",
  T6: "Indian product, start-up or unclassified employer",
};

const GRADE_LABEL: Record<TitleGrade, string> = {
  junior: "analyst / associate / developer grade",
  senior_ic: "senior individual contributor or team lead",
  staff_principal: "staff, principal, architect, manager or AVP grade",
  senior_manager: "senior manager, associate director or bank-VP grade",
  director_plus: "director, head, SVP or chief grade",
};

function hasWord(text: string, word: string): boolean {
  return new RegExp(`(?<![a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`, "i").test(text);
}

export function employerTier(company: string): { tier: EmployerTier; defaulted: boolean } {
  const c = company.trim().toLowerCase();
  for (const key of Object.keys(COMPANY_TIER).sort((a, b) => b.length - a.length)) {
    if (c.includes(key)) return { tier: COMPANY_TIER[key]!, defaulted: false };
  }
  return { tier: "T6", defaulted: true };
}

export function titleGrade(title: string, tier: EmployerTier): TitleGrade {
  const t = title.toLowerCase().replace(/[–—]/g, "-");
  if (hasWord(t, "junior") || hasWord(t, "jr") || hasWord(t, "associate") || hasWord(t, "intern")
    || hasWord(t, "trainee") || hasWord(t, "graduate")) {
    if (!hasWord(t, "associate director")) return "junior";
  }
  if (hasWord(t, "director") || hasWord(t, "head") || hasWord(t, "svp") || hasWord(t, "chief") || hasWord(t, "cto") || hasWord(t, "cdo")) {
    return "director_plus";
  }
  if (hasWord(t, "senior manager") || hasWord(t, "associate director") || hasWord(t, "vice president") || hasWord(t, "vp")
    || hasWord(t, "engineering manager") || hasWord(t, "general manager")) {
    return "senior_manager";
  }
  if (hasWord(t, "staff") || hasWord(t, "principal") || hasWord(t, "architect") || hasWord(t, "manager") || hasWord(t, "avp")) {
    return "staff_principal";
  }
  if (hasWord(t, "senior") || hasWord(t, "sr") || hasWord(t, "lead") || hasWord(t, "specialist") || hasWord(t, "consultant")) {
    return "senior_ic";
  }
  if ((tier === "T1" || tier === "T4") && (hasWord(t, "engineer") || hasWord(t, "analyst") || hasWord(t, "developer"))) {
    return "senior_ic";
  }
  return "junior";
}

export function isSnowflakeHeavy(title: string, description = ""): boolean {
  if (/\bsnowflake\b/i.test(title)) return true;
  return (description.toLowerCase().match(/\bsnowflake\b/g) ?? []).length >= 2;
}

/** Estimate annual INR CTC in lakh when the posting has no published pay. */
export function estimatePayBand(input: {
  title: string;
  company: string;
  description?: string;
  currency?: string;
}): PayEstimate | null {
  const currency = (input.currency ?? "INR").toUpperCase();
  if (currency !== "INR") return null;
  const { tier, defaulted } = employerTier(input.company);
  const grade = titleGrade(input.title, tier);
  const [lowLpa, highLpa] = GRADE_TABLE[tier][grade];
  const midLpa = Math.round(((lowLpa + highLpa) / 2) * 10) / 10;
  const note = `Grade benchmark: tier ${tier} (${TIER_LABEL[tier]}${defaulted ? ", employer not in tier table" : ""}) × ${grade} (${GRADE_LABEL[grade]}) → ₹${lowLpa}–${highLpa}L. Filing aid only — not an employer figure; do not quote it to a recruiter as published pay.`;
  return {
    lowLpa,
    highLpa,
    midLpa,
    tier,
    grade,
    source: "grade_benchmark",
    label: `~₹${lowLpa}–${highLpa}L (estimate)`,
    expectedCtc: `My expected CTC is in the ₹${lowLpa}–${highLpa} LPA range (midpoint about ₹${midLpa}L), flexible for the right seat.`,
    note,
  };
}

/** Convert LPA estimate into annual absolute INR used by job pay_low / pay_high. */
export function estimateAsJobPay(estimate: PayEstimate): { payLow: number; payHigh: number; salaryText: string } {
  return {
    payLow: estimate.lowLpa * 100_000,
    payHigh: estimate.highLpa * 100_000,
    salaryText: estimate.label,
  };
}
