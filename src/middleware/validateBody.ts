import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny } from "zod";
import { zodErrorToJson } from "../validation/zodError";

/**
 * Parses `req.body` with a Zod schema. On failure responds **422** with
 * `{ error: "Validation failed", details: [{ field, message }] }`.
 */
export function validateBody<S extends ZodTypeAny>(schema: S) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json(zodErrorToJson(parsed.error));
      return;
    }
    req.validatedBody = parsed.data;
    next();
  };
}
