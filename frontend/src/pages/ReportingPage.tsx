import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { isApiError } from "../api/errors";
import {
  firstDayOfMonthYmdIndia,
  formatIndiaDateTime,
  ymdInIndia,
} from "../lib/indiaTime";
import type {
  GrossMarginReport,
  PurchasesReport,
  ReportPeriod,
  ReportRunSummary,
  SalesByCustomerReport,
  SalesByProductReport,
  SalesSummaryReport,
  ScheduledReportConfig,
  SupplierPaymentsReport,
  TaxInvoiceSalesReport,
} from "../api/types";
import { SavedReportViewer } from "./SavedReportViewer";
import {
  reportSlotTimeLabel,
  REPORT_STAGGER_NOTE,
} from "../lib/reportScheduleSlots";

function ymdToDmy(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function fmtInr(s: string | number): string {
  const n = typeof s === "string" ? Number.parseFloat(s) : s;
  if (!Number.isFinite(n)) return "—";
  return `₹${n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function csvEscapeCell(v: string): string {
  if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(csvEscapeCell).join(",")).join("\r\n");
}

function downloadCsvFile(filename: string, rows: string[][]): void {
  const bom = "\uFEFF";
  const blob = new Blob([bom + toCsv(rows)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const btnSecondary: React.CSSProperties = {
  height: 32,
  padding: "0 12px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  height: 38,
  padding: "0 12px",
  border: "1px solid var(--border)",
  borderRadius: 10,
  fontSize: 13,
  outline: "none",
  background: "var(--surface)",
  color: "var(--text)",
};

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--muted)",
  borderBottom: "1px solid var(--border)",
};

const td: React.CSSProperties = {
  padding: "8px 10px",
  fontSize: 13,
  borderBottom: "1px solid var(--surface-subtle)",
};

const tableWrap: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 10,
  overflow: "auto",
  maxHeight: 360,
  background: "var(--surface)",
};

type ReportKind =
  | "sales-summary"
  | "sales-by-customer"
  | "sales-by-product"
  | "tax-invoice-sales"
  | "purchases"
  | "supplier-payments"
  | "gross-margin";

const REPORT_OPTIONS: { value: ReportKind; label: string }[] = [
  { value: "sales-summary", label: "Sales summary & register" },
  { value: "sales-by-customer", label: "Sales by customer" },
  { value: "sales-by-product", label: "Sales by product" },
  { value: "tax-invoice-sales", label: "Tax invoice register (GST)" },
  { value: "purchases", label: "Purchases" },
  { value: "supplier-payments", label: "Payments to suppliers" },
  { value: "gross-margin", label: "Gross margin" },
];

const PERIOD_OPTIONS: { value: ReportPeriod; label: string }[] = [
  { value: "DAILY", label: "Daily" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly (Indian FY)" },
  { value: "YEARLY", label: "Yearly" },
];

const SCHEDULED_REPORT_ROWS: {
  key:
    | "sales"
    | "inventory"
    | "supplierOutstanding"
    | "customerOutstanding";
  reportType:
    | "SALES"
    | "INVENTORY"
    | "SUPPLIER_OUTSTANDING"
    | "CUSTOMER_OUTSTANDING";
  label: string;
  enabledKey:
    | "salesEnabled"
    | "inventoryEnabled"
    | "supplierOutstandingEnabled"
    | "customerOutstandingEnabled";
  periodKey:
    | "salesPeriod"
    | "inventoryPeriod"
    | "supplierOutstandingPeriod"
    | "customerOutstandingPeriod";
}[] = [
  {
    key: "sales",
    reportType: "SALES",
    label: "Sales report",
    enabledKey: "salesEnabled",
    periodKey: "salesPeriod",
  },
  {
    key: "inventory",
    reportType: "INVENTORY",
    label: "Inventory report",
    enabledKey: "inventoryEnabled",
    periodKey: "inventoryPeriod",
  },
  {
    key: "supplierOutstanding",
    reportType: "SUPPLIER_OUTSTANDING",
    label: "Supplier outstanding",
    enabledKey: "supplierOutstandingEnabled",
    periodKey: "supplierOutstandingPeriod",
  },
  {
    key: "customerOutstanding",
    reportType: "CUSTOMER_OUTSTANDING",
    label: "Customer outstanding",
    enabledKey: "customerOutstandingEnabled",
    periodKey: "customerOutstandingPeriod",
  },
];

function reportTypeDisplay(type: string): string {
  switch (type) {
    case "SALES":
      return "Sales";
    case "INVENTORY":
      return "Inventory";
    case "SUPPLIER_OUTSTANDING":
      return "Supplier outstanding";
    case "CUSTOMER_OUTSTANDING":
      return "Customer outstanding";
    default:
      return type;
  }
}

function periodDisplay(period: string): string {
  return PERIOD_OPTIONS.find((p) => p.value === period)?.label ?? period;
}

type ReportingPageProps = {
  initialReportRunId?: string | null;
};

export function ReportingPage({ initialReportRunId = null }: ReportingPageProps) {
  const defaults = useMemo(() => {
    const now = new Date();
    return {
      from: firstDayOfMonthYmdIndia(now),
      to: ymdInIndia(now),
    };
  }, []);

  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [reportKind, setReportKind] = useState<ReportKind>("sales-summary");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [salesSummary, setSalesSummary] = useState<SalesSummaryReport | null>(
    null
  );
  const [byProduct, setByProduct] = useState<SalesByProductReport | null>(null);
  const [byCustomer, setByCustomer] = useState<SalesByCustomerReport | null>(
    null
  );
  const [purchases, setPurchases] = useState<PurchasesReport | null>(null);
  const [supplierPayments, setSupplierPayments] =
    useState<SupplierPaymentsReport | null>(null);
  const [margin, setMargin] = useState<GrossMarginReport | null>(null);
  const [taxInvoiceSales, setTaxInvoiceSales] =
    useState<TaxInvoiceSalesReport | null>(null);

  const [scheduleConfig, setScheduleConfig] =
    useState<ScheduledReportConfig | null>(null);
  const [scheduleDraft, setScheduleDraft] =
    useState<ScheduledReportConfig | null>(null);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleSaved, setScheduleSaved] = useState(false);
  const [reportRuns, setReportRuns] = useState<ReportRunSummary[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [viewRunId, setViewRunId] = useState<string | null>(
    initialReportRunId
  );

  useEffect(() => {
    if (initialReportRunId) setViewRunId(initialReportRunId);
  }, [initialReportRunId]);

  const loadActiveReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      switch (reportKind) {
        case "sales-summary": {
          const data = await api.getReportSalesSummary(from, to);
          setSalesSummary(data);
          break;
        }
        case "sales-by-customer": {
          const data = await api.getReportSalesByCustomer(from, to);
          setByCustomer(data);
          break;
        }
        case "sales-by-product": {
          const data = await api.getReportSalesByProduct(from, to);
          setByProduct(data);
          break;
        }
        case "tax-invoice-sales": {
          const data = await api.getReportTaxInvoiceSales(from, to);
          setTaxInvoiceSales(data);
          break;
        }
        case "purchases": {
          const data = await api.getReportPurchases(from, to);
          setPurchases(data);
          break;
        }
        case "supplier-payments": {
          const data = await api.getReportSupplierPayments(from, to);
          setSupplierPayments(data);
          break;
        }
        case "gross-margin": {
          const data = await api.getReportGrossMargin(from, to);
          setMargin(data);
          break;
        }
      }
    } catch (e) {
      const msg = isApiError(e) ? e.message : "Failed to load report";
      setError(msg);
      switch (reportKind) {
        case "sales-summary":
          setSalesSummary(null);
          break;
        case "sales-by-customer":
          setByCustomer(null);
          break;
        case "sales-by-product":
          setByProduct(null);
          break;
        case "purchases":
          setPurchases(null);
          break;
        case "supplier-payments":
          setSupplierPayments(null);
          break;
        case "gross-margin":
          setMargin(null);
          break;
        case "tax-invoice-sales":
          setTaxInvoiceSales(null);
          break;
      }
    } finally {
      setLoading(false);
    }
  }, [reportKind, from, to]);

  useEffect(() => {
    void loadActiveReport();
  }, [loadActiveReport]);

  const loadScheduleSection = useCallback(async () => {
    setRunsLoading(true);
    setScheduleError(null);
    try {
      const [config, runsRes] = await Promise.all([
        api.getScheduledReportConfig(),
        api.listScheduledReportRuns(50),
      ]);
      setScheduleConfig(config);
      setScheduleDraft(config);
      setReportRuns(runsRes.runs);
    } catch (e) {
      setScheduleError(
        isApiError(e) ? e.message : "Failed to load scheduled report settings"
      );
    } finally {
      setRunsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadScheduleSection();
  }, [loadScheduleSection]);

  const saveScheduleConfig = async () => {
    if (!scheduleDraft) return;
    setScheduleSaving(true);
    setScheduleError(null);
    setScheduleSaved(false);
    try {
      const saved = await api.updateScheduledReportConfig(scheduleDraft);
      setScheduleConfig(saved);
      setScheduleDraft(saved);
      setScheduleSaved(true);
    } catch (e) {
      setScheduleError(
        isApiError(e) ? e.message : "Failed to save schedule settings"
      );
    } finally {
      setScheduleSaving(false);
    }
  };

  const activeReportLabel =
    REPORT_OPTIONS.find((o) => o.value === reportKind)?.label ?? "Report";

  const hasActiveData =
    (reportKind === "sales-summary" && salesSummary !== null) ||
    (reportKind === "sales-by-customer" && byCustomer !== null) ||
    (reportKind === "sales-by-product" && byProduct !== null) ||
    (reportKind === "tax-invoice-sales" && taxInvoiceSales !== null) ||
    (reportKind === "purchases" && purchases !== null) ||
    (reportKind === "supplier-payments" && supplierPayments !== null) ||
    (reportKind === "gross-margin" && margin !== null);

  const downloadSalesSummaryMetrics = () => {
    if (!salesSummary) return;
    const { summary } = salesSummary;
    downloadCsvFile(`sales-summary-metrics_${from}_${to}.csv`, [
      ["Label", "Value"],
      ["Sales", String(summary.saleCount)],
      ["Total", fmtInr(summary.totalAmount)],
      ["Paid", fmtInr(summary.paidAmount)],
      ["Balance due", fmtInr(summary.balanceAmount)],
      ["Discounts", fmtInr(summary.discountAmount)],
      ["Tax", fmtInr(summary.taxAmount)],
      ["Avg ticket", fmtInr(summary.averageTicket)],
    ]);
  };

  const downloadSalesRegister = () => {
    if (!salesSummary) return;
    downloadCsvFile(`sales-register_${from}_${to}.csv`, [
      ["Sale", "Date", "Customer", "Cashier", "Total", "Paid", "Balance"],
      ...salesSummary.sales.map((s) => [
        s.saleNumber,
        formatIndiaDateTime(s.createdAt),
        s.customerLabel,
        s.cashierName,
        fmtInr(s.totalAmount),
        fmtInr(s.paidAmount),
        fmtInr(s.balanceAmount),
      ]),
    ]);
  };

  const downloadSalesByProduct = () => {
    if (!byProduct) return;
    downloadCsvFile(`sales-by-product_${from}_${to}.csv`, [
      [
        "SKU",
        "Product",
        "Category",
        "Brand",
        "Qty (base)",
        "Lines",
        "Revenue",
      ],
      ...byProduct.products.map((p) => [
        p.sku,
        p.name,
        p.category,
        p.brand,
        p.quantityInBase,
        String(p.lineCount),
        fmtInr(p.revenue),
      ]),
    ]);
  };

  const downloadSalesByCustomer = () => {
    if (!byCustomer) return;
    downloadCsvFile(`sales-by-customer_${from}_${to}.csv`, [
      ["Customer", "Sales", "Total", "Paid", "Balance"],
      ...byCustomer.customers.map((c) => [
        c.customerLabel,
        String(c.saleCount),
        fmtInr(c.totalAmount),
        fmtInr(c.paidAmount),
        fmtInr(c.balanceAmount),
      ]),
    ]);
  };

  const downloadSupplierPaymentsBySupplier = () => {
    if (!supplierPayments) return;
    downloadCsvFile(`supplier-payments-by-supplier_${from}_${to}.csv`, [
      ["Supplier", "Payments", "Total paid"],
      ...supplierPayments.bySupplier.map((s) => [
        s.supplierName,
        String(s.paymentCount),
        fmtInr(s.totalPaid),
      ]),
    ]);
  };

  const downloadSupplierPaymentsDetail = () => {
    if (!supplierPayments) return;
    downloadCsvFile(`supplier-payments-detail_${from}_${to}.csv`, [
      ["Paid at", "Supplier", "Purchase", "Amount", "Recorded by", "Note"],
      ...supplierPayments.payments.map((p) => [
        formatIndiaDateTime(p.paidAt),
        p.supplierName,
        p.purchaseNumber,
        fmtInr(p.amount),
        p.recordedByName,
        p.note ?? "—",
      ]),
    ]);
  };

  const downloadPurchasesBySupplier = () => {
    if (!purchases) return;
    downloadCsvFile(`purchases-by-supplier_${from}_${to}.csv`, [
      ["Supplier", "Purchases", "Total"],
      ...purchases.bySupplier.map((s) => [
        s.supplierName,
        String(s.purchaseCount),
        fmtInr(s.totalAmount),
      ]),
    ]);
  };

  const downloadPurchasesRegister = () => {
    if (!purchases) return;
    downloadCsvFile(`purchases-register_${from}_${to}.csv`, [
      ["PO", "Date", "Supplier", "Invoice", "By", "Total"],
      ...purchases.purchases.map((p) => [
        p.purchaseNumber,
        formatIndiaDateTime(p.createdAt),
        p.supplierName,
        p.invoiceNumber ?? "—",
        p.createdByName,
        fmtInr(p.totalAmount),
      ]),
    ]);
  };

  const downloadTaxInvoiceRegister = () => {
    if (!taxInvoiceSales) return;
    const gstHeader = [
      "Date",
      "Party",
      "Invoice no",
      "Amt before tax",
      "SGST",
      "CGST",
      "IGST",
      "Grand total",
    ];
    const gstRows = taxInvoiceSales.rows.map((r) => [
      ymdToDmy(r.invoiceDate),
      r.partyLabel,
      r.saleNumber,
      fmtInr(r.amountBeforeTax),
      fmtInr(r.sgstAmount),
      fmtInr(r.cgstAmount),
      fmtInr(r.igstAmount),
      fmtInr(r.grandTotal),
    ]);
    const payHeader = ["Date", "Invoice no", "Payment", "Note"];
    const payRows = taxInvoiceSales.paymentRows.map((p) => [
      ymdToDmy(p.paymentDate),
      p.saleNumber,
      fmtInr(p.amount),
      p.note ?? "—",
    ]);
    downloadCsvFile(`tax-invoice-register_${from}_${to}.csv`, [
      ["GST register"],
      gstHeader,
      ...gstRows,
      [],
      ["Payments"],
      payHeader,
      ...payRows,
    ]);
  };

  const downloadGrossMargin = () => {
    if (!margin) return;
    downloadCsvFile(`gross-margin_${from}_${to}.csv`, [
      ["Label", "Value"],
      ["Sale lines", String(margin.lineCount)],
      ["Revenue", fmtInr(margin.revenue)],
      ["Est. cost", fmtInr(margin.estimatedCost)],
      ["Gross margin", fmtInr(margin.grossMargin)],
      ["Margin %", `${margin.marginPercent}%`],
    ]);
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 28,
        width: "100%",
        maxWidth: 1200,
      }}
    >
      <div>
        <h2 style={{ margin: 0, fontSize: 20, color: "var(--text)" }}>
          Reporting
        </h2>
        <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--muted)" }}>
          Choose a report, set the date range (India time / IST), then run or change dates to
          refresh. Sales by customer groups completed sales in the period. Payments to suppliers
          uses each payment&apos;s <strong>payment date</strong>. Gross margin uses product cost ×
          quantity sold (approximate). CSV exports use UTF-8 with BOM for Excel.
        </p>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "flex-end",
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 220 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>
            Report
          </span>
          <select
            value={reportKind}
            onChange={(e) => setReportKind(e.target.value as ReportKind)}
            style={{
              ...inputStyle,
              minWidth: 220,
              cursor: "pointer",
              paddingRight: 8,
            }}
          >
            {REPORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>
            From
          </span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>
            To
          </span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            style={inputStyle}
          />
        </label>
        <button
          type="button"
          onClick={() => void loadActiveReport()}
          disabled={loading}
          style={{
            height: 38,
            padding: "0 18px",
            borderRadius: 10,
            border: "none",
            background: loading ? "var(--border)" : "var(--accent)",
            color: loading ? "var(--muted)" : "var(--on-accent)",
            fontSize: 14,
            fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Loading…" : "Run report"}
        </button>
      </div>

      {error ? (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 10,
            background: "var(--surface)",
            color: "var(--danger)",
            fontSize: 14,
          }}
        >
          {error}
        </div>
      ) : null}

      {loading && !error && !hasActiveData ? (
        <div style={{ fontSize: 14, color: "var(--muted)" }}>Loading…</div>
      ) : null}

      {reportKind === "sales-summary" && salesSummary ? (
        <section>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              marginBottom: 12,
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: 16,
                color: "var(--text)",
              }}
            >
              {activeReportLabel}
            </h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button
                type="button"
                style={btnSecondary}
                onClick={downloadSalesSummaryMetrics}
              >
                CSV summary
              </button>
              <button
                type="button"
                style={btnSecondary}
                onClick={downloadSalesRegister}
              >
                CSV register
              </button>
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: 10,
              marginBottom: 14,
            }}
          >
            {[
              ["Sales", String(salesSummary.summary.saleCount)],
              ["Total", fmtInr(salesSummary.summary.totalAmount)],
              ["Paid", fmtInr(salesSummary.summary.paidAmount)],
              ["Balance due", fmtInr(salesSummary.summary.balanceAmount)],
              ["Discounts", fmtInr(salesSummary.summary.discountAmount)],
              ["Tax", fmtInr(salesSummary.summary.taxAmount)],
              ["Avg ticket", fmtInr(salesSummary.summary.averageTicket)],
            ].map(([k, v]) => (
              <div
                key={k}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--surface-subtle)",
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--muted)",
                    fontWeight: 600,
                    marginBottom: 4,
                  }}
                >
                  {k}
                </div>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: "var(--text)",
                  }}
                >
                  {v}
                </div>
              </div>
            ))}
          </div>
          <div style={tableWrap}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--surface-subtle)" }}>
                  <th style={th}>Sale</th>
                  <th style={th}>Date</th>
                  <th style={th}>Customer</th>
                  <th style={th}>Cashier</th>
                  <th style={{ ...th, textAlign: "right" }}>Total</th>
                  <th style={{ ...th, textAlign: "right" }}>Paid</th>
                  <th style={{ ...th, textAlign: "right" }}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {salesSummary.sales.map((s) => (
                  <tr key={s.id}>
                    <td style={td}>{s.saleNumber}</td>
                    <td style={{ ...td, color: "var(--muted)", fontSize: 12 }}>
                      {formatIndiaDateTime(s.createdAt)}
                    </td>
                    <td style={td}>{s.customerLabel}</td>
                    <td style={td}>{s.cashierName}</td>
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        fontFamily: "monospace",
                      }}
                    >
                      {fmtInr(s.totalAmount)}
                    </td>
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        fontFamily: "monospace",
                        color: "var(--muted)",
                      }}
                    >
                      {fmtInr(s.paidAmount)}
                    </td>
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        fontFamily: "monospace",
                        fontWeight: 600,
                      }}
                    >
                      {fmtInr(s.balanceAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {reportKind === "sales-by-product" && byProduct ? (
        <section>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              marginBottom: 12,
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: 16,
                color: "var(--text)",
              }}
            >
              {activeReportLabel}
            </h3>
            <button
              type="button"
              style={btnSecondary}
              onClick={downloadSalesByProduct}
            >
              CSV
            </button>
          </div>
          <div style={tableWrap}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--surface-subtle)" }}>
                  <th style={th}>SKU</th>
                  <th style={th}>Product</th>
                  <th style={th}>Category</th>
                  <th style={th}>Brand</th>
                  <th style={{ ...th, textAlign: "right" }}>Qty (base)</th>
                  <th style={{ ...th, textAlign: "right" }}>Lines</th>
                  <th style={{ ...th, textAlign: "right" }}>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {byProduct.products.map((p) => (
                  <tr key={p.productId}>
                    <td style={td}>{p.sku}</td>
                    <td style={td}>{p.name}</td>
                    <td style={td}>{p.category}</td>
                    <td style={td}>{p.brand}</td>
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        fontFamily: "monospace",
                      }}
                    >
                      {p.quantityInBase}
                    </td>
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        fontFamily: "monospace",
                      }}
                    >
                      {p.lineCount}
                    </td>
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        fontFamily: "monospace",
                        fontWeight: 600,
                      }}
                    >
                      {fmtInr(p.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {reportKind === "tax-invoice-sales" && taxInvoiceSales ? (
        <section>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              marginBottom: 12,
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: 16,
                color: "var(--text)",
              }}
            >
              {activeReportLabel}
            </h3>
            <button
              type="button"
              style={btnSecondary}
              onClick={downloadTaxInvoiceRegister}
            >
              CSV
            </button>
          </div>
          <p
            style={{
              margin: "0 0 12px",
              fontSize: 12,
              color: "var(--muted)",
              lineHeight: 1.5,
            }}
          >
            {taxInvoiceSales.disclaimer}
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: 10,
              marginBottom: 14,
            }}
          >
            {[
              ["Sales", String(taxInvoiceSales.summary.saleCount)],
              ["Amt before tax", fmtInr(taxInvoiceSales.summary.amountBeforeTax)],
              ["SGST", fmtInr(taxInvoiceSales.summary.sgstAmount)],
              ["CGST", fmtInr(taxInvoiceSales.summary.cgstAmount)],
              ["IGST", fmtInr(taxInvoiceSales.summary.igstAmount)],
              ["Grand total", fmtInr(taxInvoiceSales.summary.grandTotal)],
              [
                "Payment lines",
                String(taxInvoiceSales.paymentSummary.paymentCount),
              ],
              ["Total paid", fmtInr(taxInvoiceSales.paymentSummary.totalPaid)],
            ].map(([k, v]) => (
              <div
                key={k}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--surface-subtle)",
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--muted)",
                    fontWeight: 600,
                    marginBottom: 4,
                  }}
                >
                  {k}
                </div>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: "var(--text)",
                  }}
                >
                  {v}
                </div>
              </div>
            ))}
          </div>

          <div style={tableWrap}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--surface-subtle)" }}>
                  <th style={th}>Date</th>
                  <th style={{ ...th, minWidth: 220 }}>Party</th>
                  <th style={th}>Invoice no</th>
                  <th style={{ ...th, textAlign: "right" }}>Amt before tax</th>
                  <th style={{ ...th, textAlign: "right" }}>SGST</th>
                  <th style={{ ...th, textAlign: "right" }}>CGST</th>
                  <th style={{ ...th, textAlign: "right" }}>IGST</th>
                  <th style={{ ...th, textAlign: "right" }}>Grand total</th>
                </tr>
              </thead>
              <tbody>
                {taxInvoiceSales.rows.map((r) => (
                  <tr key={r.id}>
                    <td
                      style={{
                        ...td,
                        color: "var(--muted)",
                        fontSize: 12,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {ymdToDmy(r.invoiceDate)}
                    </td>
                    <td style={td}>{r.partyLabel}</td>
                    <td
                      style={{
                        ...td,
                        overflowWrap: "anywhere",
                        wordBreak: "break-word",
                      }}
                    >
                      {r.saleNumber}
                    </td>
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        fontFamily: "monospace",
                      }}
                    >
                      {fmtInr(r.amountBeforeTax)}
                    </td>
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        fontFamily: "monospace",
                      }}
                    >
                      {fmtInr(r.sgstAmount)}
                    </td>
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        fontFamily: "monospace",
                      }}
                    >
                      {fmtInr(r.cgstAmount)}
                    </td>
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        fontFamily: "monospace",
                      }}
                    >
                      {fmtInr(r.igstAmount)}
                    </td>
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        fontFamily: "monospace",
                        fontWeight: 600,
                      }}
                    >
                      {fmtInr(r.grandTotal)}
                    </td>
                  </tr>
                ))}
                <tr style={{ background: "var(--surface-subtle)" }}>
                  <td colSpan={3} style={{ ...td, fontWeight: 700 }}>
                    Total
                  </td>
                  <td
                    style={{
                      ...td,
                      textAlign: "right",
                      fontFamily: "monospace",
                      fontWeight: 700,
                    }}
                  >
                    {fmtInr(taxInvoiceSales.summary.amountBeforeTax)}
                  </td>
                  <td
                    style={{
                      ...td,
                      textAlign: "right",
                      fontFamily: "monospace",
                      fontWeight: 700,
                    }}
                  >
                    {fmtInr(taxInvoiceSales.summary.sgstAmount)}
                  </td>
                  <td
                    style={{
                      ...td,
                      textAlign: "right",
                      fontFamily: "monospace",
                      fontWeight: 700,
                    }}
                  >
                    {fmtInr(taxInvoiceSales.summary.cgstAmount)}
                  </td>
                  <td
                    style={{
                      ...td,
                      textAlign: "right",
                      fontFamily: "monospace",
                      fontWeight: 700,
                    }}
                  >
                    {fmtInr(taxInvoiceSales.summary.igstAmount)}
                  </td>
                  <td
                    style={{
                      ...td,
                      textAlign: "right",
                      fontFamily: "monospace",
                      fontWeight: 700,
                    }}
                  >
                    {fmtInr(taxInvoiceSales.summary.grandTotal)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <h4
            style={{
              margin: "18px 0 8px",
              fontSize: 13,
              color: "var(--muted)",
              fontWeight: 600,
            }}
          >
            Payments
          </h4>
          <p
            style={{
              margin: "0 0 12px",
              fontSize: 12,
              color: "var(--muted)",
              lineHeight: 1.5,
            }}
          >
            Receipts recorded against invoices in the register above (date is when the
            payment was saved, IST calendar day). Split invoices show one row per
            instalment.
          </p>
          <div style={tableWrap}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--surface-subtle)" }}>
                  <th style={th}>Date</th>
                  <th style={th}>Invoice no</th>
                  <th style={{ ...th, textAlign: "right" }}>Payment</th>
                  <th style={th}>Note</th>
                </tr>
              </thead>
              <tbody>
                {taxInvoiceSales.paymentRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      style={{ ...td, color: "var(--muted)", fontStyle: "italic" }}
                    >
                      No payments found for invoices in this period.
                    </td>
                  </tr>
                ) : (
                  <>
                    {taxInvoiceSales.paymentRows.map((p) => (
                      <tr key={p.id}>
                        <td
                          style={{
                            ...td,
                            color: "var(--muted)",
                            fontSize: 12,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {ymdToDmy(p.paymentDate)}
                        </td>
                        <td
                          style={{
                            ...td,
                            overflowWrap: "anywhere",
                            wordBreak: "break-word",
                          }}
                        >
                          {p.saleNumber}
                        </td>
                        <td
                          style={{
                            ...td,
                            textAlign: "right",
                            fontFamily: "monospace",
                            fontWeight: 600,
                          }}
                        >
                          {fmtInr(p.amount)}
                        </td>
                        <td style={{ ...td, color: "var(--muted)", fontSize: 12 }}>
                          {p.note ?? "—"}
                        </td>
                      </tr>
                    ))}
                    <tr style={{ background: "var(--surface-subtle)" }}>
                      <td colSpan={2} style={{ ...td, fontWeight: 700 }}>
                        Total
                      </td>
                      <td
                        style={{
                          ...td,
                          textAlign: "right",
                          fontFamily: "monospace",
                          fontWeight: 700,
                        }}
                      >
                        {fmtInr(taxInvoiceSales.paymentSummary.totalPaid)}
                      </td>
                      <td style={td} />
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {reportKind === "sales-by-customer" && byCustomer ? (
        <section>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              marginBottom: 12,
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: 16,
                color: "var(--text)",
              }}
            >
              {activeReportLabel}
            </h3>
            <button
              type="button"
              style={btnSecondary}
              onClick={downloadSalesByCustomer}
            >
              CSV
            </button>
          </div>
          <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--muted)" }}>
            Completed sales in the date range, grouped by customer (saved customers) or
            walk-in name/phone. Amounts are sums across all sales for that group.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: 10,
              marginBottom: 14,
            }}
          >
            {[
              ["Customers", String(byCustomer.summary.customerCount)],
              ["Sales", String(byCustomer.summary.saleCount)],
              ["Total sold", fmtInr(byCustomer.summary.totalAmount)],
              ["Collected", fmtInr(byCustomer.summary.paidAmount)],
              ["Balance due", fmtInr(byCustomer.summary.balanceAmount)],
            ].map(([k, v]) => (
              <div
                key={k}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--surface-subtle)",
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--muted)",
                    fontWeight: 600,
                    marginBottom: 4,
                  }}
                >
                  {k}
                </div>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: "var(--text)",
                  }}
                >
                  {v}
                </div>
              </div>
            ))}
          </div>
          <div style={tableWrap}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--surface-subtle)" }}>
                  <th style={th}>Customer</th>
                  <th style={{ ...th, textAlign: "right" }}>Sales</th>
                  <th style={{ ...th, textAlign: "right" }}>Total</th>
                  <th style={{ ...th, textAlign: "right" }}>Paid</th>
                  <th style={{ ...th, textAlign: "right" }}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {byCustomer.customers.map((c, i) => (
                  <tr key={`${c.customerLabel}-${i}`}>
                    <td style={td}>{c.customerLabel}</td>
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        fontFamily: "monospace",
                      }}
                    >
                      {c.saleCount}
                    </td>
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        fontFamily: "monospace",
                        fontWeight: 600,
                      }}
                    >
                      {fmtInr(c.totalAmount)}
                    </td>
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        fontFamily: "monospace",
                        color: "var(--muted)",
                      }}
                    >
                      {fmtInr(c.paidAmount)}
                    </td>
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        fontFamily: "monospace",
                      }}
                    >
                      {fmtInr(c.balanceAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {reportKind === "purchases" && purchases ? (
        <section>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              marginBottom: 12,
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: 16,
                color: "var(--text)",
              }}
            >
              {activeReportLabel}
            </h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button
                type="button"
                style={btnSecondary}
                onClick={downloadPurchasesBySupplier}
              >
                CSV by supplier
              </button>
              <button
                type="button"
                style={btnSecondary}
                onClick={downloadPurchasesRegister}
              >
                CSV register
              </button>
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
              gap: 10,
              marginBottom: 14,
            }}
          >
            {[
              ["Purchases", String(purchases.summary.purchaseCount)],
              ["Total spend", fmtInr(purchases.summary.totalAmount)],
              ["Subtotal", fmtInr(purchases.summary.subtotal)],
              ["Tax", fmtInr(purchases.summary.taxAmount)],
            ].map(([k, v]) => (
              <div
                key={k}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--surface-subtle)",
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--muted)",
                    fontWeight: 600,
                    marginBottom: 4,
                  }}
                >
                  {k}
                </div>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: "var(--text)",
                  }}
                >
                  {v}
                </div>
              </div>
            ))}
          </div>
          <h4
            style={{
              margin: "0 0 8px",
              fontSize: 13,
              color: "var(--muted)",
              fontWeight: 600,
            }}
          >
            By supplier
          </h4>
          <div style={{ ...tableWrap, maxHeight: 220, marginBottom: 16 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--surface-subtle)" }}>
                  <th style={th}>Supplier</th>
                  <th style={{ ...th, textAlign: "right" }}>Purchases</th>
                  <th style={{ ...th, textAlign: "right" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {purchases.bySupplier.map((s) => (
                  <tr key={s.supplierId}>
                    <td style={td}>{s.supplierName}</td>
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        fontFamily: "monospace",
                      }}
                    >
                      {s.purchaseCount}
                    </td>
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        fontFamily: "monospace",
                        fontWeight: 600,
                      }}
                    >
                      {fmtInr(s.totalAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h4
            style={{
              margin: "0 0 8px",
              fontSize: 13,
              color: "var(--muted)",
              fontWeight: 600,
            }}
          >
            Register
          </h4>
          <div style={tableWrap}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--surface-subtle)" }}>
                  <th style={th}>PO</th>
                  <th style={th}>Date</th>
                  <th style={th}>Supplier</th>
                  <th style={th}>Invoice</th>
                  <th style={th}>By</th>
                  <th style={{ ...th, textAlign: "right" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {purchases.purchases.map((p) => (
                  <tr key={p.id}>
                    <td style={td}>{p.purchaseNumber}</td>
                    <td style={{ ...td, color: "var(--muted)", fontSize: 12 }}>
                      {formatIndiaDateTime(p.createdAt)}
                    </td>
                    <td style={td}>{p.supplierName}</td>
                    <td style={td}>{p.invoiceNumber ?? "—"}</td>
                    <td style={td}>{p.createdByName}</td>
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        fontFamily: "monospace",
                        fontWeight: 600,
                      }}
                    >
                      {fmtInr(p.totalAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {reportKind === "supplier-payments" && supplierPayments ? (
        <section>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              marginBottom: 12,
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: 16,
                color: "var(--text)",
              }}
            >
              {activeReportLabel}
            </h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button
                type="button"
                style={btnSecondary}
                onClick={downloadSupplierPaymentsBySupplier}
              >
                CSV by supplier
              </button>
              <button
                type="button"
                style={btnSecondary}
                onClick={downloadSupplierPaymentsDetail}
              >
                CSV all payments
              </button>
            </div>
          </div>
          <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--muted)" }}>
            Cash and transfers recorded against supplier bills (partial payments). Rows are
            filtered by <strong>payment date</strong> in the range above, not purchase date.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
              gap: 10,
              marginBottom: 14,
            }}
          >
            {[
              ["Payments", String(supplierPayments.summary.paymentCount)],
              ["Total paid out", fmtInr(supplierPayments.summary.totalPaid)],
            ].map(([k, v]) => (
              <div
                key={k}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--surface-subtle)",
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--muted)",
                    fontWeight: 600,
                    marginBottom: 4,
                  }}
                >
                  {k}
                </div>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: "var(--text)",
                  }}
                >
                  {v}
                </div>
              </div>
            ))}
          </div>
          <h4
            style={{
              margin: "0 0 8px",
              fontSize: 13,
              color: "var(--muted)",
              fontWeight: 600,
            }}
          >
            By supplier
          </h4>
          <div style={{ ...tableWrap, maxHeight: 220, marginBottom: 16 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--surface-subtle)" }}>
                  <th style={th}>Supplier</th>
                  <th style={{ ...th, textAlign: "right" }}>Payments</th>
                  <th style={{ ...th, textAlign: "right" }}>Total paid</th>
                </tr>
              </thead>
              <tbody>
                {supplierPayments.bySupplier.map((s) => (
                  <tr key={s.supplierId}>
                    <td style={td}>{s.supplierName}</td>
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        fontFamily: "monospace",
                      }}
                    >
                      {s.paymentCount}
                    </td>
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        fontFamily: "monospace",
                        fontWeight: 600,
                      }}
                    >
                      {fmtInr(s.totalPaid)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h4
            style={{
              margin: "0 0 8px",
              fontSize: 13,
              color: "var(--muted)",
              fontWeight: 600,
            }}
          >
            Payment lines
          </h4>
          <div style={tableWrap}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--surface-subtle)" }}>
                  <th style={th}>Paid at</th>
                  <th style={th}>Supplier</th>
                  <th style={th}>Purchase</th>
                  <th style={{ ...th, textAlign: "right" }}>Amount</th>
                  <th style={th}>Recorded by</th>
                  <th style={th}>Note</th>
                </tr>
              </thead>
              <tbody>
                {supplierPayments.payments.map((p) => (
                  <tr key={p.id}>
                    <td style={{ ...td, color: "var(--muted)", fontSize: 12 }}>
                      {formatIndiaDateTime(p.paidAt)}
                    </td>
                    <td style={td}>{p.supplierName}</td>
                    <td style={td}>{p.purchaseNumber}</td>
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        fontFamily: "monospace",
                        fontWeight: 600,
                      }}
                    >
                      {fmtInr(p.amount)}
                    </td>
                    <td style={td}>{p.recordedByName}</td>
                    <td style={{ ...td, color: "var(--muted)", fontSize: 12 }}>
                      {p.note ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {reportKind === "gross-margin" && margin ? (
        <section>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              marginBottom: 12,
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: 16,
                color: "var(--text)",
              }}
            >
              {activeReportLabel}
            </h3>
            <button
              type="button"
              style={btnSecondary}
              onClick={downloadGrossMargin}
            >
              CSV
            </button>
          </div>
          <p
            style={{
              margin: "0 0 12px",
              fontSize: 12,
              color: "var(--muted)",
              lineHeight: 1.5,
            }}
          >
            {margin.disclaimer}
            {margin.linesMissingCost > 0
              ? ` ${margin.linesMissingCost} line(s) had no cost price (treated as zero).`
              : ""}
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
              gap: 10,
            }}
          >
            {[
              ["Sale lines", String(margin.lineCount)],
              ["Revenue", fmtInr(margin.revenue)],
              ["Est. cost", fmtInr(margin.estimatedCost)],
              ["Gross margin", fmtInr(margin.grossMargin)],
              ["Margin %", `${margin.marginPercent}%`],
            ].map(([k, v]) => (
              <div
                key={k}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--surface-subtle)",
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--muted)",
                    fontWeight: 600,
                    marginBottom: 4,
                  }}
                >
                  {k}
                </div>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: "var(--text)",
                  }}
                >
                  {v}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section
        style={{
          marginTop: 32,
          paddingTop: 24,
          borderTop: "1px solid var(--border)",
        }}
      >
        <h2
          style={{
            margin: "0 0 8px",
            fontSize: 18,
            fontWeight: 600,
            color: "var(--text)",
          }}
        >
          Scheduled owner reports
        </h2>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--muted)" }}>
          Automatic reports use Indian financial year quarters (Q1 Apr–Jun through
          Q4 Jan–Mar). {REPORT_STAGGER_NOTE} When a report is ready, an email
          with a link is sent to the owner address below.
        </p>

        {scheduleError ? (
          <p
            style={{
              margin: "0 0 12px",
              fontSize: 13,
              color: "var(--danger-text)",
            }}
          >
            {scheduleError}
          </p>
        ) : null}
        {scheduleSaved ? (
          <p
            style={{
              margin: "0 0 12px",
              fontSize: 13,
              color: "var(--success-text, var(--text))",
            }}
          >
            Schedule settings saved.
          </p>
        ) : null}

        {scheduleDraft ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              maxWidth: 720,
            }}
          >
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                Notification email
              </span>
              <input
                type="email"
                style={inputStyle}
                value={scheduleDraft.notifyEmail}
                onChange={(e) =>
                  setScheduleDraft((d) =>
                    d ? { ...d, notifyEmail: e.target.value } : d
                  )
                }
                placeholder="owner@example.com"
              />
            </label>

            {SCHEDULED_REPORT_ROWS.map((row) => (
              <div
                key={row.key}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 14px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--surface-subtle)",
                }}
              >
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    minWidth: 200,
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--text)",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={scheduleDraft[row.enabledKey]}
                    onChange={(e) =>
                      setScheduleDraft((d) =>
                        d
                          ? {
                              ...d,
                              [row.enabledKey]: e.target.checked,
                              [row.periodKey]: e.target.checked
                                ? d[row.periodKey] ?? "MONTHLY"
                                : null,
                            }
                          : d
                      )
                    }
                  />
                  {row.label}
                </label>
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--muted)",
                    minWidth: 72,
                  }}
                  title="Run time when this frequency is due (IST)"
                >
                  {reportSlotTimeLabel(row.reportType)}
                </span>
                <select
                  style={{ ...inputStyle, height: 36, minWidth: 140 }}
                  disabled={!scheduleDraft[row.enabledKey]}
                  value={scheduleDraft[row.periodKey] ?? "MONTHLY"}
                  onChange={(e) =>
                    setScheduleDraft((d) =>
                      d
                        ? {
                            ...d,
                            [row.periodKey]: e.target.value as ReportPeriod,
                          }
                        : d
                    )
                  }
                >
                  {PERIOD_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}

            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button
                type="button"
                style={{
                  ...btnSecondary,
                  height: 38,
                  background: "var(--accent)",
                  color: "var(--accent-text, #fff)",
                  border: "none",
                }}
                disabled={scheduleSaving}
                onClick={() => void saveScheduleConfig()}
              >
                {scheduleSaving ? "Saving…" : "Save schedule"}
              </button>
              {scheduleConfig?.updatedAt ? (
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  Last saved {formatIndiaDateTime(scheduleConfig.updatedAt)}
                </span>
              ) : null}
            </div>
          </div>
        ) : runsLoading ? (
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
            Loading schedule settings…
          </p>
        ) : null}

        <h3
          style={{
            margin: "24px 0 12px",
            fontSize: 15,
            fontWeight: 600,
            color: "var(--text)",
          }}
        >
          Report history
        </h3>
        {runsLoading && reportRuns.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
            Loading history…
          </p>
        ) : reportRuns.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
            No scheduled reports generated yet.
          </p>
        ) : (
          <div style={tableWrap}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Generated", "Report", "Frequency", "Period", "Status", ""].map(
                    (h) => (
                      <th key={h || "action"} style={th}>
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {reportRuns.map((r) => (
                  <tr key={r.id}>
                    <td style={td}>{formatIndiaDateTime(r.asOf)}</td>
                    <td style={td}>{reportTypeDisplay(r.reportType)}</td>
                    <td style={td}>{periodDisplay(r.period)}</td>
                    <td style={td}>{r.periodLabel ?? "—"}</td>
                    <td style={td}>{r.status}</td>
                    <td style={td}>
                      {r.status === "COMPLETED" ? (
                        <button
                          type="button"
                          style={btnSecondary}
                          onClick={() => setViewRunId(r.id)}
                        >
                          View
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {viewRunId ? (
        <SavedReportViewer
          runId={viewRunId}
          onClose={() => setViewRunId(null)}
        />
      ) : null}
    </div>
  );
}
