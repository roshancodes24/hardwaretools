import { Router, type Request, type Response } from "express";
import { prisma } from "../lib/prisma";
import { UserRole } from "@prisma/client";
import { hasAdminAccess } from "../middleware/actingUser";

const router = Router();

/**
 * Protected session: requires JWT (via `actingUserMiddleware`).
 * Returns logged-in `user`, optional full `users` list for admin switcher, and legacy ids.
 */
router.get("/", async (req: Request, res: Response) => {
  const jwtUser = req.jwtUser;
  const acting = req.actingUser;
  if (!jwtUser || !acting) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const [admin, cashier] = await Promise.all([
      prisma.user.findFirst({
        where: { role: UserRole.ADMIN, isActive: true },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.user.findFirst({
        where: { role: UserRole.CASHIER, isActive: true },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    if (!admin || !cashier) {
      res.status(503).json({
        error:
          "No active ADMIN and CASHIER users found. Run `npm run seed` to create default users.",
      });
      return;
    }

    const usersRaw = await prisma.user.findMany({
      where: {
        isActive: true,
        role: { in: [UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER] },
      },
      select: { id: true, fullName: true, role: true },
      orderBy: { fullName: "asc" },
    });

    const roleRank: Record<UserRole, number> = {
      [UserRole.ADMIN]: 0,
      [UserRole.MANAGER]: 1,
      [UserRole.CASHIER]: 2,
    };
    const sorted = [...usersRaw].sort(
      (a, b) =>
        roleRank[a.role] - roleRank[b.role] ||
        a.fullName.localeCompare(b.fullName, "en")
    );

    const usersForClient = hasAdminAccess(jwtUser.role)
      ? sorted
      : sorted.filter((u) => u.id === jwtUser.id);

    res.status(200).json({
      user: {
        id: jwtUser.id,
        name: jwtUser.fullName,
        role: jwtUser.role,
      },
      adminUserId: admin.id,
      cashierUserId: cashier.id,
      users: usersForClient.map((u) => ({
        id: u.id,
        fullName: u.fullName,
        role: u.role,
      })),
    });
  } catch (error) {
    console.error("GET /session failed:", error);
    res.status(500).json({ error: "Failed to resolve session users" });
  }
});

export default router;
