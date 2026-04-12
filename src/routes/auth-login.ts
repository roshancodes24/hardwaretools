import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { signAccessToken } from "../lib/jwt";
import { validateBody } from "../middleware/validateBody";
import { loginBodySchema, type LoginBodyValidated } from "../validation/schemas";

const router = Router();

/**
 * POST /api/login — username + password → JWT + user profile.
 */
router.post(
  "/",
  validateBody(loginBodySchema),
  async (req, res) => {
    const { username, password } = req.validatedBody as LoginBodyValidated;
    try {
      const user = await prisma.user.findFirst({
        where: { username, isActive: true },
        select: {
          id: true,
          fullName: true,
          role: true,
          passwordHash: true,
        },
      });

      const fail = () => {
        res.status(401).json({ error: "Invalid credentials" });
      };

      if (!user) {
        fail();
        return;
      }

      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) {
        fail();
        return;
      }

      const token = signAccessToken(user.id);
      res.status(200).json({
        token,
        user: {
          id: user.id,
          name: user.fullName,
          role: user.role,
        },
      });
    } catch (error) {
      console.error("POST /login failed:", error);
      res.status(500).json({ error: "Login failed" });
    }
  }
);

export default router;
