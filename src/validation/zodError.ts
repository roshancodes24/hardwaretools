import type { ZodError } from "zod";

export type ValidationErrorDetail = {
  field: string;
  message: string;
};

export type ValidationErrorJson = {
  error: string;
  details?: ValidationErrorDetail[];
};

export function zodErrorToJson(err: ZodError): ValidationErrorJson {
  const details: ValidationErrorDetail[] = err.issues.map((issue) => ({
    field:
      issue.path.length > 0
        ? issue.path.map((p) => String(p)).join(".")
        : "root",
    message: issue.message,
  }));

  return {
    error: "Validation failed",
    details,
  };
}
