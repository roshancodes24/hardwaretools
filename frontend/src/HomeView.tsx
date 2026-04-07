import type { Tab } from "./Sidebar";

interface HomeViewProps {
  onTabChange: (tab: Tab) => void;
}

const fmtInr = (n: number) =>
  `₹${Number(n).toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;

export function HomeView({ onTabChange }: HomeViewProps) {
  const todaysSales = 28450;
  const transactionsToday = 37;
  const lowStockItems = 9;
  const outOfStockItems = 3;

  const recentActivity = [
    { time: "09:10 AM", type: "Sale", reference: "SAL-1084", amount: 3250, status: "Completed" },
    { time: "10:25 AM", type: "Purchase", reference: "PUR-0421", amount: 8900, status: "Received" },
    { time: "11:40 AM", type: "Adjustment", reference: "ADJ-0193", amount: 0, status: "Applied" },
    { time: "01:15 PM", type: "Sale", reference: "SAL-1085", amount: 16450, status: "Completed" },
  ];

  const statCards = [
    { label: "Today's sales", value: fmtInr(todaysSales), tone: "accent" },
    { label: "Transactions today", value: String(transactionsToday), tone: "normal" },
    { label: "Low stock items", value: String(lowStockItems), tone: "warning" },
    { label: "Out of stock items", value: String(outOfStockItems), tone: "danger" },
  ] as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
        {statCards.map((card) => {
          const valueColor =
            card.tone === "danger"
              ? "var(--danger)"
              : card.tone === "warning"
                ? "var(--accent)"
                : "var(--text)";
          return (
            <div
              key={card.label}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "12px 14px",
              }}
            >
              <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{card.label}</div>
              <div style={{ marginTop: 7, fontSize: 22, fontWeight: 700, color: valueColor }}>{card.value}</div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
        {[
          {
            label: "New Sale",
            tab: "pos" as Tab,
            icon: (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <rect x="5" y="6" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
                <path d="M8 10h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M9.5 4h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            ),
            tone: "blue" as const,
          },
          {
            label: "New Purchase",
            tab: "purchase" as Tab,
            icon: (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            ),
            tone: "gray" as const,
          },
          {
            label: "Adjust Stock",
            tab: "adjustment" as Tab,
            icon: (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M7 5h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            ),
            tone: "gray" as const,
          },
        ].map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={() => onTabChange(action.tab)}
            style={{
              height: 44,
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--text)",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              textAlign: "left",
              padding: "0 12px",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: action.tone === "blue" ? "#eff6ff" : "var(--surface-subtle)",
                color: action.tone === "blue" ? "#2563eb" : "var(--muted)",
                flexShrink: 0,
              }}
            >
              {action.icon}
            </span>
            {action.label}
          </button>
        ))}
      </div>

      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
        <div
          style={{
            padding: "10px 12px",
            borderBottom: "1px solid var(--border)",
            fontSize: 13,
            fontWeight: 700,
            color: "var(--text)",
          }}
        >
          Recent activity
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--surface-subtle)", color: "var(--muted)" }}>
              <th style={{ textAlign: "left", padding: "9px 12px", fontWeight: 600, fontSize: 11 }}>Time</th>
              <th style={{ textAlign: "left", padding: "9px 12px", fontWeight: 600, fontSize: 11 }}>Type</th>
              <th style={{ textAlign: "left", padding: "9px 12px", fontWeight: 600, fontSize: 11 }}>Reference</th>
              <th style={{ textAlign: "right", padding: "9px 12px", fontWeight: 600, fontSize: 11 }}>Amount</th>
              <th style={{ textAlign: "left", padding: "9px 12px", fontWeight: 600, fontSize: 11 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {recentActivity.map((row, i) => (
              <tr key={`${row.reference}-${i}`} style={{ background: i % 2 ? "var(--surface-subtle)" : "var(--surface)" }}>
                <td style={{ padding: "9px 12px", color: "var(--text)" }}>{row.time}</td>
                <td style={{ padding: "9px 12px", color: "var(--text)" }}>{row.type}</td>
                <td style={{ padding: "9px 12px", color: "var(--text)", fontWeight: 600 }}>{row.reference}</td>
                <td style={{ padding: "9px 12px", color: "var(--text)", textAlign: "right", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                  {fmtInr(row.amount)}
                </td>
                <td style={{ padding: "9px 12px", color: "var(--muted)", fontWeight: 600 }}>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
