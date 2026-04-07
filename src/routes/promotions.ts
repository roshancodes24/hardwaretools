import { Prisma } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../lib/prisma";
import { validateBody } from "../middleware/validateBody";
import type {
  CreatePromotionValidated,
  UpdatePromotionValidated,
} from "../validation/schemas";
import { createPromotionSchema, updatePromotionSchema } from "../validation/schemas";

const router = Router();

function serializePromotion(p: {
  products: Array<{ productId: string }>;
  [k: string]: unknown;
}) {
  return {
    ...p,
    productIds: p.products.map((pp) => pp.productId),
  };
}

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
    res.status(200).json(promotions.map((p) => serializePromotion(p)));
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
      res.status(201).json(serializePromotion(promotion));
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

router.put(
  "/:id",
  validateBody(updatePromotionSchema),
  async (req, res) => {
    const body = req.validatedBody as UpdatePromotionValidated;
    try {
      const updated = await prisma.$transaction(async (tx) => {
        const promotion = await tx.promotion.update({
          where: { id: req.params.id },
          data: {
            name: body.name,
            code: body.scope === "CART" ? (body.code?.toUpperCase() ?? null) : null,
            scope: body.scope,
            category: body.scope === "CATEGORY" ? (body.category ?? null) : null,
            percentage: body.percentage,
            isActive: body.isActive,
            startsAt: body.startsAt ?? null,
            endsAt: body.endsAt ?? null,
            note: body.note ?? null,
          },
        });

        await tx.promotionProduct.deleteMany({
          where: { promotionId: promotion.id },
        });
        if (body.scope === "PRODUCT" && body.productIds && body.productIds.length > 0) {
          await tx.promotionProduct.createMany({
            data: body.productIds.map((productId) => ({
              promotionId: promotion.id,
              productId,
            })),
            skipDuplicates: true,
          });
        }

        return tx.promotion.findUniqueOrThrow({
          where: { id: promotion.id },
          include: { products: true },
        });
      });

      res.status(200).json(serializePromotion(updated));
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
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      ) {
        res.status(404).json({ error: "Promotion not found" });
        return;
      }
      console.error("PUT /promotions/:id failed:", error);
      res.status(400).json({
        error:
          error instanceof Error ? error.message : "Failed to update promotion",
      });
    }
  }
);

router.delete("/:id", async (req, res) => {
  try {
    await prisma.promotion.delete({
      where: { id: req.params.id },
    });
    res.status(204).send();
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      res.status(404).json({ error: "Promotion not found" });
      return;
    }
    console.error("DELETE /promotions/:id failed:", error);
    res.status(500).json({ error: "Failed to delete promotion" });
  }
});

export default router;
