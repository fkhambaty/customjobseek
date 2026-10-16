import type { OccupationFamily } from "./engine/occupations";

/**
 * Broad industries for onboarding and board filtering.
 * A scan prefers employers whose sectors overlap the chosen industries,
 * so a dietitian is not scored against unrelated software boards first.
 */
export const INDUSTRY_CATEGORIES = [
  {
    id: "technology",
    label: "Technology & IT",
    families: ["technical"] as OccupationFamily[],
    sectors: ["software", "IT services", "technology", "AI", "data", "cloud", "internet", "security", "semiconductors", "networking", "infrastructure", "fintech"],
  },
  {
    id: "healthcare",
    label: "Healthcare & life sciences",
    families: ["healthcare"] as OccupationFamily[],
    sectors: ["healthcare", "hospital", "pharma", "biotech", "medical", "nutrition", "wellness", "clinical"],
  },
  {
    id: "finance",
    label: "Finance & accounting",
    families: ["finance"] as OccupationFamily[],
    sectors: ["fintech", "payments", "banking", "finance", "insurance", "professional services"],
  },
  {
    id: "education",
    label: "Education",
    families: ["education"] as OccupationFamily[],
    sectors: ["education", "edtech", "training", "university"],
  },
  {
    id: "manufacturing",
    label: "Manufacturing & engineering",
    families: ["manufacturing", "trades"] as OccupationFamily[],
    sectors: ["manufacturing", "engineering", "automotive", "industrial", "aerospace", "semiconductors"],
  },
  {
    id: "hospitality",
    label: "Hospitality & food",
    families: ["hospitality"] as OccupationFamily[],
    sectors: ["hospitality", "food", "restaurant", "hotel", "nutrition", "wellness"],
  },
  {
    id: "retail",
    label: "Retail & ecommerce",
    families: ["retail"] as OccupationFamily[],
    sectors: ["retail", "ecommerce", "consumer"],
  },
  {
    id: "operations",
    label: "Operations & logistics",
    families: ["operations", "transport"] as OccupationFamily[],
    sectors: ["logistics", "operations", "supply chain", "transport", "delivery"],
  },
  {
    id: "creative",
    label: "Creative & media",
    families: ["creative"] as OccupationFamily[],
    sectors: ["media", "advertising", "design", "creative technology", "entertainment"],
  },
  {
    id: "legal",
    label: "Legal & compliance",
    families: ["legal"] as OccupationFamily[],
    sectors: ["legal", "compliance", "professional services"],
  },
  {
    id: "public",
    label: "Government & nonprofit",
    families: ["public_sector", "nonprofit"] as OccupationFamily[],
    sectors: ["public sector", "government", "nonprofit", "NGO"],
  },
  {
    id: "agriculture",
    label: "Agriculture",
    families: ["agriculture"] as OccupationFamily[],
    sectors: ["agriculture", "agritech", "food"],
  },
  {
    id: "professional",
    label: "Professional services",
    families: ["professional", "entry_level"] as OccupationFamily[],
    sectors: ["consulting", "professional services", "HR"],
  },
] as const;

export type IndustryId = (typeof INDUSTRY_CATEGORIES)[number]["id"];

const BY_ID = new Map(INDUSTRY_CATEGORIES.map((row) => [row.id, row]));

export function industryById(id: string): (typeof INDUSTRY_CATEGORIES)[number] | undefined {
  return BY_ID.get(id as IndustryId);
}

export function industryLabels(ids: string[]): string[] {
  return ids.map((id) => industryById(id)?.label ?? id).filter(Boolean);
}

/** Sector tags a scan should prefer when the profile lists industries. */
export function sectorsForIndustries(industryIds: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of industryIds) {
    const row = industryById(id);
    if (!row) continue;
    for (const sector of row.sectors) {
      const key = sector.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(sector);
    }
  }
  return out;
}

/** True when company sectors JSON overlaps preferred sectors, or when no preference is set. */
export function companyMatchesIndustries(sectorsJson: string, industryIds: string[]): boolean {
  if (!industryIds.length) return true;
  const preferred = new Set(sectorsForIndustries(industryIds).map((s) => s.toLowerCase()));
  if (!preferred.size) return true;
  let sectors: unknown;
  try {
    sectors = JSON.parse(sectorsJson || "[]");
  } catch {
    return false;
  }
  if (!Array.isArray(sectors) || sectors.length === 0) return false;
  return sectors.some((sector) => typeof sector === "string" && preferred.has(sector.toLowerCase()));
}

export function isIndustryId(value: string): value is IndustryId {
  return BY_ID.has(value as IndustryId);
}
