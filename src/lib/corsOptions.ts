import type { CorsOptions } from "cors";

/** Parse comma-separated browser origins from CORS_ORIGIN. */
function parseAllowedOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * CORS policy:
 * - Development: localhost Vite dev server origins (unless overridden).
 * - Production: set CORS_ORIGIN to allowed frontend URL(s).
 * - Same-origin production (SERVE_FRONTEND=1): requests without Origin are allowed.
 */
export function buildCorsOptions(): CorsOptions {
  const isProd = process.env.NODE_ENV === "production";
  const configured = parseAllowedOrigins(process.env.CORS_ORIGIN);

  const defaultDevOrigins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
  ];

  const allowed = configured.length > 0 ? configured : isProd ? [] : defaultDevOrigins;

  return {
    origin(origin, callback) {
      // Same-origin / server-to-server / curl — no Origin header.
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowed.includes(origin)) {
        callback(null, true);
        return;
      }
      if (!isProd && allowed.length === 0) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked origin: ${origin}`));
    },
    credentials: true,
  };
}
