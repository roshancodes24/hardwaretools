import type { ErrorRequestHandler, RequestHandler } from "express";

/** One-line access log for API requests (method, path, status, duration). */
export function requestLogger(): RequestHandler {
  return (req, res, next) => {
    const started = Date.now();
    res.on("finish", () => {
      if (req.path.startsWith("/api")) {
        const ms = Date.now() - started;
        console.log(
          `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`
        );
      }
    });
    next();
  };
}

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  if (/CORS blocked origin/i.test(message)) {
    res.status(403).json({ error: "Origin not allowed by CORS policy." });
    return;
  }

  console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({ error: "Internal server error" });
};
