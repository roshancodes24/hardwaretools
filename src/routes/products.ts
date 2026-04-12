import type { Prisma } from "@prisma/client";
import { ProductStatus, UnitKind } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../lib/prisma";
import { validateBody } from "../middleware/validateBody";
import { requireAdmin } from "../middleware/requireRole";
import { generateNextSku } from "../lib/generateSku";
import { getProductStock } from "../services/inventory";
import {
  batchCreateProductsSchema,
  type BatchCreateProductsValidated,
  updateProductBodySchema,
  type UpdateProductBodyValidated,
} from "../validation/schemas";

const router = Router();

function paramStr(v: string | string[] | undefined): string {
  if (v == null) return "";
  return Array.isArray(v) ? (v[0] ?? "") : v;
}

function unitDisplayName(code: string): string {
  const map: Record<string, string> = {
    pc: "Piece",
    pcs: "Pieces",
    kg: "Kilogram",
    g: "Gram",
    mg: "Milligram",
    m: "Meter",
    cm: "Centimetre",
    mm: "Millimetre",
    L: "Litre",
    mL: "Millilitre",
    box: "Box",
    roll: "Roll",
    bag: "Bag",
    pair: "Pair",
    set: "Set",
    bundle: "Bundle",
    sheet: "Sheet",
    tin: "Tin",
    drum: "Drum",
  };
  return map[code] ?? code.charAt(0).toUpperCase() + code.slice(1);
}

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

router.post(
  "/batch",
  requireAdmin,
  validateBody(batchCreateProductsSchema),
  async (req, res) => {
    const { products: items } =
      req.validatedBody as BatchCreateProductsValidated;

    try {
      // Create products in a single transaction (SKU assigned per row from category sequence)
      const created = await prisma.$transaction(async (tx) => {
        const results = [];
        for (const item of items) {
          const sku = await generateNextSku(tx, item.category);
          const product = await tx.product.create({
            data: {
              sku,
              name: item.name,
              description: item.description ?? null,
              category: item.category,
              brand: item.brand ?? null,
              status: ProductStatus.ACTIVE,
              baseUnitCode: item.baseUnitCode,
              unitKind: item.unitKind as UnitKind,
              allowsFractional: item.allowsFractional,
              sellingPrice: item.sellingPrice != null ? item.sellingPrice : null,
              costPrice: item.costPrice != null ? item.costPrice : null,
              taxRate: item.taxRate != null ? item.taxRate : null,
              reorderLevel: item.reorderLevel != null ? item.reorderLevel : null,
              currentStock: item.currentStock,
              units: {
                create: {
                  code: item.baseUnitCode,
                  displayName: unitDisplayName(item.baseUnitCode),
                  isBaseUnit: true,
                  conversionToBase: 1,
                  allowsFractionalSale: item.allowsFractional,
                },
              },
            },
            include: { units: true, barcodes: true },
          });
          results.push(product);
        }
        return results;
      });

      res.status(201).json({ created: created.length, products: created });
    } catch (error) {
      console.error("POST /products/batch failed:", error);
      res.status(400).json({
        error:
          error instanceof Error ? error.message : "Failed to create products",
      });
    }
  }
);

router.patch(
  "/:id",
  requireAdmin,
  validateBody(updateProductBodySchema),
  async (req, res) => {
    const id = paramStr(req.params.id);
    if (!id) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    const body = req.validatedBody as UpdateProductBodyValidated;
    try {
      const existing = await prisma.product.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ error: "Product not found" });
        return;
      }

      const data: Prisma.ProductUpdateInput = {};
      if (body.name !== undefined) data.name = body.name;
      if (body.description !== undefined) data.description = body.description;
      if (body.category !== undefined) data.category = body.category;
      if (body.brand !== undefined) data.brand = body.brand;
      if (body.sellingPrice !== undefined) data.sellingPrice = body.sellingPrice;
      if (body.costPrice !== undefined) data.costPrice = body.costPrice;
      if (body.taxRate !== undefined) data.taxRate = body.taxRate;
      if (body.reorderLevel !== undefined) data.reorderLevel = body.reorderLevel;
      if (body.allowsFractional !== undefined) {
        data.allowsFractional = body.allowsFractional;
        data.units = {
          updateMany: {
            where: { isBaseUnit: true },
            data: { allowsFractionalSale: body.allowsFractional },
          },
        };
      }
      if (body.status !== undefined) data.status = body.status;

      const updated = await prisma.product.update({
        where: { id },
        data,
        include: { units: true, barcodes: true },
      });
      res.status(200).json(updated);
    } catch (error) {
      console.error("PATCH /products/:id failed:", error);
      res.status(400).json({
        error:
          error instanceof Error ? error.message : "Failed to update product",
      });
    }
  }
);

router.delete("/:id", requireAdmin, async (req, res) => {
  const id = paramStr(req.params.id);
  if (!id) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  try {
    const p = await prisma.product.findUnique({
      where: { id },
      select: {
        id: true,
        _count: {
          select: {
            saleLines: true,
            purchaseLines: true,
            stockMovements: true,
            stockAdjustments: true,
          },
        },
      },
    });
    if (!p) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    const c = p._count;
    if (
      c.saleLines > 0 ||
      c.purchaseLines > 0 ||
      c.stockMovements > 0 ||
      c.stockAdjustments > 0
    ) {
      res.status(400).json({
        error:
          "Cannot delete this product while it has sales, purchases, stock movements, or adjustments. Set status to Inactive instead.",
      });
      return;
    }
    await prisma.product.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    console.error("DELETE /products/:id failed:", error);
    res.status(500).json({
      error:
        error instanceof Error ? error.message : "Failed to delete product",
    });
  }
});

router.get("/:id/stock", async (req, res) => {
  const stockId = paramStr(req.params.id);
  if (!stockId) {
    res.status(400).json({ error: "Product id is required" });
    return;
  }
  try {
    const product = await getProductStock(stockId);
    res.status(200).json(product);
  } catch (error) {
    console.error("GET /products/:id/stock failed:", error);
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to fetch stock",
    });
  }
});

export default router;
