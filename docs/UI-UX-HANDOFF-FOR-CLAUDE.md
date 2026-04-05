# Hardware Inventory / POS — UI/UX context for review

Paste this whole file into Claude when you want suggestions to **optimize UI/UX**, **accessibility**, **information architecture**, or **visual design**. The app is real production-lean code in a private repo; this document summarizes what exists today.

---

## Product

**Name (in UI):** *Raj Electrical, Hardware and Paints — POS & Inventory*

**Purpose:** Point of sale, inventory browsing, supplier purchases, and stock adjustments for a hardware / electrical / paints shop. Currency is **₹ (INR)** via `en-IN` locale.

**Users (seed / demo):** Admin (purchases, adjustments) and Cashier (sales). IDs come from `/api/session`.

---

## Tech stack

| Layer | Choice |
|--------|--------|
| UI | React 19, TypeScript |
| Build | Vite 6, `@vitejs/plugin-react` |
| Styling | **Almost entirely inline `style={{}}` objects** in one large component file |
| Global CSS | `frontend/src/index.css` — minimal reset (`box-sizing`, `body` margin), disabled button cursor/opacity |
| API | `fetch` to `/api/*`; dev server proxies `/api` → `http://localhost:4000` |

There is **no** component library, **no** Tailwind, **no** CSS modules for the main UI.

---

## Code organization (frontend)

- **Main UI:** `frontend/src/App.tsx` — **~1,800+ lines**, contains:
  - Root layout, tab navigation, data loading
  - `POSView`, `InventoryView`, `PurchaseView`, `AdjustmentView`
  - Shared pieces: `Badge`, `Toast`, `FormErrorBanner`, `FieldWrap`, shared `inputStyle`
- **API client:** `frontend/src/api/client.ts`
- **Product mapping:** `frontend/src/lib/mapProduct.ts` — maps API product + units to `UiProduct`

Refactors are fair game (split files, design tokens, shared components) if you recommend them.

---

## Navigation & screens

Top bar: dark strip (`#1c1917`), height ~54px, logo block with amber accent (`#d97706`), shop title, **tab buttons**, today’s date (`en-IN`).

**Tabs:**

1. **Point of Sale** (`pos`)  
   - Search + category filter.  
   - Product **grid** of cards (click to add; out-of-stock disabled, muted).  
   - **Cart** with quantities, line errors, order-level discount input.  
   - Checkout → `POST /api/sales`.  
   - Success/error **Toast** (auto-dismiss timing in code).

2. **Inventory** (`inventory`)  
   - Summary cards: Total SKUs, Stock Value, Low Stock count, Out of Stock count.  
   - Search (name / SKU / category).  
   - **Sortable table** (click column headers): SKU, Product, Category, Sale Price, Stock, Unit, Status.  
   - Toggle asc/desc; status sort: **Out of Stock → Low Stock → In Stock** when ascending (severity).

3. **Purchases** (`purchase`)  
   - Supplier select, invoice metadata, multi-line purchase form.  
   - `POST /api/purchases`.

4. **Stock Adjust** (`adjustment`)  
   - Product, quantity-after, reason, note.  
   - `POST /api/stock-adjustments`.

**Initial load:** Fetches session + products + suppliers in parallel. Loading and global error states are simple text/banner patterns.

---

## Visual language (current tokens)

Derived from inline styles in `App.tsx`:

| Role | Color | Notes |
|------|--------|--------|
| Page background | `#f5f4f0` | Warm off-white |
| Top bar | `#1c1917` | Stone-900 |
| Primary accent / active tab | `#d97706` | Amber |
| Muted text | `#78716c`, `#a8a29e`, `#57534e` | Stone scale |
| Borders | `#e7e5e4`, `#f5f4f0` | |
| Success / in-stock | `#dcfce7` bg, `#16a34a` text | |
| Warning / low stock | `#fef3c7` bg, `#d97706` text | |
| Error / out of stock | `#fee2e2` bg, `#dc2626` text | |
| Primary CTA (e.g. Confirm Sale) | `#d97706` | |
| Secondary dark button | `#1c1917` | e.g. Save Adjustment |

**Typography:** `system-ui, -apple-system, sans-serif`. Prices often **monospace**. Mixed font sizes (~11–22px) without a formal scale.

**Shape:** Border radius commonly **8–12px** on cards, inputs, tables.

---

## Domain objects at the UI layer

**`UiProduct`** (from `mapProduct.ts`): `id`, `name`, `sku`, `category`, `price` (selling), `stock` (cached base units), `unit` (display), `lowStock` (from reorder level), `baseUnitId`, `allowsFractionalSale`.

**Stock status:**  
`out` if `stock === 0`, else `low` if `stock <= lowStock`, else `ok`.

Badges: **In Stock** | **Low Stock** | **Out of Stock**.

---

## API surface (for UX that depends on data)

Base path `/api` (proxied in dev).

- `GET /session` — demo user IDs  
- `GET /products` — products with `units`, `barcodes`  
- `GET /suppliers`  
- `POST /sales`, `POST /purchases`, `POST /stock-adjustments`

Optimistic UI is **not** heavily used; errors come back as structured messages mapped to fields in forms.

---

## Known UX / a11y gaps (good optimization targets)

- **Keyboard:** Tab screens and POS grid may need explicit focus order, keyboard activation, skip links.  
- **Screen readers:** Product cards, sortable headers, and dynamic errors may lack ARIA roles/labels.  
- **Touch targets:** Some controls are dense; verify minimum sizes on tablets used as POS.  
- **Responsive:** Layout is largely flex/grid without documented breakpoints; likely desktop-first.  
- **Empty / edge states:** Few dedicated illustrations or copy for empty cart, zero search results, etc.  
- **Design consistency:** One-off inline values; no token file — drift is easy.

---

## What “optimize” might mean here

Prioritize practical wins for **retail staff**:

- Faster **checkout** (fewer taps, clearer totals, barcode-friendly layout if added later).  
- Clearer **stock signals** in POS (not only badges).  
- **Inventory** readability at a glance (density, zebra striping, sticky header already present).  
- **Forms** with clearer grouping, progressive disclosure, and error recovery.  
- **Accessibility** to meet WCAG-minded goals where possible without a full redesign.

---

## Files worth mentioning in follow-up

- `frontend/src/App.tsx` — all main UI  
- `frontend/src/lib/mapProduct.ts` — product shape  
- `frontend/src/api/client.ts` — networking  
- `frontend/vite.config.ts` — dev server port **5173**, API proxy  

---

## Optional prompt you can add after pasting

> Using the context above, propose a prioritized UI/UX improvement plan: quick wins vs larger refactors. Call out specific screens and suggest modern patterns (spacing scale, typography scale, focus states, responsive behavior). If recommending a design system, keep migration cost low for a small team.
