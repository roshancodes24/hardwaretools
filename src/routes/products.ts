import { Router } from "express";
import { prisma } from "../lib/prisma";
import { getProductStock } from "../services/inventory";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const products = await prisma.product.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        units: true,
        barcodes: true,
      },
    });

    res.status(200).json(products);
  } catch (error) {
    console.error("GET /products failed:", error);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

router.get("/:id/stock", async (req, res) => {
  try {
    const product = await getProductStock(req.params.id);
    res.status(200).json(product);
  } catch (error) {
    console.error("GET /products/:id/stock failed:", error);
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to fetch stock",
    });
  }
});

export default router;
