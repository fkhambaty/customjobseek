import { describe, expect, it } from "vitest";
import { evaluateFit, marketLocationOk, titleAlignment, type JobInput } from "../shared/engine/fit";
import {
  OCCUPATION_FAMILIES,
  OCCUPATION_TAXONOMY_VERSION,
  OCCUPATIONS,
  describeRole,
  familyLabel,
  occupationSearchWords,
  resolveRole,
  roleKey,
} from "../shared/engine/occupations";
import { tailorResume } from "../shared/engine/tailor";
import { FEATURED_MARKET_CODES, countryByCode, preferencesForCountry, zonesForCountry } from "../shared/geo";
import { emptyProfile, type Profile } from "../shared/types";
import { sanitiseProfile } from "../shared/validate";
import { meaningfulTitleMatch } from "../worker/discoverMatch";

function person(overrides: Partial<Profile> = {}): Profile {
  return { ...emptyProfile("person@example.com"), fullName: "Mina Cole", email: "person@example.com", totalYears: 6, ...overrides };
}

function opening(overrides: Partial<JobInput> = {}): JobInput {
  return { title: "Role", company: "Example", location: "", salaryText: "", description: "", ...overrides };
}

describe("occupation taxonomy", () => {
  it("covers every family and keeps aliases unique", () => {
    expect(OCCUPATION_TAXONOMY_VERSION).toBe(1);
    const seen = new Map<string, string>();
    for (const occupation of OCCUPATIONS) {
      for (const alias of [occupation.title, ...occupation.aliases]) {
        const key = roleKey(alias);
        expect(seen.get(key), key).toBeUndefined();
        seen.set(key, occupation.id);
      }
    }
    for (const family of OCCUPATION_FAMILIES) {
      expect(OCCUPATIONS.some((occupation) => occupation.family === family)).toBe(true);
      expect(familyLabel(family).length).toBeGreaterThan(0);
    }
  });

  it("keeps free-text titles and normalises aliases and seniority", () => {
    const free = resolveRole("  Bee hotel attendant ");
    expect(free).toMatchObject({ canonical: "Bee hotel attendant", family: null, occupationId: null, seniority: "mid", taxonomyVersion: 1 });
    expect(describeRole(free)).toBe("Kept as typed");
    expect(resolveRole("Solicitor")).toMatchObject({ canonical: "Lawyer", family: "legal", seniority: "mid" });
    expect(resolveRole("Sr. Software Engineer")).toMatchObject({ canonical: "Software Engineer", family: "technical", seniority: "senior" });
    expect(resolveRole("HGV Driver")).toMatchObject({ canonical: "Truck Driver", family: "transport" });
    expect(resolveRole("Staff Nurse")).toMatchObject({ canonical: "Registered Nurse", family: "healthcare" });
    expect(resolveRole("Chartered Accountant")).toMatchObject({ canonical: "Accountant", family: "finance" });
    expect(resolveRole("Garda")).toMatchObject({ canonical: "Police Officer", family: "public_sector" });
    expect(resolveRole("Sous Chef")).toMatchObject({ canonical: "Chef", family: "hospitality" });
    expect(resolveRole("Director of Nursing").seniority).toBe("executive");
    expect(occupationSearchWords(["RN"])).toEqual(expect.arrayContaining(["nurse"]));
  });

  it("matches unlike fields without treating them as the same work", () => {
    expect(titleAlignment("Solicitor", ["Lawyer"])).toBeGreaterThanOrEqual(0.92);
    expect(titleAlignment("Electrician", ["Software Engineer"])).toBe(0);
    expect(titleAlignment("Bee hotel attendant", ["Bee hotel attendant"])).toBe(1);
    expect(meaningfulTitleMatch("RN - ICU", ["Registered Nurse"])).toBeGreaterThanOrEqual(0.9);
    expect(meaningfulTitleMatch("HGV Driver", ["Truck Driver"])).toBeGreaterThanOrEqual(0.9);
    expect(meaningfulTitleMatch("Senior Software Engineer", ["Registered Nurse"])).toBe(0);
    expect(meaningfulTitleMatch("Line Cook", ["Chef"])).toBeGreaterThanOrEqual(0.9);
    expect(meaningfulTitleMatch("Primary Teacher", ["Electrician"])).toBe(0);
  });
});

describe("cross-field evidence", () => {
  const nurseJd = `Registered Nurse, ward based.
Requirements:
- Patient care on a busy ward
- An active nursing license
- Care planning`;

  function nurse(): Profile {
    return person({
      skills: [{ name: "Patient Care", level: "expert" }],
      experience: [{
        id: "e1",
        company: "City Hospital",
        title: "Staff Nurse",
        location: "Cape Town",
        start: "2020",
        end: "Present",
        bullets: [{ id: "b1", text: "Led patient care and care planning for a 12-bed ward" }],
      }],
      preferences: {
        ...emptyProfile().preferences,
        country: "ZA",
        cities: ["Cape Town"],
        currency: "ZAR",
        timezone: "Africa/Johannesburg",
        targetRoles: ["RN"],
      },
    });
  }

  it("counts a license only when the profile already states it", () => {
    const withoutLicense = evaluateFit(opening({ title: "Registered Nurse", location: "Cape Town, South Africa", description: nurseJd }), nurse());
    expect(withoutLicense.missingRequired).toContain("Nursing license");
    expect(withoutLicense.matchedRequired).toEqual(expect.arrayContaining(["Patient Care", "Care planning"]));
    const resume = tailorResume(nurse(), withoutLicense, { id: "j1", title: "Registered Nurse", company: "Ward" });
    expect(resume.skills).not.toContain("Nursing license");
    expect(resume.provenance.untraceableLines).toEqual([]);

    const licensed = nurse();
    licensed.certifications = [{ id: "c1", name: "RN license", issuer: "South African Nursing Council", year: "2019" }];
    const withLicense = evaluateFit(opening({ title: "Registered Nurse", location: "Cape Town, South Africa", description: nurseJd }), licensed);
    expect(withLicense.missingRequired).not.toContain("Nursing license");
    expect(withLicense.matchedRequired).toContain("Nursing license");
    const licensedResume = tailorResume(licensed, withLicense, { id: "j1", title: "Registered Nurse", company: "Ward" });
    expect(licensedResume.skills).not.toContain("Nursing license");
    expect(licensedResume.certifications.map((item) => item.name)).toEqual(["RN license"]);
  });

  it("does not prefer a technical profile for healthcare, hospitality, or trades", () => {
    const technical = person({
      skills: [{ name: "Python", level: "expert" }, { name: "SQL", level: "expert" }],
      experience: [{
        id: "e1",
        company: "Acme",
        title: "Software Engineer",
        location: "Austin",
        start: "2020",
        end: "Present",
        bullets: [{ id: "b1", text: "Built Python services and SQL reports" }],
      }],
      preferences: { ...emptyProfile().preferences, country: "US", cities: ["Austin"], timezone: "America/Chicago", targetRoles: ["Software Engineer"] },
    });
    const nurseFit = evaluateFit(opening({ title: "Registered Nurse", location: "Cape Town, South Africa", description: nurseJd }), nurse());
    const technicalOnWard = evaluateFit(opening({ title: "Registered Nurse", location: "Austin, United States", description: nurseJd }), technical);
    expect(nurseFit.score).toBeGreaterThan(technicalOnWard.score);
    expect(technicalOnWard.decision).not.toBe("apply");

    const kitchen = `Head chef for a hotel.
Requirements:
- Cooking and food preparation
- Food safety certificate
- 5 years of kitchen experience`;
    const chef = person({
      skills: [{ name: "Cooking", level: "expert" }, { name: "Food safety", level: "working" }],
      experience: [{
        id: "e1",
        company: "Harbour Inn",
        title: "Sous Chef",
        location: "Dublin",
        start: "2018",
        end: "Present",
        bullets: [{ id: "b1", text: "Ran dinner service and kept food safety logs" }],
      }],
      preferences: { ...emptyProfile().preferences, country: "IE", cities: ["Dublin"], currency: "EUR", timezone: "Europe/Dublin", targetRoles: ["Chef"] },
    });
    const chefFit = evaluateFit(opening({ title: "Head Chef", location: "Dublin, Ireland", description: kitchen, salaryText: "€45,000 per year" }), chef);
    const technicalInKitchen = evaluateFit(opening({ title: "Head Chef", location: "Austin, United States", description: kitchen }), technical);
    expect(chefFit.decision).not.toBe("skip");
    expect(chefFit.score).toBeGreaterThan(technicalInKitchen.score);
    expect(technicalInKitchen.missingRequired).toEqual(expect.arrayContaining(["Cooking", "Food safety"]));
  });
});

describe("english-language markets", () => {
  it("gives each selected market a clock and keeps other countries available", () => {
    for (const code of FEATURED_MARKET_CODES) {
      expect(countryByCode(code)?.cities.length).toBeGreaterThan(0);
      expect(zonesForCountry(code)[0]?.id).not.toBe("UTC");
    }
    expect(countryByCode("FR")?.name).toBe("France");
    expect(zonesForCountry("FR")[0]?.id).toBe("UTC");
  });

  it("migrates a missing clock from the saved country and keeps India time when none was set", () => {
    expect(sanitiseProfile({}).preferences.timezone).toBe("Asia/Kolkata");
    expect(sanitiseProfile({ preferences: { country: "IN" } }).preferences.timezone).toBe("Asia/Kolkata");
    expect(sanitiseProfile({ preferences: { country: "US" } }).preferences.timezone).toBe("America/New_York");
    expect(sanitiseProfile({ preferences: { country: "US", timezone: "America/Los_Angeles" } }).preferences.timezone).toBe("America/Los_Angeles");
    expect(sanitiseProfile({ preferences: { country: "GB", timezone: "Asia/Kolkata" } }).preferences.timezone).toBe("Europe/London");
    const moved = preferencesForCountry(sanitiseProfile({ preferences: { country: "IN", cities: ["Pune"], timezone: "Asia/Kolkata" } }).preferences, "CA");
    expect(moved).toMatchObject({ country: "CA", currency: "CAD", cities: [], timezone: "America/Toronto" });
  });

  it("accepts home cities and rejects another country's remote opening", () => {
    expect(marketLocationOk("Cape Town", "ZA")).toBe(true);
    expect(marketLocationOk("NYC", "US")).toBe(true);
    expect(marketLocationOk("London", "GB")).toBe(true);
    expect(marketLocationOk("London", "US")).toBe(false);
    expect(marketLocationOk("Toronto", "CA")).toBe(true);
    expect(marketLocationOk("Sydney", "AU")).toBe(true);
    expect(marketLocationOk("Singapore", "SG")).toBe(true);
    expect(marketLocationOk("Auckland", "NZ")).toBe(true);
    expect(marketLocationOk("Dublin", "IE")).toBe(true);
    expect(marketLocationOk("Remote, Republic of Ireland", "IE")).toBe(true);
    expect(marketLocationOk("Johannesburg, RSA", "ZA")).toBe(true);
    expect(marketLocationOk("Remote", "SG")).toBe(true);
    expect(marketLocationOk("Remote - United States", "SG")).toBe(false);
    expect(marketLocationOk("Austin, Texas", "ZA")).toBe(false);
    const remote = person({
      preferences: { ...emptyProfile().preferences, country: "AU", cities: [], remoteOk: false, timezone: "Australia/Sydney" },
    });
    expect(evaluateFit(opening({ title: "Teacher", location: "Hybrid, Sydney", description: "Hybrid classroom role" }), remote).blockers.map((item) => item.kind)).toContain("location");
  });
});
