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
  // TODO: wire to real API
  const todaysSales = 28450;
  const transactionsToday = 37;
  const lowStockItems = 9;
  const outOfStockItems = 3;

  // TODO: wire to real API
  const recentActivity = [
    {
      time: "09:10 AM",
      type: "Sale",
      reference: "SAL-1084",
      amount: 3250,
      status: "Completed",
    },
    {
      time: "10:25 AM",
      type: "Purchase",
      reference: "PUR-0421",
      amount: 8900,
      status: "Received",
    },
    {
      time: "11:40 AM",
      type: "Adjustment",
      reference: "ADJ-0193",
      amount: 0,
      status: "Applied",
    },
    {
      time: "01:15 PM",
      type: "Sale",
      reference: "SAL-1085",
      amount: 16450,
      status: "Completed",
    },
  ];

  const statCards = [
    { label: "Today's sales", value: fmtInr(todaysSales) },
    { label: "Transactions today", value: String(transactionsToday) },
    { label: "Low stock items", value: String(lowStockItems) },
    { label: "Out of stock items", value: String(outOfStockItems) },
  ];

  const showLowStockBanner = lowStockItems + outOfStockItems > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* TODO: wire to real API */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 12,
        }}
      >
        {statCards.map((card) => (
          <div
            key={card.label}
            style={{
              background: "#ffffff",
              border: "1px solid #e7e5e4",
              borderRadius: 10,
              padding: "14px 16px",
            }}
          >
            <div style={{ fontSize: 12, color: "#78716c" }}>{card.label}</div>
            <div
              style={{
                marginTop: 6,
                fontSize: 22,
                fontWeight: 700,
                color: "#1c1917",
              }}
            >
              {card.value}
            </div>
          </div>
        ))}
      </div>

      {/* TODO: wire to real API */}
      {showLowStockBanner && (
        <div
          style={{
            background: "#fef3c7",
            color: "#d97706",
            borderRadius: 10,
            border: "1px solid #f5e2a3",
            padding: "10px 12px",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Low stock alert: some items are running low or out of stock. Review
          stock levels and replenish soon.
        </div>
      )}

      {/* TODO: wire to real API */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <button
          type="button"
          onClick={() => onTabChange("pos")}
          style={{
            background: "#1c1917",
            color: "#d97706",
            border: "1px solid #2f2b29",
            borderRadius: 10,
            padding: "14px 12px",
            fontWeight: 700,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          New Sale
        </button>
        <button
          type="button"
          onClick={() => onTabChange("purchase")}
          style={{
            background: "#1c1917",
            color: "#d97706",
            border: "1px solid #2f2b29",
            borderRadius: 10,
            padding: "14px 12px",
            fontWeight: 700,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          New Purchase
        </button>
        <button
          type="button"
          onClick={() => onTabChange("adjustment")}
          style={{
            background: "#1c1917",
            color: "#d97706",
            border: "1px solid #2f2b29",
            borderRadius: 10,
            padding: "14px 12px",
            fontWeight: 700,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          Adjust Stock
        </button>
      </div>

      {/* TODO: wire to real API */}
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #e7e5e4",
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "12px 14px",
            borderBottom: "1px solid #e7e5e4",
            fontSize: 14,
            fontWeight: 700,
            color: "#1c1917",
          }}
        >
          Recent activity
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#ffffff", color: "#78716c" }}>
              <th style={{ textAlign: "left", padding: "10px 14px", fontWeight: 600 }}>
                Time
              </th>
              <th style={{ textAlign: "left", padding: "10px 14px", fontWeight: 600 }}>
                Type
              </th>
              <th style={{ textAlign: "left", padding: "10px 14px", fontWeight: 600 }}>
                Reference
              </th>
              <th style={{ textAlign: "right", padding: "10px 14px", fontWeight: 600 }}>
                Amount
              </th>
              <th style={{ textAlign: "left", padding: "10px 14px", fontWeight: 600 }}>
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {recentActivity.map((row, i) => (
              <tr key={`${row.reference}-${i}`} style={{ background: i % 2 ? "#f5f4f0" : "#ffffff" }}>
                <td style={{ padding: "10px 14px", color: "#1c1917" }}>{row.time}</td>
                <td style={{ padding: "10px 14px", color: "#1c1917" }}>{row.type}</td>
                <td style={{ padding: "10px 14px", color: "#1c1917" }}>{row.reference}</td>
                <td
                  style={{
                    padding: "10px 14px",
                    color: "#1c1917",
                    textAlign: "right",
                    fontFamily: "monospace",
                  }}
                >
                  {fmtInr(row.amount)}
                </td>
                <td style={{ padding: "10px 14px", color: "#a8a29e" }}>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
