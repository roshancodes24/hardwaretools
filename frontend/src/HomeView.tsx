import { useEffect, useState } from "react";
import { api } from "./api/client";
import { isApiError } from "./api/errors";
import type { SalesRevenueBucket, SalesRevenueGranularity } from "./api/types";
import type { Tab } from "./Sidebar";
import { SimpleLineChart } from "./components/SimpleLineChart";

interface HomeViewProps {
  onTabChange: (tab: Tab) => void;
  /** Dashboard stats + revenue chart for admins only; cashiers see shortcuts and activity. */
  isAdmin: boolean;
}

const fmtInr = (n: number) =>
  `₹${Number(n).toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;

function fmtAxisRupee(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "₹0";
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(0)}k`;
  return `₹${Math.round(n)}`;
}

const VIEW_OPTIONS: { value: SalesRevenueGranularity; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

function chartBucketsFor(granularity: SalesRevenueGranularity): number {
  return granularity === "day" ? 14 : 12;
}

function chartSubtitleFor(granularity: SalesRevenueGranularity): string {
  if (granularity === "day") {
    return "Completed sales, last 14 days (IST)";
  }
  if (granularity === "week") {
    return "Completed sales by week, Mon–Sun (IST), last 12 weeks";
  }
  return "Completed sales by calendar month (IST), last 12 months";
}

export function HomeView({ onTabChange, isAdmin }: HomeViewProps) {
  const [viewBy, setViewBy] = useState<SalesRevenueGranularity>("day");
  const [revenueSeries, setRevenueSeries] = useState<SalesRevenueBucket[]>([]);
  const [todaySnap, setTodaySnap] = useState<SalesRevenueBucket | null>(null);
  const [dashLoading, setDashLoading] = useState(true);
  const [dashError, setDashError] = useState<string | null>(null);

  const lowStockItems = 9;
  const outOfStockItems = 3;

  useEffect(() => {
    if (!isAdmin) {
      setDashLoading(false);
      setDashError(null);
      setRevenueSeries([]);
      setTodaySnap(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setDashLoading(true);
      setDashError(null);
      try {
        const buckets = chartBucketsFor(viewBy);
        const [main, todayRes] = await Promise.all([
          api.getSalesRevenueSeries(viewBy, buckets),
          api.getSalesRevenueSeries("day", 1),
        ]);
        if (!cancelled) {
          setRevenueSeries(main.series);
          setTodaySnap(todayRes.series[0] ?? null);
        }
      } catch (e) {
        if (!cancelled) {
          setRevenueSeries([]);
          setTodaySnap(null);
          setDashError(isApiError(e) ? e.message : "Could not load chart");
        }
      } finally {
        if (!cancelled) setDashLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewBy, isAdmin]);

  const todaysSales = todaySnap ? Number(todaySnap.total) : isAdmin ? 28450 : 0;
  const transactionsToday = todaySnap ? todaySnap.count : isAdmin ? 37 : 0;

  const salesPoints = revenueSeries.map((d) => ({
    xLabel: d.label,
    y: Number(d.total),
  }));

  const recentActivity = [
    { time: "09:10 AM", type: "Sale", reference: "SAL-1084", amount: 3250, status: "Completed" },
    { time: "10:25 AM", type: "Purchase", reference: "PUR-0421", amount: 8900, status: "Received" },
    { time: "11:40 AM", type: "Adjustment", reference: "ADJ-0193", amount: 0, status: "Applied" },
    { time: "01:15 PM", type: "Sale", reference: "SAL-1085", amount: 16450, status: "Completed" },
  ];
  const [showAllActivity, setShowAllActivity] = useState(false);
  const visibleActivity = showAllActivity
    ? recentActivity
    : recentActivity.slice(0, 10);

  const statCards = isAdmin
    ? ([
        { label: "Today's sales (IST)", value: fmtInr(todaysSales), tone: "accent" },
        { label: "Transactions today", value: String(transactionsToday), tone: "normal" },
        { label: "Low stock items", value: String(lowStockItems), tone: "warning" },
        { label: "Out of stock items", value: String(outOfStockItems), tone: "danger" },
      ] as const)
    : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {statCards.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          {statCards.map((card) => {
            const valueColor =
              card.tone === "danger"
                ? "#dc2626"
                : card.tone === "warning"
                  ? "#d97706"
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
      ) : null}

      {dashError ? (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            color: "var(--danger)",
            fontSize: 13,
          }}
        >
          {dashError}
        </div>
      ) : null}

      {isAdmin ? (
      <div style={{ maxWidth: 900, width: "100%" }}>
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "var(--text)",
              marginBottom: 8,
            }}
          >
            View By
          </div>
          <div
            role="group"
            aria-label="View sales chart by"
            style={{
              display: "inline-flex",
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "var(--surface)",
            }}
          >
            {VIEW_OPTIONS.map((o, i) => {
              const selected = viewBy === o.value;
              const isFirst = i === 0;
              const isLast = i === VIEW_OPTIONS.length - 1;
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setViewBy(o.value)}
                  style={{
                    padding: "10px 22px",
                    fontSize: 14,
                    fontWeight: 500,
                    fontFamily: "inherit",
                    color: "var(--text)",
                    cursor: "pointer",
                    border: "none",
                    borderLeft: i > 0 ? "1px solid var(--border)" : "none",
                    background: "var(--surface)",
                    borderTopLeftRadius: isFirst ? 7 : 0,
                    borderBottomLeftRadius: isFirst ? 7 : 0,
                    borderTopRightRadius: isLast ? 7 : 0,
                    borderBottomRightRadius: isLast ? 7 : 0,
                    boxShadow: selected
                      ? "inset 0 0 0 2px var(--accent)"
                      : "none",
                    position: "relative",
                    zIndex: selected ? 1 : 0,
                  }}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>

        {dashLoading ? (
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              minHeight: 260,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--muted)",
              fontSize: 14,
            }}
          >
            Loading chart…
          </div>
        ) : (
          <SimpleLineChart
            title="Sales revenue"
            subtitle={chartSubtitleFor(viewBy)}
            points={salesPoints}
            color="#2563eb"
            formatY={fmtAxisRupee}
          />
        )}
      </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
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
          ...(isAdmin
            ? [
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
              ]
            : []),
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
            {visibleActivity.map((row, i) => (
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
        {recentActivity.length > 10 && (
          <div
            style={{
              padding: "10px 12px",
              borderTop: "1px solid var(--border)",
              display: "flex",
              justifyContent: "flex-end",
            }}
          >
            <button
              type="button"
              onClick={() => setShowAllActivity((v) => !v)}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: "var(--surface)",
                color: "var(--text)",
                height: 32,
                padding: "0 12px",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {showAllActivity ? "Show less activity" : "View more activity"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
