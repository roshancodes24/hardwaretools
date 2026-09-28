import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { api } from "../api/client";
import { isApiError } from "../api/errors";
import type { SaleDetail, SaleSearchResult } from "../api/types";
import { Toast } from "../components/Toast";
import { TaxInvoiceModal } from "../invoice/TaxInvoiceModal";
import { formatIndiaDateTime } from "../lib/indiaTime";
import type { ConfirmOptions } from "../useConfirm";

const inputStyle: CSSProperties = {
  width: "100%",
  maxWidth: 320,
  padding: "0 12px",
  height: 40,
  borderRadius: 10,
  border: "1px solid var(--border)",
  fontSize: 14,
  outline: "none",
  background: "var(--surface)",
  color: "var(--text)",
  boxSizing: "border-box",
};

export function ReprintInvoicePage({
  confirm,
  canCancel,
  onInventoryRestored,
}: {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  canCancel: boolean;
  onInventoryRestored?: () => void;
}) {
  const [searchQ, setSearchQ] = useState("");
  const [results, setResults] = useState<SaleSearchResult[]>([]);
  const [showingSearch, setShowingSearch] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{
    type: "success" | "error";
    msg: string;
  } | null>(null);
  const [invoiceSale, setInvoiceSale] = useState<SaleDetail | null>(null);

  const loadRecent = useCallback(async () => {
    setError(null);
    setSearchLoading(true);
    try {
      const rows = await api.listRecentSales(10);
      setResults(rows);
      setShowingSearch(false);
    } catch (e) {
      setResults([]);
      setError(isApiError(e) ? e.message : "Could not load recent invoices");
    } finally {
      setSearchLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  const openSale = useCallback(async (id: string) => {
    setError(null);
    setOpeningId(id);
    try {
      const sale = await api.getSale(id);
      setInvoiceSale(sale);
    } catch (e) {
      setError(isApiError(e) ? e.message : "Could not load sale");
    } finally {
      setOpeningId(null);
    }
  }, []);

  const cancelSale = useCallback(
    async (row: SaleSearchResult) => {
      const ok = await confirm({
        title: `Cancel invoice ${row.saleNumber}?`,
        message:
          "This will cancel the invoice and restore all items from this sale to inventory. This action cannot be undone.",
        confirmLabel: "Cancel Invoice",
        cancelLabel: "Keep Invoice",
        variant: "danger",
      });
      if (!ok) return;
      setError(null);
      setStatusMsg(null);
      setCancellingId(row.id);
      try {
        const sale = await api.cancelSale(row.id);
        setResults((rows) =>
          rows.map((item) =>
            item.id === sale.id ? { ...item, status: sale.status } : item
          )
        );
        setInvoiceSale((open) => (open?.id === sale.id ? sale : open));
        setStatusMsg({
          type: "success",
          msg: `Invoice ${sale.saleNumber} cancelled and inventory restored.`,
        });
        onInventoryRestored?.();
      } catch (e) {
        setStatusMsg({
          type: "error",
          msg: isApiError(e) ? e.message : "Could not cancel invoice",
        });
      } finally {
        setCancellingId(null);
      }
    },
    [confirm, onInventoryRestored]
  );

  const runSearch = async () => {
    const q = searchQ.trim();
    if (q.length < 2) {
      void loadRecent();
      return;
    }
    setError(null);
    setSearchLoading(true);
    setResults([]);
    try {
      const rows = await api.searchSales({ q });
      setShowingSearch(true);
      setResults(rows);
    } catch (e) {
      setError(isApiError(e) ? e.message : "Search failed");
    } finally {
      setSearchLoading(false);
    }
  };

  const fmt = (s: string) =>
    `₹${Number(s).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  return (
    <>
      {invoiceSale ? (
        <TaxInvoiceModal
          sale={invoiceSale}
          onClose={() => setInvoiceSale(null)}
        />
      ) : null}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 20,
          maxWidth: 880,
          width: "100%",
        }}
      >
        <Toast status={statusMsg} />
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: "var(--text)" }}>
            Invoices
          </h2>
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--muted)" }}>
            The latest invoices are listed below. Search by customer name, phone, or part of
            the sale number to narrow the list. Open a row to review or print. Tax invoice
            layout is used when the sale was recorded as a tax invoice; otherwise the standard
            bill without tax detail lines is shown.
          </p>
        </div>

        {error ? (
          <div
            style={{
              padding: "12px 14px",
              borderRadius: 10,
              background: "rgba(220, 38, 38, 0.08)",
              border: "1px solid rgba(220, 38, 38, 0.25)",
              color: "var(--danger)",
              fontSize: 14,
            }}
          >
            {error}
          </div>
        ) : null}

        <section
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 18,
          }}
        >
          <h3 style={{ margin: "0 0 12px", fontSize: 15, color: "var(--text)" }}>
            {showingSearch ? "Search results" : "Recent invoices"}
          </h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <input
              type="text"
              placeholder="Name, phone, or sale number fragment"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void runSearch()}
              style={{ ...inputStyle, maxWidth: 400 }}
              aria-label="Search sales"
            />
            <button
              type="button"
              disabled={searchLoading}
              onClick={() => void runSearch()}
              style={{
                height: 40,
                padding: "0 18px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--surface-subtle)",
                color: "var(--text)",
                fontWeight: 600,
                fontSize: 14,
                cursor: searchLoading ? "wait" : "pointer",
              }}
            >
              {searchLoading ? "Searching…" : "Search"}
            </button>
          </div>

          {!searchLoading && results.length === 0 ? (
            <p style={{ margin: "16px 0 0", fontSize: 13, color: "var(--muted)" }}>
              {showingSearch ? "No matching sales found." : "No invoices yet."}
            </p>
          ) : null}

          {results.length > 0 ? (
            <div style={{ marginTop: 16, overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                    <th style={{ padding: "8px 6px", color: "var(--muted)" }}>Invoice</th>
                    <th style={{ padding: "8px 6px", color: "var(--muted)" }}>Date</th>
                    <th style={{ padding: "8px 6px", color: "var(--muted)" }}>Customer</th>
                    <th style={{ padding: "8px 6px", color: "var(--muted)", textAlign: "right" }}>
                      Total
                    </th>
                    <th style={{ padding: "8px 6px" }} />
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "10px 6px", fontWeight: 600 }}>{r.saleNumber}</td>
                      <td style={{ padding: "10px 6px", color: "var(--muted)" }}>
                        {formatIndiaDateTime(r.createdAt)}
                      </td>
                      <td style={{ padding: "10px 6px" }}>{r.customerLabel}</td>
                      <td style={{ padding: "10px 6px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {fmt(r.totalAmount)}
                      </td>
                      <td style={{ padding: "10px 6px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <button
                            type="button"
                            disabled={openingId !== null}
                            onClick={() => void openSale(r.id)}
                            style={{
                              padding: "6px 12px",
                              borderRadius: 8,
                              border: "none",
                              background: "var(--accent)",
                              color: "var(--on-accent)",
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: openingId ? "wait" : "pointer",
                              opacity: openingId && openingId !== r.id ? 0.65 : 1,
                            }}
                          >
                            {openingId === r.id ? "…" : "Invoice"}
                          </button>
                          {canCancel && r.status === "COMPLETED" ? (
                            <button
                              type="button"
                              disabled={cancellingId !== null}
                              onClick={() => void cancelSale(r)}
                              style={{
                                padding: "6px 12px",
                                borderRadius: 8,
                                border: "1px solid var(--danger-border-solid)",
                                background: "var(--surface)",
                                fontSize: 12,
                                fontWeight: 600,
                                color: "var(--danger-text)",
                                cursor: cancellingId ? "wait" : "pointer",
                                opacity: cancellingId && cancellingId !== r.id ? 0.65 : 1,
                              }}
                            >
                              Cancel
                            </button>
                          ) : null}
                          {r.status === "CANCELLED" ? (
                            <span
                              style={{
                                padding: "6px 12px",
                                borderRadius: 8,
                                border: "1px solid var(--border)",
                                background: "var(--surface-subtle)",
                                fontSize: 12,
                                fontWeight: 600,
                                color: "var(--muted)",
                                cursor: "default",
                                userSelect: "none",
                              }}
                            >
                              Cancelled
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    </>
  );
}
