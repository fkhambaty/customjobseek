import data from "./geo.json";

export interface Country {
  code: string;
  name: string;
  currency: string;
  cities: string[];
}

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
  "washington": ["washington dc", "washington, dc"],
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
