export type FieldDetail = {
  field: string;
  message: string;
};

export class ApiError extends Error {
  readonly status: number;
  readonly details?: FieldDetail[];

  constructor(message: string, status: number, details?: FieldDetail[]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
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

export function parseErrorResponse(
  status: number,
  body: unknown,
  fallbackText: string
): ApiError {
  if (typeof body === "object" && body !== null && "error" in body) {
    const errMsg = (body as { error: unknown }).error;
    const message =
      typeof errMsg === "string" && errMsg.length > 0 ? errMsg : fallbackText;
    const details = normalizeDetails(
      (body as { details?: unknown }).details
    );
    return new ApiError(message, status, details);
  }
  return new ApiError(fallbackText, status, undefined);
}
