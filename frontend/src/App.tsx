import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { api } from "./api/client";
import { isApiError } from "./api/errors";
import type {
  ApiCustomer,
  ApiProduct,
  ApiPromotion,
  ApiSupplier,
  CreateSaleBody,
} from "./api/types";
import { allocateLineDiscounts } from "./lib/allocateLineDiscounts";
import {
  lineErrorsFromDetails,
  mapAdjustmentDetailField,
  mapPurchaseDetailField,
  recordFieldErrors,
} from "./lib/formErrors";
import { mapApiProduct, type UiProduct } from "./lib/mapProduct";
import { HomeView } from "./HomeView";
import { ConfirmModal } from "./ConfirmModal";
import { PromotionsPage } from "./pages/PromotionsPage";
import { ProductsPage } from "./pages/ProductsPage";
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

// ═══════════════════════════════════════════════════════════════════
// POS VIEW
// ═══════════════════════════════════════════════════════════════════
function POSView({
  products,
  promotions,
  cashierUserId,
  customers,
  refreshCustomers,
  onSaleComplete,
}: {
  products: UiProduct[];
  promotions: ApiPromotion[];
  cashierUserId: string;
  customers: ApiCustomer[];
  refreshCustomers: () => Promise<void>;
  onSaleComplete: () => Promise<void>;
}) {
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
  const [customerPhoneError, setCustomerPhoneError] = useState<string | null>(null);
  const [customerSuggestOpen, setCustomerSuggestOpen] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);

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

  const pickRegisteredCustomer = (c: ApiCustomer) => {
    setPosCustomerId(c.id);
    setCustomerQuery("");
    setWalkInPhone("");
    setCustomerPhoneError(null);
    setCustomerSuggestOpen(false);
  };

  const clearRegisteredCustomer = () => {
    setPosCustomerId("");
    setCustomerPhoneError(null);
    setCustomerSuggestOpen(false);
  };

  /** Registers typed walk-in as a customer only when cashier clicks Save — not on checkout */
  const saveCustomerFromWalkIn = async () => {
    const name = customerQuery.trim();
    const phone = walkInPhone.trim();
    if (!name || posCustomerId || savingCustomer) return;
    if (!phone) {
      setCustomerPhoneError("Phone number is required to save a customer.");
      return;
    }
    setCustomerPhoneError(null);
    setSavingCustomer(true);
    setStatus(null);
    try {
      const c = await api.createCustomer({
        name,
        phone,
      });
      await refreshCustomers();
      setPosCustomerId(c.id);
      setCustomerQuery("");
      setWalkInPhone("");
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
      if (promotionCode.trim() && !cartPromotion) {
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

      const saleBody: CreateSaleBody = {
        createdById: cashierUserId,
        note: [
          discount > 0 ? `POS discount ${discount}%` : "",
          cartPromotion ? `Cart promo ${cartPromotion.code}` : "",
        ]
          .filter(Boolean)
          .join(" | ") || undefined,
        paidAmount: total,
        lines: cart.map((x, i) => ({
          productId: x.id,
          productUnitId: x.baseUnitId,
          quantity: x.qty,
          unitPrice: x.price,
          lineDiscount: lineDiscounts[i] ?? 0,
          lineTax: 0,
        })),
      };
      if (posCustomerId) {
        saleBody.customerId = posCustomerId;
      } else {
        if (customerQuery.trim()) {
          saleBody.customerName = customerQuery.trim();
        }
        if (walkInPhone.trim()) {
          saleBody.customerPhone = walkInPhone.trim();
        }
      }

      const sale = await api.createSale(saleBody);

      const snap =
        (sale.customerNameSnapshot ?? sale.customerName)?.trim() ?? "";
      setStatus({
        type: "success",
        msg: snap
          ? `Sale complete — ${sale.saleNumber} · ${snap}`
          : `Sale complete — ${sale.saleNumber}`,
      });
      setCart([]);
      setDiscount(0);
      setPromotionCode("");
      setPosCustomerId("");
      setCustomerQuery("");
      setWalkInPhone("");
      setCustomerPhoneError(null);
      setCustomerSuggestOpen(false);
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
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 308px",
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
        <div style={{ display: "flex", gap: 8 }}>
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
          {cart.length > 0 && (
            <button
              type="button"
              onClick={() => setCart([])}
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
                    const ph = customers.find((x) => x.id === posCustomerId)
                      ?.phone;
                    return ph ? (
                      <div style={{ fontSize: 12, color: "#78716c", marginTop: 2 }}>
                        {ph}
                      </div>
                    ) : null;
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
                  placeholder="Phone (optional)"
                  value={walkInPhone}
                  onChange={(e) => {
                    setWalkInPhone(e.target.value);
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
                <div
                  style={{
                    fontSize: 11,
                    color: "#a8a29e",
                    marginTop: 6,
                    lineHeight: 1.35,
                  }}
                >
                  Checkout without saving keeps this sale as walk-in only (not
                  added to customers).
                </div>
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
              {fmt(total)}
            </span>
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
  );
}

// ═══════════════════════════════════════════════════════════════════
// INVENTORY VIEW
// ═══════════════════════════════════════════════════════════════════
function InventoryView({ products }: { products: UiProduct[] }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<InventorySortKey>("sku");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const totalValue = products.reduce((s, p) => s + p.price * p.stock, 0);
  const lowCount = products.filter((p) => stockStatus(p) === "low").length;
  const outCount = products.filter((p) => stockStatus(p) === "out").length;

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
    );
  }, [products, search]);

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
      value: String(products.length),
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
      color: "var(--accent)",
      mono: false,
    },
    {
      label: "Out of Stock",
      value: String(outCount),
      color: "var(--muted)",
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
          gridTemplateColumns: "repeat(4, 1fr)",
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

      <input
        placeholder="Search by name, SKU or category..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ ...inputStyle, maxWidth: 380 }}
      />

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
  "productId",
  "quantity",
  "unitCost",
  "invoiceDate",
  "note",
]);

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
  adminUserId,
  onPurchaseComplete,
  refreshSuppliers,
}: {
  products: UiProduct[];
  suppliers: ApiSupplier[];
  adminUserId: string;
  onPurchaseComplete: () => Promise<void>;
  refreshSuppliers: () => Promise<void>;
}) {
  const empty = {
    productId: "",
    supplierId: "",
    quantity: "",
    unitCost: "",
    purchaseDate: new Date().toISOString().slice(0, 10),
    notes: "",
  };
  const [form, setForm] = useState(empty);
  const [status, setStatus] = useState<{
    type: "success" | "error";
    msg: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

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

  useEffect(() => {
    setFieldErrors({});
  }, [
    form.productId,
    form.supplierId,
    form.quantity,
    form.unitCost,
    form.purchaseDate,
    form.notes,
  ]);

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

  const set = (k: keyof typeof empty, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

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
    setNewSupplier((s) => ({ ...s, [k]: v }));
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
    setCreatingSupplier(true);
    setNewSupplierErrors({});
    setSupplierPanelMsg(null);
    try {
      const s = await api.createSupplier({
        name: trimmedName,
        contactPerson: newSupplier.contactPerson.trim() || undefined,
        phone: newSupplier.phone.trim() || undefined,
        email: newSupplier.email.trim() || undefined,
        address: newSupplier.address.trim() || undefined,
        gstNumber: newSupplier.gstNumber.trim() || undefined,
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

  const selectedProduct = products.find((p) => p.id === form.productId);

  const totalCost =
    (Number(form.quantity) || 0) * (Number(form.unitCost) || 0);

  const handleSubmit = async () => {
    if (loading) return;
    setLoading(true);
    setStatus(null);
    setFieldErrors({});
    try {
      const purchase = await api.createPurchase({
        supplierId: form.supplierId,
        createdById: adminUserId,
        invoiceDate: form.purchaseDate || undefined,
        note: form.notes || undefined,
        lines: [
          {
            productId: form.productId,
            productUnitId: selectedProduct?.baseUnitId ?? "",
            quantity: Number(form.quantity),
            unitCost: Number(form.unitCost),
          },
        ],
      });
      setStatus({
        type: "success",
        msg: `Purchase recorded — ${purchase.purchaseNumber}`,
      });
      setForm({
        ...empty,
        purchaseDate: new Date().toISOString().slice(0, 10),
      });
      await onPurchaseComplete();
      setTimeout(() => setStatus(null), 4000);
    } catch (e) {
      if (isApiError(e)) {
        const fe: Record<string, string> = {};
        for (const d of e.details ?? []) {
          const k = mapPurchaseDetailField(d.field);
          if (!fe[k]) fe[k] = d.message;
        }
        setFieldErrors(fe);
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
          New Purchase Entry
        </div>

        <FieldWrap label="Supplier *" error={fieldErrors.supplierId}>
          <select
            value={form.supplierId}
            onChange={(e) => {
              set("supplierId", e.target.value);
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

        <FieldWrap label="Product *" error={fieldErrors.productId}>
          <select
            value={form.productId}
            onChange={(e) => set("productId", e.target.value)}
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

        {selectedProduct && (
          <div
            style={{
              background: "#fef9ee",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
              color: "#78716c",
              display: "flex",
              gap: 20,
            }}
          >
            <span>
              Current stock:{" "}
              <strong style={{ color: "#1c1917" }}>
                {selectedProduct.stock} {selectedProduct.unit}
              </strong>
            </span>
            <span>
              Sale price:{" "}
              <strong style={{ color: "#1c1917" }}>
                {fmt(selectedProduct.price)}
              </strong>
            </span>
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 14,
          }}
        >
          <FieldWrap label="Quantity *" error={fieldErrors.quantity}>
            <input
              type="number"
              min={0.0001}
              step="any"
              placeholder="0"
              value={form.quantity}
              onChange={(e) => set("quantity", e.target.value)}
              style={{
                ...inputStyle,
                borderColor: fieldErrors.quantity ? "#fca5a5" : "#e7e5e4",
              }}
            />
          </FieldWrap>
          <FieldWrap label="Unit Cost (₹) *" error={fieldErrors.unitCost}>
            <input
              type="number"
              min={0}
              step="any"
              placeholder="0.00"
              value={form.unitCost}
              onChange={(e) => set("unitCost", e.target.value)}
              style={{
                ...inputStyle,
                borderColor: fieldErrors.unitCost ? "#fca5a5" : "#e7e5e4",
              }}
            />
          </FieldWrap>
        </div>

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
            onChange={(e) => set("purchaseDate", e.target.value)}
            style={{
              ...inputStyle,
              borderColor: fieldErrors.invoiceDate ? "#fca5a5" : "#e7e5e4",
            }}
          />
        </FieldWrap>

        <FieldWrap label="Notes (optional)" error={fieldErrors.note}>
          <textarea
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
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
  );
}

// ═══════════════════════════════════════════════════════════════════
// STOCK ADJUSTMENT VIEW
// ═══════════════════════════════════════════════════════════════════
function AdjustmentView({
  products,
  adminUserId,
  onAdjustmentComplete,
}: {
  products: UiProduct[];
  adminUserId: string;
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
        adjustedById: adminUserId,
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
  const [tab, setTab] = useState<Tab>("home");
  const [rawProducts, setRawProducts] = useState<ApiProduct[]>([]);
  const [products, setProducts] = useState<UiProduct[]>([]);
  const [promotions, setPromotions] = useState<ApiPromotion[]>([]);
  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [customers, setCustomers] = useState<ApiCustomer[]>([]);
  const [adminUserId, setAdminUserId] = useState("");
  const [cashierUserId, setCashierUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshProducts = useCallback(async () => {
    const raw = await api.getProducts();
    setRawProducts(raw);
    setProducts(raw.map(mapApiProduct));
  }, []);

  const refreshSuppliers = useCallback(async () => {
    const sups = await api.getSuppliers();
    setSuppliers(sups);
  }, []);

  const refreshCustomers = useCallback(async () => {
    try {
      const rows = await api.getCustomers();
      setCustomers(rows);
    } catch {
      setCustomers([]);
    }
  }, []);

  const refreshPromotions = useCallback(async () => {
    try {
      const rows = await api.getPromotions();
      setPromotions(rows);
    } catch {
      setPromotions([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [session, rawProducts, sups] = await Promise.all([
          api.getSession(),
          api.getProducts(),
          api.getSuppliers(),
        ]);
        if (cancelled) return;
        setAdminUserId(session.adminUserId);
        setCashierUserId(session.cashierUserId);
        setRawProducts(rawProducts);
        setProducts(rawProducts.map(mapApiProduct));
        setSuppliers(sups);
        try {
          const custs = await api.getCustomers();
          if (!cancelled) setCustomers(custs);
        } catch {
          if (!cancelled) setCustomers([]);
        }
        try {
          const promoRows = await api.getPromotions();
          if (!cancelled) setPromotions(promoRows);
        } catch {
          if (!cancelled) setPromotions([]);
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
  }, []);

  return (
    <>
      <div
      style={{
        display: "flex",
        minHeight: "100vh",
        fontFamily: "Inter, system-ui, -apple-system, sans-serif",
        background: "var(--bg)",
      }}
    >
      <Sidebar activeTab={tab} onTabChange={setTab} />

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
            padding: "0 24px",
            gap: 16,
            flexShrink: 0,
          }}
        >
          <span style={{ color: "var(--text)", fontSize: 14, fontWeight: 600 }}>
            Hardware Inventory & POS
          </span>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>
            {new Date().toLocaleDateString("en-IN", { dateStyle: "long" })}
          </span>
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
              padding: "24px",
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
                {tab === "home" && <HomeView onTabChange={setTab} />}
                {tab === "products" && (
                  <ProductsPage onProductsCreated={refreshProducts} />
                )}
                {tab === "promotion" && (
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
                    cashierUserId={cashierUserId}
                    customers={customers}
                    refreshCustomers={refreshCustomers}
                    onSaleComplete={refreshProducts}
                  />
                )}
                {tab === "inventory" && (
                  <InventoryView products={products} />
                )}
                {tab === "purchase" && (
                  <PurchaseView
                    products={products}
                    suppliers={suppliers}
                    adminUserId={adminUserId}
                    onPurchaseComplete={refreshProducts}
                    refreshSuppliers={refreshSuppliers}
                  />
                )}
                {tab === "adjustment" && (
                  <AdjustmentView
                    products={products}
                    adminUserId={adminUserId}
                    onAdjustmentComplete={refreshProducts}
                  />
                )}
                {tab === "reporting" && (
                  <div style={{ padding: 24, color: "#78716c" }}>
                    Reporting is not enabled.
                  </div>
                )}
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
