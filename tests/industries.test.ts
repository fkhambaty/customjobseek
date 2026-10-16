import { describe, expect, it } from "vitest";
import { companyMatchesIndustries, sectorsForIndustries } from "../shared/industries";
import { resolveRole } from "../shared/engine/occupations";

describe("industry scan steering", () => {
  it("resolves dietitian titles into healthcare", () => {
    expect(resolveRole("Clinical Dietitian")).toMatchObject({ family: "healthcare", canonical: "Dietitian" });
    expect(resolveRole("Nutritionist")).toMatchObject({ family: "healthcare" });
  });

  it("matches healthcare sectors and rejects unrelated software boards", () => {
    const sectors = sectorsForIndustries(["healthcare"]);
    expect(sectors.map((s) => s.toLowerCase())).toEqual(expect.arrayContaining(["healthcare", "nutrition"]));
    expect(companyMatchesIndustries(JSON.stringify(["healthcare", "nutrition"]), ["healthcare"])).toBe(true);
    expect(companyMatchesIndustries(JSON.stringify(["software", "AI"]), ["healthcare"])).toBe(false);
    expect(companyMatchesIndustries(JSON.stringify(["software"]), [])).toBe(true);
  });
});
