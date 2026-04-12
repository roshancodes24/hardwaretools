import {
  Prisma,
  PurchaseStatus,
  SaleStatus,
} from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "../lib/prisma";

/** India Standard Time — all report ranges, charts, and “today” use this zone. */
const ZONE = "Asia/Kolkata";

function dtUtc(d: Date): DateTime {
  return DateTime.fromJSDate(d, { zone: "utc" });
}

function dtIndia(d: Date): DateTime {
  return dtUtc(d).setZone(ZONE);
}

/** Monday 00:00 (IST) for the calendar week containing `dt` (IST). */
function startOfMondayWeekIndia(dt: DateTime): DateTime {
  const d = dt.setZone(ZONE).startOf("day");
  return d.minus({ days: d.weekday - 1 });
}

const D = Prisma.Decimal;

function decStr(v: Prisma.Decimal | null | undefined): string {
  if (v == null) return "0.00";
  return v.toFixed(2);
}

function qtyStr(v: Prisma.Decimal | null | undefined): string {
  if (v == null) return "0.0000";
  return v.toFixed(4);
}

export type ReportDateRange = { start: Date; end: Date };

/** Interpret YYYY-MM-DD as IST calendar days (inclusive). */
export function parseReportRange(fromStr: string, toStr: string): ReportDateRange {
  const start = DateTime.fromISO(fromStr, { zone: ZONE }).startOf("day");
  const end = DateTime.fromISO(toStr, { zone: ZONE }).endOf("day");
  if (!start.isValid || !end.isValid) {
    throw new Error("Invalid date range.");
  }
  if (start > end) {
    throw new Error("'from' must be on or before 'to'.");
  }
  return { start: start.toJSDate(), end: end.toJSDate() };
}

/** Report 1: sales register + period aggregates (completed sales only). */
export async function getSalesSummaryReport(range: ReportDateRange) {
  const where = {
    status: SaleStatus.COMPLETED,
    createdAt: { gte: range.start, lte: range.end },
  };

  const [agg, sales] = await Promise.all([
    prisma.sale.aggregate({
      where,
      _count: { id: true },
      _sum: {
        subtotal: true,
        discountAmount: true,
        taxAmount: true,
        totalAmount: true,
        paidAmount: true,
        balanceAmount: true,
      },
    }),
    prisma.sale.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 2000,
      include: {
        createdBy: { select: { fullName: true } },
      },
    }),
  ]);

  const count = agg._count.id;
  const totalRev = agg._sum.totalAmount ?? new D(0);
  const avgTicket =
    count > 0 ? totalRev.div(count).toDecimalPlaces(2) : new D(0);

  return {
    summary: {
      saleCount: count,
      subtotal: decStr(agg._sum.subtotal),
      discountAmount: decStr(agg._sum.discountAmount),
      taxAmount: decStr(agg._sum.taxAmount),
      totalAmount: decStr(agg._sum.totalAmount),
      paidAmount: decStr(agg._sum.paidAmount),
      balanceAmount: decStr(agg._sum.balanceAmount),
      averageTicket: decStr(avgTicket),
    },
    sales: sales.map((s) => ({
      id: s.id,
      saleNumber: s.saleNumber,
      createdAt: s.createdAt.toISOString(),
      subtotal: decStr(s.subtotal),
      discountAmount: decStr(s.discountAmount),
      taxAmount: decStr(s.taxAmount),
      totalAmount: decStr(s.totalAmount),
      paidAmount: decStr(s.paidAmount),
      balanceAmount: decStr(s.balanceAmount),
      customerLabel:
        s.customerNameSnapshot?.trim() ||
        s.customerName?.trim() ||
        (s.customerPhone ? `Phone ${s.customerPhone}` : "—"),
      cashierName: s.createdBy.fullName,
    })),
  };
}

/** Report 2: sales by product (completed sales in range). */
export async function getSalesByProductReport(range: ReportDateRange) {
  const grouped = await prisma.saleLine.groupBy({
    by: ["productId"],
    where: {
      sale: {
        status: SaleStatus.COMPLETED,
        createdAt: { gte: range.start, lte: range.end },
      },
    },
    _sum: {
      lineTotal: true,
      quantityInBase: true,
    },
    _count: { _all: true },
  });

  const productIds = grouped.map((g) => g.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      sku: true,
      name: true,
      category: true,
      brand: true,
    },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const rows = grouped
    .map((g) => {
      const p = byId.get(g.productId);
      return {
        productId: g.productId,
        sku: p?.sku ?? "—",
        name: p?.name ?? "Unknown",
        category: p?.category ?? "—",
        brand: p?.brand ?? "—",
        lineCount: g._count._all,
        quantityInBase: qtyStr(g._sum.quantityInBase),
        revenue: decStr(g._sum.lineTotal),
      };
    })
    .sort(
      (a, b) =>
        Number.parseFloat(b.revenue) - Number.parseFloat(a.revenue)
    );

  return { products: rows };
}

/** Report 3: purchases (received only) in range. */
export async function getPurchasesReport(range: ReportDateRange) {
  const where = {
    status: PurchaseStatus.RECEIVED,
    createdAt: { gte: range.start, lte: range.end },
  };

  const [agg, purchases] = await Promise.all([
    prisma.purchase.aggregate({
      where,
      _count: { id: true },
      _sum: { totalAmount: true, subtotal: true, taxAmount: true },
    }),
    prisma.purchase.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 2000,
      include: {
        supplier: { select: { id: true, name: true } },
        createdBy: { select: { fullName: true } },
      },
    }),
  ]);

  const bySupplierMap = new Map<
    string,
    { supplierId: string; supplierName: string; purchaseCount: number; totalAmount: Prisma.Decimal }
  >();
  for (const pur of purchases) {
    const sid = pur.supplierId;
    const existing = bySupplierMap.get(sid);
    const ta = pur.totalAmount;
    if (existing) {
      existing.purchaseCount += 1;
      existing.totalAmount = existing.totalAmount.plus(ta);
    } else {
      bySupplierMap.set(sid, {
        supplierId: sid,
        supplierName: pur.supplier.name,
        purchaseCount: 1,
        totalAmount: new D(ta),
      });
    }
  }

  const bySupplier = [...bySupplierMap.values()]
    .map((s) => ({
      supplierId: s.supplierId,
      supplierName: s.supplierName,
      purchaseCount: s.purchaseCount,
      totalAmount: decStr(s.totalAmount),
    }))
    .sort(
      (a, b) =>
        Number.parseFloat(b.totalAmount) - Number.parseFloat(a.totalAmount)
    );

  return {
    summary: {
      purchaseCount: agg._count.id,
      subtotal: decStr(agg._sum.subtotal),
      taxAmount: decStr(agg._sum.taxAmount),
      totalAmount: decStr(agg._sum.totalAmount),
    },
    bySupplier,
    purchases: purchases.map((p) => ({
      id: p.id,
      purchaseNumber: p.purchaseNumber,
      createdAt: p.createdAt.toISOString(),
      invoiceNumber: p.invoiceNumber,
      invoiceDate: p.invoiceDate?.toISOString() ?? null,
      subtotal: decStr(p.subtotal),
      taxAmount: decStr(p.taxAmount),
      totalAmount: decStr(p.totalAmount),
      supplierName: p.supplier.name,
      createdByName: p.createdBy.fullName,
    })),
  };
}

/** Report 7: approximate gross margin from sale lines × product costPrice. */
export async function getGrossMarginReport(range: ReportDateRange) {
  const lines = await prisma.saleLine.findMany({
    where: {
      sale: {
        status: SaleStatus.COMPLETED,
        createdAt: { gte: range.start, lte: range.end },
      },
    },
    select: {
      lineTotal: true,
      quantityInBase: true,
      product: {
        select: {
          sku: true,
          name: true,
          costPrice: true,
        },
      },
    },
  });

  let revenue = new D(0);
  let estimatedCost = new D(0);
  let linesMissingCost = 0;

  for (const line of lines) {
    revenue = revenue.plus(line.lineTotal);
    const cp = line.product.costPrice;
    if (cp == null) {
      linesMissingCost += 1;
      continue;
    }
    const lineCost = new D(cp).mul(line.quantityInBase);
    estimatedCost = estimatedCost.plus(lineCost);
  }

  const margin = revenue.minus(estimatedCost);
  const marginPct =
    revenue.greaterThan(0)
      ? margin.div(revenue).mul(100).toDecimalPlaces(2)
      : new D(0);

  return {
    disclaimer:
      "Margin uses product cost price × quantity sold (base units). Missing cost is treated as zero.",
    lineCount: lines.length,
    linesMissingCost,
    revenue: decStr(revenue),
    estimatedCost: decStr(estimatedCost),
    grossMargin: decStr(margin),
    marginPercent: decStr(marginPct),
  };
}

export type DashboardDayPoint = {
  date: string;
  salesTotal: string;
  salesCount: number;
  purchasesTotal: string;
  purchasesCount: number;
};

/** Daily buckets by IST calendar date for home dashboard charts. */
export async function getDashboardTimeSeries(
  days: number
): Promise<DashboardDayPoint[]> {
  const n = Math.min(90, Math.max(1, Math.floor(days)));
  const now = DateTime.now().setZone(ZONE);
  const endDayStart = now.startOf("day");
  const startDayStart = now.minus({ days: n - 1 }).startOf("day");
  const rangeStart = startDayStart.toJSDate();
  const rangeEnd = now.endOf("day").toJSDate();

  const [sales, purchases] = await Promise.all([
    prisma.sale.findMany({
      where: {
        status: SaleStatus.COMPLETED,
        createdAt: { gte: rangeStart, lte: rangeEnd },
      },
      select: { createdAt: true, totalAmount: true },
    }),
    prisma.purchase.findMany({
      where: {
        status: PurchaseStatus.RECEIVED,
        createdAt: { gte: rangeStart, lte: rangeEnd },
      },
      select: { createdAt: true, totalAmount: true },
    }),
  ]);

  const salesMap = new Map<string, { total: Prisma.Decimal; count: number }>();
  for (const s of sales) {
    const key = dtIndia(s.createdAt).toISODate()!;
    const cur = salesMap.get(key) ?? { total: new D(0), count: 0 };
    cur.total = cur.total.plus(s.totalAmount);
    cur.count += 1;
    salesMap.set(key, cur);
  }

  const purchaseMap = new Map<
    string,
    { total: Prisma.Decimal; count: number }
  >();
  for (const p of purchases) {
    const key = dtIndia(p.createdAt).toISODate()!;
    const cur = purchaseMap.get(key) ?? { total: new D(0), count: 0 };
    cur.total = cur.total.plus(p.totalAmount);
    cur.count += 1;
    purchaseMap.set(key, cur);
  }

  const out: DashboardDayPoint[] = [];
  let d = startDayStart;
  while (d <= endDayStart) {
    const key = d.toISODate()!;
    const s = salesMap.get(key);
    const pur = purchaseMap.get(key);
    out.push({
      date: key,
      salesTotal: decStr(s?.total ?? new D(0)),
      salesCount: s?.count ?? 0,
      purchasesTotal: decStr(pur?.total ?? new D(0)),
      purchasesCount: pur?.count ?? 0,
    });
    d = d.plus({ days: 1 });
  }

  return out;
}

export type SalesRevenueGranularity = "day" | "week" | "month";

export type SalesRevenueBucket = {
  key: string;
  label: string;
  total: string;
  count: number;
};

function bucketIndexForSale(
  createdAt: Date,
  granularity: SalesRevenueGranularity,
  starts: Date[]
): number {
  const t = dtIndia(createdAt);
  if (granularity === "day") {
    const saleDay = t.toISODate()!;
    return starts.findIndex((s) => dtIndia(s).toISODate() === saleDay);
  }
  if (granularity === "week") {
    const w = startOfMondayWeekIndia(t);
    return starts.findIndex((s) =>
      w.equals(startOfMondayWeekIndia(dtIndia(s)))
    );
  }
  const monthStart = t.startOf("month");
  return starts.findIndex((s) =>
    monthStart.hasSame(dtIndia(s).startOf("month"), "month")
  );
}

/** Completed sales by IST day, week (Mon–Sun IST), or IST calendar month. */
export async function getSalesRevenueTimeSeries(
  granularity: SalesRevenueGranularity,
  bucketCount: number
): Promise<SalesRevenueBucket[]> {
  const n = Math.min(48, Math.max(2, Math.floor(bucketCount)));
  const now = DateTime.now().setZone(ZONE);
  const end = now.endOf("day").toJSDate();

  const startsLuxon: DateTime[] = [];
  const labels: string[] = [];

  if (granularity === "day") {
    const endDay = now.startOf("day");
    for (let i = n - 1; i >= 0; i--) {
      const d = endDay.minus({ days: i });
      startsLuxon.push(d);
      labels.push(d.setLocale("en-IN").toFormat("d MMM"));
    }
  } else if (granularity === "week") {
    const currentMonday = startOfMondayWeekIndia(now);
    const oldestMonday = currentMonday.minus({ weeks: n - 1 });
    for (let i = 0; i < n; i++) {
      const ws = oldestMonday.plus({ weeks: i });
      startsLuxon.push(ws);
      const we = ws.plus({ days: 6 });
      labels.push(
        `${ws.setLocale("en-IN").toFormat("d MMM")}–${we.setLocale("en-IN").toFormat("d MMM")}`
      );
    }
  } else {
    const endMonth = now.startOf("month");
    const oldestMonth = endMonth.minus({ months: n - 1 });
    for (let i = 0; i < n; i++) {
      const m = oldestMonth.plus({ months: i });
      startsLuxon.push(m);
      labels.push(m.setLocale("en-IN").toFormat("MMM yyyy"));
    }
  }

  const starts = startsLuxon.map((dt) => dt.toJSDate());
  const rangeStart = starts[0]!;

  const sales = await prisma.sale.findMany({
    where: {
      status: SaleStatus.COMPLETED,
      createdAt: { gte: rangeStart, lte: end },
    },
    select: { createdAt: true, totalAmount: true },
  });

  const totals = starts.map(() => new D(0));
  const counts = starts.map(() => 0);

  for (const s of sales) {
    const idx = bucketIndexForSale(s.createdAt, granularity, starts);
    if (idx >= 0 && idx < totals.length) {
      totals[idx] = totals[idx]!.plus(s.totalAmount);
      counts[idx]! += 1;
    }
  }

  return starts.map((start, i) => ({
    key: dtIndia(start).toISODate()!,
    label: labels[i]!,
    total: decStr(totals[i]!),
    count: counts[i]!,
  }));
}
