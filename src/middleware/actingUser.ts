import type { NextFunction, Request, Response } from "express";
import { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { verifyAccessToken } from "../lib/jwt";

/** JWT subject + effective row fields used by session and RBAC. */
export type AuthUser = { id: string; role: UserRole; fullName: string };

declare global {
  namespace Express {
    interface Request {
      /** Who signed in (JWT `sub`). */
      jwtUser?: AuthUser;
      /** Effective user for permissions and `createdById` checks (impersonation). */
      actingUser?: AuthUser;
    }
  }
}

/** ADMIN and legacy MANAGER = full back-office access (2-role model + compat). */
export function hasAdminAccess(role: UserRole): boolean {
  return role === UserRole.ADMIN || role === UserRole.MANAGER;
}

function parseBearer(req: Request): string | null {
  const raw = req.get("authorization") ?? req.get("Authorization") ?? "";
  const m = /^Bearer\s+(\S+)/i.exec(raw.trim());
  return m ? m[1].trim() : null;
}

/**
 * Requires `Authorization: Bearer <JWT>`.
 * Optional `X-Acting-User-Id`: only when JWT user is ADMIN/MANAGER — switch effective user.
 */
export function actingUserMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  void (async () => {
    try {
      const bearer = parseBearer(req);
      if (!bearer) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      let sub: string;
      try {
        sub = verifyAccessToken(bearer).sub;
      } catch {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const jwtRow = await prisma.user.findFirst({
        where: { id: sub, isActive: true },
        select: { id: true, role: true, fullName: true },
      });
      if (!jwtRow) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const jwtUser: AuthUser = {
        id: jwtRow.id,
        role: jwtRow.role,
        fullName: jwtRow.fullName,
      };
      req.jwtUser = jwtUser;

      let effective = jwtUser;
      const altId = (req.get("x-acting-user-id") ?? "").trim();
      if (altId && altId !== jwtUser.id) {
        if (!hasAdminAccess(jwtUser.role)) {
          res.status(403).json({ error: "Cannot switch acting user" });
          return;
        }
        const alt = await prisma.user.findFirst({
          where: { id: altId, isActive: true },
          select: { id: true, role: true, fullName: true },
        });
        if (!alt) {
          res.status(401).json({ error: "Unknown or inactive user" });
          return;
        }
        effective = {
          id: alt.id,
          role: alt.role,
          fullName: alt.fullName,
        };
      }

      req.actingUser = effective;
      next();
    } catch (e) {
      next(e);
    }
  })();
}
