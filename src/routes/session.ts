import { Router } from "express";
import { prisma } from "../lib/prisma";
import { UserRole } from "@prisma/client";

const router = Router();

/**
 * Dev-friendly defaults: first active ADMIN and CASHIER from the database.
 * Replace with real auth when you add login.
 */
router.get("/", async (_req, res) => {
  try {
    const [admin, cashier] = await Promise.all([
      prisma.user.findFirst({
        where: { role: UserRole.ADMIN, isActive: true },
        select: { id: true },
      }),
      prisma.user.findFirst({
        where: { role: UserRole.CASHIER, isActive: true },
        select: { id: true },
      }),
    ]);

    if (!admin || !cashier) {
      res.status(503).json({
        error:
          "No active ADMIN and CASHIER users found. Run `npm run seed` to create default users.",
      });
      return;
    }

    res.status(200).json({
      adminUserId: admin.id,
      cashierUserId: cashier.id,
    });
  } catch (error) {
    console.error("GET /session failed:", error);
    res.status(500).json({ error: "Failed to resolve session users" });
  }
});

export default router;
