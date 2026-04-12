import type { NextFunction, Request, Response } from "express";
import { hasAdminAccess } from "./actingUser";

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const u = req.actingUser;
  if (!u) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (!hasAdminAccess(u.role)) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

type BodyUserField = "createdById" | "adjustedById";

export function assertBodyUserMatchesActing(
  req: Request,
  field: BodyUserField
): { ok: true } | { ok: false; status: number; message: string } {
  const acting = req.actingUser;
  if (!acting) {
    return { ok: false, status: 401, message: "Not authenticated" };
  }
  const body = req.body as Record<string, unknown> | undefined;
  const raw = body?.[field];
  const id = typeof raw === "string" ? raw.trim() : "";
  if (!id || id !== acting.id) {
    return {
      ok: false,
      status: 403,
      message: `${field} must match the signed-in user`,
    };
  }
  return { ok: true };
}
