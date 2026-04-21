import type { Prisma } from "@prisma/client";
import { PurchaseStatus } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../lib/prisma";
import {
  assertBodyUserMatchesActing,
  requireAdmin,
} from "../middleware/requireRole";
import { validateBody } from "../middleware/validateBody";
import {
  createPurchase,
  recordPurchasePayment,
} from "../services/inventory";
import type {
  CreatePurchaseValidated,
  RecordPurchasePaymentValidated,
} from "../validation/schemas";
import {
  createPurchaseSchema,
  recordPurchasePaymentSchema,
} from "../validation/schemas";

const router = Router();

function paramStr(v: string | string[] | undefined): string {
  if (v == null) return "";
  return Array.isArray(v) ? (v[0] ?? "") : v;
}

function decStr(v: Prisma.Decimal | null | undefined): string {
  if (v == null) return "0.00";
  return v.toFixed(2);
}

function serializePurchasePayment(p: {
  id: string;
  amount: Prisma.Decimal;
  paidAt: Date;
  note: string | null;
  createdAt: Date;
  createdById: string;
  createdBy: { fullName: string };
}) {
  return {
    id: p.id,
    amount: decStr(p.amount),
    paidAt: p.paidAt.toISOString(),
    note: p.note,
    createdAt: p.createdAt.toISOString(),
    createdById: p.createdById,
    recordedByName: p.createdBy.fullName,
  };
}

const purchaseDetailInclude = {
  supplier: { select: { id: true, name: true } },
  createdBy: { select: { fullName: true } },
  lines: {
    include: {
      product: { select: { id: true, name: true, sku: true } },
      productUnit: { select: { code: true, displayName: true } },
    },
  },
  payments: {
    orderBy: { paidAt: "asc" as const },
    include: { createdBy: { select: { fullName: true } } },
  },
} satisfies Prisma.PurchaseInclude;

function serializePurchaseDetail(
  purchase: Prisma.PurchaseGetPayload<{ include: typeof purchaseDetailInclude }>
) {
  return {
    id: purchase.id,
    purchaseNumber: purchase.purchaseNumber,
    status: purchase.status,
    supplierId: purchase.supplierId,
    supplierName: purchase.supplier.name,
    invoiceNumber: purchase.invoiceNumber,
    invoiceDate: purchase.invoiceDate?.toISOString() ?? null,
    note: purchase.note,
    subtotal: decStr(purchase.subtotal),
    discountAmount: decStr(purchase.discountAmount),
    taxAmount: decStr(purchase.taxAmount),
    totalAmount: decStr(purchase.totalAmount),
    paidAmount: decStr(purchase.paidAmount),
    balanceAmount: decStr(purchase.balanceAmount),
    createdAt: purchase.createdAt.toISOString(),
    createdById: purchase.createdById,
    recordedByName: purchase.createdBy.fullName,
    lines: purchase.lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      productUnitId: line.productUnitId,
      quantity: line.quantity.toFixed(4),
      unitCost: decStr(line.unitCost),
      lineDiscount: decStr(line.lineDiscount),
      lineTax: decStr(line.lineTax),
      lineTotal: decStr(line.lineTotal),
      productName: line.product.name,
      productSku: line.product.sku,
      unitCode: line.productUnit.code,
      unitDisplayName: line.productUnit.displayName,
    })),
    payments: purchase.payments.map(serializePurchasePayment),
  };
}

router.get(
  "/",
  requireAdmin,
  async (req, res) => {
    const owingOnly =
      String(req.query.owingOnly ?? req.query.balanceDue ?? "").trim() ===
        "1" ||
      String(req.query.owingOnly ?? "").toLowerCase() === "true";
    const limitRaw = Number(req.query.limit);
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(500, Math.floor(limitRaw))
        : 150;

    try {
      const rows = await prisma.purchase.findMany({
        where: owingOnly
          ? {
              status: PurchaseStatus.RECEIVED,
              balanceAmount: { gt: 0 },
            }
          : { status: PurchaseStatus.RECEIVED },
        orderBy: { createdAt: "desc" },
        take: limit,
        include: {
          supplier: { select: { name: true } },
          createdBy: { select: { fullName: true } },
        },
      });

      res.status(200).json({
        purchases: rows.map((p) => ({
          id: p.id,
          purchaseNumber: p.purchaseNumber,
          createdAt: p.createdAt.toISOString(),
          supplierName: p.supplier.name,
          invoiceNumber: p.invoiceNumber,
          invoiceDate: p.invoiceDate?.toISOString() ?? null,
          totalAmount: decStr(p.totalAmount),
          paidAmount: decStr(p.paidAmount),
          balanceAmount: decStr(p.balanceAmount),
          recordedByName: p.createdBy.fullName,
        })),
      });
    } catch (error) {
      console.error("GET /purchases failed:", error);
      res.status(500).json({ error: "Failed to list purchases" });
    }
  }
);

router.post(
  "/",
  requireAdmin,
  validateBody(createPurchaseSchema),
  async (req, res) => {
    const check = assertBodyUserMatchesActing(req, "createdById");
    if (!check.ok) {
      res.status(check.status).json({ error: check.message });
      return;
    }
    const body = req.validatedBody as CreatePurchaseValidated;
    try {
      const purchase = await createPurchase({
        supplierId: body.supplierId,
        createdById: body.createdById,
        invoiceNumber: body.invoiceNumber,
        invoiceDate: body.invoiceDate,
        note: body.note,
        lines: body.lines,
      });
      if (!purchase) {
        res.status(500).json({ error: "Purchase not found after create" });
        return;
      }
      res.status(201).json(serializePurchaseDetail(purchase));
    } catch (error) {
      console.error("POST /purchases failed:", error);
      res.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to create purchase",
      });
    }
  }
);

router.get("/:id", requireAdmin, async (req, res) => {
  const id = paramStr(req.params.id);
  if (!id) {
    res.status(404).json({ error: "Purchase not found" });
    return;
  }
  try {
    const purchase = await prisma.purchase.findUnique({
      where: { id },
      include: purchaseDetailInclude,
    });
    if (!purchase) {
      res.status(404).json({ error: "Purchase not found" });
      return;
    }
    res.status(200).json(serializePurchaseDetail(purchase));
  } catch (error) {
    console.error("GET /purchases/:id failed:", error);
    res.status(500).json({ error: "Failed to load purchase" });
  }
});

router.post(
  "/:id/payments",
  requireAdmin,
  validateBody(recordPurchasePaymentSchema),
  async (req, res) => {
    const auth = assertBodyUserMatchesActing(req, "createdById");
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.message });
      return;
    }
    const body = req.validatedBody as RecordPurchasePaymentValidated;
    const purchaseId = paramStr(req.params.id);
    if (!purchaseId) {
      res.status(404).json({ error: "Purchase not found" });
      return;
    }
    try {
      const purchase = await recordPurchasePayment({
        purchaseId,
        amount: body.amount,
        createdById: body.createdById,
        note: body.note,
        paidAt: body.paidAt,
      });
      if (!purchase) {
        res.status(500).json({ error: "Purchase not found after payment" });
        return;
      }
      res.status(200).json(serializePurchaseDetail(purchase));
    } catch (error) {
      console.error("POST /purchases/:id/payments failed:", error);
      res.status(400).json({
        error:
          error instanceof Error ? error.message : "Failed to record payment",
      });
    }
  }
);

export default router;
