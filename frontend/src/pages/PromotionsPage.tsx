import { useMemo, useState } from "react";
import { api } from "../api/client";
import { isApiError } from "../api/errors";
import type { ApiProduct, ApiPromotion, PromotionScope } from "../api/types";
import type { ConfirmOptions } from "../useConfirm";

type Props = {
  products: ApiProduct[];
  promotions: ApiPromotion[];
  onPromotionCreated: () => Promise<void>;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
};

const inputStyle: React.CSSProperties = {
  height: 38,
  padding: "0 12px",
  border: "1px solid var(--border)",
  borderRadius: 10,
  fontSize: 13,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
  background: "var(--surface)",
  color: "var(--text)",
};

const categories = ["Electrical", "Hardware", "Paint"] as const;

export function PromotionsPage({
  products,
  promotions,
  onPromotionCreated,
  confirm,
}: Props) {
  const emptyForm = {
    name: "",
    code: "",
    scope: "CART" as PromotionScope,
    percentage: "10",
    category: "Electrical" as "Electrical" | "Hardware" | "Paint",
    startsAt: "",
    endsAt: "",
    note: "",
  };
  const [form, setForm] = useState({
    ...emptyForm,
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [productQuery, setProductQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
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

  const productTypeaheadMatches = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    if (!q) return productOptions;
    return productOptions.filter((p) => p.label.toLowerCase().includes(q));
  }, [productOptions, productQuery]);

  const resetForm = () => {
    setForm({ ...emptyForm });
    setSelectedProducts([]);
    setProductQuery("");
    setEditingId(null);
  };

  const startEdit = (p: ApiPromotion) => {
    setEditingId(p.id);
    setStatus(null);
    setError(null);
    setForm({
      name: p.name,
      code: p.code ?? "",
      scope: p.scope,
      percentage: String(Number(p.percentage)),
      category: (p.category ?? "Electrical") as "Electrical" | "Hardware" | "Paint",
      startsAt: p.startsAt ? p.startsAt.slice(0, 10) : "",
      endsAt: p.endsAt ? p.endsAt.slice(0, 10) : "",
      note: p.note ?? "",
    });
    setSelectedProducts(p.productIds ?? []);
    setProductQuery("");
  };

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    setStatus(null);
    setError(null);
    try {
      const editingPromotion = editingId
        ? promotions.find((p) => p.id === editingId)
        : undefined;
      const payload = {
        name: form.name.trim(),
        code: form.scope === "CART" ? form.code.trim() : undefined,
        scope: form.scope,
        percentage: Number(form.percentage),
        category: form.scope === "CATEGORY" ? form.category : undefined,
        productIds: form.scope === "PRODUCT" ? selectedProducts : undefined,
        startsAt: form.startsAt || undefined,
        endsAt: form.endsAt || undefined,
        note: form.note.trim() || undefined,
        isActive: editingPromotion?.isActive ?? true,
      };
      if (editingId) {
        await api.updatePromotion(editingId, payload);
        setStatus("Promotion updated");
      } else {
        await api.createPromotion(payload);
        setStatus("Promotion created");
      }
      resetForm();
      await onPromotionCreated();
    } catch (e) {
      setError(
        isApiError(e)
          ? e.message
          : editingId
            ? "Failed to update promotion"
            : "Failed to create promotion"
      );
    } finally {
      setSaving(false);
    }
  };

  const removePromotion = async (id: string) => {
    if (rowBusyId) return;
    const ok = await confirm({
      title: "Delete promotion",
      message: "This cannot be undone.",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    setRowBusyId(id);
    setStatus(null);
    setError(null);
    try {
      await api.deletePromotion(id);
      if (editingId === id) resetForm();
      await onPromotionCreated();
      setStatus("Promotion deleted");
    } catch (e) {
      setError(isApiError(e) ? e.message : "Failed to delete promotion");
    } finally {
      setRowBusyId(null);
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 18 }}>
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          alignSelf: "start",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>
          {editingId ? "Edit Promotion" : "New Promotion"}
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
          <>
            <input
              placeholder="Search product by name or SKU"
              value={productQuery}
              onChange={(e) => setProductQuery(e.target.value)}
              style={inputStyle}
            />
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              {selectedProducts.length} selected
            </div>
            {selectedProducts.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {selectedProducts.map((id) => {
                  const label = productOptions.find((p) => p.id === id)?.label ?? id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() =>
                        setSelectedProducts((cur) => cur.filter((x) => x !== id))
                      }
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 999,
                        padding: "2px 8px",
                        background: "var(--surface-subtle)",
                        color: "var(--text)",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                      title="Remove product"
                    >
                      {label} ×
                    </button>
                  );
                })}
              </div>
            )}
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: 10,
                maxHeight: 180,
                overflowY: "auto",
                padding: 8,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {productTypeaheadMatches.map((p) => (
                <label
                  key={p.id}
                  style={{ fontSize: 12, color: "var(--text)", display: "flex", gap: 8 }}
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
              {productTypeaheadMatches.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  No matching products.
                </div>
              )}
            </div>
          </>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
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
          style={{ ...inputStyle, height: "auto", padding: "8px 12px", resize: "vertical" }}
        />
        {error && <div style={{ color: "var(--danger)", fontSize: 12 }}>{error}</div>}
        {status && <div style={{ color: "var(--accent)", fontSize: 12 }}>{status}</div>}
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          style={{
            height: 38,
            border: "none",
            borderRadius: 10,
            background: "var(--accent)",
            color: "#fff",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {saving ? "Saving..." : editingId ? "Save Changes" : "Create Promotion"}
        </button>
        {editingId && (
          <button
            type="button"
            onClick={resetForm}
            style={{
              height: 34,
              border: "1px solid var(--border)",
              borderRadius: 10,
              background: "var(--surface)",
              color: "var(--text)",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Cancel Edit
          </button>
        )}
      </div>

      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "12px 14px",
            borderBottom: "1px solid var(--border)",
            fontWeight: 700,
            color: "var(--text)",
          }}
        >
          Promotions
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--surface-subtle)" }}>
              <th style={{ textAlign: "left", padding: "10px 14px" }}>Name</th>
              <th style={{ textAlign: "left", padding: "10px 14px" }}>Scope</th>
              <th style={{ textAlign: "left", padding: "10px 14px" }}>Code/Target</th>
              <th style={{ textAlign: "right", padding: "10px 14px" }}>%</th>
              <th style={{ textAlign: "left", padding: "10px 14px" }}>Status</th>
              <th style={{ textAlign: "right", padding: "10px 14px" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {promotions.map((p, i) => (
              <tr key={p.id} style={{ background: i % 2 ? "var(--surface-subtle)" : "var(--surface)" }}>
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
                <td style={{ padding: "10px 14px", textAlign: "right" }}>
                  <button
                    type="button"
                    onClick={() => startEdit(p)}
                    disabled={!!rowBusyId}
                    style={{
                      marginRight: 8,
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      padding: "4px 8px",
                      background: "var(--surface)",
                      cursor: rowBusyId ? "not-allowed" : "pointer",
                      fontSize: 12,
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void removePromotion(p.id)}
                    disabled={!!rowBusyId}
                    style={{
                      border: "1px solid #fca5a5",
                      borderRadius: 8,
                      padding: "4px 8px",
                      background: "var(--surface)",
                      color: "#b91c1c",
                      cursor: rowBusyId ? "not-allowed" : "pointer",
                      fontSize: 12,
                    }}
                  >
                    {rowBusyId === p.id ? "Deleting..." : "Delete"}
                  </button>
                </td>
              </tr>
            ))}
            {promotions.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: "18px 14px", color: "var(--muted)" }}>
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
