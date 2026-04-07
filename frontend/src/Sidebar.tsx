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

const NAV_ICONS: Record<Tab, ReactNode> = {
  home: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4.5" y="4.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.7" />
      <rect x="14.5" y="4.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.7" />
      <rect x="4.5" y="14.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.7" />
      <rect x="14.5" y="14.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  ),
  pos: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 5h10l1 4H6l1-4Z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M6 9v9a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9" stroke="currentColor" strokeWidth="1.7" />
      <path d="M10 13h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  reporting: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 19V9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M12 19V5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M19 19v-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  products: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4.5 5.5h15M4.5 18.5h15" stroke="currentColor" strokeWidth="1.7" />
      <path d="M6 5.5v13" stroke="currentColor" strokeWidth="1.7" />
      <path d="M18 5.5v13" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  ),
  promotion: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 3h8l5 5v8l-5 5H8l-5-5V8l5-5Z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9 15l6-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="9" cy="9" r="1" fill="currentColor" />
      <circle cx="15" cy="15" r="1" fill="currentColor" />
    </svg>
  ),
  inventory: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" stroke="currentColor" strokeWidth="1.7" />
      <path d="m4 7.5 8 4.5 8-4.5" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  ),
  purchase: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4v16M4 12h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  adjustment: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="m13 6 6 6-6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

function NavButton({
  label,
  active,
  onClick,
  compact,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  compact?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        display: "flex",
        alignItems: "center",
        gap: 10,
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
        lineHeight: 1.2,
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
      {icon ? (
        <span
          style={{
            width: 20,
            height: 20,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: active ? 1 : 0.85,
            flexShrink: 0,
          }}
        >
          {icon}
        </span>
      ) : null}
      <span>{label}</span>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
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
          padding: "0 4px 0 6px",
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
        <NavButton
          label="Home"
          icon={NAV_ICONS.home}
          active={activeTab === "home"}
          onClick={() => onTabChange("home")}
        />
        <NavButton
          label="Sell (POS)"
          icon={NAV_ICONS.pos}
          active={activeTab === "pos"}
          onClick={() => onTabChange("pos")}
        />
        <NavButton
          label="Reporting"
          icon={NAV_ICONS.reporting}
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
              icon={NAV_ICONS[item.id]}
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
            icon={NAV_ICONS.inventory}
            active={activeTab === "inventory"}
            onClick={() => onTabChange("inventory")}
          />
          {isAdmin && (
            <>
              <NavButton
                compact
                label="Purchases"
                icon={NAV_ICONS.purchase}
                active={activeTab === "purchase"}
                onClick={() => onTabChange("purchase")}
              />
              <NavButton
                compact
                label="Adjustments"
                icon={NAV_ICONS.adjustment}
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
