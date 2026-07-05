export type FieldDetail = {
  field: string;
  message: string;
};

export class ApiError extends Error {
  readonly status: number;
  readonly details?: FieldDetail[];
  readonly code?: string;
  readonly field?: string;

  constructor(
    message: string,
    status: number,
    details?: FieldDetail[],
    meta?: { code?: string; field?: string }
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
    this.code = meta?.code;
    this.field = meta?.field;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

function normalizeDetails(raw: unknown): FieldDetail[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: FieldDetail[] = [];
  for (const item of raw) {
    if (
      typeof item === "object" &&
      item !== null &&
      "field" in item &&
      "message" in item &&
      typeof (item as FieldDetail).field === "string" &&
      typeof (item as FieldDetail).message === "string"
    ) {
      out.push({
        field: (item as FieldDetail).field,
        message: (item as FieldDetail).message,
      });
    }
  }
  return out.length ? out : undefined;
}

function friendlyHttpFallback(status: number): string {
  if (status === 404) {
    return [
      "The API did not handle this request (404).",
      "If the response was HTML, the browser likely reached Vite without proxying /api to Express.",
      "From the project root run `npm run dev:all`, or run `npm run dev` (API :4000) and `npm run dev:web` separately.",
      "For preview builds, keep the API running; Vite preview proxies /api to 127.0.0.1:4000.",
      "Or set VITE_API_URL (no trailing slash, e.g. http://127.0.0.1:4000) and rebuild.",
    ].join(" ");
  }
  if (status === 413) {
    return [
      "Request body is too large (413).",
      "Bulk imports send a large JSON payload — restart the API after updating JSON_BODY_LIMIT, or import fewer rows at a time.",
    ].join(" ");
  }
  return `Request failed (${status}). Check that the API server is running.`;
}

function toPlainMessage(raw: string, status: number): string {
  const trimmed = raw.trim();
  if (!trimmed) return friendlyHttpFallback(status);
  if (/<!doctype html>|<html/i.test(trimmed)) return friendlyHttpFallback(status);
  return trimmed;
}

export function parseErrorResponse(
  status: number,
  body: unknown,
  fallbackText: string
): ApiError {
  if (typeof body === "object" && body !== null && "error" in body) {
    const rawError = (body as { error: unknown }).error;
    let message = fallbackText;
    let code: string | undefined;
    let field: string | undefined;

    if (typeof rawError === "string" && rawError.length > 0) {
      message = toPlainMessage(rawError, status);
    } else if (typeof rawError === "object" && rawError !== null) {
      const msg = (rawError as { message?: unknown }).message;
      const c = (rawError as { code?: unknown }).code;
      const f = (rawError as { field?: unknown }).field;
      if (typeof msg === "string" && msg.length > 0) {
        message = toPlainMessage(msg, status);
      }
      if (typeof c === "string") code = c;
      if (typeof f === "string") field = f;
    }

    const details = normalizeDetails(
      (body as { details?: unknown }).details
    );
    return new ApiError(message, status, details, { code, field });
  }
  const plain =
    typeof fallbackText === "string" &&
    (/<!doctype html>|<html/i.test(fallbackText) ||
      /Cannot GET|Cannot POST/i.test(fallbackText))
      ? friendlyHttpFallback(status)
      : fallbackText;
  return new ApiError(plain, status, undefined);
}
