import type { Profile } from "./types";
import { factGaps, profileReadiness } from "./validate";

export const WIZARD_STEPS = ["welcome", "resume", "facts", "roles", "market", "paths", "confirm", "scan"] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number];

/** Empty is an account from before guided setup. Done means they left the wizard. */
export type StoredWizardStep = WizardStep | "done" | "";

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

/** A step the client is allowed to save. Empty is only the legacy default. */
export function parseWizardProgress(value: unknown): WizardStep | "done" | null {
  const step = parseStoredWizardStep(value);
  if (step === "") return null;
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
        why: "Titles decide which openings are worth reading. Without at least one, a scan has nothing to match and stays off.",
      };
    case "market":
      return {
        title: "Where you will work, and for what pay",
        short: "Market",
        why: "Country, remote work, and pay tell the scan what to skip. A role in the wrong place, or below your pay, is not a match. Leaving pay blank means you have no pay floor.",
      };
    case "paths":
      return {
        title: "Name the search paths you want",
        short: "Paths",
        why: "A search path is one place and one pay rule, such as Pune · Below ₹35 LPA or Remote · Above ₹30 LPA. A job matches on the midpoint of the pay the posting published. If the posting has no pay, you can review it separately. Nothing is guessed.",
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

/** Earliest step the saved profile still needs. Market is kept only when that step was saved. */
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
    case "market":
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
    case "welcome":
    case "resume":
    case "facts":
    case "roles":
    case "market":
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
    case "market":
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
