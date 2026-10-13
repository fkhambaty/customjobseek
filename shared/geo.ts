import data from "./geo.json";
import type { Preferences } from "./types";

export interface Country {
  code: string;
  name: string;
  currency: string;
  cities: string[];
}

/** English-language markets the product treats as first-class. Other countries still work. */
export const FEATURED_MARKET_CODES = ["IN", "US", "GB", "CA", "AU", "SG", "NZ", "IE", "ZA"] as const;
export type FeaturedMarketCode = (typeof FEATURED_MARKET_CODES)[number];

export interface ScheduleZone {
  id: string;
  label: string;
  short: string;
  countries: readonly string[];
}

export const SCHEDULE_ZONES: readonly ScheduleZone[] = [
  { id: "Asia/Kolkata", label: "India (IST)", short: "IST", countries: ["IN"] },
  { id: "America/New_York", label: "US Eastern", short: "ET", countries: ["US"] },
  { id: "America/Chicago", label: "US Central", short: "CT", countries: ["US"] },
  { id: "America/Denver", label: "US Mountain", short: "MT", countries: ["US"] },
  { id: "America/Los_Angeles", label: "US Pacific", short: "PT", countries: ["US"] },
  { id: "Europe/London", label: "United Kingdom", short: "UK", countries: ["GB"] },
  { id: "America/Toronto", label: "Canada Eastern", short: "ET", countries: ["CA"] },
  { id: "America/Vancouver", label: "Canada Pacific", short: "PT", countries: ["CA"] },
  { id: "Australia/Sydney", label: "Australia Eastern", short: "AET", countries: ["AU"] },
  { id: "Australia/Perth", label: "Australia Western", short: "AWST", countries: ["AU"] },
  { id: "Asia/Singapore", label: "Singapore", short: "SGT", countries: ["SG"] },
  { id: "Pacific/Auckland", label: "New Zealand", short: "NZ", countries: ["NZ"] },
  { id: "Europe/Dublin", label: "Ireland", short: "IE", countries: ["IE"] },
  { id: "Africa/Johannesburg", label: "South Africa", short: "SAST", countries: ["ZA"] },
  { id: "UTC", label: "UTC", short: "UTC", countries: [] },
];

/** Older schedules and profiles with no country keep India time, which is what they were saved under. */
export const DEFAULT_TIME_ZONE = "Asia/Kolkata";

export const COUNTRIES: Country[] = data as Country[];

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

// Names a job posting uses instead of the official country name.
const COUNTRY_ALIASES: Record<string, string[]> = {
  US: ["usa", "u.s.", "u.s.a.", "united states of america", "america"],
  GB: ["uk", "u.k.", "united kingdom", "britain", "great britain", "england", "scotland", "wales"],
  AE: ["uae", "u.a.e.", "united arab emirates"],
  KR: ["south korea", "republic of korea"],
  KP: ["north korea"],
  CZ: ["czech republic"],
  NL: ["holland"],
  VN: ["vietnam"],
  TR: ["turkey"],
  RU: ["russia"],
  CN: ["china", "prc"],
  TW: ["taiwan"],
  HK: ["hong kong"],
  DE: ["germany"],
  IN: ["india", "bharat"],
  ZA: ["rsa", "republic of south africa"],
  IE: ["republic of ireland", "eire"],
  NZ: ["aotearoa"],
  SG: ["republic of singapore"],
  AU: ["aus"],
};

const CITY_ALIASES: Record<string, string[]> = {
  bengaluru: ["bangalore"],
  mumbai: ["bombay"],
  gurugram: ["gurgaon"],
  chennai: ["madras"],
  kolkata: ["calcutta"],
  kochi: ["cochin"],
  thiruvananthapuram: ["trivandrum"],
  delhi: ["new delhi"],
  "new delhi": ["delhi"],
  "ho chi minh city": ["saigon"],
  "sao paulo": ["são paulo"],
  "washington": ["washington dc", "washington, dc", "washington d.c."],
  "new york": ["nyc", "new york city"],
  "san francisco": ["sf bay area"],
  "los angeles": ["l.a."],
  "johannesburg": ["joburg"],
  "cape town": ["capetown"],
};

export function countryByCode(code: string): Country | undefined {
  return BY_CODE.get(code.toUpperCase());
}

export function currencies(): string[] {
  const first = ["USD", "EUR", "GBP", "INR", "AED", "SGD", "AUD", "CAD", "CHF", "JPY"];
  const all = Array.from(new Set(COUNTRIES.map((c) => c.currency))).sort();
  return [...first.filter((c) => all.includes(c)), ...all.filter((c) => !first.includes(c))];
}

export function countryNames(code: string): string[] {
  const country = countryByCode(code);
  if (!country) return [];
  return [country.name, ...(COUNTRY_ALIASES[country.code] ?? [])];
}

export function cityNames(city: string): string[] {
  const key = city.trim().toLowerCase();
  return [city.trim(), ...(CITY_ALIASES[key] ?? [])];
}

const ZONE_BY_ID = new Map(SCHEDULE_ZONES.map((zone) => [zone.id, zone]));

export function isScheduleTimeZone(value: string): boolean {
  return ZONE_BY_ID.has(value);
}

export function timeZoneLabel(id: string): string {
  return ZONE_BY_ID.get(id)?.short ?? "local";
}

export function zonesForCountry(country: string): ScheduleZone[] {
  const zones = SCHEDULE_ZONES.filter((zone) => zone.countries.includes(country));
  if (zones.length) return [...zones];
  const utc = ZONE_BY_ID.get("UTC");
  return utc ? [utc] : [];
}

/** A saved zone is kept when it belongs to the country. Otherwise the country's default is used. */
export function resolveTimeZone(country: string, stored: string): string {
  const cleaned = stored.trim();
  if (!country) return isScheduleTimeZone(cleaned) ? cleaned : DEFAULT_TIME_ZONE;
  const zones = zonesForCountry(country);
  if (zones.some((zone) => zone.id === cleaned)) return cleaned;
  return zones[0]?.id ?? "UTC";
}

export function countriesForPicker(): { featured: Country[]; other: Country[] } {
  const featuredCodes = new Set<string>(FEATURED_MARKET_CODES);
  const featured = FEATURED_MARKET_CODES.map((code) => countryByCode(code)).filter((country): country is Country => Boolean(country));
  const other = COUNTRIES.filter((country) => !featuredCodes.has(country.code)).sort((a, b) => a.name.localeCompare(b.name));
  return { featured, other };
}

export function preferencesForCountry(prefs: Preferences, country: string): Preferences {
  const picked = countryByCode(country);
  return {
    ...prefs,
    country,
    currency: picked?.currency || prefs.currency,
    cities: [],
    timezone: resolveTimeZone(country, country ? prefs.timezone : prefs.timezone || DEFAULT_TIME_ZONE),
  };
}
