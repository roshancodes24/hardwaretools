import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { isApiError } from "../api/errors";
import { formatIndiaDateTime } from "../lib/indiaTime";
import type {
  CustomerOutstandingReport,
  InventorySnapshotReport,
  SavedCustomerOutstandingPayload,
  SavedInventoryReportPayload,
  SavedReportRunDetail,
  SavedSalesReportPayload,
  SavedSupplierOutstandingPayload,
  SupplierOutstandingReport,
  SalesSummaryReport,
  GrossMarginReport,
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
  maxHeight: 420,
  background: "var(--surface)",
};

type Props = {
  runId: string;
  onClose?: () => void;
};

function SalesSavedView({
  sales,
  grossMargin,
  onCsv,
}: {
  sales: SalesSummaryReport;
  grossMargin: GrossMarginReport;
  onCsv: () => void;
}) {
  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <h4 style={{ margin: 0, fontSize: 15, color: "var(--text)" }}>
          Sales summary
        </h4>
        <button type="button" style={btnSecondary} onClick={onCsv}>
          CSV
        </button>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          gap: 10,
          marginBottom: 16,
        }}
      >
        {[
          ["Sales", String(sales.summary.saleCount)],
          ["Total", fmtInr(sales.summary.totalAmount)],
          ["Paid", fmtInr(sales.summary.paidAmount)],
          ["Balance", fmtInr(sales.summary.balanceAmount)],
          ["Avg ticket", fmtInr(sales.summary.averageTicket)],
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
            <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>
              {k}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
              {v}
            </div>
          </div>
        ))}
      </div>
      <div style={tableWrap}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Sale #", "Date", "Total", "Paid", "Balance"].map((h) => (
                <th key={h} style={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sales.sales.map((s) => (
              <tr key={s.id}>
                <td style={td}>{s.saleNumber}</td>
                <td style={td}>{formatIndiaDateTime(s.createdAt)}</td>
                <td style={td}>{fmtInr(s.totalAmount)}</td>
                <td style={td}>{fmtInr(s.paidAmount)}</td>
                <td style={td}>{fmtInr(s.balanceAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p
        style={{
          margin: "16px 0 8px",
          fontSize: 12,
          color: "var(--muted)",
        }}
      >
        Gross margin: {fmtInr(grossMargin.grossMargin)} ({grossMargin.marginPercent}
        %) on {fmtInr(grossMargin.revenue)} revenue.
      </p>
    </>
  );
}

function InventorySavedView({
  data,
  onCsv,
}: {
  data: InventorySnapshotReport;
  onCsv: () => void;
}) {
  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <h4 style={{ margin: 0, fontSize: 15, color: "var(--text)" }}>
          Inventory snapshot
        </h4>
        <button type="button" style={btnSecondary} onClick={onCsv}>
          CSV
        </button>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          gap: 10,
          marginBottom: 16,
        }}
      >
        {[
          ["Products", String(data.summary.productCount)],
          ["Total units", data.summary.totalUnits],
          ["Stock value", fmtInr(data.summary.totalStockValue)],
          ["Out of stock", String(data.summary.outOfStockCount)],
          ["Below reorder", String(data.summary.belowReorderCount)],
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
            <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>
              {k}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
              {v}
            </div>
          </div>
        ))}
      </div>
      <div style={tableWrap}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["SKU", "Name", "Stock", "Unit", "Value", "Flags"].map((h) => (
                <th key={h} style={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.products.map((p) => (
              <tr key={p.sku}>
                <td style={td}>{p.sku}</td>
                <td style={td}>{p.name}</td>
                <td style={td}>{p.currentStock}</td>
                <td style={td}>{p.baseUnitCode}</td>
                <td style={td}>{fmtInr(p.stockValue)}</td>
                <td style={td}>
                  {p.outOfStock
                    ? "Out of stock"
                    : p.belowReorder
                      ? "Below reorder"
                      : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SupplierOutstandingSavedView({
  data,
  onCsv,
}: {
  data: SupplierOutstandingReport;
  onCsv: () => void;
}) {
  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <h4 style={{ margin: 0, fontSize: 15, color: "var(--text)" }}>
          Supplier outstanding
        </h4>
        <button type="button" style={btnSecondary} onClick={onCsv}>
          CSV
        </button>
      </div>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--muted)" }}>
        {data.summary.supplierCount} supplier(s),{" "}
        {fmtInr(data.summary.totalBalance)} total balance.
      </p>
      <div style={tableWrap}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Supplier", "Invoices", "Balance"].map((h) => (
                <th key={h} style={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.suppliers.map((s) => (
              <tr key={s.supplierId}>
                <td style={td}>{s.supplierName}</td>
                <td style={td}>{s.invoiceCount}</td>
                <td style={td}>{fmtInr(s.balanceAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function CustomerOutstandingSavedView({
  data,
  onCsv,
}: {
  data: CustomerOutstandingReport;
  onCsv: () => void;
}) {
  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <h4 style={{ margin: 0, fontSize: 15, color: "var(--text)" }}>
          Customer outstanding
        </h4>
        <button type="button" style={btnSecondary} onClick={onCsv}>
          CSV
        </button>
      </div>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--muted)" }}>
        {data.summary.customerCount} customer(s),{" "}
        {fmtInr(data.summary.totalBalance)} total balance.
      </p>
      <div style={tableWrap}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Customer", "Sales", "Balance"].map((h) => (
                <th key={h} style={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.customers.map((c, i) => (
              <tr key={c.customerId ?? `walkin-${i}`}>
                <td style={td}>{c.customerLabel}</td>
                <td style={td}>{c.saleCount}</td>
                <td style={td}>{fmtInr(c.balanceAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function SavedReportViewer({ runId, onClose }: Props) {
  const [run, setRun] = useState<SavedReportRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const data = await api.getScheduledReportRun(runId);
        if (!cancelled) setRun(data);
      } catch (e) {
        if (!cancelled) {
          setError(isApiError(e) ? e.message : "Failed to load saved report");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const downloadSalesCsv = useCallback(() => {
    const payload = run?.payload as SavedSalesReportPayload | undefined;
    if (!payload?.sales) return;
    const rows: string[][] = [
      ["Sale #", "Date", "Subtotal", "Tax", "Total", "Paid", "Balance"],
      ...payload.sales.sales.map((s) => [
        s.saleNumber,
        s.createdAt,
        s.subtotal,
        s.taxAmount,
        s.totalAmount,
        s.paidAmount,
        s.balanceAmount,
      ]),
    ];
    downloadCsvFile(`sales-report-${runId}.csv`, rows);
  }, [run, runId]);

  const downloadInventoryCsv = useCallback(() => {
    const payload = run?.payload as SavedInventoryReportPayload | undefined;
    if (!payload?.products) return;
    const rows: string[][] = [
      [
        "SKU",
        "Name",
        "Category",
        "Stock",
        "Unit",
        "Avg cost",
        "Stock value",
        "Out of stock",
        "Below reorder",
      ],
      ...payload.products.map((p) => [
        p.sku,
        p.name,
        p.category,
        p.currentStock,
        p.baseUnitCode,
        p.avgCostPrice ?? p.costPrice ?? "",
        p.stockValue,
        p.outOfStock ? "Yes" : "No",
        p.belowReorder ? "Yes" : "No",
      ]),
    ];
    downloadCsvFile(`inventory-report-${runId}.csv`, rows);
  }, [run, runId]);

  const downloadSupplierCsv = useCallback(() => {
    const payload = run?.payload as SavedSupplierOutstandingPayload | undefined;
    if (!payload?.suppliers) return;
    const rows: string[][] = [
      ["Supplier", "Invoices", "Total", "Paid", "Balance"],
      ...payload.suppliers.map((s) => [
        s.supplierName,
        String(s.invoiceCount),
        s.totalAmount,
        s.paidAmount,
        s.balanceAmount,
      ]),
    ];
    downloadCsvFile(`supplier-outstanding-${runId}.csv`, rows);
  }, [run, runId]);

  const downloadCustomerCsv = useCallback(() => {
    const payload = run?.payload as SavedCustomerOutstandingPayload | undefined;
    if (!payload?.customers) return;
    const rows: string[][] = [
      ["Customer", "Sales", "Total", "Paid", "Balance"],
      ...payload.customers.map((c) => [
        c.customerLabel,
        String(c.saleCount),
        c.totalAmount,
        c.paidAmount,
        c.balanceAmount,
      ]),
    ];
    downloadCsvFile(`customer-outstanding-${runId}.csv`, rows);
  }, [run, runId]);

  if (loading) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
        Loading saved report…
      </p>
    );
  }

  if (error || !run) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: "var(--danger-text)" }}>
        {error ?? "Report not found"}
      </p>
    );
  }

  if (run.status !== "COMPLETED" || !run.payload) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
        Report status: {run.status}
        {run.errorMessage ? ` — ${run.errorMessage}` : ""}
      </p>
    );
  }

  const meta = (run.payload as { meta?: SavedSalesReportPayload["meta"] }).meta;

  return (
    <section
      style={{
        marginTop: 24,
        padding: "18px 20px",
        borderRadius: 12,
        border: "1px solid var(--border)",
        background: "var(--surface)",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 16,
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 17, color: "var(--text)" }}>
            {meta?.reportTypeLabel ?? run.reportType}
          </h3>
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--muted)" }}>
            {meta?.periodLabel ?? run.period} · Generated{" "}
            {formatIndiaDateTime(run.asOf)}
          </p>
        </div>
        {onClose ? (
          <button type="button" style={btnSecondary} onClick={onClose}>
            Close
          </button>
        ) : null}
      </div>

      {run.reportType === "SALES" ? (
        <SalesSavedView
          sales={(run.payload as SavedSalesReportPayload).sales}
          grossMargin={(run.payload as SavedSalesReportPayload).grossMargin}
          onCsv={downloadSalesCsv}
        />
      ) : null}
      {run.reportType === "INVENTORY" ? (
        <InventorySavedView
          data={run.payload as SavedInventoryReportPayload}
          onCsv={downloadInventoryCsv}
        />
      ) : null}
      {run.reportType === "SUPPLIER_OUTSTANDING" ? (
        <SupplierOutstandingSavedView
          data={run.payload as SavedSupplierOutstandingPayload}
          onCsv={downloadSupplierCsv}
        />
      ) : null}
      {run.reportType === "CUSTOMER_OUTSTANDING" ? (
        <CustomerOutstandingSavedView
          data={run.payload as SavedCustomerOutstandingPayload}
          onCsv={downloadCustomerCsv}
        />
      ) : null}
    </section>
  );
}
