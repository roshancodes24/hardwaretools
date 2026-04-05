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
import type { ApiSupplier } from "./api/types";
import { allocateLineDiscounts } from "./lib/allocateLineDiscounts";
import {
  lineErrorsFromDetails,
  mapAdjustmentDetailField,
  mapPurchaseDetailField,
  recordFieldErrors,
} from "./lib/formErrors";
import { mapApiProduct, type UiProduct } from "./lib/mapProduct";

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
        color: status.type === "success" ? "#16a34a" : "#dc2626",
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
}: {
  label: string;
  children: ReactNode;
  error?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 13, fontWeight: 500, color: "#44403c" }}>
        {label}
      </label>
      {children}
      {error ? (
        <span style={{ fontSize: 12, color: "#dc2626" }}>{error}</span>
      ) : null}
    </div>
  );
}

const inputStyle: CSSProperties = {
  height: 38,
  padding: "0 12px",
  border: "1px solid #e7e5e4",
  borderRadius: 8,
  fontSize: 14,
  outline: "none",
  background: "#fff",
};

type CartLine = UiProduct & { qty: number };

// ═══════════════════════════════════════════════════════════════════
// POS VIEW
// ═══════════════════════════════════════════════════════════════════
function POSView({
  products,
  cashierUserId,
  onSaleComplete,
}: {
  products: UiProduct[];
  cashierUserId: string;
  onSaleComplete: () => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState(0);
  const [status, setStatus] = useState<{
    type: "success" | "error";
    msg: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [lineErrors, setLineErrors] = useState<
    Map<number, Record<string, string>>
  >(() => new Map());

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

  const subtotal = cart.reduce((s, x) => s + x.price * x.qty, 0);
  const discountAmt = subtotal * (discount / 100);
  const total = subtotal - discountAmt;

  const handleCheckout = async () => {
    if (!cart.length || loading) return;
    setLoading(true);
    setStatus(null);
    setFieldErrors({});
    setLineErrors(new Map());
    try {
      const lineSubtotals = cart.map((x) => x.price * x.qty);
      const lineDiscounts = allocateLineDiscounts(lineSubtotals, discount);

      const sale = await api.createSale({
        createdById: cashierUserId,
        note: discount > 0 ? `POS discount ${discount}%` : undefined,
        paidAmount: total,
        lines: cart.map((x, i) => ({
          productId: x.id,
          productUnitId: x.baseUnitId,
          quantity: x.qty,
          unitPrice: x.price,
          lineDiscount: lineDiscounts[i] ?? 0,
          lineTax: 0,
        })),
      });

      setStatus({
        type: "success",
        msg: `Sale complete — ${sale.saleNumber}`,
      });
      setCart([]);
      setDiscount(0);
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
        gridTemplateColumns: "1fr 340px",
        gap: 16,
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
        <div style={{ display: "flex", gap: 10 }}>
          <input
            placeholder="Search by name or SKU..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle, flex: 1 }}
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{ ...inputStyle, padding: "0 10px", cursor: "pointer" }}
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
            gridTemplateColumns: "repeat(auto-fill, minmax(156px, 1fr))",
            gap: 10,
            alignContent: "start",
          }}
        >
          {filtered.map((p) => {
            const st = stockStatus(p);
            const inCart = cart.find((x) => x.id === p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => addToCart(p)}
                disabled={st === "out"}
                style={{
                  background: "#fff",
                  textAlign: "left",
                  padding: "12px 10px",
                  borderRadius: 10,
                  cursor: st === "out" ? "not-allowed" : "pointer",
                  opacity: st === "out" ? 0.5 : 1,
                  position: "relative",
                  border: inCart
                    ? "2px solid #d97706"
                    : "1px solid #e7e5e4",
                  transition: "border-color 0.1s",
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: "#a8a29e",
                    marginBottom: 3,
                  }}
                >
                  {p.sku}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#1c1917",
                    lineHeight: 1.3,
                    marginBottom: 6,
                  }}
                >
                  {p.name}
                </div>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    fontFamily: "monospace",
                    color: "#1c1917",
                  }}
                >
                  {fmt(p.price)}
                </div>
                <div
                  style={{ fontSize: 11, color: "#a8a29e", marginBottom: 8 }}
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
                      background: "#d97706",
                      color: "#fff",
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
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
      </div>

      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          border: "1px solid #e7e5e4",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "13px 16px",
            borderBottom: "1px solid #f0ece8",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 15 }}>Current Sale</span>
          {cart.length > 0 && (
            <button
              type="button"
              onClick={() => setCart([])}
              style={{
                fontSize: 12,
                color: "#dc2626",
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
                padding: "48px 16px",
                textAlign: "center",
                color: "#a8a29e",
                fontSize: 14,
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
                  style={{ borderBottom: "1px solid #fafaf9" }}
                >
                  <div
                    style={{
                      padding: "10px 14px",
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: "#1c1917",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {item.name}
                      </div>
                      <div style={{ fontSize: 12, color: "#78716c" }}>
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
                          width: 26,
                          height: 26,
                          borderRadius: 6,
                          border: "1px solid #e7e5e4",
                          background: "#fafaf9",
                          cursor: "pointer",
                          fontSize: 15,
                          fontWeight: 700,
                          color: "#44403c",
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
                          width: 52,
                          height: 26,
                          textAlign: "center",
                          border: lineErrDetail(lineIndex, "quantity")
                            ? "1px solid #fca5a5"
                            : "1px solid #e7e5e4",
                          borderRadius: 6,
                          fontSize: 13,
                          outline: "none",
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => updateQty(item.id, item.qty + 1)}
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 6,
                          border: "1px solid #e7e5e4",
                          background: "#fafaf9",
                          cursor: "pointer",
                          fontSize: 15,
                          fontWeight: 700,
                          color: "#44403c",
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
                        fontSize: 13,
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
                        color: "#dc2626",
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
            borderTop: "1px solid #e7e5e4",
            padding: "14px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
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
                color: "#dc2626",
                fontFamily: "monospace",
                minWidth: 64,
                textAlign: "right",
              }}
            >
              −{fmt(discountAmt)}
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
            <span style={{ fontFamily: "monospace", color: "#d97706" }}>
              {fmt(total)}
            </span>
          </div>
          {fieldErrors.paidAmount ? (
            <div style={{ fontSize: 12, color: "#dc2626" }}>
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
              background: cart.length ? "#d97706" : "#e7e5e4",
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
}: {
  products: UiProduct[];
  suppliers: ApiSupplier[];
  adminUserId: string;
  onPurchaseComplete: () => Promise<void>;
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

  const purchaseFormBanner = useMemo(() => {
    const extra = Object.entries(fieldErrors).filter(
      ([k]) => !PURCHASE_INLINE_ERROR_KEYS.has(k)
    );
    if (extra.length === 0) return undefined;
    return extra.map(([k, v]) => `${k}: ${v}`).join(" · ");
  }, [fieldErrors]);

  const set = (k: keyof typeof empty, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

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
            onChange={(e) => set("supplierId", e.target.value)}
            style={{ ...inputStyle, padding: "0 10px", cursor: "pointer" }}
          >
            <option value="">— Select supplier —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </FieldWrap>

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
            background: "#d97706",
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
                      ? "2px solid #d97706"
                      : "1px solid #e7e5e4",
                  background: form.type === t.value ? "#fef9ee" : "#fff",
                  color: form.type === t.value ? "#b45309" : "#44403c",
                  fontWeight: form.type === t.value ? 600 : 400,
                  transition: "all 0.1s",
                }}
              >
                <div style={{ fontSize: 14 }}>{t.label}</div>
                <div
                  style={{
                    fontSize: 11,
                    color: form.type === t.value ? "#d97706" : "#a8a29e",
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
const TABS = [
  { id: "pos", label: "Point of Sale" },
  { id: "inventory", label: "Inventory" },
  { id: "purchase", label: "Purchases" },
  { id: "adjustment", label: "Stock Adjust" },
] as const;

export default function App() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("pos");
  const [products, setProducts] = useState<UiProduct[]>([]);
  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [adminUserId, setAdminUserId] = useState("");
  const [cashierUserId, setCashierUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshProducts = useCallback(async () => {
    const raw = await api.getProducts();
    setProducts(raw.map(mapApiProduct));
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
        setProducts(rawProducts.map(mapApiProduct));
        setSuppliers(sups);
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

  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f4f0",
        fontFamily: "system-ui, -apple-system, sans-serif",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          background: "#1c1917",
          height: 54,
          padding: "0 24px",
          display: "flex",
          alignItems: "center",
          gap: 28,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 28,
              height: 28,
              background: "#d97706",
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#fff"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 3h18l-2 13H5L3 3z" />
              <circle cx="9" cy="20" r="1" />
              <circle cx="15" cy="20" r="1" />
            </svg>
          </div>
          <span style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>
            Raj Electrical, Hardware and Paints
          </span>
          <span style={{ color: "#57534e", fontSize: 13, marginLeft: 4 }}>
            POS & Inventory
          </span>
        </div>

        <nav style={{ display: "flex", flex: 1 }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              style={{
                height: 54,
                padding: "0 16px",
                background: "none",
                border: "none",
                borderBottom:
                  tab === t.id ? "2px solid #d97706" : "2px solid transparent",
                color: tab === t.id ? "#d97706" : "#a8a29e",
                fontWeight: tab === t.id ? 600 : 400,
                fontSize: 14,
                cursor: "pointer",
                transition: "color 0.15s",
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div
          style={{ color: "#57534e", fontSize: 12, whiteSpace: "nowrap" }}
        >
          {today}
        </div>
      </div>

      <div
        style={{
          flex: 1,
          padding: "20px 24px",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
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
              background: "#fee2e2",
              color: "#dc2626",
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
            {tab === "pos" && (
              <POSView
                products={products}
                cashierUserId={cashierUserId}
                onSaleComplete={refreshProducts}
              />
            )}
            {tab === "inventory" && <InventoryView products={products} />}
            {tab === "purchase" && (
              <PurchaseView
                products={products}
                suppliers={suppliers}
                adminUserId={adminUserId}
                onPurchaseComplete={refreshProducts}
              />
            )}
            {tab === "adjustment" && (
              <AdjustmentView
                products={products}
                adminUserId={adminUserId}
                onAdjustmentComplete={refreshProducts}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
