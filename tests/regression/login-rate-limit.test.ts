/**
 * Login rate limiting — brute-force protection on POST /api/login.
 */
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createLoginRateLimiter } from "../../src/middleware/loginRateLimit";

describe("Login rate limiter", () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it("returns 429 after exceeding max attempts from the same IP", async () => {
    process.env.VITEST = "";
    process.env.NODE_ENV = "development";
    process.env.LOGIN_RATE_LIMIT_MAX = "3";
    process.env.LOGIN_RATE_LIMIT_WINDOW_MS = "600000";

    const app = express();
    app.set("trust proxy", 1);
    app.post("/login", createLoginRateLimiter(), (_req, res) => {
      res.status(401).json({ error: "Invalid credentials" });
    });

    for (let i = 0; i < 3; i++) {
      const res = await request(app).post("/login").send({
        username: "admin",
        password: "wrong",
      });
      expect(res.status).toBe(401);
    }

    const blocked = await request(app).post("/login").send({
      username: "admin",
      password: "wrong",
    });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/too many login attempts/i);
  });
});
