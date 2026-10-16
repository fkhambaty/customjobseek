import { describe, expect, it } from "vitest";
import {
  CODE_TTL_MINUTES,
  PASSWORD_MIN_LENGTH,
  passwordHintSentence,
  passwordRuleStates,
  validatePassword,
} from "../shared/password";

describe("password rules", () => {
  it("requires length, a letter, and a number", () => {
    expect(validatePassword("short")).toMatch(/at least/i);
    expect(validatePassword("abcdefghij")).toMatch(/number/i);
    expect(validatePassword("1234567890")).toMatch(/letter/i);
    expect(validatePassword("abcdefghi1")).toBeNull();
  });

  it("exposes the same rules the signup UI shows", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(10);
    expect(CODE_TTL_MINUTES).toBe(15);
    expect(passwordHintSentence()).toContain("10 characters");
    const states = passwordRuleStates("Abcdefgh12");
    expect(states.every((rule) => rule.met)).toBe(true);
  });
});
