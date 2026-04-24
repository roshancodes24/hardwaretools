import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { PurchaseStatus, SaleStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { hasAdminAccess } from "../middleware/actingUser";
import { validateBody } from "../middleware/validateBody";
import { assertBodyUserMatchesActing } from "../middleware/requireRole";
import { createSale, recordSalePayment } from "../services/inventory";
import type {
  CreateSaleValidated,
  RecordSalePaymentValidated,
} from "../validation/schemas";
import {
  createSaleSchema,
  recordSalePaymentSchema,
} from "../validation/schemas";

const router = Router();

function paramStr(v: string | string[] | undefined): string {
  if (v == null) return "";
  return Array.isArray(v) ? (v[0] ?? "") : v;
}

const saleDetailInclude = {
  customer: { select: { partyGstNo: true, partyState: true } },
  lines: {
    include: {
      product: {
        select: {
          name: true,
          sku: true,
          hsnCode: true,
          cgstPercent: true,
          sgstPercent: true,
          igstPercent: true,
        },
      },
      productUnit: { select: { code: true, displayName: true } },
    },
  },
  payments: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.SaleInclude;

function decStr(v: Prisma.Decimal | null | undefined): string {
  if (v == null) return "0.00";
  return v.toFixed(2);
}

function serializePayment(p: {
  id: string;
  amount: Prisma.Decimal;
  note: string | null;
  createdAt: Date;
  createdById: string;
}) {
  return {
    id: p.id,
    amount: decStr(p.amount),
    note: p.note,
    createdAt: p.createdAt.toISOString(),
    createdById: p.createdById,
  };
}

function serializeSaleDetail(sale: {
  id: string;
  saleNumber: string;
  status: SaleStatus;
  customerId: string | null;
  customerName: string | null;
  customerNameSnapshot: string | null;
  customerPhone: string | null;
  customerPartyGstNo: string | null;
  customerPartyState: string | null;
  note: string | null;
  subtotal: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  transportAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  balanceAmount: Prisma.Decimal;
  createdAt: Date;
  createdById: string;
  customer: { partyGstNo: string | null; partyState: string | null } | null;
  lines: Array<{
    id: string;
    productId: string;
    productUnitId: string;
    quantity: Prisma.Decimal;
    quantityInBase: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    lineDiscount: Prisma.Decimal;
    lineTax: Prisma.Decimal;
    lineTotal: Prisma.Decimal;
    product: {
      name: string;
      sku: string;
      hsnCode: string | null;
      cgstPercent: Prisma.Decimal | null;
      sgstPercent: Prisma.Decimal | null;
      igstPercent: Prisma.Decimal | null;
    };
    productUnit: { code: string; displayName: string };
  }>;
  payments: Array<{
    id: string;
    amount: Prisma.Decimal;
    note: string | null;
    createdAt: Date;
    createdById: string;
  }>;
}) {
  return {
    id: sale.id,
    saleNumber: sale.saleNumber,
    status: sale.status,
    customerId: sale.customerId,
    customerName: sale.customerName,
    customerNameSnapshot: sale.customerNameSnapshot,
    customerPhone: sale.customerPhone,
    customerPartyGstNo:
      sale.customerPartyGstNo ?? sale.customer?.partyGstNo ?? null,
    customerPartyState:
      sale.customerPartyState ?? sale.customer?.partyState ?? null,
    note: sale.note,
    subtotal: decStr(sale.subtotal),
    discountAmount: decStr(sale.discountAmount),
    taxAmount: decStr(sale.taxAmount),
    transportAmount: decStr(sale.transportAmount),
    totalAmount: decStr(sale.totalAmount),
    paidAmount: decStr(sale.paidAmount),
    balanceAmount: decStr(sale.balanceAmount),
    createdAt: sale.createdAt.toISOString(),
    createdById: sale.createdById,
    lines: sale.lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      productUnitId: line.productUnitId,
      quantity: line.quantity.toFixed(4),
      quantityInBase: line.quantityInBase.toFixed(4),
      unitPrice: decStr(line.unitPrice),
      lineDiscount: decStr(line.lineDiscount),
      lineTax: decStr(line.lineTax),
      lineTotal: decStr(line.lineTotal),
      productName: line.product.name,
      productSku: line.product.sku,
      productHsnCode: line.product.hsnCode?.trim() ? line.product.hsnCode.trim() : null,
      unitCode: line.productUnit.code,
      unitDisplayName: line.productUnit.displayName,
      cgstPercent:
        line.product.cgstPercent != null ? decStr(line.product.cgstPercent) : null,
      sgstPercent:
        line.product.sgstPercent != null ? decStr(line.product.sgstPercent) : null,
      igstPercent:
        line.product.igstPercent != null ? decStr(line.product.igstPercent) : null,
    })),
    payments: sale.payments.map(serializePayment),
  };
}

router.post(
  "/",
  validateBody(createSaleSchema),
  async (req, res) => {
    const auth = assertBodyUserMatchesActing(req, "createdById");
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.message });
      return;
    }
    const body = req.validatedBody as CreateSaleValidated;
    try {
      const sale = await createSale({
        createdById: body.createdById,
        customerId: body.customerId,
        customerName: body.customerName,
        customerPhone: body.customerPhone,
        customerPartyGstNo: body.customerPartyGstNo,
        customerPartyState: body.customerPartyState,
        transportAmount: body.transportAmount,
        note: body.note,
        documentKind: body.documentKind,
        paidAmount: body.paidAmount,
        lines: body.lines,
      });
      if (!sale) {
        res.status(500).json({ error: "Sale not found after create" });
        return;
      }
      res.status(201).json(serializeSaleDetail(sale));
    } catch (error) {
      console.error("POST /sales failed:", error);
      res.status(400).json({
        error:
          error instanceof Error ? error.message : "Failed to create sale",
      });
    }
  }
);

router.get("/recent-activity", async (req, res) => {
  const acting = req.actingUser;
  if (!acting) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  let limit = Number.parseInt(String(req.query.limit ?? "25"), 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 25;
  limit = Math.min(50, limit);
  const takeSource = Math.min(30, limit + 10);

  try {
    const isAdmin = hasAdminAccess(acting.role);

    const [sales, purchases, adjustments] = await Promise.all([
      prisma.sale.findMany({
        where: { status: SaleStatus.COMPLETED },
        orderBy: { createdAt: "desc" },
        take: takeSource,
        select: {
          createdAt: true,
          saleNumber: true,
          totalAmount: true,
          status: true,
        },
      }),
      isAdmin
        ? prisma.purchase.findMany({
            where: { status: PurchaseStatus.RECEIVED },
            orderBy: { createdAt: "desc" },
            take: takeSource,
            select: {
              createdAt: true,
              purchaseNumber: true,
              totalAmount: true,
            },
          })
        : Promise.resolve(
            [] as {
              createdAt: Date;
              purchaseNumber: string;
              totalAmount: Prisma.Decimal;
            }[]
          ),
      isAdmin
        ? prisma.stockAdjustment.findMany({
            orderBy: { createdAt: "desc" },
            take: takeSource,
            select: {
              createdAt: true,
              difference: true,
              product: { select: { sku: true, baseUnitCode: true } },
            },
          })
        : Promise.resolve(
            [] as {
              createdAt: Date;
              difference: Prisma.Decimal;
              product: { sku: string; baseUnitCode: string };
            }[]
          ),
    ]);

    type OutRow = {
      createdAt: string;
      type: string;
      reference: string;
      amount: string;
      amountNote: string | null;
      status: string;
    };

    const rows: OutRow[] = [];

    for (const s of sales) {
      rows.push({
        createdAt: s.createdAt.toISOString(),
        type: "Sale",
        reference: s.saleNumber,
        amount: decStr(s.totalAmount),
        amountNote: null,
        status:
          s.status === SaleStatus.COMPLETED ? "Completed" : String(s.status),
      });
    }

    for (const p of purchases) {
      rows.push({
        createdAt: p.createdAt.toISOString(),
        type: "Purchase",
        reference: p.purchaseNumber,
        amount: decStr(p.totalAmount),
        amountNote: null,
        status: "Received",
      });
    }

    for (const a of adjustments) {
      const n = Number(a.difference);
      const absTrim = a.difference
        .abs()
        .toFixed(4)
        .replace(/\.?0+$/, "");
      const qtyNote =
        n === 0
          ? `0 ${a.product.baseUnitCode}`
          : `${n > 0 ? "+" : "−"}${absTrim} ${a.product.baseUnitCode}`;
      rows.push({
        createdAt: a.createdAt.toISOString(),
        type: "Adjustment",
        reference: `Stock · ${a.product.sku}`,
        amount: "0.00",
        amountNote: qtyNote,
        status: "Applied",
      });
    }

    rows.sort((x, y) =>
      x.createdAt < y.createdAt ? 1 : x.createdAt > y.createdAt ? -1 : 0
    );

    res.status(200).json({ items: rows.slice(0, limit) });
  } catch (error) {
    console.error("GET /sales/recent-activity failed:", error);
    res.status(500).json({ error: "Failed to load recent activity" });
  }
});

router.get("/outstanding", async (_req, res) => {
  try {
    const rows = await prisma.sale.findMany({
      where: {
        status: SaleStatus.COMPLETED,
        balanceAmount: { gt: 0 },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
      include: {
        _count: { select: { lines: true } },
      },
    });
    res.status(200).json(
      rows.map((s) => ({
        id: s.id,
        saleNumber: s.saleNumber,
        createdAt: s.createdAt.toISOString(),
        totalAmount: decStr(s.totalAmount),
        paidAmount: decStr(s.paidAmount),
        balanceAmount: decStr(s.balanceAmount),
        customerId: s.customerId,
        customerName: s.customerNameSnapshot ?? s.customerName,
        customerPhone: s.customerPhone,
        lineCount: s._count.lines,
      }))
    );
  } catch (error) {
    console.error("GET /sales/outstanding failed:", error);
    res.status(500).json({ error: "Failed to list outstanding sales" });
  }
});

router.get("/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) {
    res.status(400).json({
      error: "Search query q must be at least 2 characters",
    });
    return;
  }

  let limit = Number.parseInt(String(req.query.limit ?? "20"), 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 20;
  limit = Math.min(50, limit);

  const dateParts: Prisma.SaleWhereInput[] = [];
  const fromRaw = req.query.from;
  const toRaw = req.query.to;
  if (fromRaw != null && String(fromRaw).trim() !== "") {
    const d = new Date(String(fromRaw));
    if (!Number.isNaN(d.getTime())) {
      dateParts.push({ createdAt: { gte: d } });
    }
  }
  if (toRaw != null && String(toRaw).trim() !== "") {
    const d = new Date(String(toRaw));
    if (!Number.isNaN(d.getTime())) {
      dateParts.push({ createdAt: { lte: d } });
    }
  }

  try {
    const rows = await prisma.sale.findMany({
      where: {
        status: SaleStatus.COMPLETED,
        AND: [
          {
            OR: [
              { customerName: { contains: q, mode: "insensitive" } },
              { customerNameSnapshot: { contains: q, mode: "insensitive" } },
              { customerPhone: { contains: q, mode: "insensitive" } },
              { saleNumber: { contains: q, mode: "insensitive" } },
            ],
          },
          ...dateParts,
        ],
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        saleNumber: true,
        createdAt: true,
        totalAmount: true,
        paidAmount: true,
        balanceAmount: true,
        customerName: true,
        customerNameSnapshot: true,
        customerPhone: true,
      },
    });

    res.status(200).json(
      rows.map((s) => {
        const label =
          (s.customerNameSnapshot ?? s.customerName ?? s.customerPhone ?? "")
            .trim() || "—";
        return {
          id: s.id,
          saleNumber: s.saleNumber,
          createdAt: s.createdAt.toISOString(),
          totalAmount: decStr(s.totalAmount),
          paidAmount: decStr(s.paidAmount),
          balanceAmount: decStr(s.balanceAmount),
          customerLabel: label,
        };
      })
    );
  } catch (error) {
    console.error("GET /sales/search failed:", error);
    res.status(500).json({ error: "Failed to search sales" });
  }
});

router.get("/by-number/:saleNumber", async (req, res) => {
  const saleNumber = decodeURIComponent(paramStr(req.params.saleNumber)).trim();
  if (!saleNumber) {
    res.status(400).json({ error: "Missing sale number" });
    return;
  }

  try {
    const sale = await prisma.sale.findUnique({
      where: { saleNumber },
      include: saleDetailInclude,
    });
    if (!sale) {
      res.status(404).json({ error: "Sale not found" });
      return;
    }
    res.status(200).json(serializeSaleDetail(sale));
  } catch (error) {
    console.error("GET /sales/by-number/:saleNumber failed:", error);
    res.status(500).json({ error: "Failed to load sale" });
  }
});

router.get("/:id", async (req, res) => {
  const id = paramStr(req.params.id);
  if (!id) {
    res.status(404).json({ error: "Sale not found" });
    return;
  }
  try {
    const sale = await prisma.sale.findUnique({
      where: { id },
      include: saleDetailInclude,
    });
    if (!sale) {
      res.status(404).json({ error: "Sale not found" });
      return;
    }
    res.status(200).json(serializeSaleDetail(sale));
  } catch (error) {
    console.error("GET /sales/:id failed:", error);
    res.status(500).json({ error: "Failed to load sale" });
  }
});

router.post(
  "/:id/payments",
  validateBody(recordSalePaymentSchema),
  async (req, res) => {
    const auth = assertBodyUserMatchesActing(req, "createdById");
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.message });
      return;
    }
    const body = req.validatedBody as RecordSalePaymentValidated;
    const saleId = paramStr(req.params.id);
    if (!saleId) {
      res.status(404).json({ error: "Sale not found" });
      return;
    }
    try {
      const sale = await recordSalePayment({
        saleId,
        amount: body.amount,
        createdById: body.createdById,
        note: body.note,
      });
      if (!sale) {
        res.status(500).json({ error: "Sale not found after payment" });
        return;
      }
      res.status(200).json(serializeSaleDetail(sale));
    } catch (error) {
      console.error("POST /sales/:id/payments failed:", error);
      res.status(400).json({
        error:
          error instanceof Error ? error.message : "Failed to record payment",
      });
    }
  }
);

export default router;
