import { useMemo, useState } from "react";
import { api } from "../api/client";
import { isApiError } from "../api/errors";
import type { ApiProduct, ApiPromotion, PromotionScope } from "../api/types";

type Props = {
  products: ApiProduct[];
  promotions: ApiPromotion[];
  onPromotionCreated: () => Promise<void>;
};

const inputStyle: React.CSSProperties = {
  height: 36,
  padding: "0 10px",
  border: "1px solid #e7e5e4",
  borderRadius: 8,
  fontSize: 13,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
  background: "#fff",
};

const categories = ["Electrical", "Hardware", "Paint"] as const;

export function PromotionsPage({
  products,
  promotions,
  onPromotionCreated,
}: Props) {
  const [form, setForm] = useState({
    name: "",
    code: "",
    scope: "CART" as PromotionScope,
    percentage: "10",
    category: "Electrical" as "Electrical" | "Hardware" | "Paint",
    startsAt: "",
    endsAt: "",
    note: "",
  });
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const productOptions = useMemo(
    () =>
      products.map((p) => ({
        id: p.id,
        label: `${p.name} (${p.sku})`,
      })),
    [products]
  );

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    setStatus(null);
    setError(null);
    try {
      await api.createPromotion({
        name: form.name.trim(),
        code: form.scope === "CART" ? form.code.trim() : undefined,
        scope: form.scope,
        percentage: Number(form.percentage),
        category: form.scope === "CATEGORY" ? form.category : undefined,
        productIds: form.scope === "PRODUCT" ? selectedProducts : undefined,
        startsAt: form.startsAt || undefined,
        endsAt: form.endsAt || undefined,
        note: form.note.trim() || undefined,
        isActive: true,
      });
      setStatus("Promotion created");
      setForm({
        name: "",
        code: "",
        scope: "CART",
        percentage: "10",
        category: "Electrical",
        startsAt: "",
        endsAt: "",
        note: "",
      });
      setSelectedProducts([]);
      await onPromotionCreated();
    } catch (e) {
      setError(isApiError(e) ? e.message : "Failed to create promotion");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 16 }}>
      <div
        style={{
          background: "#fff",
          border: "1px solid #e7e5e4",
          borderRadius: 12,
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          alignSelf: "start",
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, color: "#1c1917" }}>
          New Promotion
        </div>
        <input
          placeholder="Promotion name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          style={inputStyle}
        />
        <select
          value={form.scope}
          onChange={(e) =>
            setForm((f) => ({ ...f, scope: e.target.value as PromotionScope }))
          }
          style={inputStyle}
        >
          <option value="CART">Cart-wide code</option>
          <option value="PRODUCT">Per-product</option>
          <option value="CATEGORY">Category-wide</option>
        </select>
        {form.scope === "CART" && (
          <input
            placeholder="Promo code (e.g. NEW10)"
            value={form.code}
            onChange={(e) =>
              setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))
            }
            style={inputStyle}
          />
        )}
        <input
          type="number"
          min={0.01}
          max={100}
          step="0.01"
          placeholder="Percentage"
          value={form.percentage}
          onChange={(e) =>
            setForm((f) => ({ ...f, percentage: e.target.value }))
          }
          style={inputStyle}
        />
        {form.scope === "CATEGORY" && (
          <select
            value={form.category}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                category: e.target.value as "Electrical" | "Hardware" | "Paint",
              }))
            }
            style={inputStyle}
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        {form.scope === "PRODUCT" && (
          <div
            style={{
              border: "1px solid #e7e5e4",
              borderRadius: 8,
              maxHeight: 160,
              overflowY: "auto",
              padding: 8,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {productOptions.map((p) => (
              <label
                key={p.id}
                style={{ fontSize: 12, color: "#44403c", display: "flex", gap: 8 }}
              >
                <input
                  type="checkbox"
                  checked={selectedProducts.includes(p.id)}
                  onChange={(e) =>
                    setSelectedProducts((cur) =>
                      e.target.checked
                        ? [...cur, p.id]
                        : cur.filter((id) => id !== p.id)
                    )
                  }
                />
                {p.label}
              </label>
            ))}
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <input
            type="date"
            value={form.startsAt}
            onChange={(e) =>
              setForm((f) => ({ ...f, startsAt: e.target.value }))
            }
            style={inputStyle}
          />
          <input
            type="date"
            value={form.endsAt}
            onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))}
            style={inputStyle}
          />
        </div>
        <textarea
          placeholder="Note (optional)"
          value={form.note}
          onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          rows={3}
          style={{
            ...inputStyle,
            height: "auto",
            padding: "8px 10px",
            resize: "vertical",
          }}
        />
        {error && <div style={{ color: "#dc2626", fontSize: 12 }}>{error}</div>}
        {status && <div style={{ color: "#16a34a", fontSize: 12 }}>{status}</div>}
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          style={{
            height: 38,
            border: "none",
            borderRadius: 8,
            background: "#d97706",
            color: "#fff",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {saving ? "Saving..." : "Create Promotion"}
        </button>
      </div>

      <div
        style={{
          background: "#fff",
          border: "1px solid #e7e5e4",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "12px 14px",
            borderBottom: "1px solid #e7e5e4",
            fontWeight: 600,
            color: "#1c1917",
          }}
        >
          Promotions
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#fafaf9" }}>
              <th style={{ textAlign: "left", padding: "10px 14px" }}>Name</th>
              <th style={{ textAlign: "left", padding: "10px 14px" }}>Scope</th>
              <th style={{ textAlign: "left", padding: "10px 14px" }}>Code/Target</th>
              <th style={{ textAlign: "right", padding: "10px 14px" }}>%</th>
              <th style={{ textAlign: "left", padding: "10px 14px" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {promotions.map((p, i) => (
              <tr key={p.id} style={{ background: i % 2 ? "#fafaf9" : "#fff" }}>
                <td style={{ padding: "10px 14px" }}>{p.name}</td>
                <td style={{ padding: "10px 14px" }}>{p.scope}</td>
                <td style={{ padding: "10px 14px" }}>
                  {p.scope === "CART"
                    ? p.code || "—"
                    : p.scope === "CATEGORY"
                      ? p.category || "—"
                      : `${p.productIds.length} products`}
                </td>
                <td style={{ padding: "10px 14px", textAlign: "right" }}>
                  {Number(p.percentage).toFixed(2)}%
                </td>
                <td style={{ padding: "10px 14px" }}>
                  {p.isActive ? "Active" : "Inactive"}
                </td>
              </tr>
            ))}
            {promotions.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: "18px 14px", color: "#78716c" }}>
                  No promotions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
