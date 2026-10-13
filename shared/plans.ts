export type PlanId = "free" | "starter" | "growth" | "pro";

export interface Plan {
  id: PlanId;
  name: string;
  priceInr: number;
  evalCredits: number;
  resumeCredits: number;
  validityDays: number;
  blurb: string;
  features: string[];
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    priceInr: 0,
    evalCredits: 3,
    resumeCredits: 3,
    validityDays: 0,
    blurb: "See if it works for you.",
    features: ["3 complete application packs", "Fit check + tailored resume per job", "Application tracker"],
  },
  starter: {
    id: "starter",
    name: "Starter",
    priceInr: 599,
    evalCredits: 10,
    resumeCredits: 10,
    validityDays: 180,
    blurb: "A focused month of applying.",
    features: ["10 application packs", "Fit check + tailored resume per job", "Credits last 6 months"],
  },
  growth: {
    id: "growth",
    name: "Growth",
    priceInr: 999,
    evalCredits: 25,
    resumeCredits: 25,
    validityDays: 180,
    blurb: "For an active, steady search.",
    features: ["25 application packs", "Fit check + tailored resume per job", "Credits last 6 months"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceInr: 1999,
    evalCredits: 60,
    resumeCredits: 60,
    validityDays: 180,
    blurb: "When the search is your full-time job.",
    features: ["60 application packs", "Tracking and follow-up reminders", "Credits last 6 months"],
  },
};

export const PLAN_ORDER: PlanId[] = ["free", "starter", "growth", "pro"];
