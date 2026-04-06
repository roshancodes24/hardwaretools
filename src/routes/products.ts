import { ProductStatus, UnitKind } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../lib/prisma";
import { validateBody } from "../middleware/validateBody";
import { generateNextSku } from "../lib/generateSku";
import { getProductStock } from "../services/inventory";
import {
  batchCreateProductsSchema,
  type BatchCreateProductsValidated,
} from "../validation/schemas";

const router = Router();

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
