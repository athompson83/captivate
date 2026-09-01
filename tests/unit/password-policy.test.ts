import { describe, expect, it } from "vitest";
import { PASSWORD_MIN, passwordProblem } from "@/lib/auth/password";

/**
 * The rule was eight characters and nothing else.
 *
 * Which admitted `12345678`, `password`, and `aaaaaaaa` — the guesses that cost
 * an attacker one request each and are tried against every login form in
 * existence. Length was never the property that mattered; it was a proxy for it,
 * and a poor one at the short end.
 *
 * These are the cases that must stay refused. They are cheap to check and
 * cannot fail open, which is the whole reason they belong in the application
 * rather than waiting on the platform's breach-corpus check.
 */
describe("passwords that must be refused", () => {
  const refuse = (password: string, context?: { email?: string; displayName?: string }) =>
    expect(
      passwordProblem(password, context),
      `expected "${password}" to be refused`,
    ).not.toBeNull();

  it("refuses the passwords tried first", () => {
    for (const password of [
      "password",
      "Password1",
      "P@ssw0rd",
      "12345678",
      "qwerty123",
      "iloveyou1",
    ]) {
      refuse(password);
    }
  });

  it("sees through character substitution", () => {
    // `P@$$w0rd!` and `password` are the same guess to anyone with a rule list.
    refuse("P@$$w0rd!");
    refuse("1L0v3You!");
  });

  it("refuses the product's own name, which is what people reach for", () => {
    refuse("captivate");
    refuse("Presentation");
  });

  it("refuses one character repeated and straight key runs", () => {
    refuse("aaaaaaaaaa");
    refuse("----------");
    refuse("abcdefghij");
    refuse("9876543210");
  });

  it("refuses a password that is really the email or the name on the same form", () => {
    // Both halves of the login sitting in one place is not two secrets.
    refuse("alexsmith99", { email: "alex.smith@example.com" });
    refuse("Wilhelmina1", { displayName: "Wilhelmina" });
  });

  it("still refuses anything under the minimum", () => {
    refuse("Tr0ub4dr");
    expect(passwordProblem("x".repeat(PASSWORD_MIN - 1))).not.toBeNull();
  });

  it("explains what to change rather than restating the rule", () => {
    // Long enough to clear the length gate, so the message under test is the
    // one about the guess itself rather than the one about the character count.
    const message = passwordProblem("password123");
    expect(message).toBeTruthy();
    // A sign-up form is the worst place to make somebody guess what is wrong.
    expect(message).toMatch(/try|avoid|unrelated/i);
  });
});

describe("passwords that must be accepted", () => {
  const accept = (password: string, context?: { email?: string; displayName?: string }) =>
    expect(passwordProblem(password, context), `expected "${password}" to be accepted`).toBeNull();

  it("accepts unrelated words, which is the advice being given", () => {
    accept("correct horse battery staple");
    accept("thimble-rafter-quench");
  });

  it("accepts an ordinary strong password", () => {
    accept("7Kq!wvnZ2r@Lm");
  });

  it("does not refuse a password merely for sharing a few letters with the email", () => {
    // The check has to bite on "the password is the address" without refusing
    // every password that happens to contain a common substring.
    accept("thimble-rafter-quench", { email: "alex.smith@example.com" });
  });

  it("accepts a long passphrase well past the old ceiling of usefulness", () => {
    accept("the seventeenth lantern refused to explain itself");
  });
});
