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
  SalesByProductReport,
  SalesSummaryReport,
} from "../api/types";

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
  | "sales-by-product"
  | "purchases"
  | "gross-margin";

const REPORT_OPTIONS: { value: ReportKind; label: string }[] = [
  { value: "sales-summary", label: "Sales summary & register" },
  { value: "sales-by-product", label: "Sales by product" },
  { value: "purchases", label: "Purchases" },
  { value: "gross-margin", label: "Gross margin" },
];

export function ReportingPage() {
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
  const [purchases, setPurchases] = useState<PurchasesReport | null>(null);
  const [margin, setMargin] = useState<GrossMarginReport | null>(null);

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
        case "sales-by-product": {
          const data = await api.getReportSalesByProduct(from, to);
          setByProduct(data);
          break;
        }
        case "purchases": {
          const data = await api.getReportPurchases(from, to);
          setPurchases(data);
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
        case "sales-by-product":
          setByProduct(null);
          break;
        case "purchases":
          setPurchases(null);
          break;
        case "gross-margin":
          setMargin(null);
          break;
      }
    } finally {
      setLoading(false);
    }
  }, [reportKind, from, to]);

  useEffect(() => {
    void loadActiveReport();
  }, [loadActiveReport]);

  const activeReportLabel =
    REPORT_OPTIONS.find((o) => o.value === reportKind)?.label ?? "Report";

  const hasActiveData =
    (reportKind === "sales-summary" && salesSummary !== null) ||
    (reportKind === "sales-by-product" && byProduct !== null) ||
    (reportKind === "purchases" && purchases !== null) ||
    (reportKind === "gross-margin" && margin !== null);

  const downloadSalesSummaryMetrics = () => {
    if (!salesSummary) return;
    const { summary } = salesSummary;
    downloadCsvFile(`sales-summary-metrics_${from}_${to}.csv`, [
      ["metric", "value"],
      ["saleCount", String(summary.saleCount)],
      ["subtotal", summary.subtotal],
      ["discountAmount", summary.discountAmount],
      ["taxAmount", summary.taxAmount],
      ["totalAmount", summary.totalAmount],
      ["paidAmount", summary.paidAmount],
      ["balanceAmount", summary.balanceAmount],
      ["averageTicket", summary.averageTicket],
    ]);
  };

  const downloadSalesRegister = () => {
    if (!salesSummary) return;
    downloadCsvFile(`sales-register_${from}_${to}.csv`, [
      [
        "saleNumber",
        "createdAt",
        "customer",
        "cashier",
        "total",
        "paid",
        "balance",
      ],
      ...salesSummary.sales.map((s) => [
        s.saleNumber,
        s.createdAt,
        s.customerLabel,
        s.cashierName,
        s.totalAmount,
        s.paidAmount,
        s.balanceAmount,
      ]),
    ]);
  };

  const downloadSalesByProduct = () => {
    if (!byProduct) return;
    downloadCsvFile(`sales-by-product_${from}_${to}.csv`, [
      [
        "sku",
        "name",
        "category",
        "brand",
        "quantityInBase",
        "lineCount",
        "revenue",
      ],
      ...byProduct.products.map((p) => [
        p.sku,
        p.name,
        p.category,
        p.brand,
        p.quantityInBase,
        String(p.lineCount),
        p.revenue,
      ]),
    ]);
  };

  const downloadPurchasesBySupplier = () => {
    if (!purchases) return;
    downloadCsvFile(`purchases-by-supplier_${from}_${to}.csv`, [
      ["supplierName", "purchaseCount", "totalAmount"],
      ...purchases.bySupplier.map((s) => [
        s.supplierName,
        String(s.purchaseCount),
        s.totalAmount,
      ]),
    ]);
  };

  const downloadPurchasesRegister = () => {
    if (!purchases) return;
    downloadCsvFile(`purchases-register_${from}_${to}.csv`, [
      [
        "purchaseNumber",
        "createdAt",
        "supplierName",
        "invoiceNumber",
        "invoiceDate",
        "createdByName",
        "subtotal",
        "taxAmount",
        "totalAmount",
      ],
      ...purchases.purchases.map((p) => [
        p.purchaseNumber,
        p.createdAt,
        p.supplierName,
        p.invoiceNumber ?? "",
        p.invoiceDate ?? "",
        p.createdByName,
        p.subtotal,
        p.taxAmount,
        p.totalAmount,
      ]),
    ]);
  };

  const downloadGrossMargin = () => {
    if (!margin) return;
    downloadCsvFile(`gross-margin_${from}_${to}.csv`, [
      [
        "lineCount",
        "linesMissingCost",
        "revenue",
        "estimatedCost",
        "grossMargin",
        "marginPercent",
      ],
      [
        String(margin.lineCount),
        String(margin.linesMissingCost),
        margin.revenue,
        margin.estimatedCost,
        margin.grossMargin,
        margin.marginPercent,
      ],
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
          refresh. Gross margin uses product cost × quantity sold (approximate).
          CSV exports use UTF-8 with BOM for Excel.
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
            color: loading ? "var(--muted)" : "#fff",
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
    </div>
  );
}
