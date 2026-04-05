import { Router } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      orderBy: { name: "asc" },
    });
    res.status(200).json(suppliers);
  } catch (error) {
    console.error("GET /suppliers failed:", error);
    res.status(500).json({ error: "Failed to fetch suppliers" });
  }
});

export default router;
