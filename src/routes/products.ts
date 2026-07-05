import { Prisma, ProductStatus, UnitKind } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../lib/prisma";
import { validateBody } from "../middleware/validateBody";
import { requireAdmin } from "../middleware/requireRole";
import { generateNextBrandCode, generateNextSku } from "../lib/generateSku";
import { getProductStock } from "../services/inventory";
import {
  parseProductListQuery,
  productSearchWhere,
  resolveProductListPaging,
  wantsPaginatedProductList,
} from "../lib/productListQuery";
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

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

import { sellingPriceFromCostAndPercent } from "../lib/productPricing";

function resolveSellingPriceForBatch(item: {
  sellingPrice?: number;
  costPrice?: number;
  percentage?: number;
}): number | null {
  if (item.sellingPrice !== undefined && item.sellingPrice !== null) {
    return item.sellingPrice;
  }
  if (
    item.costPrice !== undefined &&
    item.costPrice !== null &&
    item.percentage !== undefined &&
    item.percentage !== null
  ) {
    const c = Number(item.costPrice);
    const p = Number(item.percentage);
    if (Number.isFinite(c) && Number.isFinite(p) && c >= 0 && p >= 0) {
      return sellingPriceFromCostAndPercent(c, p);
    }
  }
  return null;
}

const BATCH_CREATE_CHUNK = 100;
const BATCH_CREATE_TX_OPTS = { timeout: 120_000, maxWait: 30_000 } as const;

type BatchProductItem = BatchCreateProductsValidated["products"][number];

function explicitSku(item: BatchProductItem): string | undefined {
  const s = typeof item.sku === "string" ? item.sku.trim() : "";
  return s !== "" ? s : undefined;
}

async function createProductBatchChunk(
  tx: Prisma.TransactionClient,
  items: BatchProductItem[]
) {
  const results = [];
  const autoSkuSeq = new Map<
    "Electrical" | "Hardware" | "Paint",
    { prefix: string; next: number }
  >();

  for (const item of items) {
    const trimmedSku = explicitSku(item);
    let sku: string;
    if (trimmedSku) {
      sku = trimmedSku;
    } else {
      const cat = item.category;
      let seq = autoSkuSeq.get(cat);
      if (!seq) {
        const first = await generateNextSku(tx, cat);
        const m = /^([A-Z]{2})-(\d+)$/.exec(first);
        if (!m) {
          sku = first;
        } else {
          seq = { prefix: m[1], next: parseInt(m[2], 10) + 1 };
          autoSkuSeq.set(cat, seq);
          sku = first;
        }
      } else {
        sku = `${seq.prefix}-${String(seq.next).padStart(5, "0")}`;
        seq.next += 1;
      }
    }

    const product = await tx.product.create({
      data: {
        sku,
        name: item.name,
        description: item.description ?? null,
        category: item.category,
        brand: item.brand ?? null,
        brandCode: item.brandCode ?? null,
        color: item.color ?? null,
        size: item.size ?? null,
        status: ProductStatus.ACTIVE,
        baseUnitCode: item.baseUnitCode,
        unitKind: item.unitKind as UnitKind,
        allowsFractional: item.allowsFractional,
        sellingPrice: resolveSellingPriceForBatch(item),
        costPrice: item.costPrice != null ? item.costPrice : null,
        avgCostPrice: item.costPrice != null ? item.costPrice : null,
        percentage: item.percentage != null ? item.percentage : null,
        mrp: item.mrp != null ? item.mrp : null,
        cgstPercent: item.cgstPercent != null ? item.cgstPercent : null,
        sgstPercent: item.sgstPercent != null ? item.sgstPercent : null,
        igstPercent: item.igstPercent != null ? item.igstPercent : null,
        reorderLevel: item.reorderLevel != null ? item.reorderLevel : null,
        hsnCode: item.hsnCode != null ? item.hsnCode : null,
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
}

async function createProductsInChunks(items: BatchProductItem[]) {
  const created: Awaited<ReturnType<typeof createProductBatchChunk>> = [];
  const createdIds: string[] = [];

  try {
    for (let i = 0; i < items.length; i += BATCH_CREATE_CHUNK) {
      const chunk = items.slice(i, i + BATCH_CREATE_CHUNK);
      const chunkCreated = await prisma.$transaction(
        (tx) => createProductBatchChunk(tx, chunk),
        BATCH_CREATE_TX_OPTS
      );
      created.push(...chunkCreated);
      createdIds.push(...chunkCreated.map((p) => p.id));
    }
    return created;
  } catch (error) {
    if (createdIds.length > 0) {
      try {
        await prisma.product.deleteMany({ where: { id: { in: createdIds } } });
      } catch (rollbackError) {
        console.error("Batch create rollback failed:", rollbackError);
      }
    }
    throw error;
  }
}

router.get("/", async (req, res) => {
  try {
    const listQuery = parseProductListQuery(
      req.query as Record<string, unknown>
    );

    if (wantsPaginatedProductList(listQuery)) {
      const { page, limit, skip } = resolveProductListPaging(listQuery);
      const searchWhere = productSearchWhere(listQuery.q);
      const where: Prisma.ProductWhereInput = {
        ...searchWhere,
        ...(listQuery.priceReviewOnly ? { priceReviewNeeded: true } : {}),
      };
      const catalogWhere: Prisma.ProductWhereInput = listQuery.priceReviewOnly
        ? { priceReviewNeeded: true }
        : {};

      const [total, catalogTotal, items] = await prisma.$transaction([
        prisma.product.count({ where }),
        prisma.product.count({ where: catalogWhere }),
        prisma.product.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
          include: {
            units: true,
            barcodes: true,
          },
        }),
      ]);

      res.status(200).json({ items, total, catalogTotal, page, limit });
      return;
    }

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
      const requestedBrandCodes = items
        .map((item) => item.brandCode?.trim() ?? "")
        .filter((brandCode) => brandCode.length > 0);

      const existingByBrandCode =
        requestedBrandCodes.length > 0
          ? await prisma.product.findMany({
              where: {
                OR: requestedBrandCodes.map((brandCode) => ({
                  brandCode: { equals: brandCode, mode: "insensitive" as const },
                })),
              },
              select: { brandCode: true },
            })
          : [];

      const existingBrandCodes = new Set(
        existingByBrandCode
          .map((p) => p.brandCode)
          .filter((brandCode): brandCode is string => Boolean(brandCode))
          .map((brandCode) => normalizeKey(brandCode))
      );

      for (const item of items) {
        const trimmedBrandCode = item.brandCode?.trim();
        if (
          trimmedBrandCode &&
          existingBrandCodes.has(normalizeKey(trimmedBrandCode))
        ) {
          res.status(409).json({
            error: `A product with brand code "${trimmedBrandCode}" already exists.`,
          });
          return;
        }
      }

      const explicitSkus = items
        .map((item) => explicitSku(item))
        .filter((sku): sku is string => sku != null);

      if (explicitSkus.length > 0) {
        const skuClash = await prisma.product.findFirst({
          where: { sku: { in: explicitSkus } },
          select: { sku: true },
        });
        if (skuClash) {
          res.status(409).json({
            error: `SKU "${skuClash.sku}" is already in use.`,
          });
          return;
        }
      }

      const created = await createProductsInChunks(items);

      res.status(201).json({ created: created.length, products: created });
    } catch (error) {
      console.error("POST /products/batch failed:", error);
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        res.status(409).json({
          error: "A product with this brand code or SKU already exists.",
        });
        return;
      }
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

      if (body.brandCode !== undefined && body.brandCode !== null) {
        const brandCode = body.brandCode.trim();
        if (brandCode.length > 0) {
          const brandCodeClash = await prisma.product.findFirst({
            where: {
              id: { not: id },
              brandCode: { equals: brandCode, mode: "insensitive" },
            },
            select: { id: true },
          });
          if (brandCodeClash) {
            res.status(409).json({
              error: `A product with brand code "${brandCode}" already exists.`,
            });
            return;
          }
        }
      }

      const data: Prisma.ProductUpdateInput = {};
      if (body.name !== undefined) data.name = body.name;
      if (body.description !== undefined) data.description = body.description;
      if (body.category !== undefined) data.category = body.category;
      if (body.brand !== undefined) data.brand = body.brand;
      if (body.brandCode !== undefined) {
        if (body.brandCode === null || body.brandCode.trim() === "") {
          /* keep existing brand code — it is the unique identifier */
        } else {
          data.brandCode = body.brandCode.trim();
        }
      }
      if (body.color !== undefined) data.color = body.color;
      if (body.size !== undefined) data.size = body.size;
      if (body.sellingPrice !== undefined) data.sellingPrice = body.sellingPrice;
      if (body.costPrice !== undefined) {
        data.costPrice = body.costPrice;
        // A manual cost correction resets the moving-average basis too.
        data.avgCostPrice = body.costPrice;
      }
      if (body.percentage !== undefined) data.percentage = body.percentage;
      // A manual price/cost edit resolves any pending price review.
      if (
        body.sellingPrice !== undefined ||
        body.costPrice !== undefined ||
        body.percentage !== undefined
      ) {
        data.priceReviewNeeded = false;
        data.suggestedSellingPrice = null;
        data.priceReviewNote = null;
      }
      if (body.mrp !== undefined) data.mrp = body.mrp;
      if (body.cgstPercent !== undefined) data.cgstPercent = body.cgstPercent;
      if (body.sgstPercent !== undefined) data.sgstPercent = body.sgstPercent;
      if (body.igstPercent !== undefined) data.igstPercent = body.igstPercent;
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
      if (body.hsnCode !== undefined) data.hsnCode = body.hsnCode;

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

/** Read an optional list of product ids from the request body (batch scope). */
function parseBatchIds(body: unknown): string[] | null {
  if (body && typeof body === "object" && Array.isArray((body as { ids?: unknown }).ids)) {
    const ids = ((body as { ids: unknown[] }).ids).filter(
      (x): x is string => typeof x === "string" && x.trim() !== ""
    );
    return ids.length > 0 ? ids : null;
  }
  return null;
}

/**
 * Bulk approve: set sellingPrice = suggestedSellingPrice (where present) and clear the
 * review flag for all currently-flagged products (optionally scoped to `ids`).
 */
router.post("/price-review/apply-all", requireAdmin, async (req, res) => {
  try {
    const ids = parseBatchIds(req.body);
    const updated = await prisma.$transaction(async (tx) => {
      if (ids) {
        await tx.$executeRaw`
          UPDATE "Product"
          SET "sellingPrice" = "suggestedSellingPrice"
          WHERE "priceReviewNeeded" = true
            AND "suggestedSellingPrice" IS NOT NULL
            AND "id" IN (${Prisma.join(ids)})
        `;
      } else {
        await tx.$executeRaw`
          UPDATE "Product"
          SET "sellingPrice" = "suggestedSellingPrice"
          WHERE "priceReviewNeeded" = true
            AND "suggestedSellingPrice" IS NOT NULL
        `;
      }
      const cleared = await tx.product.updateMany({
        where: {
          priceReviewNeeded: true,
          ...(ids ? { id: { in: ids } } : {}),
        },
        data: {
          priceReviewNeeded: false,
          suggestedSellingPrice: null,
          priceReviewNote: null,
        },
      });
      return cleared.count;
    });
    res.status(200).json({ updated });
  } catch (error) {
    console.error("POST /products/price-review/apply-all failed:", error);
    res.status(400).json({
      error:
        error instanceof Error ? error.message : "Failed to apply price reviews",
    });
  }
});

/**
 * Bulk keep-current: clear the review flag without changing selling prices for all
 * currently-flagged products (optionally scoped to `ids`).
 */
router.post("/price-review/dismiss-all", requireAdmin, async (req, res) => {
  try {
    const ids = parseBatchIds(req.body);
    const cleared = await prisma.product.updateMany({
      where: {
        priceReviewNeeded: true,
        ...(ids ? { id: { in: ids } } : {}),
      },
      data: {
        priceReviewNeeded: false,
        suggestedSellingPrice: null,
        priceReviewNote: null,
      },
    });
    res.status(200).json({ updated: cleared.count });
  } catch (error) {
    console.error("POST /products/price-review/dismiss-all failed:", error);
    res.status(400).json({
      error:
        error instanceof Error ? error.message : "Failed to update price reviews",
    });
  }
});

/** Approve the suggested markdown: apply suggestedSellingPrice, clear the review. */
router.post("/:id/price-review/apply", requireAdmin, async (req, res) => {
  const id = paramStr(req.params.id);
  if (!id) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  try {
    const existing = await prisma.product.findUnique({
      where: { id },
      select: { id: true, suggestedSellingPrice: true },
    });
    if (!existing) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    const updated = await prisma.product.update({
      where: { id },
      data: {
        ...(existing.suggestedSellingPrice != null
          ? { sellingPrice: existing.suggestedSellingPrice }
          : {}),
        priceReviewNeeded: false,
        suggestedSellingPrice: null,
        priceReviewNote: null,
      },
      include: { units: true, barcodes: true },
    });
    res.status(200).json(updated);
  } catch (error) {
    console.error("POST /products/:id/price-review/apply failed:", error);
    res.status(400).json({
      error:
        error instanceof Error ? error.message : "Failed to apply price review",
    });
  }
});

/** Dismiss the review: keep the current selling price, clear the flag. */
router.post("/:id/price-review/dismiss", requireAdmin, async (req, res) => {
  const id = paramStr(req.params.id);
  if (!id) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  try {
    const existing = await prisma.product.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    const updated = await prisma.product.update({
      where: { id },
      data: {
        priceReviewNeeded: false,
        suggestedSellingPrice: null,
        priceReviewNote: null,
      },
      include: { units: true, barcodes: true },
    });
    res.status(200).json(updated);
  } catch (error) {
    console.error("POST /products/:id/price-review/dismiss failed:", error);
    res.status(400).json({
      error:
        error instanceof Error ? error.message : "Failed to dismiss price review",
    });
  }
});

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
