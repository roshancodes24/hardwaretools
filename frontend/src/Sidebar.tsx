import { useState } from 'react';
import { FEATURE_FLAGS } from './featureFlags';

// ─── Tab type ────────────────────────────────────────────────────────────────
// These must match the tab values already used in App.tsx
export type Tab = 'home' | 'pos' | 'reporting' | 'products' | 'promotion' | 'inventory' | 'purchase' | 'adjustment';

// ─── Props ───────────────────────────────────────────────────────────────────
interface SidebarProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  userRole?: string; // 'admin' | 'cashier' — hides purchase/adjustment for cashier if needed
}

// ─── Colour tokens (mirrors App.tsx palette) ─────────────────────────────────
const C = {
  bg: '#1c1917',
  bgHover: 'rgba(255,255,255,0.05)',
  bgActive: 'rgba(217,119,6,0.12)',
  accent: '#d97706',
  textMuted: '#a8a29e',
  textDim: '#78716c',
  textLight: '#e7e5e4',
  textActive: '#d97706',
  border: 'rgba(255,255,255,0.08)',
  groupLabel: '#57534e',
  avatarBg: '#44403c',
};

// ─── Tiny SVG icons ───────────────────────────────────────────────────────────
const Icon = {
  home: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2 6.5L8 2l6 4.5V14a.5.5 0 01-.5.5h-3.5V10h-4v4.5H2.5A.5.5 0 012 14V6.5z"
        stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
  sell: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="4" width="13" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 4V3a3 3 0 016 0v1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6 8h4M8 6v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
  reporting: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="9" width="3" height="5" rx=".5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="6.5" y="5" width="3" height="9" rx=".5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="11.5" y="2" width="3" height="12" rx=".5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
  catalog: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="1.5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="8.5" y="1.5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="1.5" y="8.5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="8.5" y="8.5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
  inventory: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="7" width="13" height="7.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 7V5a4 4 0 018 0v2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6 10.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
  chevron: (open: boolean) => (
    <svg
      width="12" height="12" viewBox="0 0 12 12" fill="none"
      style={{ transition: 'transform 0.18s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', flexShrink: 0 }}
    >
      <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function Dot({ active }: { active: boolean }) {
  return (
    <span style={{
      width: 5, height: 5, borderRadius: '50%',
      background: 'currentColor', flexShrink: 0,
      opacity: active ? 1 : 0.5,
    }} />
  );
}

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  children?: React.ReactNode; // e.g. chevron or badge
}

function NavItem({ icon, label, active, onClick, children }: NavItemProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '7px 14px', width: '100%', border: 'none', borderRadius: 0,
        background: active ? C.bgActive : hovered ? C.bgHover : 'transparent',
        color: active ? C.textActive : hovered ? C.textLight : C.textMuted,
        fontSize: 13, cursor: 'pointer', textAlign: 'left', position: 'relative',
        boxSizing: 'border-box',
      }}
    >
      {active && (
        <span style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: 3, background: C.accent, borderRadius: '0 2px 2px 0',
        }} />
      )}
      <span style={{ flexShrink: 0, opacity: active ? 1 : 0.7, display: 'flex' }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {children}
    </button>
  );
}

interface ParentNavItemProps {
  icon: React.ReactNode;
  label: string;
  open: boolean;
  onToggle: () => void;
}

function ParentNavItem({ icon, label, open, onToggle }: ParentNavItemProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onToggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '7px 14px', width: '100%', border: 'none', borderRadius: 0,
        background: hovered ? C.bgHover : 'transparent',
        color: open || hovered ? C.textLight : C.textMuted,
        fontSize: 13, fontWeight: 500, cursor: 'pointer', textAlign: 'left',
        boxSizing: 'border-box',
      }}
    >
      <span style={{ flexShrink: 0, opacity: open ? 1 : 0.7, display: 'flex' }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {Icon.chevron(open)}
    </button>
  );
}

interface SubNavItemProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function SubNavItem({ label, active, onClick }: SubNavItemProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 14px 5px 40px', width: '100%', border: 'none', borderRadius: 0,
        background: hovered ? 'rgba(255,255,255,0.04)' : 'transparent',
        color: active ? C.textActive : hovered ? '#d6d3d1' : C.textDim,
        fontSize: 12.5, cursor: 'pointer', textAlign: 'left',
        boxSizing: 'border-box',
      }}
    >
      <Dot active={active} />
      {label}
    </button>
  );
}

function GroupLabel({ label }: { label: string }) {
  return (
    <div style={{
      fontSize: 10, color: C.groupLabel,
      padding: '8px 14px 3px 40px',
      letterSpacing: '0.06em', textTransform: 'uppercase',
    }}>
      {label}
    </div>
  );
}

function Divider() {
  return <hr style={{ border: 'none', borderTop: `0.5px solid ${C.border}`, margin: '4px 14px' }} />;
}

// ─── Main Sidebar ─────────────────────────────────────────────────────────────
export function Sidebar({ activeTab, onTabChange, userRole }: SidebarProps) {
  const [catalogOpen, setCatalogOpen] = useState(
    activeTab === 'products' || activeTab === 'promotion'
  );
  const [inventoryOpen, setInventoryOpen] = useState(
    activeTab === 'inventory' || activeTab === 'purchase' || activeTab === 'adjustment'
  );

  const isAdmin = userRole === 'admin' || userRole === undefined;

  return (
    <aside style={{
      width: 232, minWidth: 232, background: C.bg,
      display: 'flex', flexDirection: 'column',
      height: '100vh', overflowY: 'auto',
      boxSizing: 'border-box',
    }}>

      {/* Logo */}
      <div style={{ padding: '14px 16px 10px', borderBottom: `0.5px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{
            width: 30, height: 30, background: C.accent, borderRadius: 6,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 500, color: '#fff', flexShrink: 0,
          }}>R</div>
          <div style={{ fontSize: 11, color: '#d6d3d1', lineHeight: 1.35 }}>
            <strong style={{ fontSize: 12, color: '#fff', fontWeight: 500, display: 'block' }}>
              Raj Electrical
            </strong>
            Hardware &amp; Paints
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '8px 0' }}>

        {/* Top-level items */}
        <NavItem icon={Icon.home} label="Home" active={activeTab === 'home'} onClick={() => onTabChange('home')} />
        <NavItem icon={Icon.sell} label="Sell" active={activeTab === 'pos'} onClick={() => onTabChange('pos')} />

        {FEATURE_FLAGS.reporting && (
          <NavItem icon={Icon.reporting} label="Reporting" active={activeTab === 'reporting'} onClick={() => onTabChange('reporting')} />
        )}

        <Divider />

        {/* Catalog — product master data only (SKUs, not stock movements) */}
        <ParentNavItem icon={Icon.catalog} label="Catalog" open={catalogOpen} onToggle={() => setCatalogOpen(o => !o)} />
        {catalogOpen && (
          <div>
            <GroupLabel label="Product master" />
            <SubNavItem
              label="Product catalog"
              active={activeTab === 'products'}
              onClick={() => onTabChange('products')}
            />

            {FEATURE_FLAGS.catalogBrands && (
              <SubNavItem label="Brands" active={false} onClick={() => { /* TODO: brands route */ }} />
            )}

            {FEATURE_FLAGS.catalogProductTypes && (
              <SubNavItem label="Product types" active={false} onClick={() => { /* TODO */ }} />
            )}
            {FEATURE_FLAGS.catalogPromotions && (
              <SubNavItem
                label="Promotions"
                active={activeTab === 'promotion'}
                onClick={() => onTabChange('promotion')}
              />
            )}
            {FEATURE_FLAGS.catalogPriceBooks && (
              <SubNavItem label="Price books" active={false} onClick={() => { /* TODO */ }} />
            )}
          </div>
        )}

        {/* Stock (levels, receiving, corrections) — admin only */}
        {isAdmin && (
          <>
            <ParentNavItem icon={Icon.inventory} label="Stock" open={inventoryOpen} onToggle={() => setInventoryOpen(o => !o)} />
            {inventoryOpen && (
              <div>
                <SubNavItem
                  label="Stock levels"
                  active={activeTab === 'inventory'}
                  onClick={() => onTabChange('inventory')}
                />

                <GroupLabel label="Receive stock" />
                <SubNavItem
                  label="Record supplier purchase"
                  active={activeTab === 'purchase'}
                  onClick={() => onTabChange('purchase')}
                />
                {FEATURE_FLAGS.inventoryOrderStock && (
                  <SubNavItem label="Order stock" active={false} onClick={() => { /* TODO */ }} />
                )}
                {FEATURE_FLAGS.inventoryReceiveStock && (
                  <SubNavItem label="Receive stock" active={false} onClick={() => { /* TODO */ }} />
                )}
                {FEATURE_FLAGS.inventorySupplierReturns && (
                  <SubNavItem label="Supplier returns" active={false} onClick={() => { /* TODO */ }} />
                )}

                <GroupLabel label="Corrections" />
                <SubNavItem
                  label="Adjust quantities"
                  active={activeTab === 'adjustment'}
                  onClick={() => onTabChange('adjustment')}
                />
                {FEATURE_FLAGS.inventoryCounts && (
                  <SubNavItem label="Inventory counts" active={false} onClick={() => { /* TODO */ }} />
                )}
              </div>
            )}
          </>
        )}
      </nav>

      {/* Footer / user row */}
      <div style={{ padding: '10px 14px', borderTop: `0.5px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{
            width: 26, height: 26, borderRadius: '50%', background: C.avatarBg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, color: '#d6d3d1', fontWeight: 500, flexShrink: 0,
          }}>
            {userRole === 'cashier' ? 'C' : 'A'}
          </div>
          <div style={{ fontSize: 11.5, color: C.textMuted }}>
            <strong style={{ color: '#d6d3d1', fontWeight: 500, display: 'block', fontSize: 12 }}>
              {userRole === 'cashier' ? 'Cashier' : 'Admin'}
            </strong>
            Raj Electrical
          </div>
        </div>
      </div>

    </aside>
  );
}
