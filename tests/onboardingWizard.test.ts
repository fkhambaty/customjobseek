import { describe, expect, it } from "vitest";
import {
  WIZARD_STEPS,
  derivedWizardStep,
  needsGuidedOnboarding,
  parseStoredWizardStep,
  parseWizardProgress,
  resumeWizardStep,
  shiftWizardStep,
  wizardContinueBlock,
  wizardCopy,
  type StoredWizardStep,
  type WizardStep,
} from "../shared/onboardingWizard";
import { emptyProfile, type Profile } from "../shared/types";
import { factGaps, profileReadiness } from "../shared/validate";

function readyProfile(): Profile {
  const profile = emptyProfile("ada@example.com");
  profile.fullName = "Ada Lovelace";
  profile.skills = [{ name: "Mathematics", level: "expert" }];
  profile.experience = [{
    id: "1",
    company: "Analytical Engines",
    title: "Engineer",
    location: "",
    start: "1842",
    end: "",
    bullets: [{ id: "b", text: "Wrote a method for calculating Bernoulli numbers." }],
  }];
  profile.preferences.targetRoles = ["Engineer"];
  return profile;
}

describe("guided onboarding", () => {
  it("requires target roles before a profile is ready to scan", () => {
    const profile = readyProfile();
    profile.preferences.targetRoles = [];
    expect(factGaps(profile)).toEqual([]);
    expect(profileReadiness(profile)).toEqual(["the job titles you want"]);
    expect(profileReadiness(emptyProfile())).toEqual([
      "your name",
      "a contact email",
      "at least one skill",
      "at least one role with achievements",
      "the job titles you want",
    ]);
    expect(profileReadiness(readyProfile())).toEqual([]);
  });

  it("resumes the saved step when the profile can still support it", () => {
    const ready = readyProfile();
    expect(derivedWizardStep(emptyProfile(), false)).toBe("welcome");
    expect(derivedWizardStep(emptyProfile(), true)).toBe("facts");
    expect(derivedWizardStep(ready, false)).toBe("confirm");

    const partial = readyProfile();
    partial.preferences.targetRoles = [];
    expect(derivedWizardStep(partial, true)).toBe("roles");
    expect(resumeWizardStep(ready, "market", false)).toBe("paths");
    expect(resumeWizardStep(partial, "market", false)).toBe("roles");
    expect(resumeWizardStep(ready, "paths", false)).toBe("paths");
    expect(resumeWizardStep(ready, "scan", false)).toBe("scan");
    expect(resumeWizardStep(partial, "scan", false)).toBe("roles");
    expect(resumeWizardStep(emptyProfile(), "resume", false)).toBe("resume");
    expect(resumeWizardStep(ready, "", false)).toBe("confirm");
    expect(resumeWizardStep(ready, "done", false)).toBe("confirm");
  });

  it("keeps completed people on Today and everyone else in setup", () => {
    const steps: StoredWizardStep[] = ["", "done", "market", ...WIZARD_STEPS];
    const gates = steps.map((step) => [step, needsGuidedOnboarding(step, true), needsGuidedOnboarding(step, false)]);
    expect(gates).toEqual([
      ["", false, true],
      ["done", false, false],
      ["market", true, true],
      ["welcome", true, true],
      ["resume", true, true],
      ["facts", true, true],
      ["roles", true, true],
      ["paths", true, true],
      ["confirm", true, true],
      ["scan", true, true],
    ]);
  });

  it("walks forward and back through every step", () => {
    let step: WizardStep = "welcome";
    const seen: WizardStep[] = [step];
    while (true) {
      const next = shiftWizardStep(step, "continue");
      if (!next) break;
      step = next;
      seen.push(step);
    }
    expect(seen).toEqual([...WIZARD_STEPS]);
    expect(seen).not.toContain("market");
    expect(shiftWizardStep("scan", "continue")).toBeNull();
    expect(shiftWizardStep("welcome", "back")).toBeNull();
    while (true) {
      const previous = shiftWizardStep(step, "back");
      if (!previous) break;
      step = previous;
    }
    expect(step).toBe("welcome");
  });

  it("explains every step and blocks continue until the required facts exist", () => {
    for (const step of WIZARD_STEPS) {
      const copy = wizardCopy(step);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.why.length).toBeGreaterThan(20);
      expect(copy.short.length).toBeGreaterThan(0);
    }
    const empty = emptyProfile("ada@example.com");
    expect(wizardContinueBlock("welcome", empty)).toBeNull();
    expect(wizardContinueBlock("resume", empty)).toBeNull();
    expect(wizardContinueBlock("paths", empty)).toBeNull();
    expect(wizardContinueBlock("scan", empty)).toBeNull();
    expect(wizardContinueBlock("facts", empty)).toMatch(/your name/);
    expect(wizardContinueBlock("roles", readyProfile())).toBeNull();
    const noRoles = readyProfile();
    noRoles.preferences.targetRoles = [];
    expect(wizardContinueBlock("roles", noRoles)).toMatch(/job title/i);
    expect(wizardContinueBlock("confirm", noRoles)).toMatch(/job titles/);
    expect(wizardContinueBlock("confirm", readyProfile())).toBeNull();
  });

  it("accepts only real saved steps and remaps retired market to paths", () => {
    expect(parseStoredWizardStep("market")).toBe("market");
    expect(parseWizardProgress("market")).toBe("paths");
    expect(parseStoredWizardStep("done")).toBe("done");
    expect(parseStoredWizardStep("")).toBe("");
    expect(parseStoredWizardStep("profile")).toBe("");
    expect(parseStoredWizardStep(3)).toBe("");
    expect(parseWizardProgress("scan")).toBe("scan");
    expect(parseWizardProgress("done")).toBe("done");
    expect(parseWizardProgress("")).toBeNull();
    expect(parseWizardProgress("welcome ")).toBeNull();
  });
});
