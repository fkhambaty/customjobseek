export type PlanId = "free" | "starter" | "growth" | "pro";

export interface Plan {
  id: PlanId;
  name: string;
  priceInr: number;
  evalCredits: number;
  resumeCredits: number;
  scanRuns: number;
  validityDays: number;
  blurb: string;
  features: string[];
}

export interface RunPack {
  id: "runs5" | "runs15" | "runs30";
  runs: number;
  priceInr: number;
}

export const RUN_PACKS: RunPack[] = [
  { id: "runs5", runs: 5, priceInr: 149 },
  { id: "runs15", runs: 15, priceInr: 399 },
  { id: "runs30", runs: 30, priceInr: 699 },
];

export function runsForPlan(plan: string): number {
  return PLANS[plan as PlanId]?.scanRuns ?? PLANS.free.scanRuns;
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    priceInr: 0,
    evalCredits: 3,
    resumeCredits: 3,
    scanRuns: 1,
    validityDays: 0,
    blurb: "See if it works for you.",
    features: ["1 scan that prepares your best 3 jobs", "3 complete application packs", "Application tracker"],
  },
  starter: {
    id: "starter",
    name: "Starter",
    priceInr: 599,
    evalCredits: 10,
    resumeCredits: 10,
    scanRuns: 4,
    validityDays: 180,
    blurb: "A focused month of applying.",
    features: ["10 application packs", "4 scans, by hand or every day", "Daily scan at a time you choose"],
  },
  growth: {
    id: "growth",
    name: "Growth",
    priceInr: 999,
    evalCredits: 25,
    resumeCredits: 25,
    scanRuns: 10,
    validityDays: 180,
    blurb: "For an active, steady search.",
    features: ["25 application packs", "10 scans, by hand or every day", "Daily scan at a time you choose"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceInr: 1999,
    evalCredits: 60,
    resumeCredits: 60,
    scanRuns: 25,
    validityDays: 180,
    blurb: "When the search is your full-time job.",
    features: ["60 application packs", "25 scans, by hand or every day", "Daily scan at a time you choose"],
  },
};

export const PLAN_ORDER: PlanId[] = ["free", "starter", "growth", "pro"];

export function parsePlanId(value: string): PlanId | null {
  switch (value) {
    case "free":
    case "starter":
    case "growth":
    case "pro":
      return value;
    default:
      return null;
  }
}

/** Higher means a larger paid plan. Unknown names count as free. */
export function planRank(plan: PlanId): number {
  switch (plan) {
    case "free":
      return 0;
    case "starter":
      return 1;
    case "growth":
      return 2;
    case "pro":
      return 3;
    default: {
      const unexpected: never = plan;
      return unexpected;
    }
  }
}
