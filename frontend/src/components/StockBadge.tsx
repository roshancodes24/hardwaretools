export function StockBadge({ status }: { status: "ok" | "low" | "out" }) {
  const map = {
    ok: { bg: "var(--stock-ok-bg)", color: "var(--stock-ok-text)", label: "In Stock" },
    low: { bg: "var(--stock-low-bg)", color: "var(--stock-low-text)", label: "Low Stock" },
    out: { bg: "var(--stock-out-bg)", color: "var(--stock-out-text)", label: "Out of Stock" },
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
