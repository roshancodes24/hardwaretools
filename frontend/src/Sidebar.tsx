import { useMemo, useState, type ReactNode } from "react";
import { FEATURE_FLAGS } from "./featureFlags";

export type Tab =
  | "home"
  | "pos"
  | "outstanding"
  | "invoices"
  | "reporting"
  | "products"
  | "promotion"
  | "inventory"
  | "purchase"
  | "adjustment";

interface SidebarProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  /** When false, hide back-office nav (CASHIER = counter + catalog read). */
  isAdmin?: boolean;
  mobile?: boolean;
  iconOnly?: boolean;
  onToggleExpand?: () => void;
}

type NavLeaf = { id: Tab; label: string };

const NAV_ICONS: Record<Tab, ReactNode> = {
  home: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4.5" y="4.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.7" />
      <rect x="14.5" y="4.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.7" />
      <rect x="4.5" y="14.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.7" />
      <rect x="14.5" y="14.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  ),
  pos: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 5h10l1 4H6l1-4Z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M6 9v9a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9" stroke="currentColor" strokeWidth="1.7" />
      <path d="M10 13h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  outstanding: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 4h10v4H7V4Z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M6 8h12v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8Z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M10 12h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  invoices: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8 4h11a1 1 0 0 1 1 1v15l-3-2-3 2-3-2-3 2V5a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M10 9h7M10 12h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  reporting: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 19V9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M12 19V5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M19 19v-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  products: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4.5 5.5h15M4.5 18.5h15" stroke="currentColor" strokeWidth="1.7" />
      <path d="M6 5.5v13" stroke="currentColor" strokeWidth="1.7" />
      <path d="M18 5.5v13" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  ),
  promotion: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 3h8l5 5v8l-5 5H8l-5-5V8l5-5Z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9 15l6-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="9" cy="9" r="1" fill="currentColor" />
      <circle cx="15" cy="15" r="1" fill="currentColor" />
    </svg>
  ),
  inventory: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" stroke="currentColor" strokeWidth="1.7" />
      <path d="m4 7.5 8 4.5 8-4.5" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  ),
  purchase: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4v16M4 12h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  adjustment: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
  iconOnly = false,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  compact?: boolean;
  icon?: ReactNode;
  iconOnly?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      style={{
        width: "100%",
        textAlign: iconOnly ? "center" : "left",
        display: "flex",
        alignItems: "center",
        justifyContent: iconOnly ? "center" : "flex-start",
        gap: iconOnly ? 0 : 10,
        border: "1px solid",
        borderColor: active ? "rgba(37,99,235,0.4)" : "transparent",
        background: active ? "rgba(18,34,78,0.72)" : "transparent",
        color: active ? "#f8fafc" : "var(--sidebar-text)",
        borderRadius: 10,
        padding: iconOnly ? "10px 0" : compact ? "8px 10px" : "10px 12px",
        fontSize: compact ? 12.5 : 13,
        fontWeight: active ? 600 : 500,
        cursor: "pointer",
        transition: "all 0.14s ease",
        lineHeight: 1.2,
        boxShadow: active
          ? "inset 0 0 0 1px rgba(59,130,246,0.16), inset 3px 0 0 #3b82f6"
          : "none",
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
            width: 22,
            height: 22,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: active ? 1 : 0.85,
            flexShrink: 0,
            borderRadius: 6,
            background: active ? "rgba(37,99,235,0.2)" : "transparent",
            color: active ? "#3b82f6" : "currentColor",
          }}
        >
          {icon}
        </span>
      ) : null}
      {!iconOnly && <span>{label}</span>}
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

export function Sidebar({
  activeTab,
  onTabChange,
  isAdmin = true,
  mobile = false,
  iconOnly = false,
  onToggleExpand,
}: SidebarProps) {
  const [catalogOpen, setCatalogOpen] = useState(
    activeTab === "products" || activeTab === "promotion"
  );
  const [inventoryOpen, setInventoryOpen] = useState(
    activeTab === "inventory" || activeTab === "purchase" || activeTab === "adjustment"
  );

  const catalogItems = useMemo<NavLeaf[]>(() => {
    const rows: NavLeaf[] = [{ id: "products", label: "Products" }];
    if (FEATURE_FLAGS.catalogPromotions && isAdmin)
      rows.push({ id: "promotion", label: "Promotions" });
    return rows;
  }, [isAdmin]);

  return (
    <aside
      style={{
        width: mobile ? (iconOnly ? 72 : 228) : 244,
        minWidth: mobile ? (iconOnly ? 72 : 228) : 244,
        height: "100vh",
        background: "var(--sidebar-bg)",
        borderRight: "1px solid var(--sidebar-border)",
        padding: "0 8px 8px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        flexShrink: 0,
        overflow: "hidden",
        transition: "width 0.2s ease, min-width 0.2s ease",
      }}
    >
      <div
        style={{
          height: 56,
          borderBottom: "1px solid var(--sidebar-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: iconOnly ? "center" : "space-between",
          padding: "0 6px",
          marginBottom: 6,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "#f5f4f0", fontWeight: 700, fontSize: 13 }}>
            {iconOnly ? "RH" : "Raj Hardware, Electrical and Paint"}
          </div>
          {!mobile && !iconOnly && (
            <div style={{ color: "var(--sidebar-muted)", marginTop: 2, fontSize: 10.5 }}>
              Retail Console
            </div>
          )}
        </div>
        {mobile && onToggleExpand && (
          <button
            type="button"
            onClick={onToggleExpand}
            aria-label={iconOnly ? "Expand sidebar labels" : "Collapse sidebar labels"}
            title={iconOnly ? "Expand labels" : "Collapse labels"}
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              border: "1px solid var(--sidebar-border)",
              background: "rgba(255,255,255,0.06)",
              color: "#cbd5e1",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {iconOnly ? "»" : "«"}
          </button>
        )}
      </div>

      <nav
        className="sidebar-nav-scroll"
        aria-label="Main navigation"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          WebkitOverflowScrolling: "touch",
        }}
      >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <NavButton
          label="Home"
          icon={NAV_ICONS.home}
          active={activeTab === "home"}
          onClick={() => onTabChange("home")}
          iconOnly={iconOnly}
        />
        <NavButton
          label="Sell (POS)"
          icon={NAV_ICONS.pos}
          active={activeTab === "pos"}
          onClick={() => onTabChange("pos")}
          iconOnly={iconOnly}
        />
        <NavButton
          label="Outstanding"
          icon={NAV_ICONS.outstanding}
          active={activeTab === "outstanding"}
          onClick={() => onTabChange("outstanding")}
          iconOnly={iconOnly}
        />
        <NavButton
          label="Invoices"
          icon={NAV_ICONS.invoices}
          active={activeTab === "invoices"}
          onClick={() => onTabChange("invoices")}
          iconOnly={iconOnly}
        />
        {isAdmin ? (
          <NavButton
            label="Reporting"
            icon={NAV_ICONS.reporting}
            active={activeTab === "reporting"}
            onClick={() => onTabChange("reporting")}
            iconOnly={iconOnly}
          />
        ) : null}
      </div>

      <div style={{ borderTop: "1px solid var(--sidebar-border)", margin: "4px 2px" }} />

      {!iconOnly && (
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
              iconOnly={iconOnly}
            />
          ))}
        </div>
      </NavGroup>
      )}
      {iconOnly && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {catalogItems.map((item) => (
            <NavButton
              key={item.id}
              compact
              label={item.label}
              icon={NAV_ICONS[item.id]}
              active={activeTab === item.id}
              onClick={() => onTabChange(item.id)}
              iconOnly
            />
          ))}
        </div>
      )}

      {!iconOnly && (
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
            iconOnly={iconOnly}
          />
          {isAdmin && (
            <>
              <NavButton
                compact
                label="Purchases"
                icon={NAV_ICONS.purchase}
                active={activeTab === "purchase"}
                onClick={() => onTabChange("purchase")}
                iconOnly={iconOnly}
              />
              <NavButton
                compact
                label="Adjustments"
                icon={NAV_ICONS.adjustment}
                active={activeTab === "adjustment"}
                onClick={() => onTabChange("adjustment")}
                iconOnly={iconOnly}
              />
            </>
          )}
        </div>
      </NavGroup>
      )}
      {iconOnly && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <NavButton
            compact
            label="Overview"
            icon={NAV_ICONS.inventory}
            active={activeTab === "inventory"}
            onClick={() => onTabChange("inventory")}
            iconOnly
          />
          {isAdmin && (
            <>
              <NavButton
                compact
                label="Purchases"
                icon={NAV_ICONS.purchase}
                active={activeTab === "purchase"}
                onClick={() => onTabChange("purchase")}
                iconOnly
              />
              <NavButton
                compact
                label="Adjustments"
                icon={NAV_ICONS.adjustment}
                active={activeTab === "adjustment"}
                onClick={() => onTabChange("adjustment")}
                iconOnly
              />
            </>
          )}
        </div>
      )}

      </nav>

      <div style={{ flexShrink: 0, borderTop: "1px solid var(--sidebar-border)", paddingTop: 10 }}>
        {mobile && onToggleExpand && (
          <button
            type="button"
            onClick={onToggleExpand}
            aria-label={iconOnly ? "Expand sidebar labels" : "Collapse sidebar labels"}
            title={iconOnly ? "Expand labels" : "Collapse labels"}
            style={{
              width: "100%",
              height: 34,
              borderRadius: 8,
              border: "1px solid var(--sidebar-border)",
              background: "rgba(255,255,255,0.06)",
              color: "#cbd5e1",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {iconOnly ? "Expand labels" : "Collapse labels"}
          </button>
        )}
      </div>
    </aside>
  );
}
