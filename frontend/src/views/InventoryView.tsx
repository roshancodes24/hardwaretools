import { useMemo, useState } from "react";
import {
  compareInventoryRows,
  stockStatus,
  type InventorySortKey,
} from "../lib/inventoryTable";
import { StockBadge } from "../components/StockBadge";
import { fmt } from "../lib/formatMoney";
import type { UiProduct } from "../lib/mapProduct";
import { inputStyle } from "../styles/formStyles";

export function InventoryView({ products }: { products: UiProduct[] }) {
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
      color: "var(--text)",
      mono: false,
    },
    {
      label: "Stock Value",
      value: fmt(totalValue),
      color: "var(--text)",
      mono: true,
    },
    {
      label: "Low Stock",
      value: String(lowCount),
      color: "var(--stock-low-text)",
      mono: false,
    },
    {
      label: "Out of Stock",
      value: String(outCount),
      color: "var(--danger-strong)",
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
              background: "var(--surface)",
              borderRadius: 10,
              border: "1px solid var(--border)",
              padding: "14px 16px",
            }}
          >
            <div
              style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}
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
          background: "var(--surface)",
          borderRadius: 12,
          border: "1px solid var(--border)",
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
                borderBottom: "1px solid var(--border)",
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
                      color: active ? "var(--text)" : "var(--muted)",
                      fontSize: 12,
                      background: "var(--surface-subtle)",
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
                    borderBottom: "1px solid var(--border)",
                    background: i % 2 === 0 ? "var(--surface)" : "var(--surface-subtle)",
                  }}
                >
                  <td
                    style={{
                      padding: "10px 14px",
                      fontFamily: "monospace",
                      color: "var(--muted)",
                      fontSize: 12,
                    }}
                  >
                    {p.sku}
                  </td>
                  <td
                    style={{
                      padding: "10px 14px",
                      fontWeight: 500,
                      color: "var(--text)",
                    }}
                  >
                    {p.name}
                  </td>
                  <td style={{ padding: "10px 14px", color: "var(--muted)" }}>
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
                          ? "var(--danger-strong)"
                          : st === "low"
                            ? "var(--stock-low-text)"
                            : "var(--text)",
                    }}
                  >
                    {p.stock}
                  </td>
                  <td style={{ padding: "10px 14px", color: "var(--muted)" }}>
                    {p.unit}
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <StockBadge status={st} />
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