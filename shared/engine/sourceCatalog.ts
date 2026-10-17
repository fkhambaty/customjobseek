import rows from "../data/source-catalog.json";
import industryRows from "../data/industry-employer-catalog.json";
import { FEATURED_MARKET_CODES, type FeaturedMarketCode } from "../geo";
import { INDUSTRY_CATEGORIES, sectorsForIndustries, type IndustryId } from "../industries";

export interface CatalogEmployer {
  name: string;
  careerUrl: string;
  country: FeaturedMarketCode;
  sectors: string[];
}

/** Curated public boards checked against the vendor's own listing endpoint. Not a full market. */
export function sourceCatalog(): CatalogEmployer[] {
  return rows as CatalogEmployer[];
}

/** Larger multi-industry scan pool (imported into `companies` with sector tags). */
export function industryEmployerCatalog(): CatalogEmployer[] {
  return industryRows as CatalogEmployer[];
}

export function catalogCount(country: string): number {
  return sourceCatalog().filter((row) => row.country === country).length;
}

export function featuredCatalogCounts(): { country: FeaturedMarketCode; catalog: number }[] {
  return FEATURED_MARKET_CODES.map((country) => ({ country, catalog: catalogCount(country) }));
}

function rowMatchesIndustry(row: CatalogEmployer, industryId: IndustryId): boolean {
  const preferred = new Set(sectorsForIndustries([industryId]).map((s) => s.toLowerCase()));
  return row.sectors.some((s) => preferred.has(s.toLowerCase()));
}

/** How many catalog employers are tagged for each onboarding industry. */
export function industryCatalogCoverage(): { industry: IndustryId; label: string; curated: number; pool: number }[] {
  const curated = sourceCatalog();
  const pool = industryEmployerCatalog();
  return INDUSTRY_CATEGORIES.map((row) => ({
    industry: row.id,
    label: row.label,
    curated: curated.filter((e) => rowMatchesIndustry(e, row.id)).length,
    pool: pool.filter((e) => rowMatchesIndustry(e, row.id)).length,
  }));
}
