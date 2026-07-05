import { useCallback, useState, type CSSProperties } from "react";
import { api } from "../api/client";
import { isApiError } from "../api/errors";
import type { SaleDetail, SaleSearchResult } from "../api/types";
import { TaxInvoiceModal } from "../invoice/TaxInvoiceModal";
import { formatIndiaDateTime } from "../lib/indiaTime";

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

export function ReprintInvoicePage() {
  const [searchQ, setSearchQ] = useState("");
  const [results, setResults] = useState<SaleSearchResult[]>([]);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoiceSale, setInvoiceSale] = useState<SaleDetail | null>(null);

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

  const runSearch = async () => {
    const q = searchQ.trim();
    if (q.length < 2) {
      setError("Search needs at least 2 characters.");
      return;
    }
    setError(null);
    setSearchLoading(true);
    setResults([]);
    try {
      const rows = await api.searchSales({ q });
      setResults(rows);
      if (rows.length === 0) {
        setError("No matching sales found.");
      }
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
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: "var(--text)" }}>
            Invoices
          </h2>
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--muted)" }}>
            Search by customer name, phone, or part of the sale number. Open a row to review
            or print. Tax invoice layout is used when the sale was recorded as a tax invoice;
            otherwise the standard bill without tax detail lines is shown.
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
            Search sales
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
