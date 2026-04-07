import { Prisma } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../lib/prisma";
import { validateBody } from "../middleware/validateBody";
import type { CreatePromotionValidated } from "../validation/schemas";
import { createPromotionSchema } from "../validation/schemas";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const promotions = await prisma.promotion.findMany({
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
      include: {
        products: {
          include: {
            product: {
              select: { id: true, sku: true, name: true, category: true },
            },
          },
        },
      },
    });
    res.status(200).json(
      promotions.map((p) => ({
        ...p,
        productIds: p.products.map((pp) => pp.productId),
      }))
    );
  } catch (error) {
    console.error("GET /promotions failed:", error);
    res.status(500).json({ error: "Failed to fetch promotions" });
  }
});

router.post(
  "/",
  validateBody(createPromotionSchema),
  async (req, res) => {
    const body = req.validatedBody as CreatePromotionValidated;
    try {
      const promotion = await prisma.promotion.create({
        data: {
          name: body.name,
          code: body.code ? body.code.toUpperCase() : null,
          scope: body.scope,
          category: body.category ?? null,
          percentage: body.percentage,
          isActive: body.isActive,
          startsAt: body.startsAt ?? null,
          endsAt: body.endsAt ?? null,
          note: body.note ?? null,
          products:
            body.scope === "PRODUCT" && body.productIds
              ? {
                  create: body.productIds.map((productId) => ({
                    productId,
                  })),
                }
              : undefined,
        },
        include: {
          products: true,
        },
      });
      res.status(201).json({
        ...promotion,
        productIds: promotion.products.map((p) => p.productId),
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        res.status(409).json({
          error: "Promotion code already exists",
        });
        return;
      }
      console.error("POST /promotions failed:", error);
      res.status(400).json({
        error:
          error instanceof Error ? error.message : "Failed to create promotion",
      });
    }
  }
);

export default router;
