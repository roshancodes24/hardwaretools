import {
  Prisma,
  ProductStatus,
  PurchaseStatus,
  SaleStatus,
  ScheduledReportType,
  ReportPeriod,
  ReportRunStatus,
} from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  computePreviousPeriodBounds,
  isSchedulerWindowOpen,
  nowIndia,
  reportPeriodLabel,
  reportTypeLabel,
  type PeriodBounds,
} from "../lib/reportPeriods";
import {
  isReportSlotReached,
  parseReportCronBaseHour,
  REPORT_RUN_ORDER,
} from "../lib/reportScheduleSlots";
import {
  getGrossMarginReport,
  getSalesSummaryReport,
  type ReportDateRange,
} from "./reports";
import { sendReportReadyEmail, isEmailConfigured } from "./email";

const D = Prisma.Decimal;

function decStr(v: Prisma.Decimal | null | undefined): string {
  if (v == null) return "0.00";
  return v.toFixed(2);
}

function qtyStr(v: Prisma.Decimal | null | undefined): string {
  if (v == null) return "0.0000";
  return v.toFixed(4);
}

export type ScheduledReportConfigDto = {
  notifyEmail: string;
  salesEnabled: boolean;
  salesPeriod: ReportPeriod | null;
  inventoryEnabled: boolean;
  inventoryPeriod: ReportPeriod | null;
  supplierOutstandingEnabled: boolean;
  supplierOutstandingPeriod: ReportPeriod | null;
  customerOutstandingEnabled: boolean;
  customerOutstandingPeriod: ReportPeriod | null;
  updatedAt: string;
};

export type ReportRunSummaryDto = {
  id: string;
  reportType: ScheduledReportType;
  period: ReportPeriod;
  periodStart: string;
  periodEnd: string;
  asOf: string;
  status: ReportRunStatus;
  errorMessage: string | null;
  emailSentAt: string | null;
  createdAt: string;
  periodLabel: string | null;
};

function configToDto(row: {
  notifyEmail: string;
  salesEnabled: boolean;
  salesPeriod: ReportPeriod | null;
  inventoryEnabled: boolean;
  inventoryPeriod: ReportPeriod | null;
  supplierOutstandingEnabled: boolean;
  supplierOutstandingPeriod: ReportPeriod | null;
  customerOutstandingEnabled: boolean;
  customerOutstandingPeriod: ReportPeriod | null;
  updatedAt: Date;
}): ScheduledReportConfigDto {
  return {
    notifyEmail: row.notifyEmail,
    salesEnabled: row.salesEnabled,
    salesPeriod: row.salesPeriod,
    inventoryEnabled: row.inventoryEnabled,
    inventoryPeriod: row.inventoryPeriod,
    supplierOutstandingEnabled: row.supplierOutstandingEnabled,
    supplierOutstandingPeriod: row.supplierOutstandingPeriod,
    customerOutstandingEnabled: row.customerOutstandingEnabled,
    customerOutstandingPeriod: row.customerOutstandingPeriod,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getOrCreateReportScheduleConfig(): Promise<ScheduledReportConfigDto> {
  const defaultEmail = (process.env.REPORT_NOTIFY_EMAIL ?? "").trim();
  const row = await prisma.reportScheduleConfig.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      notifyEmail: defaultEmail,
    },
    update: {},
  });
  return configToDto(row);
}

export async function updateReportScheduleConfig(input: {
  notifyEmail: string;
  salesEnabled: boolean;
  salesPeriod: ReportPeriod | null;
  inventoryEnabled: boolean;
  inventoryPeriod: ReportPeriod | null;
  supplierOutstandingEnabled: boolean;
  supplierOutstandingPeriod: ReportPeriod | null;
  customerOutstandingEnabled: boolean;
  customerOutstandingPeriod: ReportPeriod | null;
}): Promise<ScheduledReportConfigDto> {
  const row = await prisma.reportScheduleConfig.upsert({
    where: { id: "default" },
    create: { id: "default", ...input },
    update: input,
  });
  return configToDto(row);
}

/** Inventory snapshot at generation time (all active products). */
export async function getInventorySnapshotReport() {
  const products = await prisma.product.findMany({
    where: { status: ProductStatus.ACTIVE },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: {
      sku: true,
      name: true,
      category: true,
      brand: true,
      baseUnitCode: true,
      currentStock: true,
      reorderLevel: true,
      costPrice: true,
      avgCostPrice: true,
    },
  });

  let totalUnits = new D(0);
  let totalStockValue = new D(0);
  let outOfStockCount = 0;
  let belowReorderCount = 0;

  const rows = products.map((p) => {
    const stock = new D(p.currentStock);
    const unitCost = p.avgCostPrice ?? p.costPrice ?? new D(0);
    const stockValue = stock.mul(unitCost);
    const reorder = p.reorderLevel != null ? new D(p.reorderLevel) : null;
    const outOfStock = stock.lessThanOrEqualTo(0);
    const belowReorder =
      reorder != null && stock.greaterThan(0) && stock.lessThanOrEqualTo(reorder);

    totalUnits = totalUnits.plus(stock);
    totalStockValue = totalStockValue.plus(stockValue);
    if (outOfStock) outOfStockCount += 1;
    if (belowReorder) belowReorderCount += 1;

    return {
      sku: p.sku,
      name: p.name,
      category: p.category ?? "",
      brand: p.brand ?? "",
      baseUnitCode: p.baseUnitCode,
      currentStock: qtyStr(stock),
      reorderLevel: reorder != null ? qtyStr(reorder) : null,
      costPrice: p.costPrice != null ? decStr(p.costPrice) : null,
      avgCostPrice: p.avgCostPrice != null ? decStr(p.avgCostPrice) : null,
      stockValue: decStr(stockValue),
      outOfStock,
      belowReorder,
    };
  });

  return {
    summary: {
      productCount: products.length,
      totalUnits: qtyStr(totalUnits),
      totalStockValue: decStr(totalStockValue),
      outOfStockCount,
      belowReorderCount,
    },
    products: rows,
  };
}

/** Open supplier balances grouped by supplier (point-in-time). */
export async function getSupplierOutstandingReport() {
  const purchases = await prisma.purchase.findMany({
    where: {
      status: PurchaseStatus.RECEIVED,
      balanceAmount: { gt: 0 },
    },
    orderBy: { createdAt: "desc" },
    include: {
      supplier: { select: { id: true, name: true, phone: true } },
    },
  });

  const map = new Map<
    string,
    {
      supplierId: string;
      supplierName: string;
      supplierPhone: string | null;
      invoiceCount: number;
      totalAmount: InstanceType<typeof D>;
      paidAmount: InstanceType<typeof D>;
      balanceAmount: InstanceType<typeof D>;
      invoices: {
        purchaseNumber: string;
        invoiceNumber: string | null;
        invoiceDate: string | null;
        createdAt: string;
        totalAmount: string;
        paidAmount: string;
        balanceAmount: string;
      }[];
    }
  >();

  for (const p of purchases) {
    const key = p.supplierId;
    const existing = map.get(key);
    const row = {
      purchaseNumber: p.purchaseNumber,
      invoiceNumber: p.invoiceNumber,
      invoiceDate: p.invoiceDate?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
      totalAmount: decStr(p.totalAmount),
      paidAmount: decStr(p.paidAmount),
      balanceAmount: decStr(p.balanceAmount),
    };
    if (existing) {
      existing.invoiceCount += 1;
      existing.totalAmount = existing.totalAmount.plus(p.totalAmount);
      existing.paidAmount = existing.paidAmount.plus(p.paidAmount);
      existing.balanceAmount = existing.balanceAmount.plus(p.balanceAmount);
      existing.invoices.push(row);
    } else {
      map.set(key, {
        supplierId: p.supplierId,
        supplierName: p.supplier.name,
        supplierPhone: p.supplier.phone,
        invoiceCount: 1,
        totalAmount: new D(p.totalAmount),
        paidAmount: new D(p.paidAmount),
        balanceAmount: new D(p.balanceAmount),
        invoices: [row],
      });
    }
  }

  let sumBal = new D(0);
  const suppliers = [...map.values()]
    .map((s) => {
      sumBal = sumBal.plus(s.balanceAmount);
      return {
        supplierId: s.supplierId,
        supplierName: s.supplierName,
        supplierPhone: s.supplierPhone,
        invoiceCount: s.invoiceCount,
        totalAmount: decStr(s.totalAmount),
        paidAmount: decStr(s.paidAmount),
        balanceAmount: decStr(s.balanceAmount),
        invoices: s.invoices,
      };
    })
    .sort(
      (a, b) =>
        Number.parseFloat(b.balanceAmount) - Number.parseFloat(a.balanceAmount)
    );

  return {
    summary: {
      supplierCount: suppliers.length,
      invoiceCount: purchases.length,
      totalBalance: decStr(sumBal),
    },
    suppliers,
  };
}

/** Open customer balances grouped by customer (point-in-time). */
export async function getCustomerOutstandingReport() {
  const sales = await prisma.sale.findMany({
    where: {
      status: SaleStatus.COMPLETED,
      balanceAmount: { gt: 0 },
    },
    orderBy: { createdAt: "desc" },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
    },
  });

  const map = new Map<
    string,
    {
      customerId: string | null;
      customerLabel: string;
      saleCount: number;
      totalAmount: InstanceType<typeof D>;
      paidAmount: InstanceType<typeof D>;
      balanceAmount: InstanceType<typeof D>;
      sales: {
        saleNumber: string;
        createdAt: string;
        totalAmount: string;
        paidAmount: string;
        balanceAmount: string;
      }[];
    }
  >();

  for (const s of sales) {
    let key: string;
    let label: string;

    if (s.customerId && s.customer) {
      key = `id:${s.customerId}`;
      const nm = s.customer.name.trim();
      const ph = s.customer.phone?.trim();
      label = ph ? `${nm} (${ph})` : nm;
    } else {
      const snap =
        s.customerNameSnapshot?.trim() || s.customerName?.trim() || "";
      const ph = s.customerPhone?.trim() || "";
      label = snap || (ph ? `Phone ${ph}` : "Walk-in / not set");
      key = `walkin:${snap.toLowerCase()}|${ph}`;
    }

    const row = {
      saleNumber: s.saleNumber,
      createdAt: s.createdAt.toISOString(),
      totalAmount: decStr(s.totalAmount),
      paidAmount: decStr(s.paidAmount),
      balanceAmount: decStr(s.balanceAmount),
    };

    const existing = map.get(key);
    if (existing) {
      existing.saleCount += 1;
      existing.totalAmount = existing.totalAmount.plus(s.totalAmount);
      existing.paidAmount = existing.paidAmount.plus(s.paidAmount);
      existing.balanceAmount = existing.balanceAmount.plus(s.balanceAmount);
      existing.sales.push(row);
    } else {
      map.set(key, {
        customerId: s.customerId,
        customerLabel: label,
        saleCount: 1,
        totalAmount: new D(s.totalAmount),
        paidAmount: new D(s.paidAmount),
        balanceAmount: new D(s.balanceAmount),
        sales: [row],
      });
    }
  }

  let sumBal = new D(0);
  const customers = [...map.values()]
    .map((c) => {
      sumBal = sumBal.plus(c.balanceAmount);
      return {
        customerId: c.customerId,
        customerLabel: c.customerLabel,
        saleCount: c.saleCount,
        totalAmount: decStr(c.totalAmount),
        paidAmount: decStr(c.paidAmount),
        balanceAmount: decStr(c.balanceAmount),
        sales: c.sales,
      };
    })
    .sort(
      (a, b) =>
        Number.parseFloat(b.balanceAmount) - Number.parseFloat(a.balanceAmount)
    );

  return {
    summary: {
      customerCount: customers.length,
      saleCount: sales.length,
      totalBalance: decStr(sumBal),
    },
    customers,
  };
}

async function buildReportPayload(
  reportType: ScheduledReportType,
  bounds: PeriodBounds,
  asOf: Date
): Promise<Record<string, unknown>> {
  const meta = {
    reportType,
    reportTypeLabel: reportTypeLabel(reportType),
    periodLabel: bounds.label,
    asOf: asOf.toISOString(),
    periodStart: bounds.periodStart.toISOString(),
    periodEnd: bounds.periodEnd.toISOString(),
  };

  switch (reportType) {
    case ScheduledReportType.SALES: {
      const range: ReportDateRange = {
        start: bounds.periodStart,
        end: bounds.periodEnd,
      };
      const [sales, grossMargin] = await Promise.all([
        getSalesSummaryReport(range),
        getGrossMarginReport(range),
      ]);
      return { meta, sales, grossMargin };
    }
    case ScheduledReportType.INVENTORY:
      return { meta, ...(await getInventorySnapshotReport()) };
    case ScheduledReportType.SUPPLIER_OUTSTANDING:
      return { meta, ...(await getSupplierOutstandingReport()) };
    case ScheduledReportType.CUSTOMER_OUTSTANDING:
      return { meta, ...(await getCustomerOutstandingReport()) };
    default: {
      const _exhaustive: never = reportType;
      throw new Error(`Unknown report type: ${_exhaustive}`);
    }
  }
}

type EnabledReport = {
  reportType: ScheduledReportType;
  period: ReportPeriod;
};

function enabledReportsFromConfig(config: ScheduledReportConfigDto): EnabledReport[] {
  const out: EnabledReport[] = [];
  if (config.salesEnabled && config.salesPeriod) {
    out.push({ reportType: ScheduledReportType.SALES, period: config.salesPeriod });
  }
  if (config.inventoryEnabled && config.inventoryPeriod) {
    out.push({
      reportType: ScheduledReportType.INVENTORY,
      period: config.inventoryPeriod,
    });
  }
  if (config.supplierOutstandingEnabled && config.supplierOutstandingPeriod) {
    out.push({
      reportType: ScheduledReportType.SUPPLIER_OUTSTANDING,
      period: config.supplierOutstandingPeriod,
    });
  }
  if (config.customerOutstandingEnabled && config.customerOutstandingPeriod) {
    out.push({
      reportType: ScheduledReportType.CUSTOMER_OUTSTANDING,
      period: config.customerOutstandingPeriod,
    });
  }
  return out;
}

async function generateOneReport(
  reportType: ScheduledReportType,
  period: ReportPeriod,
  bounds: PeriodBounds,
  notifyEmail: string
): Promise<void> {
  const existing = await prisma.reportRun.findUnique({
    where: {
      reportType_period_periodStart: {
        reportType,
        period,
        periodStart: bounds.periodStart,
      },
    },
  });

  if (existing?.status === ReportRunStatus.COMPLETED) {
    return;
  }

  const asOf = new Date();
  let runId: string;

  if (existing) {
    runId = existing.id;
    await prisma.reportRun.update({
      where: { id: runId },
      data: {
        status: ReportRunStatus.RUNNING,
        asOf,
        errorMessage: null,
      },
    });
  } else {
    const created = await prisma.reportRun.create({
      data: {
        reportType,
        period,
        periodStart: bounds.periodStart,
        periodEnd: bounds.periodEnd,
        asOf,
        status: ReportRunStatus.RUNNING,
      },
    });
    runId = created.id;
  }

  try {
    const payload = await buildReportPayload(reportType, bounds, asOf);
    await prisma.reportRun.update({
      where: { id: runId },
      data: {
        status: ReportRunStatus.COMPLETED,
        payload: payload as Prisma.InputJsonValue,
        errorMessage: null,
      },
    });

    const email = notifyEmail.trim();
    if (email && isEmailConfigured()) {
      const sent = await sendReportReadyEmail({
        to: email,
        runId,
        reportTypeLabel: reportTypeLabel(reportType),
        periodLabel: bounds.label,
        frequencyLabel: reportPeriodLabel(period),
        generatedAt: asOf,
      });
      if (sent) {
        await prisma.reportRun.update({
          where: { id: runId },
          data: { emailSentAt: new Date() },
        });
      }
    } else if (email && !isEmailConfigured()) {
      console.warn(
        `[scheduled-reports] Report ${runId} saved but SMTP is not configured — email skipped.`
      );
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Report generation failed";
    await prisma.reportRun.update({
      where: { id: runId },
      data: {
        status: ReportRunStatus.FAILED,
        errorMessage: message,
      },
    });
    console.error(`[scheduled-reports] Failed ${reportType} (${period}):`, error);
  }
}

/** Run at most one due scheduled report per invocation (30 min stagger between types). */
export async function runDueScheduledReports(): Promise<void> {
  const config = await getOrCreateReportScheduleConfig();
  const now = nowIndia();
  const baseHour = parseReportCronBaseHour();

  const due = enabledReportsFromConfig(config)
    .filter(({ period }) => isSchedulerWindowOpen(period, now))
    .sort(
      (a, b) =>
        REPORT_RUN_ORDER.indexOf(a.reportType) -
        REPORT_RUN_ORDER.indexOf(b.reportType)
    );

  for (const { reportType, period } of due) {
    if (!isReportSlotReached(reportType, now, baseHour)) continue;

    const bounds = computePreviousPeriodBounds(period, now);
    const existing = await prisma.reportRun.findUnique({
      where: {
        reportType_period_periodStart: {
          reportType,
          period,
          periodStart: bounds.periodStart,
        },
      },
    });
    if (existing?.status === ReportRunStatus.COMPLETED) continue;

    await generateOneReport(
      reportType,
      period,
      bounds,
      config.notifyEmail
    );
    return;
  }
}

export async function listReportRuns(limit = 50): Promise<ReportRunSummaryDto[]> {
  const rows = await prisma.reportRun.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.min(200, Math.max(1, limit)),
    select: {
      id: true,
      reportType: true,
      period: true,
      periodStart: true,
      periodEnd: true,
      asOf: true,
      status: true,
      errorMessage: true,
      emailSentAt: true,
      createdAt: true,
      payload: true,
    },
  });

  return rows.map((r) => {
    const payload = r.payload as { meta?: { periodLabel?: string } } | null;
    return {
      id: r.id,
      reportType: r.reportType,
      period: r.period,
      periodStart: r.periodStart.toISOString(),
      periodEnd: r.periodEnd.toISOString(),
      asOf: r.asOf.toISOString(),
      status: r.status,
      errorMessage: r.errorMessage,
      emailSentAt: r.emailSentAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      periodLabel: payload?.meta?.periodLabel ?? null,
    };
  });
}

export async function getReportRunById(id: string) {
  const row = await prisma.reportRun.findUnique({ where: { id } });
  if (!row) return null;
  return {
    id: row.id,
    reportType: row.reportType,
    period: row.period,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    asOf: row.asOf.toISOString(),
    status: row.status,
    errorMessage: row.errorMessage,
    emailSentAt: row.emailSentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    payload: row.payload,
  };
}
