import rateLimit from "express-rate-limit";
import type { RequestHandler } from "express";

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Skip throttling in automated tests (Vitest sets VITEST=true). */
function shouldSkipRateLimit(): boolean {
  return process.env.VITEST === "true" || process.env.NODE_ENV === "test";
}

/**
 * Brute-force protection for POST /api/login.
 * Defaults: 10 attempts per IP per 15 minutes (override via env).
 * Set LOGIN_RATE_LIMIT_MAX=0 to disable.
 */
export function createLoginRateLimiter(): RequestHandler {
  if (shouldSkipRateLimit()) {
    return (_req, _res, next) => next();
  }

  const max = parsePositiveInt(process.env.LOGIN_RATE_LIMIT_MAX, 10);
  if (max <= 0) {
    return (_req, _res, next) => next();
  }

  const windowMs = parsePositiveInt(
    process.env.LOGIN_RATE_LIMIT_WINDOW_MS,
    15 * 60 * 1000
  );

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: "Too many login attempts. Please wait and try again.",
    },
    skipSuccessfulRequests: true,
  });
}
