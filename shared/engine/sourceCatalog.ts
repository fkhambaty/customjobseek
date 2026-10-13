import rows from "../data/source-catalog.json";
import { FEATURED_MARKET_CODES, type FeaturedMarketCode } from "../geo";

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

export function catalogCount(country: string): number {
  return sourceCatalog().filter((row) => row.country === country).length;
}

export function featuredCatalogCounts(): { country: FeaturedMarketCode; catalog: number }[] {
  return FEATURED_MARKET_CODES.map((country) => ({ country, catalog: catalogCount(country) }));
}
