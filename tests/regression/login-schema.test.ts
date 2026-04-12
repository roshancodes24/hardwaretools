/**
 * Login request body validation (Zod) — no database.
 */
import { describe, it, expect } from "vitest";
import { loginBodySchema } from "../../src/validation/schemas";

describe("loginBodySchema (username + password)", () => {
  it("accepts minimal valid username and password", () => {
    const r = loginBodySchema.safeParse({ username: "a", password: "x" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.username).toBe("a");
      expect(r.data.password).toBe("x");
    }
  });

  it("trims username", () => {
    const r = loginBodySchema.safeParse({
      username: "  admin  ",
      password: "admin123",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.username).toBe("admin");
  });

  it("uses local part when username field contains an email", () => {
    const r = loginBodySchema.safeParse({
      username: "Admin@Shop.COM",
      password: "admin123",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.username).toBe("admin");
  });

  it("rejects empty username after trim", () => {
    const r = loginBodySchema.safeParse({
      username: "   ",
      password: "x",
    });
    expect(r.success).toBe(false);
  });

  it("rejects username over 64 chars", () => {
    const r = loginBodySchema.safeParse({
      username: "a".repeat(65),
      password: "x",
    });
    expect(r.success).toBe(false);
  });

  it("rejects spaces inside username", () => {
    expect(loginBodySchema.safeParse({ username: "bad name", password: "x" }).success).toBe(
      false
    );
  });

  it("allows dot underscore hyphen in username", () => {
    const r = loginBodySchema.safeParse({
      username: "user_01.name-test",
      password: "secret",
    });
    expect(r.success).toBe(true);
  });

  it("rejects empty password", () => {
    const r = loginBodySchema.safeParse({ username: "admin", password: "" });
    expect(r.success).toBe(false);
  });

  it("does not accept legacy email field instead of username", () => {
    const r = loginBodySchema.safeParse({
      email: "admin@shop.com",
      password: "admin123",
    } as Record<string, unknown>);
    expect(r.success).toBe(false);
  });
});
