import { useMemo, useState, type ReactNode } from "react";
import { FEATURE_FLAGS } from "./featureFlags";

export type Tab =
  | "home"
  | "pos"
  | "reporting"
  | "products"
  | "promotion"
  | "inventory"
  | "purchase"
  | "adjustment";

interface SidebarProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  userRole?: string;
}

type NavLeaf = { id: Tab; label: string };

function NavButton({
  label,
  active,
  onClick,
  compact,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        border: "1px solid",
        borderColor: active ? "var(--accent)" : "transparent",
        background: active ? "var(--accent-soft)" : "transparent",
        color: active ? "var(--accent)" : "var(--sidebar-text)",
        borderRadius: 10,
        padding: compact ? "8px 10px" : "10px 12px",
        fontSize: compact ? 12.5 : 13,
        fontWeight: active ? 600 : 500,
        cursor: "pointer",
        transition: "all 0.14s ease",
      }}
      onMouseOver={(e) => {
        if (!active) {
          e.currentTarget.style.background = "rgba(255,255,255,0.06)";
          e.currentTarget.style.color = "#f5f4f0";
        }
      }}
      onMouseOut={(e) => {
        if (!active) {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--sidebar-text)";
        }
      }}
    >
      {label}
    </button>
  );
}

function NavGroup({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          border: "none",
          background: "transparent",
          color: "var(--sidebar-muted)",
          cursor: "pointer",
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          padding: "0 4px",
        }}
      >
        <span>{title}</span>
        <span style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>
          ▸
        </span>
      </button>
      {open ? children : null}
    </div>
  );
}

export function Sidebar({ activeTab, onTabChange, userRole }: SidebarProps) {
  const [catalogOpen, setCatalogOpen] = useState(
    activeTab === "products" || activeTab === "promotion"
  );
  const [inventoryOpen, setInventoryOpen] = useState(
    activeTab === "inventory" || activeTab === "purchase" || activeTab === "adjustment"
  );

  const isAdmin = userRole === "admin" || userRole === undefined;

  const catalogItems = useMemo<NavLeaf[]>(() => {
    const rows: NavLeaf[] = [{ id: "products", label: "Products" }];
    if (FEATURE_FLAGS.catalogPromotions) rows.push({ id: "promotion", label: "Promotions" });
    return rows;
  }, []);

  return (
    <aside
      style={{
        width: 244,
        minWidth: 244,
        height: "100vh",
        background: "var(--sidebar-bg)",
        borderRight: "1px solid var(--sidebar-border)",
        padding: "0 10px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          height: 56,
          borderBottom: "1px solid var(--sidebar-border)",
          display: "flex",
          alignItems: "center",
          padding: "0 8px",
          marginBottom: 6,
        }}
      >
        <div>
          <div style={{ color: "#f5f4f0", fontWeight: 700, fontSize: 13 }}>Hardware POS</div>
          <div style={{ color: "var(--sidebar-muted)", marginTop: 2, fontSize: 10.5 }}>Retail Console</div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <NavButton label="Home" active={activeTab === "home"} onClick={() => onTabChange("home")} />
        <NavButton label="Sell (POS)" active={activeTab === "pos"} onClick={() => onTabChange("pos")} />
        <NavButton
          label="Reporting"
          active={activeTab === "reporting"}
          onClick={() => onTabChange("reporting")}
        />
      </div>

      <div style={{ borderTop: "1px solid var(--sidebar-border)", margin: "4px 2px" }} />

      <NavGroup title="Catalog" open={catalogOpen} onToggle={() => setCatalogOpen((v) => !v)}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {catalogItems.map((item) => (
            <NavButton
              key={item.id}
              compact
              label={item.label}
              active={activeTab === item.id}
              onClick={() => onTabChange(item.id)}
            />
          ))}
        </div>
      </NavGroup>

      <NavGroup
        title="Inventory"
        open={inventoryOpen}
        onToggle={() => setInventoryOpen((v) => !v)}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <NavButton
            compact
            label="Overview"
            active={activeTab === "inventory"}
            onClick={() => onTabChange("inventory")}
          />
          {isAdmin && (
            <>
              <NavButton
                compact
                label="Purchases"
                active={activeTab === "purchase"}
                onClick={() => onTabChange("purchase")}
              />
              <NavButton
                compact
                label="Adjustments"
                active={activeTab === "adjustment"}
                onClick={() => onTabChange("adjustment")}
              />
            </>
          )}
        </div>
      </NavGroup>

      <div style={{ marginTop: "auto", borderTop: "1px solid var(--sidebar-border)", paddingTop: 10 }}>
        <div style={{ color: "var(--sidebar-muted)", fontSize: 11, padding: "0 4px" }}>Theme-ready UI system</div>
      </div>
    </aside>
  );
}
