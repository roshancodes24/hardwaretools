import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { isApiError } from "../api/errors";
import { FieldWrap, FormErrorBanner } from "../components/formUi";
import { Toast } from "../components/Toast";
import { mapAdjustmentDetailField } from "../lib/formErrors";
import { fmt } from "../lib/formatMoney";
import type { UiProduct } from "../lib/mapProduct";
import { inputStyle } from "../styles/formStyles";

const ADJUSTMENT_INLINE_ERROR_KEYS = new Set([
  "productId",
  "quantity",
  "quantityAfter",
  "reason",
  "adjustedById",
  "note",
]);

export function AdjustmentView({
  products,
  actingUserId,
  onAdjustmentComplete,
}: {
  products: UiProduct[];
  actingUserId: string;
  onAdjustmentComplete: () => Promise<void>;
}) {
  const empty = { productId: "", type: "add" as const, quantity: "", reason: "" };
  const pageSize = 12;
  const reasonOptions = [
    "Physical Count",
    "Damage",
    "Wastage",
    "Supplier Return",
    "Correction",
    "Other",
  ];
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
  const [productSearch, setProductSearch] = useState("");
  const [stockFilter, setStockFilter] = useState<"all" | "low" | "out">("all");
  const [listPage, setListPage] = useState(1);
  const [reasonPreset, setReasonPreset] = useState("Physical Count");
  const [reasonNote, setReasonNote] = useState("");

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
  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    return products.filter((p) => {
      if (stockFilter === "out" && p.stock !== 0) return false;
      if (stockFilter === "low" && (p.stock === 0 || p.stock > p.lowStock)) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    });
  }, [products, productSearch, stockFilter]);
  const pageCount = Math.max(1, Math.ceil(filteredProducts.length / pageSize));
  useEffect(() => {
    if (listPage > pageCount) setListPage(pageCount);
  }, [listPage, pageCount]);
  const pagedProducts = useMemo(() => {
    const start = (listPage - 1) * pageSize;
    return filteredProducts.slice(start, start + pageSize);
  }, [filteredProducts, listPage]);

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
    if (reasonPreset === "Other" && reasonNote.trim() === "") {
      setStatus({ type: "error", msg: "Please enter a reason note for 'Other'." });
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

    const riskyAction =
      (form.type === "remove" && qtyVal >= Math.max(20, current * 0.5)) ||
      (form.type === "set" && quantityAfter === 0);
    if (riskyAction) {
      const ok = window.confirm(
        `Please confirm this adjustment.\nCurrent: ${current} ${selectedProduct.unit}\nAfter: ${quantityAfter} ${selectedProduct.unit}`
      );
      if (!ok) return;
    }

    const resolvedReason =
      reasonPreset === "Other" ? reasonNote.trim() : reasonPreset;
    const noteParts = [
      form.type !== "set" ? `Mode: ${form.type}` : null,
      reasonPreset !== "Other" && reasonNote.trim() ? reasonNote.trim() : null,
    ].filter((x): x is string => Boolean(x));

    setLoading(true);
    setStatus(null);
    setFieldErrors({});
    try {
      await api.createStockAdjustment({
        productId: form.productId,
        adjustedById: actingUserId,
        quantityAfter,
        reason: resolvedReason,
        note: noteParts.length > 0 ? noteParts.join(" | ") : undefined,
      });
      setStatus({
        type: "success",
        msg: "Adjustment recorded — stock updated.",
      });
      setForm(empty);
      setReasonPreset("Physical Count");
      setReasonNote("");
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
    { value: "add" as const, label: "Add Stock", sub: "Received stock" },
    { value: "remove" as const, label: "Reduce Stock", sub: "Damage / write-off" },
    { value: "set" as const, label: "Set Exact Count", sub: "Physical count" },
  ];
  const adjustQuantityBy = (delta: number) => {
    const cur = Number(form.quantity || 0);
    const next = Math.max(0, (Number.isFinite(cur) ? cur : 0) + delta);
    set("quantity", String(next));
  };

  const preview = previewStock();

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.8fr) minmax(420px, 1.2fr)",
        gap: 16,
        width: "100%",
        alignItems: "start",
      }}
    >
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: 14, borderBottom: "1px solid var(--border)", display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            value={productSearch}
            onChange={(e) => {
              setProductSearch(e.target.value);
              setListPage(1);
            }}
            placeholder="Search by name, SKU or category..."
            style={{ ...inputStyle, flex: 1, minWidth: 240 }}
          />
          {([
            ["all", "All"],
            ["low", "Low Stock"],
            ["out", "Out of Stock"],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setStockFilter(k);
                setListPage(1);
              }}
              style={{
                height: 32,
                padding: "0 10px",
                borderRadius: 8,
                border: stockFilter === k ? "2px solid var(--accent)" : "1px solid var(--border)",
                background: stockFilter === k ? "var(--accent-soft-bg)" : "var(--surface)",
                color: stockFilter === k ? "var(--accent)" : "var(--text-strong)",
                fontWeight: 600,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={{ maxHeight: 560, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--surface-subtle)" }}>
                {["SKU", "Name", "Category", "Price", "Stock", "Status"].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      padding: "8px 10px",
                      color: "var(--muted)",
                      fontWeight: 600,
                      position: "sticky",
                      top: 0,
                      background: "var(--surface-subtle)",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagedProducts.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: "16px 12px", color: "var(--text-faint)" }}>
                    No products match your filter.
                  </td>
                </tr>
              ) : (
                pagedProducts.map((p, idx) => {
                  const active = p.id === form.productId;
                  const statusLabel = p.stock === 0 ? "OUT" : p.stock <= p.lowStock ? "LOW" : "OK";
                  return (
                    <tr
                      key={p.id}
                      onClick={() => set("productId", p.id)}
                      style={{
                        cursor: "pointer",
                        borderBottom: "1px solid var(--border)",
                        background: active ? "var(--accent-soft-bg)" : idx % 2 === 0 ? "var(--surface)" : "var(--surface-subtle)",
                      }}
                    >
                      <td style={{ padding: "8px 10px", fontFamily: "monospace", color: "var(--muted)" }}>{p.sku}</td>
                      <td style={{ padding: "8px 10px", color: "var(--text)", fontWeight: 500 }}>{p.name}</td>
                      <td style={{ padding: "8px 10px", color: "var(--muted)" }}>{p.category}</td>
                      <td style={{ padding: "8px 10px", fontFamily: "monospace", color: "var(--muted)" }}>
                        {fmt(p.price)}
                      </td>
                      <td style={{ padding: "8px 10px", fontFamily: "monospace", color: "var(--muted)" }}>
                        {p.stock} {p.unit}
                      </td>
                      <td style={{ padding: "8px 10px", fontWeight: 700, fontSize: 11, color: statusLabel === "OUT" ? "var(--danger-strong)" : statusLabel === "LOW" ? "var(--stock-low-text)" : "var(--stock-ok-text)" }}>
                        {statusLabel}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: 12, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            Showing {filteredProducts.length === 0 ? 0 : (listPage - 1) * pageSize + 1}-
            {Math.min(listPage * pageSize, filteredProducts.length)} of {filteredProducts.length}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              disabled={listPage <= 1}
              onClick={() => setListPage((p) => Math.max(1, p - 1))}
              style={{ height: 28, padding: "0 9px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", cursor: "pointer", fontSize: 12 }}
            >
              Prev
            </button>
            <span style={{ fontSize: 12, color: "var(--muted)", alignSelf: "center" }}>
              {listPage}/{pageCount}
            </span>
            <button
              type="button"
              disabled={listPage >= pageCount}
              onClick={() => setListPage((p) => Math.min(pageCount, p + 1))}
              style={{ height: 28, padding: "0 9px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", cursor: "pointer", fontSize: 12 }}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <div style={{ position: "sticky", top: 12 }}>
        <div style={{ background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border)", padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 16, borderBottom: "1px solid var(--border)", paddingBottom: 10 }}>
            Stock Adjustment
          </div>

          <div style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}>
            {selectedProduct ? (
              <>
                <div style={{ fontWeight: 600, color: "var(--text)" }}>{selectedProduct.name}</div>
                <div style={{ marginTop: 4, fontSize: 12, color: "var(--muted)" }}>
                  {selectedProduct.sku} · {selectedProduct.category}
                </div>
                <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-strong)" }}>
                  Current: <strong>{selectedProduct.stock} {selectedProduct.unit}</strong>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: "var(--text-faint)" }}>Select a product from the list.</div>
            )}
          </div>

          <FieldWrap label="Adjustment Type *">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {adjTypes.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => set("type", t.value)}
                  style={{
                    flex: "1 1 110px",
                    padding: "8px 7px",
                    borderRadius: 8,
                    cursor: "pointer",
                    textAlign: "center",
                    border: form.type === t.value ? "2px solid var(--accent)" : "1px solid var(--border)",
                    background: form.type === t.value ? "var(--accent-soft-bg)" : "var(--surface)",
                    color: form.type === t.value ? "var(--accent)" : "var(--text-strong)",
                    fontWeight: form.type === t.value ? 600 : 400,
                    fontSize: 12,
                  }}
                >
                  <div style={{ fontSize: 12 }}>{t.label}</div>
                  <div style={{ fontSize: 10, color: form.type === t.value ? "var(--accent)" : "var(--text-faint)", marginTop: 2 }}>
                    {t.sub}
                  </div>
                </button>
              ))}
            </div>
          </FieldWrap>

          <FieldWrap label="Quantity *" error={fieldErrors.quantity ?? fieldErrors.quantityAfter}>
            <input
              type="number"
              min={0}
              step="any"
              placeholder="0"
              value={form.quantity}
              onChange={(e) => set("quantity", e.target.value)}
              style={{
                ...inputStyle,
                borderColor: fieldErrors.quantity || fieldErrors.quantityAfter ? "var(--input-error-border)" : "var(--border)",
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              {[-5, -1, +1, +5, +10].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => adjustQuantityBy(v)}
                  style={{
                    height: 26,
                    padding: "0 9px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--surface)",
                    color: "var(--text-strong)",
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                >
                  {v > 0 ? `+${v}` : v}
                </button>
              ))}
            </div>
          </FieldWrap>

          <FieldWrap label="Reason *" error={fieldErrors.reason}>
            <select
              value={reasonPreset}
              onChange={(e) => setReasonPreset(e.target.value)}
              style={{ ...inputStyle, padding: "0 10px", cursor: "pointer" }}
            >
              {reasonOptions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <input
              placeholder={reasonPreset === "Other" ? "Enter reason..." : "Optional note"}
              value={reasonNote}
              onChange={(e) => setReasonNote(e.target.value)}
              style={{ ...inputStyle, marginTop: 8 }}
            />
          </FieldWrap>

          {selectedProduct && preview !== null && (
            <div style={{ background: "var(--input-disabled)", borderRadius: 8, padding: "10px 14px", display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: "var(--muted)" }}>Current → After adjustment</span>
              <span style={{ fontFamily: "monospace", fontWeight: 600 }}>
                {selectedProduct.stock} →{" "}
                <span style={{ color: preview <= selectedProduct.lowStock ? (preview === 0 ? "var(--danger-strong)" : "var(--stock-low-text)") : "var(--stock-ok-text)" }}>
                  {preview}
                </span>{" "}
                {selectedProduct.unit}
              </span>
            </div>
          )}

          <FormErrorBanner text={adjustmentFormBanner} />
          <Toast status={status} />

          <div style={{ paddingTop: 8, borderTop: "1px solid var(--border)" }}>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading}
              style={{
                height: 40,
                width: "100%",
                background: "var(--text)",
                color: "var(--on-accent)",
                border: "none",
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {loading ? "Saving..." : "Save Adjustment"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}