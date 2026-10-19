import type { Profile } from "./types";
import { factGaps, profileReadiness } from "./validate";

export const WIZARD_STEPS = ["welcome", "resume", "facts", "roles", "paths", "confirm", "scan"] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number];

/** Empty is an account from before guided setup. Done means they left the wizard. "market" is a retired step remapped to paths. */
export type StoredWizardStep = WizardStep | "done" | "" | "market";

export interface OnboardingProgress {
  profile: boolean;
  resume: boolean;
  preferences: boolean;
  firstCheck: boolean;
  step: StoredWizardStep;
}

export interface WizardCopy {
  title: string;
  short: string;
  why: string;
}

const STORED: Record<StoredWizardStep, true> = {
  welcome: true,
  resume: true,
  facts: true,
  roles: true,
  market: true,
  paths: true,
  confirm: true,
  scan: true,
  done: true,
  "": true,
};

export function parseStoredWizardStep(value: unknown): StoredWizardStep {
  if (typeof value !== "string" || !Object.hasOwn(STORED, value)) return "";
  return value as StoredWizardStep;
}

/** A step the client is allowed to save. Empty is only the legacy default. Retired "market" becomes "paths". */
export function parseWizardProgress(value: unknown): WizardStep | "done" | null {
  const step = parseStoredWizardStep(value);
  if (step === "") return null;
  if (step === "market") return "paths";
  return step;
}

export function wizardStepIndex(step: WizardStep): number {
  return WIZARD_STEPS.indexOf(step);
}

export function wizardCopy(step: WizardStep): WizardCopy {
  switch (step) {
    case "welcome":
      return {
        title: "Let’s set up your search",
        short: "Welcome",
        why: "A scan is only useful if it knows your real work. This takes a few minutes. You can leave and come back. Nothing here is shown to employers.",
      };
    case "resume":
      return {
        title: "Start from a resume, or type it",
        short: "Resume",
        why: "A text PDF fills your jobs and skills for you. You will check every line next. A scanned image will not work. Typing it yourself is fine.",
      };
    case "facts":
      return {
        title: "Check what is true",
        short: "Facts",
        why: "Fit scores and resumes use these words and no others. Fix anything that is wrong, missing, or too strong.",
      };
    case "roles":
      return {
        title: "Which jobs should we look for?",
        short: "Roles",
        why: "Pick your industry, then the titles to find. Industry steers which employer boards a scan prefers. Titles decide which openings are worth reading. Without at least one title, a scan has nothing to match and stays off.",
      };
    case "paths":
      return {
        title: "Where to look, and for what pay",
        short: "Paths",
        why: "Each search path is one place rule and one pay band, such as Pune · ₹25–₹35 LPA, Remote · $80k–$120k, or India except Pune · ₹40–₹80 LPA. Set your country and time zone here, then add up to six paths. A job matches on the midpoint of published pay. If the posting has no pay, you can review it separately. Nothing is guessed.",
      };
    case "confirm":
      return {
        title: "Does this look like you?",
        short: "Confirm",
        why: "This is the picture the first scan will use. Go back if something is off, or open the full profile editor for school, certificates, and skills you refuse to claim.",
      };
    case "scan":
      return {
        title: "Your first scan is free",
        short: "Scan",
        why: "One scan reads the strongest openings for your titles and prepares up to three application packs. It uses your free scan. You can start it now or from Today later.",
      };
    default: {
      const unexpected: never = step;
      throw new Error(String(unexpected));
    }
  }
}

function hasDraftFacts(profile: Profile): boolean {
  return Boolean(
    profile.fullName.trim()
    || profile.headline.trim()
    || profile.summary.trim()
    || profile.skills.length
    || profile.experience.length
    || profile.education.length,
  );
}

/** Earliest step the saved profile still needs. */
export function derivedWizardStep(profile: Profile, resumeImported: boolean): WizardStep {
  if (factGaps(profile).length === 0 && profile.preferences.targetRoles.length > 0) return "confirm";
  if (factGaps(profile).length === 0) return "roles";
  if (resumeImported || hasDraftFacts(profile)) return "facts";
  return "welcome";
}

function canOffer(step: WizardStep, profile: Profile): boolean {
  switch (step) {
    case "welcome":
    case "resume":
    case "facts":
      return true;
    case "roles":
      return factGaps(profile).length === 0;
    case "paths":
      return factGaps(profile).length === 0 && profile.preferences.targetRoles.length > 0;
    case "confirm":
    case "scan":
      return profileReadiness(profile).length === 0;
    default: {
      const unexpected: never = step;
      return unexpected;
    }
  }
}

export function resumeWizardStep(profile: Profile, stored: StoredWizardStep, resumeImported: boolean): WizardStep {
  const derived = derivedWizardStep(profile, resumeImported);
  switch (stored) {
    case "":
    case "done":
      return derived;
    case "market":
      return canOffer("paths", profile) ? "paths" : derived;
    case "welcome":
    case "resume":
    case "facts":
    case "roles":
    case "paths":
    case "confirm":
    case "scan":
      return canOffer(stored, profile) ? stored : derived;
    default: {
      const unexpected: never = stored;
      return unexpected;
    }
  }
}

export function needsGuidedOnboarding(step: StoredWizardStep, profileReady: boolean): boolean {
  switch (step) {
    case "done":
      return false;
    case "":
      return !profileReady;
    case "welcome":
    case "resume":
    case "facts":
    case "roles":
    case "market":
    case "paths":
    case "confirm":
    case "scan":
      return true;
    default: {
      const unexpected: never = step;
      return unexpected;
    }
  }
}

function stepDelta(direction: "back" | "continue"): number {
  switch (direction) {
    case "back":
      return -1;
    case "continue":
      return 1;
    default: {
      const unexpected: never = direction;
      throw new Error(String(unexpected));
    }
  }
}

export function shouldPersistSearchPaths(from: WizardStep, to: WizardStep): boolean {
  return from === "paths" && wizardStepIndex(to) > wizardStepIndex(from);
}

export function shiftWizardStep(step: WizardStep, direction: "back" | "continue"): WizardStep | null {
  return WIZARD_STEPS[wizardStepIndex(step) + stepDelta(direction)] ?? null;
}

export function wizardContinueBlock(step: WizardStep, profile: Profile): string | null {
  switch (step) {
    case "welcome":
    case "resume":
    case "paths":
    case "scan":
      return null;
    case "facts": {
      const missing = factGaps(profile);
      return missing.length ? `Add ${missing.join(", ")} before continuing.` : null;
    }
    case "roles":
      return profile.preferences.targetRoles.length ? null : "Add at least one job title you want.";
    case "confirm": {
      const missing = profileReadiness(profile);
      return missing.length ? `Still needed: ${missing.join(", ")}.` : null;
    }
    default: {
      const unexpected: never = step;
      return unexpected;
    }
  }
}
