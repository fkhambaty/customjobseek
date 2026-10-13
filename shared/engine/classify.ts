import type { Preferences } from "../types";
import { detectBoard } from "./boards";

// Order matters: the first family whose words appear in the title wins, so
// seniority families sit above the function families they would otherwise swallow.
const FAMILIES: [string, RegExp][] = [
  ["Leadership", /\b(director|head of|vice president|vp\b|chief|avp|agm|gm\b|general manager)/i],
  ["Solutions & pre-sales", /\b(solutions?|pre-?sales|sales engineer|customer engineer|technical account|consultant|field engineer)/i],
  ["Data engineering", /\b(data engineer|etl|pipeline|data platform|snowflake|dbt|databricks|data architect|warehouse)/i],
  ["Analytics & BI", /\b(analytics|analyst|bi\b|business intelligence|insights|reporting|data scien|tableau|power ?bi|looker)/i],
  ["Software engineering", /\b(software|developer|engineer|sde|full ?stack|front ?end|back ?end|devops|sre|mobile|ios|android)/i],
  ["Product", /\b(product manager|product owner|product lead|\bpm\b|product management)/i],
  ["Program & delivery", /\b(program|programme|project|delivery|scrum|agile|implementation|transformation)/i],
  ["Design", /\b(designer|design|ux|ui\b|user research)/i],
  ["Marketing", /\b(marketing|growth|seo|content|brand|communications)/i],
  ["Sales & accounts", /\b(sales|account executive|account manager|business development|bdr|sdr|partnerships)/i],
  ["Customer success", /\b(customer success|support|customer experience|onboarding)/i],
  ["Finance", /\b(finance|accountant|accounting|controller|fp&a|audit|tax|treasury)/i],
  ["People & HR", /\b(recruit|talent|hr\b|human resources|people partner|people operations)/i],
  ["Operations", /\b(operations|ops\b|supply chain|procurement|logistics)/i],
];

export function roleFamily(title: string): string {
  for (const [name, re] of FAMILIES) if (re.test(title)) return name;
  return "Other";
}

const ROUTE_LABEL: Record<string, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  workable: "Workable",
  smartrecruiters: "SmartRecruiters",
  workday: "Workday",
  teamtailor: "Teamtailor",
  recruitee: "Recruitee",
};

/** Where the application is submitted, from the link alone. */
export function routeFromUrl(raw: string): string {
  if (!raw) return "No link";
  let host = "";
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return "No link";
  }
  if (host.includes("linkedin.")) return "LinkedIn";
  if (host.includes("naukri.")) return "Naukri";
  if (host.includes("indeed.")) return "Indeed";
  if (host.includes("oraclecloud.com")) return "Oracle";
  if (host.includes("successfactors") || host.includes("sapsf")) return "SuccessFactors";
  if (host.includes("icims.com")) return "iCIMS";
  if (host.includes("taleo")) return "Taleo";
  const board = detectBoard(raw);
  if (board && ROUTE_LABEL[board.ats]) return ROUTE_LABEL[board.ats]!;
  if (/[?&]gh_jid=/.test(raw)) return "Greenhouse";
  return "Career site";
}

function annualFloor(prefs: Preferences): number | null {
  if (prefs.minSalary === null) return null;
  switch (prefs.salaryPeriod) {
    case "year":
      return prefs.minSalary;
    case "month":
      return prefs.minSalary * 12;
    case "hour":
      return prefs.minSalary * 2080;
    case "lpa":
      return prefs.minSalary * 100_000;
    default: {
      const never: never = prefs.salaryPeriod;
      return never;
    }
  }
}

/**
 * A lane is where the job is and whether the pay clears the person's floor:
 * the two things that decide whether a job is worth an evening.
 */
export function laneFor(location: string, payLow: number | null, payHigh: number | null, prefs: Preferences): string {
  const loc = location.toLowerCase();
  const city = prefs.cities.find((c) => loc.includes(c.toLowerCase()));
  const place = /remote|anywhere|work from home|wfh/.test(loc) ? "Remote" : city ?? "Other places";
  const floor = annualFloor(prefs);
  const mid = payLow !== null && payHigh !== null ? (payLow + payHigh) / 2 : payHigh ?? payLow;
  if (floor === null || mid === null) return place;
  return `${place} · ${mid >= floor ? "above" : "below"} floor`;
}
