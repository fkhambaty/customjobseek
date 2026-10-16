/** Password rules enforced at signup and reset. Keep UI hints in sync with this. */

export const PASSWORD_MIN_LENGTH = 10;
/** Signup and password-reset email codes expire after this many minutes. */
export const CODE_TTL_MINUTES = 15;

export interface PasswordRule {
  id: "length" | "letter" | "number";
  label: string;
  ok: (password: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  {
    id: "length",
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    ok: (password) => password.length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: "letter",
    label: "At least one letter (A–Z or a–z)",
    ok: (password) => /[A-Za-z]/.test(password),
  },
  {
    id: "number",
    label: "At least one number (0–9)",
    ok: (password) => /\d/.test(password),
  },
];

export function passwordHints(): string[] {
  return PASSWORD_RULES.map((rule) => rule.label);
}

export function passwordHintSentence(): string {
  return passwordHints().join(". ") + ".";
}

export function validatePassword(password: string): string | null {
  for (const rule of PASSWORD_RULES) {
    if (!rule.ok(password)) return `Password needs: ${rule.label.toLowerCase()}.`;
  }
  return null;
}

export function passwordRuleStates(password: string): { id: PasswordRule["id"]; label: string; met: boolean }[] {
  return PASSWORD_RULES.map((rule) => ({ id: rule.id, label: rule.label, met: rule.ok(password) }));
}
