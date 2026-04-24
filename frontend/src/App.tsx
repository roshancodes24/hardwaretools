import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
} from "react";
import { api, getAuthToken, logoutAuth, setActingUserId } from "./api/client";
import { isApiError } from "./api/errors";
import type {
  ApiCustomer,
  ApiProduct,
  ApiPromotion,
  ApiSupplier,
  CreateSaleBody,
  OutstandingSaleSummary,
  PurchaseListRow,
  SaleDetail,
  SessionUserRow,
} from "./api/types";
import { TaxInvoiceModal } from "./invoice/TaxInvoiceModal";
import { allocateLineDiscounts } from "./lib/allocateLineDiscounts";
import {
  lineErrorsFromDetails,
  mapAdjustmentDetailField,
  recordFieldErrors,
} from "./lib/formErrors";
import {
  formatIndiaDateLong,
  formatIndiaDateTime,
  ymdInIndia,
} from "./lib/indiaTime";
import {
  parsePurchaseLinesImportFile,
  PURCHASE_IMPORT_TEMPLATE_CSV,
  resolvePurchaseImportPatches,
} from "./lib/importPurchaseLines";
import { mapApiProduct, type UiProduct } from "./lib/mapProduct";
import { sanitizeGstinInput } from "./lib/gstinInput";
import { sanitizePhoneDigits } from "./lib/phoneInput";
import { HomeView } from "./HomeView";
import { ConfirmModal } from "./ConfirmModal";
import { PromotionsPage } from "./pages/PromotionsPage";
import { LoginPage } from "./pages/LoginPage";
import { ProductsPage } from "./pages/ProductsPage";
import { ReportingPage } from "./pages/ReportingPage";
import { ReprintInvoicePage } from "./pages/ReprintInvoicePage";
import { FEATURE_FLAGS } from "./featureFlags";
import { Sidebar, type Tab } from "./Sidebar";
import { useConfirm } from "./useConfirm";

// ═══════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════
const fmt = (n: number) =>
  `₹${Number(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const stockStatus = (p: UiProduct): "ok" | "low" | "out" =>
  p.stock === 0 ? "out" : p.stock <= p.lowStock ? "low" : "ok";

type InventorySortKey =
  | "sku"
  | "name"
  | "category"
  | "price"
  | "stock"
  | "unit"
  | "status";

function statusSortRank(p: UiProduct): number {
  const st = stockStatus(p);
  if (st === "out") return 0;
  if (st === "low") return 1;
  return 2;
}

function compareInventoryRows(
  a: UiProduct,
  b: UiProduct,
  key: InventorySortKey,
  dir: "asc" | "desc"
): number {
  const sign = dir === "asc" ? 1 : -1;
  let cmp = 0;
  switch (key) {
    case "sku":
      cmp = a.sku.localeCompare(b.sku, undefined, { sensitivity: "base" });
      break;
    case "name":
      cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      break;
    case "category":
      cmp = a.category.localeCompare(b.category, undefined, {
        sensitivity: "base",
      });
      break;
    case "price":
      cmp = a.price - b.price;
      break;
    case "stock":
      cmp = a.stock - b.stock;
      break;
    case "unit":
      cmp = a.unit.localeCompare(b.unit, undefined, { sensitivity: "base" });
      break;
    case "status":
      cmp = statusSortRank(a) - statusSortRank(b);
      break;
  }
  if (cmp !== 0) return sign * cmp;
  return a.sku.localeCompare(b.sku, undefined, { sensitivity: "base" });
}

// ═══════════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════════════
function Badge({ status }: { status: "ok" | "low" | "out" }) {
  const map = {
    ok: { bg: "#dcfce7", color: "#16a34a", label: "In Stock" },
    low: { bg: "#fef3c7", color: "#d97706", label: "Low Stock" },
    out: { bg: "#fee2e2", color: "#dc2626", label: "Out of Stock" },
  };
  const s = map[status];
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        fontSize: 11,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 4,
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}

function Toast({
  status,
}: {
  status: { type: "success" | "error"; msg: string } | null;
}) {
  if (!status) return null;
  return (
    <div
      style={{
        padding: "10px 14px",
        borderRadius: 8,
        fontSize: 13,
        background: status.type === "success" ? "#dcfce7" : "#fee2e2",
        color: status.type === "success" ? "var(--accent)" : "var(--danger)",
      }}
    >
      {status.msg}
    </div>
  );
}

function FormErrorBanner({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div
      style={{
        background: "#fef2f2",
        color: "#b91c1c",
        padding: "8px 10px",
        borderRadius: 8,
        fontSize: 12,
        lineHeight: 1.45,
        border: "1px solid #fecaca",
      }}
    >
      {text}
    </div>
  );
}

function FieldWrap({
  label,
  children,
  error,
  errorId,
}: {
  label: string;
  children: ReactNode;
  error?: string;
  errorId?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 13, fontWeight: 500, color: "#44403c" }}>
        {label}
      </label>
      {children}
      {error ? (
        <span id={errorId} style={{ fontSize: 12, color: "var(--danger)" }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

const inputStyle: CSSProperties = {
  height: 38,
  padding: "0 12px",
  border: "1px solid var(--border)",
  borderRadius: 10,
  fontSize: 14,
  outline: "none",
  background: "var(--surface)",
  color: "var(--text)",
};

type CartLine = UiProduct & { qty: number };

function OutstandingView({ actingUserId }: { actingUserId: string }) {
  const recordedById = actingUserId;
  const [rows, setRows] = useState<OutstandingSaleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<OutstandingSaleSummary | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payNote, setPayNote] = useState("");
  const [payLoading, setPayLoading] = useState(false);
  const [payMsg, setPayMsg] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getOutstandingSales();
      setRows(data);
    } catch (e) {
      setError(isApiError(e) ? e.message : "Failed to load outstanding sales");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (payFor) {
      setPayAmount(Number(payFor.balanceAmount).toFixed(2));
      setPayNote("");
      setPayMsg(null);
    }
  }, [payFor]);

  const submitPayment = async () => {
    if (!payFor || !recordedById) return;
    const amt = Number.parseFloat(payAmount.replace(/,/g, ""));
    if (!Number.isFinite(amt) || amt <= 0) {
      setPayMsg({ type: "err", text: "Enter a valid payment amount." });
      return;
    }
    const maxBal = Number(payFor.balanceAmount);
    if (amt > maxBal + 1e-6) {
      setPayMsg({ type: "err", text: "Amount cannot exceed balance due." });
      return;
    }
    setPayLoading(true);
    setPayMsg(null);
    try {
      await api.recordSalePayment(payFor.id, {
        amount: amt,
        createdById: recordedById,
        note: payNote.trim() || undefined,
      });
      setPayFor(null);
      await load();
    } catch (e) {
      setPayMsg({
        type: "err",
        text: isApiError(e) ? e.message : "Payment failed",
      });
    } finally {
      setPayLoading(false);
    }
  };

  if (!recordedById) {
    return (
      <div style={{ padding: 24, color: "var(--muted)", fontSize: 14 }}>
        Session user IDs are missing, so payments cannot be recorded. Reload the
        app after the API is running.
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        maxWidth: 960,
        width: "100%",
      }}
    >
      <div>
        <h2 style={{ margin: 0, fontSize: 20, color: "var(--text)" }}>
          Outstanding balances
        </h2>
        <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--muted)" }}>
          Completed sales with an unpaid balance. Goods already left inventory;
          record payments here when the customer settles up.
        </p>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          style={{
            height: 36,
            padding: "0 14px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--text)",
            fontSize: 13,
            fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          Refresh
        </button>
        {loading ? (
          <span style={{ fontSize: 13, color: "var(--muted)" }}>Loading…</span>
        ) : null}
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

      {!loading && !error && rows.length === 0 ? (
        <div style={{ fontSize: 14, color: "var(--muted)" }}>
          No outstanding balances.
        </div>
      ) : null}

      {!loading && rows.length > 0 ? (
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 10,
            overflow: "hidden",
            background: "var(--surface)",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <thead>
              <tr style={{ background: "var(--surface-subtle)", color: "var(--muted)" }}>
                <th style={{ textAlign: "left", padding: "10px 12px" }}>Sale</th>
                <th style={{ textAlign: "left", padding: "10px 12px" }}>Date</th>
                <th style={{ textAlign: "left", padding: "10px 12px" }}>Customer</th>
                <th style={{ textAlign: "right", padding: "10px 12px" }}>Total</th>
                <th style={{ textAlign: "right", padding: "10px 12px" }}>Paid</th>
                <th style={{ textAlign: "right", padding: "10px 12px" }}>Balance</th>
                <th style={{ textAlign: "right", padding: "10px 12px" }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const cust =
                  r.customerName?.trim() ||
                  (r.customerPhone ? `Phone ${r.customerPhone}` : "—");
                const dt = new Date(r.createdAt);
                return (
                  <tr
                    key={r.id}
                    style={{ borderTop: "1px solid var(--border)" }}
                  >
                    <td style={{ padding: "10px 12px", fontWeight: 600 }}>
                      {r.saleNumber}
                    </td>
                    <td style={{ padding: "10px 12px", color: "var(--muted)" }}>
                      {Number.isNaN(dt.getTime())
                        ? r.createdAt
                        : formatIndiaDateTime(dt)}
                    </td>
                    <td style={{ padding: "10px 12px" }}>{cust}</td>
                    <td
                      style={{
                        padding: "10px 12px",
                        textAlign: "right",
                        fontFamily: "monospace",
                      }}
                    >
                      {fmt(Number(r.totalAmount))}
                    </td>
                    <td
                      style={{
                        padding: "10px 12px",
                        textAlign: "right",
                        fontFamily: "monospace",
                        color: "var(--muted)",
                      }}
                    >
                      {fmt(Number(r.paidAmount))}
                    </td>
                    <td
                      style={{
                        padding: "10px 12px",
                        textAlign: "right",
                        fontFamily: "monospace",
                        fontWeight: 600,
                        color: "var(--accent)",
                      }}
                    >
                      {fmt(Number(r.balanceAmount))}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>
                      <button
                        type="button"
                        onClick={() => setPayFor(r)}
                        style={{
                          height: 32,
                          padding: "0 12px",
                          borderRadius: 8,
                          border: "none",
                          background: "var(--accent)",
                          color: "#fff",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Pay
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {payFor ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="pay-modal-title"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => !payLoading && setPayFor(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !payLoading) setPayFor(null);
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 400,
              background: "var(--surface)",
              borderRadius: 12,
              border: "1px solid var(--border)",
              padding: 20,
              boxShadow: "0 20px 50px rgba(0,0,0,0.15)",
            }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <h3
              id="pay-modal-title"
              style={{ margin: "0 0 4px", fontSize: 17, color: "var(--text)" }}
            >
              Record payment
            </h3>
            <p style={{ margin: "0 0 16px", fontSize: 12, color: "var(--muted)" }}>
              {payFor.saleNumber} · Balance {fmt(Number(payFor.balanceAmount))}
            </p>
            <label
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--muted)",
                marginBottom: 6,
              }}
            >
              Amount
            </label>
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              style={{ ...inputStyle, width: "100%", boxSizing: "border-box", marginBottom: 12 }}
            />
            <label
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--muted)",
                marginBottom: 6,
              }}
            >
              Note (optional)
            </label>
            <input
              value={payNote}
              onChange={(e) => setPayNote(e.target.value)}
              placeholder="e.g. UPI ref"
              style={{ ...inputStyle, width: "100%", boxSizing: "border-box", marginBottom: 12 }}
            />
            {payMsg?.type === "err" ? (
              <div style={{ fontSize: 13, color: "var(--danger)", marginBottom: 12 }}>
                {payMsg.text}
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                disabled={payLoading}
                onClick={() => setPayFor(null)}
                style={{
                  height: 40,
                  padding: "0 16px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--surface-subtle)",
                  color: "var(--text)",
                  fontSize: 14,
                  cursor: payLoading ? "not-allowed" : "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={payLoading}
                onClick={() => void submitPayment()}
                style={{
                  height: 40,
                  padding: "0 16px",
                  borderRadius: 8,
                  border: "none",
                  background: "var(--accent)",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: payLoading ? "not-allowed" : "pointer",
                }}
              >
                {payLoading ? "Saving…" : "Apply payment"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// POS VIEW
// ═══════════════════════════════════════════════════════════════════
function POSView({
  products,
  promotions,
  actingUserId,
  customers,
  refreshCustomers,
  onSaleComplete,
}: {
  products: UiProduct[];
  promotions: ApiPromotion[];
  actingUserId: string;
  customers: ApiCustomer[];
  refreshCustomers: () => Promise<void>;
  onSaleComplete: () => Promise<void>;
}) {
  const promotionsUi = FEATURE_FLAGS.catalogPromotions;
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [page, setPage] = useState(1);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState(0);
  const [promotionCode, setPromotionCode] = useState("");
  const [status, setStatus] = useState<{
    type: "success" | "error";
    msg: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [lineErrors, setLineErrors] = useState<
    Map<number, Record<string, string>>
  >(() => new Map());

  /** Empty = walk-in / typing; set when cashier picks typeahead or saves a new customer */
  const [posCustomerId, setPosCustomerId] = useState("");
  /** Single field: search existing or type walk-in name */
  const [customerQuery, setCustomerQuery] = useState("");
  /** Optional phone for walk-in; cleared when a registered customer is selected */
  const [walkInPhone, setWalkInPhone] = useState("");
  /** Optional Party GST No for walk-in / save-customer; cleared with phone on pick/clear */
  const [walkInPartyGstNo, setWalkInPartyGstNo] = useState("");
  /** Optional State (tax invoice); cleared when picking a registered customer */
  const [walkInPartyState, setWalkInPartyState] = useState("");
  const [customerPhoneError, setCustomerPhoneError] = useState<string | null>(null);
  const [customerSuggestOpen, setCustomerSuggestOpen] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [amountPaidStr, setAmountPaidStr] = useState("");
  /** Freight / transport (added to charged total). */
  const [transportStr, setTransportStr] = useState("");
  const [taxInvoiceSale, setTaxInvoiceSale] = useState<SaleDetail | null>(null);
  /** If true, post-sale invoice opens in tax layout (chosen before Confirm Sale). */
  const [posTaxInvoice, setPosTaxInvoice] = useState(false);

  useEffect(() => {
    setFieldErrors({});
    setLineErrors(new Map());
  }, [cart, discount]);

  const categories = useMemo(
    () => ["All", ...new Set(products.map((p) => p.category))],
    [products]
  );

  const filtered = useMemo(
    () =>
      products.filter((p) => {
        const q = search.toLowerCase();
        return (
          (category === "All" || p.category === category) &&
          (p.name.toLowerCase().includes(q) ||
            p.sku.toLowerCase().includes(q))
        );
      }),
    [products, search, category]
  );

  const pageSize = 9;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));

  useEffect(() => {
    setPage(1);
  }, [search, category, products]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const pagedProducts = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page]);

  const typeaheadMatches = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    if (!q) return [];
    const qDigits = q.replace(/\D/g, "");
    return customers
      .filter((c) => {
        if (c.name.toLowerCase().includes(q)) return true;
        if ((c.email ?? "").toLowerCase().includes(q)) return true;
        const phone = (c.phone ?? "").replace(/\D/g, "");
        if (qDigits.length >= 2 && phone.includes(qDigits)) return true;
        if (q.length >= 2 && (c.phone ?? "").toLowerCase().includes(q))
          return true;
        return false;
      })
      .slice(0, 8);
  }, [customers, customerQuery]);

  const activePromotions = useMemo(() => {
    const now = new Date();
    return promotions.filter((p) => {
      if (!p.isActive) return false;
      const startsAt = p.startsAt ? new Date(p.startsAt) : null;
      const endsAt = p.endsAt ? new Date(p.endsAt) : null;
      if (startsAt && startsAt > now) return false;
      if (endsAt && endsAt < now) return false;
      return true;
    });
  }, [promotions]);

  const cartPromotion = useMemo(() => {
    const code = promotionCode.trim().toUpperCase();
    if (!code) return undefined;
    return activePromotions.find(
      (p) => p.scope === "CART" && (p.code ?? "").toUpperCase() === code
    );
  }, [activePromotions, promotionCode]);

  const productPromotionPctById = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of activePromotions) {
      if (p.scope !== "PRODUCT") continue;
      const pct = Number(p.percentage);
      for (const productId of p.productIds) {
        map.set(productId, Math.max(map.get(productId) ?? 0, pct));
      }
    }
    return map;
  }, [activePromotions]);

  const categoryPromotionPctByName = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of activePromotions) {
      if (p.scope !== "CATEGORY" || !p.category) continue;
      const pct = Number(p.percentage);
      map.set(p.category, Math.max(map.get(p.category) ?? 0, pct));
    }
    return map;
  }, [activePromotions]);

  const addToCart = (p: UiProduct) => {
    if (p.stock === 0) return;
    setCart((c) => {
      const existing = c.find((x) => x.id === p.id);
      return existing
        ? c.map((x) => (x.id === p.id ? { ...x, qty: x.qty + 1 } : x))
        : [...c, { ...p, qty: 1 }];
    });
  };

  const updateQty = (id: string, qtyVal: number) => {
    const line = cart.find((x) => x.id === id);
    if (!line) return;
    if (qtyVal <= 0) {
      setCart((c) => c.filter((x) => x.id !== id));
      return;
    }
    if (!line.allowsFractionalSale && !Number.isInteger(qtyVal)) {
      setStatus({
        type: "error",
        msg: `Fractional quantity not allowed for ${line.name}.`,
      });
      setTimeout(() => setStatus(null), 4000);
      return;
    }
    if (qtyVal > line.stock) {
      setStatus({
        type: "error",
        msg: `Max available: ${line.stock} ${line.unit}.`,
      });
      setTimeout(() => setStatus(null), 4000);
      return;
    }
    setCart((c) =>
      c.map((x) => (x.id === id ? { ...x, qty: qtyVal } : x))
    );
  };

  const lineSubtotals = useMemo(
    () => cart.map((x) => x.price * x.qty),
    [cart]
  );
  const linePromotionDiscounts = useMemo(
    () =>
      cart.map((line) => {
        const productPct = productPromotionPctById.get(line.id) ?? 0;
        const categoryPct = categoryPromotionPctByName.get(line.category) ?? 0;
        const pct = Math.max(productPct, categoryPct);
        return (line.price * line.qty * pct) / 100;
      }),
    [cart, productPromotionPctById, categoryPromotionPctByName]
  );
  const subtotal = lineSubtotals.reduce((s, x) => s + x, 0);
  const productCategoryPromoAmt = linePromotionDiscounts.reduce((s, x) => s + x, 0);
  const subtotalAfterLinePromos = subtotal - productCategoryPromoAmt;
  const discountAmt = subtotal * (discount / 100);
  const cartPromoPercent = cartPromotion ? Number(cartPromotion.percentage) : 0;
  const cartPromoAmt = subtotalAfterLinePromos * (cartPromoPercent / 100);
  const total = subtotalAfterLinePromos - discountAmt - cartPromoAmt;

  /** Same per-line discounts as checkout (for GST on taxable value). */
  const lineDiscountsForPos = useMemo(() => {
    if (cart.length === 0) return [];
    const orderLevelDiscountAmt = discountAmt + cartPromoAmt;
    const orderLevelDiscountPercent =
      subtotalAfterLinePromos > 0
        ? (orderLevelDiscountAmt / subtotalAfterLinePromos) * 100
        : 0;
    const orderLevelLineDiscounts = allocateLineDiscounts(
      lineSubtotals.map((v, i) => Math.max(0, v - linePromotionDiscounts[i])),
      orderLevelDiscountPercent
    );
    return linePromotionDiscounts.map(
      (v, i) => v + (orderLevelLineDiscounts[i] ?? 0)
    );
  }, [
    cart.length,
    lineSubtotals,
    linePromotionDiscounts,
    subtotalAfterLinePromos,
    discountAmt,
    cartPromoAmt,
  ]);

  const posGstTotals = useMemo(() => {
    if (!posTaxInvoice || cart.length === 0) return null;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    for (let i = 0; i < cart.length; i++) {
      const line = cart[i];
      const disc = lineDiscountsForPos[i] ?? 0;
      const taxable = Math.max(0, line.price * line.qty - disc);
      const c = line.cgstPercent ?? 0;
      const s = line.sgstPercent ?? 0;
      const ig = line.igstPercent ?? 0;
      cgst += (taxable * c) / 100;
      sgst += (taxable * s) / 100;
      igst += (taxable * ig) / 100;
    }
    return {
      cgst: Math.round(cgst * 100) / 100,
      sgst: Math.round(sgst * 100) / 100,
      igst: Math.round(igst * 100) / 100,
    };
  }, [posTaxInvoice, cart, lineDiscountsForPos]);

  /**
   * Sum of per-line GST exactly as sent to POST /sales (rounded per line).
   * Must match server taxAmount — do not use bucket-rounded posGstTotals here or
   * grandTotal vs paidAmount can drift by cents vs server total (+ transport).
   */
  const posLineTaxSum = useMemo(() => {
    if (!posTaxInvoice || cart.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < cart.length; i++) {
      const line = cart[i];
      const disc = lineDiscountsForPos[i] ?? 0;
      const taxable = Math.max(0, line.price * line.qty - disc);
      const rateSum =
        (line.cgstPercent ?? 0) +
        (line.sgstPercent ?? 0) +
        (line.igstPercent ?? 0);
      const lineTaxRaw = rateSum > 0 ? (taxable * rateSum) / 100 : 0;
      sum += Math.round(lineTaxRaw * 100) / 100;
    }
    return Math.round(sum * 100) / 100;
  }, [posTaxInvoice, cart, lineDiscountsForPos]);

  const transportAmount = useMemo(() => {
    const t = Number.parseFloat(String(transportStr).replace(/,/g, "").trim());
    if (!Number.isFinite(t) || t < 0) return 0;
    return Math.round(t * 100) / 100;
  }, [transportStr]);

  /** Charged total: net + line taxes (same formula as API) + transport. */
  const grandTotal = useMemo(() => {
    const base =
      !posTaxInvoice || cart.length === 0
        ? total
        : Math.round((total + posLineTaxSum) * 100) / 100;
    return Math.round((base + transportAmount) * 100) / 100;
  }, [total, posTaxInvoice, cart.length, posLineTaxSum, transportAmount]);

  const hasPosSaleDraft = useMemo(
    () =>
      cart.length > 0 ||
      Boolean(posCustomerId) ||
      Boolean(customerQuery.trim()) ||
      Boolean(walkInPhone.trim()) ||
      Boolean(walkInPartyGstNo.trim()) ||
      Boolean(walkInPartyState.trim()) ||
      discount > 0 ||
      Boolean(promotionCode.trim()) ||
      Boolean(transportStr.trim()) ||
      posTaxInvoice,
    [
      cart.length,
      posCustomerId,
      customerQuery,
      walkInPhone,
      walkInPartyGstNo,
      walkInPartyState,
      discount,
      promotionCode,
      transportStr,
      posTaxInvoice,
    ],
  );

  useEffect(() => {
    setAmountPaidStr(grandTotal > 0 ? grandTotal.toFixed(2) : "0.00");
  }, [grandTotal]);

  const pickRegisteredCustomer = (c: ApiCustomer) => {
    setPosCustomerId(c.id);
    setCustomerQuery("");
    setWalkInPhone("");
    setWalkInPartyGstNo("");
    setWalkInPartyState("");
    setCustomerPhoneError(null);
    setCustomerSuggestOpen(false);
  };

  const clearRegisteredCustomer = () => {
    setPosCustomerId("");
    setCustomerPhoneError(null);
    setCustomerSuggestOpen(false);
  };

  /** Reset cart + customer + discounts + transport + tax toggle + validation. */
  const resetPosSaleForm = useCallback((clearStatus: boolean) => {
    setCart([]);
    setDiscount(0);
    setPromotionCode("");
    setPosCustomerId("");
    setCustomerQuery("");
    setWalkInPhone("");
    setWalkInPartyGstNo("");
    setWalkInPartyState("");
    setTransportStr("");
    setPosTaxInvoice(false);
    setCustomerPhoneError(null);
    setCustomerSuggestOpen(false);
    setFieldErrors({});
    setLineErrors(new Map());
    if (clearStatus) setStatus(null);
  }, []);

  /** Registers typed walk-in as a customer only when cashier clicks Save — not on checkout */
  const saveCustomerFromWalkIn = async () => {
    const name = customerQuery.trim();
    const phone = sanitizePhoneDigits(walkInPhone);
    if (!name || posCustomerId || savingCustomer) return;
    if (!phone) {
      setCustomerPhoneError("Phone number is required to save a customer.");
      return;
    }
    if (phone.length !== 10) {
      setCustomerPhoneError("Phone must be exactly 10 digits.");
      return;
    }
    setCustomerPhoneError(null);
    setSavingCustomer(true);
    setStatus(null);
    try {
      const c = await api.createCustomer({
        name,
        phone,
        partyGstNo:
          posTaxInvoice && sanitizeGstinInput(walkInPartyGstNo, 20)
            ? sanitizeGstinInput(walkInPartyGstNo, 20)
            : undefined,
        partyState:
          posTaxInvoice && walkInPartyState.trim()
            ? walkInPartyState.trim()
            : undefined,
      });
      await refreshCustomers();
      setPosCustomerId(c.id);
      setCustomerQuery("");
      setWalkInPhone("");
      setWalkInPartyGstNo("");
      setWalkInPartyState("");
      setCustomerPhoneError(null);
      setCustomerSuggestOpen(false);
      setStatus({ type: "success", msg: `Customer saved — ${c.name}` });
      setTimeout(() => setStatus(null), 3000);
    } catch (e) {
      setStatus({
        type: "error",
        msg: isApiError(e) ? e.message : "Could not save customer",
      });
      setTimeout(() => setStatus(null), 5000);
    } finally {
      setSavingCustomer(false);
    }
  };

  const handleCheckout = async () => {
    if (!cart.length || loading) return;
    setLoading(true);
    setStatus(null);
    setFieldErrors({});
    setLineErrors(new Map());
    try {
      if (
        promotionsUi &&
        promotionCode.trim() &&
        !cartPromotion
      ) {
        setStatus({ type: "error", msg: "Promotion code is not valid or inactive." });
        return;
      }
      const orderLevelDiscountAmt = discountAmt + cartPromoAmt;
      const orderLevelDiscountPercent =
        subtotalAfterLinePromos > 0
          ? (orderLevelDiscountAmt / subtotalAfterLinePromos) * 100
          : 0;
      const orderLevelLineDiscounts = allocateLineDiscounts(
        lineSubtotals.map((v, i) => Math.max(0, v - linePromotionDiscounts[i])),
        orderLevelDiscountPercent
      );
      const lineDiscounts = linePromotionDiscounts.map(
        (v, i) => v + (orderLevelLineDiscounts[i] ?? 0)
      );

      const parsedPaid = Number.parseFloat(
        String(amountPaidStr).replace(/,/g, "").trim()
      );
      if (!Number.isFinite(parsedPaid) || parsedPaid < 0) {
        setStatus({
          type: "error",
          msg: "Enter a valid amount received.",
        });
        return;
      }
      const clampedPaid =
        Math.round(Math.min(grandTotal, Math.max(0, parsedPaid)) * 100) / 100;
      const hasBalance = grandTotal - clampedPaid > 0.005;
      const walkPhoneDigits = sanitizePhoneDigits(walkInPhone);
      if (
        walkPhoneDigits.length > 0 &&
        walkPhoneDigits.length !== 10
      ) {
        setStatus({
          type: "error",
          msg: "Walk-in phone must be exactly 10 digits.",
        });
        return;
      }
      if (hasBalance) {
        if (!posCustomerId) {
          const nameOk = customerQuery.trim().length > 0;
          const phoneOk = walkPhoneDigits.length === 10;
          if (!nameOk || !phoneOk) {
            setStatus({
              type: "error",
              msg: "Balance due requires a registered customer, or walk-in name and a 10-digit phone number.",
            });
            return;
          }
        }
      } else if (!posCustomerId && !customerQuery.trim()) {
        setStatus({
          type: "error",
          msg: "Walk-in name is required when paying in full (phone optional).",
        });
        return;
      }

      const saleBody: CreateSaleBody = {
        createdById: actingUserId,
        documentKind: posTaxInvoice ? "tax_invoice" : "bill",
        note: [
          discount > 0 ? `POS discount ${discount}%` : "",
          cartPromotion ? `Cart promo ${cartPromotion.code}` : "",
          posTaxInvoice ? "Tax invoice" : "",
        ]
          .filter(Boolean)
          .join(" | ") || undefined,
        paidAmount: clampedPaid,
        transportAmount,
        lines: cart.map((x, i) => {
          const disc = lineDiscounts[i] ?? 0;
          const taxable = Math.max(0, x.price * x.qty - disc);
          const rateSum =
            (x.cgstPercent ?? 0) + (x.sgstPercent ?? 0) + (x.igstPercent ?? 0);
          const lineTaxRaw = posTaxInvoice && rateSum > 0 ? (taxable * rateSum) / 100 : 0;
          const lineTax = Math.round(lineTaxRaw * 100) / 100;
          return {
            productId: x.id,
            productUnitId: x.baseUnitId,
            quantity: x.qty,
            unitPrice: x.price,
            lineDiscount: disc,
            lineTax,
          };
        }),
      };
      if (posCustomerId) {
        saleBody.customerId = posCustomerId;
      } else {
        if (customerQuery.trim()) {
          saleBody.customerName = customerQuery.trim();
        }
        if (walkPhoneDigits.length === 10) {
          saleBody.customerPhone = walkPhoneDigits;
        }
      }
      if (posTaxInvoice) {
        const gstFromCustomer = posCustomerId
          ? sanitizeGstinInput(
              customers.find((c) => c.id === posCustomerId)?.partyGstNo ?? "",
              20,
            )
          : "";
        const gstWalk = sanitizeGstinInput(walkInPartyGstNo, 20);
        const gst = gstFromCustomer || gstWalk;
        if (gst) {
          saleBody.customerPartyGstNo = gst;
        }
        const stateFromCustomer = posCustomerId
          ? customers.find((c) => c.id === posCustomerId)?.partyState?.trim()
          : undefined;
        const stateWalk = walkInPartyState.trim();
        const st = stateFromCustomer ?? stateWalk;
        if (st) {
          saleBody.customerPartyState = st;
        }
      }

      const sale = await api.createSale(saleBody);

      const bal = Number(sale.balanceAmount ?? 0);
      const snap =
        (sale.customerNameSnapshot ?? sale.customerName)?.trim() ?? "";
      const msg =
        bal > 0.005
          ? snap
            ? `Sale recorded — ${sale.saleNumber} · ${snap} · balance ${fmt(bal)}`
            : `Sale recorded — ${sale.saleNumber} · balance ${fmt(bal)}`
          : snap
            ? `Sale complete — ${sale.saleNumber} · ${snap}`
            : `Sale complete — ${sale.saleNumber}`;
      setStatus({
        type: "success",
        msg,
      });
      setTaxInvoiceSale(sale);
      resetPosSaleForm(false);
      await onSaleComplete();
      setTimeout(() => setStatus(null), 4000);
    } catch (e) {
      if (isApiError(e)) {
        setFieldErrors(recordFieldErrors(e.details));
        setLineErrors(lineErrorsFromDetails(e.details));
        setStatus({ type: "error", msg: e.message });
      } else {
        setStatus({
          type: "error",
          msg: e instanceof Error ? e.message : "Sale failed",
        });
      }
      setTimeout(() => setStatus(null), 6000);
    } finally {
      setLoading(false);
    }
  };

  const lineErrDetail = (index: number, key: string) =>
    lineErrors.get(index)?.[key];

  const saleFormBanner = useMemo(() => {
    const entries = Object.entries(fieldErrors).filter(
      ([k]) => k !== "paidAmount"
    );
    if (entries.length === 0) return undefined;
    return entries.map(([k, v]) => `${k}: ${v}`).join(" · ");
  }, [fieldErrors]);

  return (
    <>
      {taxInvoiceSale ? (
        <TaxInvoiceModal
          sale={taxInvoiceSale}
          variant={posTaxInvoice ? "tax" : "normal"}
          onClose={() => {
            setTaxInvoiceSale(null);
            setPosTaxInvoice(false);
          }}
        />
      ) : null}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: 12,
          flex: 1,
          minHeight: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            minHeight: 0,
          }}
        >
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            placeholder="Search by name or SKU..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle, flex: 1 }}
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{ ...inputStyle, minWidth: 140, padding: "0 10px", cursor: "pointer" }}
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))",
            gap: 8,
            alignContent: "start",
          }}
        >
          {pagedProducts.map((p) => {
            const st = stockStatus(p);
            const inCart = cart.find((x) => x.id === p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => addToCart(p)}
                disabled={st === "out"}
                style={{
                  background: "var(--surface)",
                  textAlign: "left",
                  padding: "10px 10px 9px",
                  borderRadius: 10,
                  cursor: st === "out" ? "not-allowed" : "pointer",
                  opacity: st === "out" ? 0.5 : 1,
                  position: "relative",
                  border: inCart
                    ? "2px solid var(--accent)"
                    : "1px solid var(--border)",
                  transition: "border-color 0.1s",
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--muted)",
                    marginBottom: 3,
                  }}
                >
                  {p.sku}
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "var(--text)",
                    lineHeight: 1.3,
                    marginBottom: 6,
                  }}
                >
                  {p.name}
                </div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    fontFamily: "monospace",
                    color: "var(--text)",
                  }}
                >
                  {fmt(p.price)}
                </div>
                <div
                  style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}
                >
                  /{p.unit}
                </div>
                <Badge status={st} />
                {inCart && (
                  <div
                    style={{
                      position: "absolute",
                      top: 8,
                      right: 8,
                      background: "var(--accent)",
                      color: "#fff",
                      width: 17,
                      height: 17,
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    {inCart.qty}
                  </div>
                )}
              </button>
            );
          })}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
            Showing{" "}
            <strong style={{ color: "var(--text)" }}>{pagedProducts.length}</strong>{" "}
            of <strong style={{ color: "var(--text)" }}>{filtered.length}</strong>{" "}
            products
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              style={{
                height: 30,
                minWidth: 64,
                padding: "0 10px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: page <= 1 ? "var(--surface-subtle)" : "var(--surface)",
                color: page <= 1 ? "var(--muted)" : "var(--text)",
                fontSize: 11.5,
                cursor: page <= 1 ? "not-allowed" : "pointer",
              }}
            >
              Prev
            </button>
            <span
              style={{
                fontSize: 11.5,
                color: "var(--muted)",
                minWidth: 64,
                textAlign: "center",
              }}
            >
              Page {page}/{pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={page >= pageCount}
              style={{
                height: 30,
                minWidth: 64,
                padding: "0 10px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: page >= pageCount ? "var(--surface-subtle)" : "var(--surface)",
                color: page >= pageCount ? "var(--muted)" : "var(--text)",
                fontSize: 11.5,
                cursor: page >= pageCount ? "not-allowed" : "pointer",
              }}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <div
        style={{
          background: "var(--surface)",
          borderRadius: 10,
          border: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "10px 12px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>Current Sale</span>
          {hasPosSaleDraft && (
            <button
              type="button"
              onClick={() => resetPosSaleForm(true)}
              style={{
                fontSize: 12,
                color: "var(--danger)",
                background: "none",
                border: "none",
                cursor: "pointer",
              }}
            >
              Clear all
            </button>
          )}
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {cart.length === 0 ? (
            <div
              style={{
                padding: "34px 12px",
                textAlign: "center",
                color: "var(--muted)",
                fontSize: 12,
              }}
            >
              No items — tap a product to add
            </div>
          ) : (
            cart.map((item, lineIndex) => {
              const le = lineErrors.get(lineIndex);
              const lineMsg = le
                ? ["quantity", "unitPrice", "productId", "productUnitId", "lineDiscount", "lineTax"]
                    .map((k) => le[k])
                    .filter(Boolean)
                    .join(" ")
                : "";
              return (
                <div
                  key={item.id}
                  style={{ borderBottom: "1px solid var(--surface-subtle)" }}
                >
                  <div
                    style={{
                      padding: "8px 10px",
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 12.5,
                          fontWeight: 500,
                          color: "var(--text)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {item.name}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>
                        {fmt(item.price)}/{item.unit}
                      </div>
                    </div>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 5 }}
                    >
                      <button
                        type="button"
                        onClick={() => updateQty(item.id, item.qty - 1)}
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 6,
                          border: "1px solid var(--border)",
                          background: "var(--surface-subtle)",
                          cursor: "pointer",
                          fontSize: 13,
                          fontWeight: 700,
                          color: "var(--text)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min={item.allowsFractionalSale ? 0.0001 : 1}
                        step={item.allowsFractionalSale ? "any" : 1}
                        value={item.qty}
                        onChange={(e) =>
                          updateQty(item.id, Number(e.target.value))
                        }
                        style={{
                          width: 44,
                          height: 22,
                          textAlign: "center",
                          border: lineErrDetail(lineIndex, "quantity")
                            ? "1px solid #fca5a5"
                            : "1px solid var(--border)",
                          borderRadius: 6,
                          fontSize: 12,
                          outline: "none",
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => updateQty(item.id, item.qty + 1)}
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 6,
                          border: "1px solid var(--border)",
                          background: "var(--surface-subtle)",
                          cursor: "pointer",
                          fontSize: 13,
                          fontWeight: 700,
                          color: "var(--text)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        +
                      </button>
                    </div>
                    <div
                      style={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        fontFamily: "monospace",
                        minWidth: 66,
                        textAlign: "right",
                      }}
                    >
                      {fmt(item.price * item.qty)}
                    </div>
                  </div>
                  {lineMsg ? (
                    <div
                      style={{
                        padding: "0 14px 8px",
                        fontSize: 11,
                        color: "var(--danger)",
                      }}
                    >
                      {lineMsg}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        <div
          style={{
            borderTop: "1px solid var(--border)",
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                color: "var(--muted)",
                marginBottom: 6,
              }}
            >
              Customer
            </div>
            {posCustomerId ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "10px 12px",
                  background: "var(--surface-subtle)",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  marginBottom: 8,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: "#1c1917",
                      lineHeight: 1.3,
                    }}
                  >
                    {customers.find((x) => x.id === posCustomerId)?.name ??
                      "Customer"}
                  </div>
                  {(() => {
                    const sel = customers.find((x) => x.id === posCustomerId);
                    const ph = sel?.phone;
                    const gst = sel?.partyGstNo?.trim();
                    const pst = sel?.partyState?.trim();
                    return (
                      <>
                        {ph ? (
                          <div
                            style={{ fontSize: 12, color: "#78716c", marginTop: 2 }}
                          >
                            {ph}
                          </div>
                        ) : null}
                        {posTaxInvoice && gst ? (
                          <div
                            style={{ fontSize: 12, color: "#78716c", marginTop: 2 }}
                          >
                            Party GST No: {gst}
                          </div>
                        ) : null}
                        {posTaxInvoice && pst ? (
                          <div
                            style={{ fontSize: 12, color: "#78716c", marginTop: 2 }}
                          >
                            State: {pst}
                          </div>
                        ) : null}
                      </>
                    );
                  })()}
                </div>
                <button
                  type="button"
                  onClick={() => clearRegisteredCustomer()}
                  style={{
                    flexShrink: 0,
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--accent)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: "4px 0",
                  }}
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <div style={{ position: "relative", marginBottom: 8 }}>
                  <input
                    placeholder="Search by name or phone, or enter walk-in name"
                    value={customerQuery}
                    onChange={(e) => {
                      setCustomerQuery(e.target.value);
                      setCustomerSuggestOpen(true);
                    }}
                    onFocus={() => setCustomerSuggestOpen(true)}
                    onBlur={() => {
                      window.setTimeout(
                        () => setCustomerSuggestOpen(false),
                        200
                      );
                    }}
                    autoComplete="off"
                    style={{
                      ...inputStyle,
                      width: "100%",
                      boxSizing: "border-box",
                      fontSize: 12,
                      height: 36,
                    }}
                  />
                  {customerSuggestOpen &&
                  customerQuery.trim() &&
                  typeaheadMatches.length > 0 ? (
                    <div
                      style={{
                        position: "absolute",
                        top: "100%",
                        left: 0,
                        right: 0,
                        marginTop: 4,
                        background: "#fff",
                        border: "1px solid #e7e5e4",
                        borderRadius: 8,
                        boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
                        maxHeight: 220,
                        overflowY: "auto",
                        zIndex: 30,
                      }}
                    >
                      {typeaheadMatches.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => pickRegisteredCustomer(c)}
                          style={{
                            display: "block",
                            width: "100%",
                            textAlign: "left",
                            padding: "10px 12px",
                            border: "none",
                            borderBottom: "1px solid #fafaf9",
                            background: "#fff",
                            cursor: "pointer",
                            fontSize: 13,
                          }}
                        >
                          <div style={{ fontWeight: 600, color: "#1c1917" }}>
                            {c.name}
                          </div>
                          {c.phone ? (
                            <div style={{ fontSize: 11, color: "#78716c" }}>
                              {c.phone}
                            </div>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="tel"
                  maxLength={10}
                  placeholder="10-digit mobile (optional if paying in full; required if balance due)"
                  value={walkInPhone}
                  onChange={(e) => {
                    setWalkInPhone(sanitizePhoneDigits(e.target.value));
                    if (customerPhoneError) setCustomerPhoneError(null);
                  }}
                  style={{
                    ...inputStyle,
                    width: "100%",
                    boxSizing: "border-box",
                    fontSize: 12,
                    height: 32,
                    marginBottom: 8,
                  }}
                />
                {posTaxInvoice ? (
                  <>
                    <label
                      style={{
                        display: "block",
                        fontSize: 11,
                        color: "var(--muted)",
                        marginBottom: 4,
                      }}
                    >
                      Party GST No
                    </label>
                    <input
                      type="text"
                      autoComplete="off"
                      placeholder="Letters and digits only (optional)"
                      maxLength={20}
                      value={walkInPartyGstNo}
                      onChange={(e) =>
                        setWalkInPartyGstNo(sanitizeGstinInput(e.target.value, 20))
                      }
                      style={{
                        ...inputStyle,
                        width: "100%",
                        boxSizing: "border-box",
                        fontSize: 12,
                        height: 32,
                        marginBottom: 8,
                      }}
                    />
                    <label
                      style={{
                        display: "block",
                        fontSize: 11,
                        color: "var(--muted)",
                        marginBottom: 4,
                      }}
                    >
                      State
                    </label>
                    <input
                      placeholder="Optional"
                      value={walkInPartyState}
                      onChange={(e) => setWalkInPartyState(e.target.value)}
                      style={{
                        ...inputStyle,
                        width: "100%",
                        boxSizing: "border-box",
                        fontSize: 12,
                        height: 32,
                        marginBottom: 8,
                      }}
                    />
                  </>
                ) : null}
                {customerPhoneError ? (
                  <div style={{ fontSize: 12, color: "var(--danger)", marginBottom: 8 }}>
                    {customerPhoneError}
                  </div>
                ) : null}
                {customerQuery.trim() ? (
                  <button
                    type="button"
                    onClick={() => void saveCustomerFromWalkIn()}
                    disabled={savingCustomer}
                    style={{
                      width: "100%",
                      height: 36,
                      borderRadius: 8,
                      border: "1px solid #e7e5e4",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: savingCustomer ? "not-allowed" : "pointer",
                      background: savingCustomer ? "#f5f5f4" : "#fafaf9",
                      color: savingCustomer ? "#a8a29e" : "#44403c",
                    }}
                  >
                    {savingCustomer ? "Saving…" : "Save customer"}
                  </button>
                ) : null}
              </>
            )}
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 13,
              color: "#78716c",
            }}
          >
            <span>Subtotal</span>
            <span style={{ fontFamily: "monospace" }}>{fmt(subtotal)}</span>
          </div>
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              cursor: loading ? "not-allowed" : "pointer",
              userSelect: "none",
              fontSize: 12,
              color: "var(--text)",
              lineHeight: 1.35,
              opacity: loading ? 0.7 : 1,
            }}
          >
            <input
              type="checkbox"
              checked={posTaxInvoice}
              disabled={loading}
              onChange={(e) => setPosTaxInvoice(e.target.checked)}
              style={{
                width: 16,
                height: 16,
                marginTop: 2,
                cursor: loading ? "not-allowed" : "pointer",
                flexShrink: 0,
              }}
            />
            <span>Tax invoice</span>
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 13, color: "#78716c", flex: 1 }}>
              Discount %
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={discount}
              onChange={(e) =>
                setDiscount(
                  Math.max(0, Math.min(100, Number(e.target.value)))
                )
              }
              style={{
                width: 58,
                height: 30,
                textAlign: "center",
                border: "1px solid #e7e5e4",
                borderRadius: 6,
                fontSize: 13,
                outline: "none",
              }}
            />
            <span
              style={{
                fontSize: 13,
                color: "var(--danger)",
                fontFamily: "monospace",
                minWidth: 64,
                textAlign: "right",
              }}
            >
              −{fmt(discountAmt)}
            </span>
          </div>
          {promotionsUi ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label style={{ fontSize: 13, color: "#78716c", flex: 1 }}>
                  Promotion code
                </label>
                <input
                  placeholder="e.g. NEW10"
                  value={promotionCode}
                  onChange={(e) => setPromotionCode(e.target.value.toUpperCase())}
                  style={{
                    width: 120,
                    height: 30,
                    textAlign: "center",
                    border: "1px solid #e7e5e4",
                    borderRadius: 6,
                    fontSize: 12,
                    outline: "none",
                  }}
                />
                <span
                  style={{
                    fontSize: 13,
                    color: "var(--danger)",
                    fontFamily: "monospace",
                    minWidth: 64,
                    textAlign: "right",
                  }}
                >
                  −{fmt(cartPromoAmt)}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 12,
                  color: "#78716c",
                }}
              >
                <span>Product/category promotions</span>
                <span style={{ fontFamily: "monospace", color: "var(--danger)" }}>
                  −{fmt(productCategoryPromoAmt)}
                </span>
              </div>
            </>
          ) : null}
          {posTaxInvoice && posGstTotals ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                padding: "8px 0",
                borderTop: "1px dashed var(--border)",
                borderBottom: "1px dashed var(--border)",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "var(--muted)",
                }}
              >
                GST
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 13,
                  color: "var(--text)",
                }}
              >
                <span>CGST@ %</span>
                <span style={{ fontFamily: "monospace" }}>{fmt(posGstTotals.cgst)}</span>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 13,
                  color: "var(--text)",
                }}
              >
                <span>SGST@ %</span>
                <span style={{ fontFamily: "monospace" }}>{fmt(posGstTotals.sgst)}</span>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 13,
                  color: "var(--text)",
                }}
              >
                <span>IGST@ %</span>
                <span style={{ fontFamily: "monospace" }}>{fmt(posGstTotals.igst)}</span>
              </div>
            </div>
          ) : null}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 13, color: "#78716c", flex: 1 }}>
              Transport (₹)
            </label>
            <input
              type="number"
              min={0}
              step={0.01}
              value={transportStr}
              onChange={(e) => setTransportStr(e.target.value)}
              placeholder="0"
              disabled={loading}
              style={{
                width: 100,
                height: 32,
                textAlign: "right",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 13,
                outline: "none",
                background: "var(--surface)",
                color: "var(--text)",
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 18,
              fontWeight: 700,
            }}
          >
            <span>Total</span>
            <span style={{ fontFamily: "monospace", color: "var(--accent)" }}>
              {fmt(grandTotal)}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label
              style={{ fontSize: 12, color: "#78716c", fontWeight: 600 }}
            >
              Amount received
            </label>
            <input
              type="number"
              min={0}
              step={0.01}
              value={amountPaidStr}
              onChange={(e) => setAmountPaidStr(e.target.value)}
              style={{
                ...inputStyle,
                width: "100%",
                boxSizing: "border-box",
                fontSize: 14,
                height: 40,
              }}
            />
            {(() => {
              const p = Number.parseFloat(
                String(amountPaidStr).replace(/,/g, "").trim()
              );
              if (!Number.isFinite(p) || p < 0) return null;
              const due = Math.max(0, grandTotal - Math.min(grandTotal, p));
              if (due < 0.005) return null;
              return (
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--accent)",
                    fontWeight: 600,
                  }}
                >
                  Balance due: {fmt(due)}
                </div>
              );
            })()}
          </div>
          {fieldErrors.paidAmount ? (
            <div style={{ fontSize: 12, color: "var(--danger)" }}>
              paidAmount: {fieldErrors.paidAmount}
            </div>
          ) : null}

          <FormErrorBanner text={saleFormBanner} />
          <Toast status={status} />

          <button
            type="button"
            onClick={handleCheckout}
            disabled={!cart.length || loading}
            style={{
              height: 44,
              borderRadius: 10,
              border: "none",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
              background: cart.length ? "var(--accent)" : "var(--border)",
              color: cart.length ? "#fff" : "#a8a29e",
              transition: "background 0.15s",
            }}
          >
            {loading ? "Processing..." : "Confirm Sale"}
          </button>
        </div>
      </div>
    </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════
// INVENTORY VIEW
// ═══════════════════════════════════════════════════════════════════
function InventoryView({ products }: { products: UiProduct[] }) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [sortKey, setSortKey] = useState<InventorySortKey>("sku");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const categoryOptions = useMemo(
    () => ["All", ...new Set(products.map((p) => p.category))],
    [products]
  );

  const scopedProducts = useMemo(
    () =>
      categoryFilter === "All"
        ? products
        : products.filter((p) => p.category === categoryFilter),
    [products, categoryFilter]
  );

  const totalValue = scopedProducts.reduce((s, p) => s + p.price * p.stock, 0);
  const lowCount = scopedProducts.filter((p) => stockStatus(p) === "low").length;
  const outCount = scopedProducts.filter((p) => stockStatus(p) === "out").length;

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return scopedProducts.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
    );
  }, [scopedProducts, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => compareInventoryRows(a, b, sortKey, sortDir));
    return arr;
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (key: InventorySortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortColumns: { key: InventorySortKey; label: string }[] = [
    { key: "sku", label: "SKU" },
    { key: "name", label: "Product" },
    { key: "category", label: "Category" },
    { key: "price", label: "Sale Price" },
    { key: "stock", label: "Stock" },
    { key: "unit", label: "Unit" },
    { key: "status", label: "Status" },
  ];

  const cards = [
    {
      label: "Total SKUs",
      value: String(scopedProducts.length),
      color: "#1c1917",
      mono: false,
    },
    {
      label: "Stock Value",
      value: fmt(totalValue),
      color: "#1c1917",
      mono: true,
    },
    {
      label: "Low Stock",
      value: String(lowCount),
      color: "#d97706",
      mono: false,
    },
    {
      label: "Out of Stock",
      value: String(outCount),
      color: "#dc2626",
      mono: false,
    },
  ];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        flex: 1,
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        {cards.map((c) => (
          <div
            key={c.label}
            style={{
              background: "#fff",
              borderRadius: 10,
              border: "1px solid #e7e5e4",
              padding: "14px 16px",
            }}
          >
            <div
              style={{ fontSize: 12, color: "#78716c", marginBottom: 6 }}
            >
              {c.label}
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: c.color,
                fontFamily: c.mono ? "monospace" : undefined,
              }}
            >
              {c.value}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", width: "100%", flexWrap: "wrap" }}>
        <input
          placeholder="Search by name, SKU or category..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, flex: 1, maxWidth: 560 }}
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          style={{ ...inputStyle, width: 220 }}
        >
          {categoryOptions.map((c) => (
            <option key={c} value={c}>
              {c === "All" ? "All Categories" : c}
            </option>
          ))}
        </select>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          background: "#fff",
          borderRadius: 12,
          border: "1px solid #e7e5e4",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13,
          }}
        >
          <thead>
            <tr
              style={{
                borderBottom: "1px solid #e7e5e4",
                position: "sticky",
                top: 0,
              }}
            >
              {sortColumns.map(({ key, label }) => {
                const active = sortKey === key;
                return (
                  <th
                    key={key}
                    style={{
                      padding: "10px 14px",
                      textAlign: "left",
                      fontWeight: 600,
                      color: active ? "#1c1917" : "#78716c",
                      fontSize: 12,
                      background: "#fafaf9",
                      whiteSpace: "nowrap",
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                    onClick={() => toggleSort(key)}
                    title="Click to sort"
                  >
                    {label}
                    {active ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((p, i) => {
              const st = stockStatus(p);
              return (
                <tr
                  key={p.id}
                  style={{
                    borderBottom: "1px solid #f5f4f0",
                    background: i % 2 === 0 ? "#fff" : "#fafaf9",
                  }}
                >
                  <td
                    style={{
                      padding: "10px 14px",
                      fontFamily: "monospace",
                      color: "#78716c",
                      fontSize: 12,
                    }}
                  >
                    {p.sku}
                  </td>
                  <td
                    style={{
                      padding: "10px 14px",
                      fontWeight: 500,
                      color: "#1c1917",
                    }}
                  >
                    {p.name}
                  </td>
                  <td style={{ padding: "10px 14px", color: "#78716c" }}>
                    {p.category}
                  </td>
                  <td
                    style={{
                      padding: "10px 14px",
                      fontFamily: "monospace",
                      fontWeight: 500,
                    }}
                  >
                    {fmt(p.price)}
                  </td>
                  <td
                    style={{
                      padding: "10px 14px",
                      fontFamily: "monospace",
                      fontWeight: 700,
                      color:
                        st === "out"
                          ? "#dc2626"
                          : st === "low"
                            ? "#d97706"
                            : "#1c1917",
                    }}
                  >
                    {p.stock}
                  </td>
                  <td style={{ padding: "10px 14px", color: "#78716c" }}>
                    {p.unit}
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <Badge status={st} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const PURCHASE_INLINE_ERROR_KEYS = new Set([
  "supplierId",
  "invoiceDate",
  "note",
]);

/** Max purchase lines from one CSV/Excel file (matches batch safety). */
const MAX_PURCHASE_IMPORT_ROWS = 500;

function newPurchaseLineRow(): {
  key: string;
  productId: string;
  quantity: string;
  unitCost: string;
} {
  return {
    key:
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `pl-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    productId: "",
    quantity: "",
    unitCost: "",
  };
}

const ADJUSTMENT_INLINE_ERROR_KEYS = new Set([
  "productId",
  "quantity",
  "quantityAfter",
  "reason",
  "adjustedById",
  "note",
]);

// ═══════════════════════════════════════════════════════════════════
// PURCHASE VIEW
// ═══════════════════════════════════════════════════════════════════
function PurchaseView({
  products,
  suppliers,
  actingUserId,
  onPurchaseComplete,
  refreshSuppliers,
  isAdminUser = false,
}: {
  products: UiProduct[];
  suppliers: ApiSupplier[];
  actingUserId: string;
  onPurchaseComplete: () => Promise<void>;
  refreshSuppliers: () => Promise<void>;
  /** Admin / manager: supplier payment register */
  isAdminUser?: boolean;
}) {
  const [form, setForm] = useState(() => ({
    supplierId: "",
    lines: [newPurchaseLineRow()],
    purchaseDate: ymdInIndia(),
    notes: "",
  }));
  const [status, setStatus] = useState<{
    type: "success" | "error";
    msg: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [lineFieldErrors, setLineFieldErrors] = useState<
    Map<number, Record<string, string>>
  >(() => new Map());
  const purchaseImportRef = useRef<HTMLInputElement>(null);
  const [importBanner, setImportBanner] = useState<string | null>(null);

  const newSupplierEmpty = useMemo(
    () => ({
      name: "",
      contactPerson: "",
      phone: "",
      email: "",
      address: "",
      gstNumber: "",
      note: "",
    }),
    []
  );
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [newSupplier, setNewSupplier] = useState(newSupplierEmpty);
  const [creatingSupplier, setCreatingSupplier] = useState(false);
  const [newSupplierErrors, setNewSupplierErrors] = useState<
    Record<string, string>
  >({});
  const [supplierPanelMsg, setSupplierPanelMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const [payRows, setPayRows] = useState<PurchaseListRow[]>([]);
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<PurchaseListRow | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payNote, setPayNote] = useState("");
  const [payPaidAt, setPayPaidAt] = useState("");
  const [payLoadingSubmit, setPayLoadingSubmit] = useState(false);
  const [payMsg, setPayMsg] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);

  const loadPayables = useCallback(async () => {
    if (!isAdminUser) return;
    setPayLoading(true);
    setPayError(null);
    try {
      const data = await api.getPurchases({ owingOnly: true, limit: 200 });
      setPayRows(data.purchases);
    } catch (e) {
      setPayError(isApiError(e) ? e.message : "Failed to load supplier payables");
      setPayRows([]);
    } finally {
      setPayLoading(false);
    }
  }, [isAdminUser]);

  useEffect(() => {
    void loadPayables();
  }, [loadPayables]);

  useEffect(() => {
    if (payFor) {
      setPayAmount(Number(payFor.balanceAmount).toFixed(2));
      setPayNote("");
      setPayPaidAt(ymdInIndia());
      setPayMsg(null);
    }
  }, [payFor]);

  useEffect(() => {
    setFieldErrors({});
    setLineFieldErrors(new Map());
  }, [form.supplierId, form.purchaseDate, form.notes, form.lines]);

  useEffect(() => {
    setNewSupplierErrors({});
  }, [newSupplier]);

  const purchaseFormBanner = useMemo(() => {
    const extra = Object.entries(fieldErrors).filter(
      ([k]) => !PURCHASE_INLINE_ERROR_KEYS.has(k)
    );
    if (extra.length === 0) return undefined;
    return extra.map(([k, v]) => `${k}: ${v}`).join(" · ");
  }, [fieldErrors]);

  const setLine = (
    index: number,
    patch: Partial<{
      productId: string;
      quantity: string;
      unitCost: string;
    }>
  ) => {
    setForm((f) => ({
      ...f,
      lines: f.lines.map((ln, i) => (i === index ? { ...ln, ...patch } : ln)),
    }));
  };

  const addPurchaseLine = () => {
    setForm((f) => ({ ...f, lines: [...f.lines, newPurchaseLineRow()] }));
  };

  const removePurchaseLine = (index: number) => {
    setForm((f) => {
      if (f.lines.length <= 1) {
        return { ...f, lines: [newPurchaseLineRow()] };
      }
      return { ...f, lines: f.lines.filter((_, i) => i !== index) };
    });
  };

  const downloadPurchaseImportTemplate = () => {
    const bom = "\uFEFF";
    const blob = new Blob([bom + PURCHASE_IMPORT_TEMPLATE_CSV], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "purchase-lines-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePurchaseImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportBanner(null);
    try {
      const {
        patches,
        patchSourceRows,
        rowErrors,
        skippedBlankRows,
        hasSupplierColumn,
      } = await parsePurchaseLinesImportFile(file);
      const capped = patches.slice(0, MAX_PURCHASE_IMPORT_ROWS);
      const cappedRows = patchSourceRows.slice(0, MAX_PURCHASE_IMPORT_ROWS);
      const {
        lines: importedLines,
        unresolved,
        supplierUnresolved,
        resolvedSupplierId,
      } = resolvePurchaseImportPatches(capped, products, cappedRows, {
        suppliers,
        hasSupplierColumn,
        defaultSupplierId: form.supplierId || null,
      });
      if (importedLines.length === 0) {
        const msg =
          supplierUnresolved.length > 0
            ? supplierUnresolved.map((u) => `Row ${u.row}: ${u.message}`).join("\n")
            : unresolved.length > 0
              ? unresolved.map((u) => `Row ${u.row}: ${u.message}`).join("\n")
              : rowErrors.length > 0
                ? rowErrors.map((r) => `Row ${r.row}: ${r.message}`).join("\n")
                : "No valid lines. Check headers: sku and/or product name, quantity, unit cost.";
        window.alert(msg);
        return;
      }
      setForm((f) => {
        const sole = f.lines.length === 1;
        const emptyRow =
          sole &&
          !f.lines[0].productId &&
          !String(f.lines[0].quantity).trim() &&
          !String(f.lines[0].unitCost).trim();
        const nextLines = emptyRow ? importedLines : [...f.lines, ...importedLines];
        return {
          ...f,
          lines: nextLines,
          supplierId: resolvedSupplierId ?? f.supplierId,
        };
      });
      const parts = [
        `Imported ${importedLines.length} line(s). Review and record purchase when ready.`,
      ];
      if (resolvedSupplierId) {
        const sn = suppliers.find((s) => s.id === resolvedSupplierId)?.name;
        if (sn) {
          parts.push(`Supplier set to “${sn}”.`);
        }
      }
      if (patches.length > MAX_PURCHASE_IMPORT_ROWS) {
        parts.push(`Only the first ${MAX_PURCHASE_IMPORT_ROWS} data rows were loaded.`);
      }
      if (skippedBlankRows > 0) {
        parts.push(`${skippedBlankRows} blank row(s) skipped.`);
      }
      if (rowErrors.length > 0) {
        parts.push(
          `Notes: ${rowErrors.map((r) => `row ${r.row}: ${r.message}`).join("; ")}`
        );
      }
      if (unresolved.length > 0) {
        parts.push(
          `Not imported: ${unresolved.map((u) => `row ${u.row}: ${u.message}`).join("; ")}`
        );
      }
      setImportBanner(parts.join(" "));
      setStatus(null);
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : "Could not read that file."
      );
    }
  };

  const duplicateSupplierMsg =
    "This supplier already exists. Select it from the dropdown or enter a different name.";
  const normalizedNewSupplierName = newSupplier.name.trim().toLocaleLowerCase();
  const matchingSupplier = useMemo(() => {
    if (!normalizedNewSupplierName) return undefined;
    return suppliers.find(
      (s) => s.name.trim().toLocaleLowerCase() === normalizedNewSupplierName
    );
  }, [normalizedNewSupplierName, suppliers]);

  const setNewSupplierField = (
    k: keyof typeof newSupplierEmpty,
    v: string
  ) => {
    const next =
      k === "phone"
        ? sanitizePhoneDigits(v)
        : k === "gstNumber"
          ? sanitizeGstinInput(v, 50)
          : v;
    setNewSupplier((s) => ({ ...s, [k]: next }));
    if (k === "name") {
      setForm((f) => {
        if (!f.supplierId) return f;
        const selected = suppliers.find((s) => s.id === f.supplierId);
        if (!selected) return f;
        const selectedName = selected.name.trim().toLocaleLowerCase();
        if (selectedName !== v.trim().toLocaleLowerCase()) return f;
        return { ...f, supplierId: "" };
      });
    }
    setSupplierPanelMsg(null);
  };

  const handleCreateSupplier = async () => {
    if (creatingSupplier) return;
    const trimmedName = newSupplier.name.trim();
    if (!trimmedName) {
      setNewSupplierErrors({ name: "Name is required" });
      return;
    }
    if (matchingSupplier) {
      setNewSupplierErrors({ name: duplicateSupplierMsg });
      setForm((f) => ({ ...f, supplierId: matchingSupplier.id }));
      return;
    }
    const supplierPhoneDigits = sanitizePhoneDigits(newSupplier.phone);
    if (supplierPhoneDigits.length > 0 && supplierPhoneDigits.length !== 10) {
      setNewSupplierErrors({ phone: "Phone must be exactly 10 digits." });
      return;
    }
    setCreatingSupplier(true);
    setNewSupplierErrors({});
    setSupplierPanelMsg(null);
    try {
      const s = await api.createSupplier({
        name: trimmedName,
        contactPerson: newSupplier.contactPerson.trim() || undefined,
        phone: supplierPhoneDigits.length === 10 ? supplierPhoneDigits : undefined,
        email: newSupplier.email.trim() || undefined,
        address: newSupplier.address.trim() || undefined,
        gstNumber: sanitizeGstinInput(newSupplier.gstNumber, 50) || undefined,
        note: newSupplier.note.trim() || undefined,
      });
      await refreshSuppliers();
      setForm((f) => ({ ...f, supplierId: s.id }));
      setNewSupplier({ ...newSupplierEmpty });
      setShowAddSupplier(false);
      setSupplierPanelMsg({
        type: "success",
        text: `“${s.name}” added and selected.`,
      });
    } catch (e) {
      if (isApiError(e)) {
        if (
          e.status === 409 &&
          (e.code === "SUPPLIER_ALREADY_EXISTS" || e.field === "supplierName")
        ) {
          setNewSupplierErrors({ name: duplicateSupplierMsg });
          const conflictMatch = suppliers.find(
            (s) => s.name.trim().toLocaleLowerCase() === trimmedName.toLocaleLowerCase()
          );
          if (conflictMatch) {
            setForm((f) => ({ ...f, supplierId: conflictMatch.id }));
          }
          return;
        }
        const fe: Record<string, string> = {};
        for (const d of e.details ?? []) {
          if (!fe[d.field]) fe[d.field] = d.message;
        }
        setNewSupplierErrors(fe);
        setSupplierPanelMsg({ type: "error", text: e.message });
      } else {
        setSupplierPanelMsg({
          type: "error",
          text: e instanceof Error ? e.message : "Could not create supplier",
        });
      }
    } finally {
      setCreatingSupplier(false);
    }
  };

  const totalCost = useMemo(() => {
    return form.lines.reduce((sum, ln) => {
      const q = Number(ln.quantity) || 0;
      const c = Number(ln.unitCost) || 0;
      return sum + q * c;
    }, 0);
  }, [form.lines]);

  const handleSubmit = async () => {
    if (loading) return;
    setLoading(true);
    setStatus(null);
    setFieldErrors({});
    setLineFieldErrors(new Map());
    try {
      const linesPayload = form.lines.map((ln) => {
        const p = products.find((x) => x.id === ln.productId);
        return {
          productId: ln.productId,
          productUnitId: p?.baseUnitId ?? "",
          quantity: Number(ln.quantity),
          unitCost: Number(ln.unitCost),
        };
      });
      const purchase = await api.createPurchase({
        supplierId: form.supplierId,
        createdById: actingUserId,
        invoiceDate: form.purchaseDate || undefined,
        note: form.notes || undefined,
        lines: linesPayload,
      });
      setStatus({
        type: "success",
        msg: `Purchase recorded — ${purchase.purchaseNumber}`,
      });
      setForm({
        supplierId: "",
        lines: [newPurchaseLineRow()],
        purchaseDate: ymdInIndia(),
        notes: "",
      });
      setImportBanner(null);
      await onPurchaseComplete();
      if (isAdminUser) void loadPayables();
      setTimeout(() => setStatus(null), 4000);
    } catch (e) {
      if (isApiError(e)) {
        setFieldErrors(recordFieldErrors(e.details));
        setLineFieldErrors(lineErrorsFromDetails(e.details));
        setStatus({ type: "error", msg: e.message });
      } else {
        setStatus({
          type: "error",
          msg: e instanceof Error ? e.message : "Purchase failed",
        });
      }
      setTimeout(() => setStatus(null), 6000);
    } finally {
      setLoading(false);
    }
  };

  const submitSupplierPayment = async () => {
    if (!payFor || !actingUserId) return;
    const amt = Number.parseFloat(payAmount.replace(/,/g, ""));
    if (!Number.isFinite(amt) || amt <= 0) {
      setPayMsg({ type: "err", text: "Enter a valid payment amount." });
      return;
    }
    const maxBal = Number(payFor.balanceAmount);
    if (amt > maxBal + 1e-6) {
      setPayMsg({
        type: "err",
        text: "Amount cannot exceed balance owed to supplier.",
      });
      return;
    }
    setPayLoadingSubmit(true);
    setPayMsg(null);
    try {
      await api.recordPurchasePayment(payFor.id, {
        amount: amt,
        createdById: actingUserId,
        note: payNote.trim() || undefined,
        paidAt: payPaidAt.trim()
          ? new Date(`${payPaidAt.trim()}T12:00:00`).toISOString()
          : undefined,
      });
      setPayFor(null);
      await loadPayables();
    } catch (e) {
      setPayMsg({
        type: "err",
        text: isApiError(e) ? e.message : "Payment failed",
      });
    } finally {
      setPayLoadingSubmit(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 28,
        maxWidth: 960,
        width: "100%",
      }}
    >
    <div style={{ maxWidth: 560 }}>
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          border: "1px solid #e7e5e4",
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            borderBottom: "1px solid #f0ece8",
            paddingBottom: 14,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 16 }}>New Purchase Entry</div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              alignItems: "center",
            }}
          >
            <input
              ref={purchaseImportRef}
              type="file"
              accept=".csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
              style={{ display: "none" }}
              onChange={(e) => void handlePurchaseImportFile(e)}
            />
            <button
              type="button"
              onClick={() => purchaseImportRef.current?.click()}
              style={{
                height: 34,
                padding: "0 12px",
                background: "#fff",
                border: "1px solid #e7e5e4",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                color: "#44403c",
                cursor: "pointer",
              }}
            >
              Import CSV / Excel
            </button>
            <button
              type="button"
              onClick={downloadPurchaseImportTemplate}
              style={{
                height: 34,
                padding: "0 12px",
                background: "#fafaf9",
                border: "1px solid #e7e5e4",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                color: "#78716c",
                cursor: "pointer",
              }}
            >
              Download template
            </button>
          </div>
        </div>

        <FieldWrap label="Supplier *" error={fieldErrors.supplierId}>
          <select
            value={form.supplierId}
            onChange={(e) => {
              setForm((f) => ({ ...f, supplierId: e.target.value }));
              if (e.target.value) {
                setNewSupplierErrors((prev) => {
                  if (!prev.name) return prev;
                  const next = { ...prev };
                  delete next.name;
                  return next;
                });
              }
            }}
            style={{ ...inputStyle, padding: "0 10px", cursor: "pointer" }}
          >
            <option value="">— Select supplier —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {matchingSupplier?.id === s.id
                  ? `${s.name} (matches new supplier name)`
                  : s.name}
              </option>
            ))}
          </select>
        </FieldWrap>

        {supplierPanelMsg && (
          <div
            style={{
              fontSize: 13,
              color:
                supplierPanelMsg.type === "success" ? "var(--accent)" : "var(--danger)",
            }}
          >
            {supplierPanelMsg.text}
          </div>
        )}

        <div>
          <button
            type="button"
            onClick={() => {
              setShowAddSupplier((v) => !v);
              setSupplierPanelMsg(null);
            }}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              fontSize: 13,
              fontWeight: 600,
              color: "var(--accent)",
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            {showAddSupplier ? "Hide new supplier form" : "+ Add new supplier"}
          </button>
        </div>

        {showAddSupplier && (
          <div
            style={{
              border: "1px solid #e7e5e4",
              borderRadius: 10,
              padding: 16,
              background: "#fafaf9",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#44403c",
              }}
            >
              New supplier
            </div>
            <FieldWrap
              label="Name *"
              error={newSupplierErrors.name}
              errorId="new-supplier-name-error"
            >
              <input
                value={newSupplier.name}
                onBlur={() => {
                  if (matchingSupplier) {
                    setNewSupplierErrors({ name: duplicateSupplierMsg });
                  }
                }}
                onChange={(e) =>
                  setNewSupplierField("name", e.target.value)
                }
                placeholder="Supplier name"
                aria-invalid={Boolean(newSupplierErrors.name)}
                aria-describedby={
                  newSupplierErrors.name ? "new-supplier-name-error" : undefined
                }
                style={{
                  ...inputStyle,
                  borderColor: newSupplierErrors.name ? "#fca5a5" : "#e7e5e4",
                }}
              />
            </FieldWrap>
            {matchingSupplier && !newSupplierErrors.name && (
              <div
                style={{
                  background: "#fef3c7",
                  color: "#92400e",
                  borderRadius: 8,
                  padding: "8px 10px",
                  fontSize: 12,
                }}
              >
                Similar existing supplier found: <strong>{matchingSupplier.name}</strong>
                . You can select it from the dropdown.
              </div>
            )}
            <FieldWrap
              label="Contact person"
              error={newSupplierErrors.contactPerson}
            >
              <input
                value={newSupplier.contactPerson}
                onChange={(e) =>
                  setNewSupplierField("contactPerson", e.target.value)
                }
                style={{
                  ...inputStyle,
                  borderColor: newSupplierErrors.contactPerson
                    ? "#fca5a5"
                    : "#e7e5e4",
                }}
              />
            </FieldWrap>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <FieldWrap label="Phone" error={newSupplierErrors.phone}>
                  <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="tel"
                  maxLength={10}
                  placeholder="10-digit mobile (optional)"
                  value={newSupplier.phone}
                  onChange={(e) =>
                    setNewSupplierField("phone", e.target.value)
                  }
                  style={{
                    ...inputStyle,
                    borderColor: newSupplierErrors.phone ? "#fca5a5" : "#e7e5e4",
                  }}
                />
              </FieldWrap>
              <FieldWrap label="Email" error={newSupplierErrors.email}>
                <input
                  type="email"
                  value={newSupplier.email}
                  onChange={(e) =>
                    setNewSupplierField("email", e.target.value)
                  }
                  style={{
                    ...inputStyle,
                    borderColor: newSupplierErrors.email ? "#fca5a5" : "#e7e5e4",
                  }}
                />
              </FieldWrap>
            </div>
            <FieldWrap label="Address" error={newSupplierErrors.address}>
              <input
                value={newSupplier.address}
                onChange={(e) =>
                  setNewSupplierField("address", e.target.value)
                }
                style={{
                  ...inputStyle,
                  borderColor: newSupplierErrors.address ? "#fca5a5" : "#e7e5e4",
                }}
              />
            </FieldWrap>
            <FieldWrap label="GST number" error={newSupplierErrors.gstNumber}>
                <input
                type="text"
                autoComplete="off"
                placeholder="Letters and digits only (optional)"
                maxLength={50}
                value={newSupplier.gstNumber}
                onChange={(e) =>
                  setNewSupplierField("gstNumber", e.target.value)
                }
                style={{
                  ...inputStyle,
                  borderColor: newSupplierErrors.gstNumber
                    ? "#fca5a5"
                    : "#e7e5e4",
                }}
              />
            </FieldWrap>
            <FieldWrap label="Note" error={newSupplierErrors.note}>
              <textarea
                value={newSupplier.note}
                onChange={(e) =>
                  setNewSupplierField("note", e.target.value)
                }
                rows={2}
                style={{
                  padding: "8px 12px",
                  border: `1px solid ${newSupplierErrors.note ? "#fca5a5" : "#e7e5e4"}`,
                  borderRadius: 8,
                  fontSize: 14,
                  resize: "vertical",
                  outline: "none",
                  fontFamily: "inherit",
                }}
              />
            </FieldWrap>
            <button
              type="button"
              onClick={handleCreateSupplier}
              disabled={creatingSupplier}
              style={{
                height: 40,
                background: "#78716c",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                cursor: creatingSupplier ? "wait" : "pointer",
              }}
            >
              {creatingSupplier ? "Saving…" : "Save supplier"}
            </button>
          </div>
        )}

        <div
          style={{
            fontWeight: 600,
            fontSize: 14,
            color: "#44403c",
            borderBottom: "1px solid #f0ece8",
            paddingBottom: 10,
          }}
        >
          Line items
        </div>

        <p style={{ margin: 0, fontSize: 12, color: "#78716c" }}>
          Row 1 = headers. Required:{" "}
          <code style={{ fontSize: 11 }}>quantity</code>,{" "}
          <code style={{ fontSize: 11 }}>unit cost</code> (or rate / purchase price), and{" "}
          <code style={{ fontSize: 11 }}>sku</code> and/or{" "}
          <code style={{ fontSize: 11 }}>product name</code> to match your catalog. Optional:{" "}
          <code style={{ fontSize: 11 }}>supplier</code> / <code style={{ fontSize: 11 }}>vendor</code>{" "}
          (name or GST); all rows must be the same supplier. Leave a cell blank only if you
          already selected that supplier above. Imported rows become line items you can edit
          before recording.
        </p>

        {importBanner ? (
          <div
            style={{
              background: "#fefce8",
              border: "1px solid #fde047",
              color: "#854d0e",
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 13,
              lineHeight: 1.45,
            }}
          >
            {importBanner}
          </div>
        ) : null}

        {form.lines.map((line, idx) => {
          const rowErr = lineFieldErrors.get(idx);
          const prodErr = rowErr?.productId ?? rowErr?.productUnitId;
          const qtyErr = rowErr?.quantity;
          const costErr = rowErr?.unitCost;
          const sel = products.find((p) => p.id === line.productId);
          return (
            <div
              key={line.key}
              style={{
                border: "1px solid #e7e5e4",
                borderRadius: 10,
                padding: 14,
                background: "#fafaf9",
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 600, color: "#78716c" }}>
                  Line {idx + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removePurchaseLine(idx)}
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#78716c",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  Remove
                </button>
              </div>
              <FieldWrap label="Product *" error={prodErr}>
                <select
                  value={line.productId}
                  onChange={(e) => setLine(idx, { productId: e.target.value })}
                  style={{ ...inputStyle, padding: "0 10px", cursor: "pointer" }}
                >
                  <option value="">— Select product —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku})
                    </option>
                  ))}
                </select>
              </FieldWrap>
              {sel ? (
                <div
                  style={{
                    background: "#fef9ee",
                    borderRadius: 8,
                    padding: "8px 12px",
                    fontSize: 12,
                    color: "#78716c",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 16,
                  }}
                >
                  <span>
                    Stock:{" "}
                    <strong style={{ color: "#1c1917" }}>
                      {sel.stock} {sel.unit}
                    </strong>
                  </span>
                  <span>
                    Sale:{" "}
                    <strong style={{ color: "#1c1917" }}>{fmt(sel.price)}</strong>
                  </span>
                </div>
              ) : null}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 14,
                }}
              >
                <FieldWrap label="Quantity *" error={qtyErr}>
                  <input
                    type="number"
                    min={0.0001}
                    step="any"
                    placeholder="0"
                    value={line.quantity}
                    onChange={(e) => setLine(idx, { quantity: e.target.value })}
                    style={{
                      ...inputStyle,
                      borderColor: qtyErr ? "#fca5a5" : "#e7e5e4",
                    }}
                  />
                </FieldWrap>
                <FieldWrap label="Unit Cost (₹) *" error={costErr}>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    placeholder="0.00"
                    value={line.unitCost}
                    onChange={(e) => setLine(idx, { unitCost: e.target.value })}
                    style={{
                      ...inputStyle,
                      borderColor: costErr ? "#fca5a5" : "#e7e5e4",
                    }}
                  />
                </FieldWrap>
              </div>
            </div>
          );
        })}

        <button
          type="button"
          onClick={addPurchaseLine}
          style={{
            alignSelf: "flex-start",
            height: 36,
            padding: "0 14px",
            background: "#fff",
            border: "1px solid #e7e5e4",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            color: "#44403c",
            cursor: "pointer",
          }}
        >
          + Add line
        </button>

        {totalCost > 0 && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              background: "#f5f4f0",
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 14,
            }}
          >
            <span style={{ color: "#78716c" }}>Total Purchase Cost</span>
            <strong style={{ fontFamily: "monospace" }}>{fmt(totalCost)}</strong>
          </div>
        )}

        <FieldWrap label="Purchase Date" error={fieldErrors.invoiceDate}>
          <input
            type="date"
            value={form.purchaseDate}
            onChange={(e) =>
              setForm((f) => ({ ...f, purchaseDate: e.target.value }))
            }
            style={{
              ...inputStyle,
              borderColor: fieldErrors.invoiceDate ? "#fca5a5" : "#e7e5e4",
            }}
          />
        </FieldWrap>

        <FieldWrap label="Notes (optional)" error={fieldErrors.note}>
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            rows={3}
            placeholder="Any additional notes..."
            style={{
              padding: "8px 12px",
              border: `1px solid ${fieldErrors.note ? "#fca5a5" : "#e7e5e4"}`,
              borderRadius: 8,
              fontSize: 14,
              resize: "vertical",
              outline: "none",
              fontFamily: "inherit",
            }}
          />
        </FieldWrap>

        <FormErrorBanner text={purchaseFormBanner} />
        <Toast status={status} />

        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading}
          style={{
            height: 44,
            background: "var(--accent)",
            color: "#fff",
            border: "none",
            borderRadius: 10,
            fontSize: 15,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {loading ? "Recording..." : "Record Purchase"}
        </button>
      </div>
    </div>

      {isAdminUser ? (
        <div
          style={{
            background: "#fff",
            borderRadius: 12,
            border: "1px solid #e7e5e4",
            padding: 24,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div>
            <div
              style={{
                fontWeight: 600,
                fontSize: 16,
                borderBottom: "1px solid #f0ece8",
                paddingBottom: 10,
                color: "var(--text)",
              }}
            >
              Supplier payments
            </div>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "#78716c" }}>
              Purchases still owed to suppliers. Record partial payments; each entry
              is stored with date and who recorded it.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => void loadPayables()}
              disabled={payLoading}
              style={{
                height: 36,
                padding: "0 14px",
                borderRadius: 8,
                border: "1px solid #e7e5e4",
                background: "#fafaf9",
                color: "#44403c",
                fontSize: 13,
                fontWeight: 600,
                cursor: payLoading ? "not-allowed" : "pointer",
              }}
            >
              Refresh
            </button>
            {payLoading ? (
              <span style={{ fontSize: 13, color: "#78716c" }}>Loading…</span>
            ) : null}
          </div>
          {payError ? (
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                background: "#fef2f2",
                color: "#b91c1c",
                fontSize: 13,
              }}
            >
              {payError}
            </div>
          ) : null}
          {!payLoading && !payError && payRows.length === 0 ? (
            <div style={{ fontSize: 14, color: "#78716c" }}>
              No outstanding supplier balances.
            </div>
          ) : null}
          {!payLoading && payRows.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr style={{ background: "#fafaf9", color: "#78716c" }}>
                    <th style={{ textAlign: "left", padding: "10px 12px" }}>
                      Purchase
                    </th>
                    <th style={{ textAlign: "left", padding: "10px 12px" }}>
                      Date
                    </th>
                    <th style={{ textAlign: "left", padding: "10px 12px" }}>
                      Supplier
                    </th>
                    <th style={{ textAlign: "right", padding: "10px 12px" }}>
                      Total
                    </th>
                    <th style={{ textAlign: "right", padding: "10px 12px" }}>
                      Paid
                    </th>
                    <th style={{ textAlign: "right", padding: "10px 12px" }}>
                      Owed
                    </th>
                    <th style={{ textAlign: "right", padding: "10px 12px" }} />
                  </tr>
                </thead>
                <tbody>
                  {payRows.map((r) => {
                    const dt = new Date(r.createdAt);
                    return (
                      <tr
                        key={r.id}
                        style={{ borderTop: "1px solid #f0ece8" }}
                      >
                        <td style={{ padding: "10px 12px", fontWeight: 600 }}>
                          {r.purchaseNumber}
                        </td>
                        <td style={{ padding: "10px 12px", color: "#78716c" }}>
                          {Number.isNaN(dt.getTime())
                            ? r.createdAt
                            : formatIndiaDateTime(dt)}
                        </td>
                        <td style={{ padding: "10px 12px" }}>{r.supplierName}</td>
                        <td
                          style={{
                            padding: "10px 12px",
                            textAlign: "right",
                            fontFamily: "monospace",
                          }}
                        >
                          {fmt(Number(r.totalAmount))}
                        </td>
                        <td
                          style={{
                            padding: "10px 12px",
                            textAlign: "right",
                            fontFamily: "monospace",
                            color: "#78716c",
                          }}
                        >
                          {fmt(Number(r.paidAmount))}
                        </td>
                        <td
                          style={{
                            padding: "10px 12px",
                            textAlign: "right",
                            fontFamily: "monospace",
                            fontWeight: 600,
                            color: "var(--accent)",
                          }}
                        >
                          {fmt(Number(r.balanceAmount))}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>
                          <button
                            type="button"
                            onClick={() => setPayFor(r)}
                            style={{
                              height: 32,
                              padding: "0 12px",
                              borderRadius: 8,
                              border: "none",
                              background: "var(--accent)",
                              color: "#fff",
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: "pointer",
                            }}
                          >
                            Pay supplier
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      {payFor ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="supplier-pay-title"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => !payLoadingSubmit && setPayFor(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !payLoadingSubmit) setPayFor(null);
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 420,
              background: "var(--surface)",
              borderRadius: 12,
              border: "1px solid var(--border)",
              padding: 20,
              boxShadow: "0 20px 50px rgba(0,0,0,0.15)",
            }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <h3
              id="supplier-pay-title"
              style={{ margin: "0 0 4px", fontSize: 17, color: "var(--text)" }}
            >
              Pay supplier
            </h3>
            <p style={{ margin: "0 0 16px", fontSize: 12, color: "var(--muted)" }}>
              {payFor.purchaseNumber} · {payFor.supplierName} · Balance{" "}
              {fmt(Number(payFor.balanceAmount))}
            </p>
            <label
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--muted)",
                marginBottom: 6,
              }}
            >
              Amount (₹)
            </label>
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              style={{
                ...inputStyle,
                width: "100%",
                boxSizing: "border-box",
                marginBottom: 12,
              }}
            />
            <label
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--muted)",
                marginBottom: 6,
              }}
            >
              Payment date
            </label>
            <input
              type="date"
              value={payPaidAt}
              onChange={(e) => setPayPaidAt(e.target.value)}
              style={{
                ...inputStyle,
                width: "100%",
                boxSizing: "border-box",
                marginBottom: 12,
              }}
            />
            <label
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--muted)",
                marginBottom: 6,
              }}
            >
              Note (optional)
            </label>
            <input
              type="text"
              value={payNote}
              onChange={(e) => setPayNote(e.target.value)}
              placeholder="e.g. NEFT ref, UTR"
              style={{
                ...inputStyle,
                width: "100%",
                boxSizing: "border-box",
                marginBottom: 12,
              }}
            />
            {payMsg ? (
              <div
                style={{
                  fontSize: 13,
                  marginBottom: 10,
                  color: payMsg.type === "err" ? "var(--danger)" : "var(--accent)",
                }}
              >
                {payMsg.text}
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                disabled={payLoadingSubmit}
                onClick={() => setPayFor(null)}
                style={{
                  height: 38,
                  padding: "0 16px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  cursor: payLoadingSubmit ? "not-allowed" : "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={payLoadingSubmit}
                onClick={() => void submitSupplierPayment()}
                style={{
                  height: 38,
                  padding: "0 18px",
                  borderRadius: 8,
                  border: "none",
                  background: "var(--accent)",
                  color: "#fff",
                  fontWeight: 600,
                  cursor: payLoadingSubmit ? "wait" : "pointer",
                }}
              >
                {payLoadingSubmit ? "Saving…" : "Record payment"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// STOCK ADJUSTMENT VIEW
// ═══════════════════════════════════════════════════════════════════
function AdjustmentView({
  products,
  actingUserId,
  onAdjustmentComplete,
}: {
  products: UiProduct[];
  actingUserId: string;
  onAdjustmentComplete: () => Promise<void>;
}) {
  const empty = { productId: "", type: "add" as const, quantity: "", reason: "" };
  const [form, setForm] = useState<{
    productId: string;
    type: "add" | "remove" | "set";
    quantity: string;
    reason: string;
  }>(empty);
  const [status, setStatus] = useState<{
    type: "success" | "error";
    msg: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setFieldErrors({});
  }, [form.productId, form.type, form.quantity, form.reason]);

  const adjustmentFormBanner = useMemo(() => {
    const extra = Object.entries(fieldErrors).filter(
      ([k]) => !ADJUSTMENT_INLINE_ERROR_KEYS.has(k)
    );
    if (extra.length === 0) return undefined;
    return extra.map(([k, v]) => `${k}: ${v}`).join(" · ");
  }, [fieldErrors]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const selectedProduct = products.find((p) => p.id === form.productId);

  const previewStock = (): number | null => {
    if (!selectedProduct || form.quantity === "") return null;
    const qtyVal = Number(form.quantity);
    if (!Number.isFinite(qtyVal)) return null;
    if (form.type === "add") return selectedProduct.stock + qtyVal;
    if (form.type === "remove")
      return Math.max(0, selectedProduct.stock - qtyVal);
    if (form.type === "set") return qtyVal;
    return null;
  };

  const handleSubmit = async () => {
    if (loading) return;
    if (!selectedProduct) {
      setStatus({
        type: "error",
        msg: "Select a product first.",
      });
      setTimeout(() => setStatus(null), 4000);
      return;
    }

    const qtyVal = Number(form.quantity);
    if (form.quantity === "" || !Number.isFinite(qtyVal) || qtyVal < 0) {
      setStatus({ type: "error", msg: "Enter a valid quantity." });
      setTimeout(() => setStatus(null), 4000);
      return;
    }

    const current = selectedProduct.stock;
    let quantityAfter: number;
    if (form.type === "add") quantityAfter = current + qtyVal;
    else if (form.type === "remove") quantityAfter = Math.max(0, current - qtyVal);
    else quantityAfter = qtyVal;

    setLoading(true);
    setStatus(null);
    setFieldErrors({});
    try {
      await api.createStockAdjustment({
        productId: form.productId,
        adjustedById: actingUserId,
        quantityAfter,
        reason: form.reason.trim() || "Stock adjustment",
        note: form.type !== "set" ? `Mode: ${form.type}` : undefined,
      });
      setStatus({
        type: "success",
        msg: "Adjustment recorded — stock updated.",
      });
      setForm(empty);
      await onAdjustmentComplete();
      setTimeout(() => setStatus(null), 4000);
    } catch (e) {
      if (isApiError(e)) {
        const fe: Record<string, string> = {};
        for (const d of e.details ?? []) {
          const k = mapAdjustmentDetailField(d.field);
          if (!fe[k]) fe[k] = d.message;
        }
        setFieldErrors(fe);
        setStatus({ type: "error", msg: e.message });
      } else {
        setStatus({
          type: "error",
          msg: e instanceof Error ? e.message : "Adjustment failed",
        });
      }
      setTimeout(() => setStatus(null), 6000);
    } finally {
      setLoading(false);
    }
  };

  const adjTypes = [
    { value: "add" as const, label: "Add", sub: "Received stock" },
    { value: "remove" as const, label: "Remove", sub: "Damage / write-off" },
    { value: "set" as const, label: "Set", sub: "Physical count" },
  ];

  const preview = previewStock();

  return (
    <div style={{ maxWidth: 560 }}>
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          border: "1px solid #e7e5e4",
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        <div
          style={{
            fontWeight: 600,
            fontSize: 16,
            borderBottom: "1px solid #f0ece8",
            paddingBottom: 14,
          }}
        >
          Stock Adjustment
        </div>

        <FieldWrap label="Product *" error={fieldErrors.productId}>
          <select
            value={form.productId}
            onChange={(e) => set("productId", e.target.value)}
            style={{ ...inputStyle, padding: "0 10px", cursor: "pointer" }}
          >
            <option value="">— Select product —</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.sku}) — {p.stock} {p.unit}
              </option>
            ))}
          </select>
        </FieldWrap>

        <FieldWrap label="Adjustment Type *">
          <div style={{ display: "flex", gap: 8 }}>
            {adjTypes.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => set("type", t.value)}
                style={{
                  flex: 1,
                  padding: "10px 6px",
                  borderRadius: 8,
                  cursor: "pointer",
                  textAlign: "center",
                  border:
                    form.type === t.value
                      ? "2px solid var(--accent)"
                      : "1px solid #e7e5e4",
                  background: form.type === t.value ? "rgba(37,99,235,0.08)" : "#fff",
                  color: form.type === t.value ? "var(--accent)" : "#44403c",
                  fontWeight: form.type === t.value ? 600 : 400,
                  transition: "all 0.1s",
                }}
              >
                <div style={{ fontSize: 14 }}>{t.label}</div>
                <div
                  style={{
                    fontSize: 11,
                    color: form.type === t.value ? "var(--accent)" : "#a8a29e",
                    marginTop: 3,
                  }}
                >
                  {t.sub}
                </div>
              </button>
            ))}
          </div>
        </FieldWrap>

        <FieldWrap
          label="Quantity *"
          error={fieldErrors.quantity ?? fieldErrors.quantityAfter}
        >
          <input
            type="number"
            min={0}
            step="any"
            placeholder="0"
            value={form.quantity}
            onChange={(e) => set("quantity", e.target.value)}
            style={{
              ...inputStyle,
              borderColor:
                fieldErrors.quantity || fieldErrors.quantityAfter
                  ? "#fca5a5"
                  : "#e7e5e4",
            }}
          />
        </FieldWrap>

        {selectedProduct && preview !== null && (
          <div
            style={{
              background: "#f5f4f0",
              borderRadius: 8,
              padding: "10px 14px",
              display: "flex",
              justifyContent: "space-between",
              fontSize: 13,
            }}
          >
            <span style={{ color: "#78716c" }}>
              Current → After adjustment
            </span>
            <span style={{ fontFamily: "monospace", fontWeight: 600 }}>
              {selectedProduct.stock}
              {" → "}
              <span
                style={{
                  color:
                    preview <= selectedProduct.lowStock
                      ? preview === 0
                        ? "#dc2626"
                        : "#d97706"
                      : "#16a34a",
                }}
              >
                {preview}
              </span>{" "}
              {selectedProduct.unit}
            </span>
          </div>
        )}

        <FieldWrap label="Reason" error={fieldErrors.reason}>
          <input
            placeholder="e.g. Physical count, damaged goods, customer return..."
            value={form.reason}
            onChange={(e) => set("reason", e.target.value)}
            style={{
              ...inputStyle,
              borderColor: fieldErrors.reason ? "#fca5a5" : "#e7e5e4",
            }}
          />
        </FieldWrap>

        <FormErrorBanner text={adjustmentFormBanner} />
        <Toast status={status} />

        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading}
          style={{
            height: 44,
            background: "#1c1917",
            color: "#fff",
            border: "none",
            borderRadius: 10,
            fontSize: 15,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {loading ? "Saving..." : "Save Adjustment"}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// APP ROOT
// ═══════════════════════════════════════════════════════════════════

export default function App() {
  const { confirmProps, confirm } = useConfirm();
  const [authPhase, setAuthPhase] = useState<"anon" | "validating" | "ready">(
    () =>
      typeof window !== "undefined" && getAuthToken() ? "validating" : "anon"
  );
  const [viewportWidth, setViewportWidth] = useState(
    typeof window === "undefined" ? 1280 : window.innerWidth
  );
  const [tab, setTab] = useState<Tab>("home");
  const [rawProducts, setRawProducts] = useState<ApiProduct[]>([]);
  const [products, setProducts] = useState<UiProduct[]>([]);
  const [promotions, setPromotions] = useState<ApiPromotion[]>([]);
  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [customers, setCustomers] = useState<ApiCustomer[]>([]);
  const [sessionUsers, setSessionUsers] = useState<SessionUserRow[]>([]);
  const [actingUserId, setActingUserIdState] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sidebarExpanded, setSidebarExpanded] = useState(
    typeof window === "undefined" ? true : window.innerWidth >= 1024
  );

  const refreshProducts = useCallback(async () => {
    const raw = await api.getProducts();
    setRawProducts(raw);
    setProducts(
      raw.filter((p) => p.status === "ACTIVE").map(mapApiProduct)
    );
  }, []);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const isSmallScreen = viewportWidth < 1024;
  const isNarrow = viewportWidth < 1200;

  useEffect(() => {
    setSidebarExpanded(!isSmallScreen);
  }, [isSmallScreen]);

  useEffect(() => {
    if (authPhase !== "validating") return;
    let cancelled = false;
    void (async () => {
      try {
        await api.getSession();
        if (!cancelled) setAuthPhase("ready");
      } catch {
        if (!cancelled) {
          logoutAuth();
          setAuthPhase("anon");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authPhase]);

  const refreshSuppliers = useCallback(async () => {
    try {
      const sups = await api.getSuppliers();
      setSuppliers(sups);
    } catch {
      setSuppliers([]);
    }
  }, []);

  const actingUser = useMemo(
    () => sessionUsers.find((u) => u.id === actingUserId),
    [sessionUsers, actingUserId]
  );
  const isAdminUser =
    actingUser?.role === "ADMIN" || actingUser?.role === "MANAGER";

  const handleActingUserChange = useCallback(
    (id: string) => {
      setActingUserIdState(id);
      setActingUserId(id);
      const u = sessionUsers.find((x) => x.id === id);
      const admin = u?.role === "ADMIN" || u?.role === "MANAGER";
      if (
        !admin &&
        ["reporting", "promotion", "purchase", "adjustment"].includes(tab)
      ) {
        setTab("home");
      }
      void (async () => {
        try {
          const [raw, sups] = await Promise.all([
            api.getProducts(),
            api.getSuppliers().catch(() => [] as ApiSupplier[]),
          ]);
          setRawProducts(raw);
          setProducts(
            raw.filter((p) => p.status === "ACTIVE").map(mapApiProduct)
          );
          setSuppliers(Array.isArray(sups) ? sups : []);
          if (FEATURE_FLAGS.catalogPromotions) {
            try {
              setPromotions(await api.getPromotions());
            } catch {
              setPromotions([]);
            }
          } else {
            setPromotions([]);
          }
        } catch {
          /* ignore */
        }
      })();
    },
    [sessionUsers, tab]
  );

  const refreshCustomers = useCallback(async () => {
    try {
      const rows = await api.getCustomers();
      setCustomers(rows);
    } catch {
      setCustomers([]);
    }
  }, []);

  const refreshPromotions = useCallback(async () => {
    if (!FEATURE_FLAGS.catalogPromotions) {
      setPromotions([]);
      return;
    }
    try {
      const rows = await api.getPromotions();
      setPromotions(rows);
    } catch {
      setPromotions([]);
    }
  }, []);

  useEffect(() => {
    if (authPhase !== "ready") return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const session = await api.getSession();
        if (cancelled) return;
        setSessionUsers(session.users ?? []);
        const stored =
          typeof localStorage !== "undefined"
            ? localStorage.getItem("inventoryActingUserId")
            : null;
        const ok =
          stored && session.users?.some((u: SessionUserRow) => u.id === stored);
        const pick = ok ? stored! : session.user.id;
        setActingUserIdState(pick);
        setActingUserId(pick);

        const [rawProducts, sups] = await Promise.all([
          api.getProducts(),
          api.getSuppliers().catch(() => [] as ApiSupplier[]),
        ]);
        if (cancelled) return;
        setRawProducts(rawProducts);
        setProducts(
          rawProducts.filter((p) => p.status === "ACTIVE").map(mapApiProduct)
        );
        setSuppliers(Array.isArray(sups) ? sups : []);
        try {
          const custs = await api.getCustomers();
          if (!cancelled) setCustomers(custs);
        } catch {
          if (!cancelled) setCustomers([]);
        }
        if (FEATURE_FLAGS.catalogPromotions) {
          try {
            const promoRows = await api.getPromotions();
            if (!cancelled) setPromotions(promoRows);
          } catch {
            if (!cancelled) setPromotions([]);
          }
        } else if (!cancelled) {
          setPromotions([]);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load data");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authPhase]);

  useEffect(() => {
    if (!FEATURE_FLAGS.catalogPromotions && tab === "promotion") {
      setTab("home");
      return;
    }
    if (
      !isAdminUser &&
      ["reporting", "promotion", "purchase", "adjustment"].includes(tab)
    ) {
      setTab("home");
    }
  }, [isAdminUser, tab]);

  if (authPhase === "anon") {
    return (
      <LoginPage
        onLoggedIn={() => {
          setAuthPhase("ready");
          setTab("pos");
        }}
      />
    );
  }

  if (authPhase === "validating") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg)",
          color: "var(--muted)",
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: 14,
          gap: 12,
        }}
      >
        <span
          style={{
            width: 22,
            height: 22,
            border: "2px solid var(--border)",
            borderTopColor: "var(--accent)",
            borderRadius: "50%",
            display: "inline-block",
            animation: "app-auth-spin 0.75s linear infinite",
          }}
        />
        Signing in…
        <style>{`@keyframes app-auth-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <>
      <div
      style={{
        display: "flex",
        flexDirection: "row",
        height: "100vh",
        fontFamily: "Inter, system-ui, -apple-system, sans-serif",
        background: "var(--bg)",
        overflow: "hidden",
      }}
    >
      <Sidebar
        activeTab={tab}
        onTabChange={setTab}
        isAdmin={isAdminUser}
        mobile={isSmallScreen}
        iconOnly={isSmallScreen && !sidebarExpanded}
        onToggleExpand={
          isSmallScreen ? () => setSidebarExpanded((v) => !v) : undefined
        }
      />

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        <div
          style={{
            background: "var(--surface)",
            borderBottom: "1px solid var(--border)",
            height: 56,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: isSmallScreen ? "0 14px" : "0 24px",
            gap: 16,
            flexShrink: 0,
          }}
        >
          <span style={{ color: "var(--text)", fontSize: 14, fontWeight: 600 }}>
            Santosh Electricals Works
          </span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
            {!loading && sessionUsers.length > 1 && isAdminUser ? (
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  color: "var(--muted)",
                }}
              >
                <span style={{ whiteSpace: "nowrap" }}>Acting as</span>
                <select
                  value={actingUserId}
                  onChange={(e) => handleActingUserChange(e.target.value)}
                  style={{
                    height: 32,
                    padding: "0 10px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--surface)",
                    color: "var(--text)",
                    fontSize: 12,
                    maxWidth: isSmallScreen ? 160 : 260,
                  }}
                >
                  {sessionUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}
                      {u.role === "CASHIER"
                        ? " (Cashier)"
                        : u.role === "MANAGER"
                          ? " (Manager)"
                          : " (Admin)"}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <span style={{ color: "var(--muted)", fontSize: 13, whiteSpace: "nowrap" }}>
              {formatIndiaDateLong()}
            </span>
            <button
              type="button"
              onClick={() => {
                logoutAuth();
                setAuthPhase("anon");
                setTab("home");
              }}
              style={{
                height: 32,
                padding: "0 12px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--surface-subtle)",
                color: "var(--text)",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Log out
            </button>
          </div>
        </div>

        <main
          style={{
            flex: 1,
            background: "var(--bg)",
            overflowY: "auto",
            minHeight: 0,
          }}
        >
          <div
            style={{
              padding: isSmallScreen ? "12px" : isNarrow ? "16px" : "24px",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              boxSizing: "border-box",
              maxWidth: 1400,
              margin: "0 auto",
              width: "100%",
            }}
          >
            {loading && (
              <div
                style={{
                  textAlign: "center",
                  padding: 80,
                  color: "#78716c",
                  fontSize: 14,
                }}
              >
                Loading products…
              </div>
            )}
            {error && (
              <div
                style={{
                  background: "var(--surface)",
                  color: "var(--danger)",
                  padding: "14px 18px",
                  borderRadius: 10,
                  fontSize: 14,
                }}
              >
                Error: {error}
              </div>
            )}
            {!loading && !error && (
              <>
                {tab === "home" && (
                  <HomeView
                    onTabChange={setTab}
                    isAdmin={isAdminUser}
                    products={products}
                  />
                )}
                {tab === "products" && (
                  <ProductsPage
                    onProductsCreated={refreshProducts}
                    allowMutations={isAdminUser}
                    confirm={confirm}
                  />
                )}
                {FEATURE_FLAGS.catalogPromotions && tab === "promotion" && (
                  <PromotionsPage
                    products={rawProducts}
                    promotions={promotions}
                    onPromotionCreated={refreshPromotions}
                    confirm={confirm}
                  />
                )}
                {tab === "pos" && (
                  <POSView
                    products={products}
                    promotions={promotions}
                    actingUserId={actingUserId}
                    customers={customers}
                    refreshCustomers={refreshCustomers}
                    onSaleComplete={refreshProducts}
                  />
                )}
                {tab === "outstanding" && (
                  <OutstandingView actingUserId={actingUserId} />
                )}
                {tab === "invoices" && <ReprintInvoicePage />}
                {tab === "inventory" && (
                  <InventoryView products={products} />
                )}
                {tab === "purchase" && (
                  <PurchaseView
                    products={products}
                    suppliers={suppliers}
                    actingUserId={actingUserId}
                    onPurchaseComplete={refreshProducts}
                    refreshSuppliers={refreshSuppliers}
                    isAdminUser={isAdminUser}
                  />
                )}
                {tab === "adjustment" && (
                  <AdjustmentView
                    products={products}
                    actingUserId={actingUserId}
                    onAdjustmentComplete={refreshProducts}
                  />
                )}
                {tab === "reporting" && <ReportingPage />}
              </>
            )}
          </div>
        </main>
      </div>
      </div>
      <ConfirmModal {...confirmProps} />
    </>
  );
}
