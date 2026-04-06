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

function toPlainMessage(raw: string, fallbackText: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return fallbackText;
  if (/<!doctype html>|<html/i.test(trimmed)) return fallbackText;
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
      message = toPlainMessage(rawError, fallbackText);
    } else if (typeof rawError === "object" && rawError !== null) {
      const msg = (rawError as { message?: unknown }).message;
      const c = (rawError as { code?: unknown }).code;
      const f = (rawError as { field?: unknown }).field;
      if (typeof msg === "string" && msg.length > 0) message = msg;
      if (typeof c === "string") code = c;
      if (typeof f === "string") field = f;
    }

    const details = normalizeDetails(
      (body as { details?: unknown }).details
    );
    return new ApiError(message, status, details, { code, field });
  }
  return new ApiError(fallbackText, status, undefined);
}
