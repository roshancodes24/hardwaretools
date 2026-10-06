# Functional Requirements Document (FRD)

**Product:** Hardware Inventory System  
**Document type:** Functional Requirements  
**Audience:** Shop owners, managers, and stakeholders (also usable by developers for acceptance)  
**Version:** 1.0  
**Date:** 2026-07-24  
**Related docs:** [FSD.md](./FSD.md) (functional design), [DATA_DICTIONARY.md](./DATA_DICTIONARY.md) (schema), [ER_DIAGRAMS.md](./ER_DIAGRAMS.md) (ER), [USER_GUIDE.md](./USER_GUIDE.md) (how to operate), [packaging/GO-LIVE-NOTES.md](../packaging/GO-LIVE-NOTES.md)

---

## 1. Document control

| Item | Value |
|------|--------|
| Scope basis | As-built application (code + schema + go-live notes) |
| Companion design | Functional Specification Document (`docs/FSD.md`) |
| Requirement ID pattern | `FR-<AREA>-nn` (functional), `NFR-<AREA>-nn` (non-functional) |
| Priority | **Must** = required for intended shop operation; **Should** = expected when feature is enabled; **Could** = optional / flagged off by default |

This FRD states **what** the system must do and **who** it serves. Detailed flows, APIs, and rules are in the FSD.

---

## 2. Purpose and product summary

The Hardware Inventory System is a **retail point-of-sale (POS) and inventory console** for a hardware / electrical / paints shop. It supports:

- Product catalog with units, barcodes, GST-related fields, and pricing
- Purchasing from suppliers and stock adjustments
- Counter sales with cash / online / split payments and credit (outstanding) balances
- Invoice reprint and on-demand business reports
- Optional **scheduled owner reports** delivered by email and saved in-app

Currency and tax context are **India-oriented** (INR, GST/HSN fields, Indian financial-year quarters for scheduled reports, Asia/Kolkata scheduling).

Brand display name is configurable at build time (e.g. shop name); default branding is “Raj Hardware.” Invoice letterhead is set separately.

---

## 3. Stakeholders and actors

| Actor | Description |
|-------|-------------|
| **Shop owner / Admin** | Full back-office: catalog, purchases, adjustments, reporting, schedule config, price review |
| **Manager** | Same effective access as Admin (legacy role treated as admin) |
| **Cashier** | Counter work: POS, outstanding payments, invoice reprint; view-only products and stock overview |
| **System scheduler** | In-process job that generates scheduled reports on a cron (IST) |
| **Email recipient** | Owner email that receives “report ready” links when SMTP is configured |

---

## 4. Assumptions and constraints

| ID | Assumption / constraint |
|----|-------------------------|
| A-01 | Single shop deployment; one PostgreSQL database |
| A-02 | Staff authenticate with username + password; browser holds a JWT (no server-side session revocation list) |
| A-03 | Deployment may be local Windows/Linux or hosted (e.g. Railway); UI may be served by the API or a separate Vite origin |
| A-04 | Production requires a strong `JWT_SECRET` and configured `DATABASE_URL` |
| A-05 | Scheduled report periods and cron use **Asia/Kolkata**; quarterly periods follow the **Indian financial year** (Apr–Mar) |
| A-06 | Bulk CSV/Excel imports are capped at approximately **1,500 rows** per file |
| A-07 | Promotions and several inventory sub-features may be hidden by frontend feature flags |

---

## 5. In scope and out of scope

### In scope

- Login, session, and admin “acting as” another user
- Home dashboard shortcuts, activity, and admin-oriented revenue views
- Product catalog CRUD (admin), view (cashier), bulk import, price review
- Suppliers (admin) and customers (all authenticated users for create/list as implemented)
- Purchases with stock-in and supplier payments (admin)
- Stock overview and manual stock adjustments (adjustments admin-only)
- POS sales, payments, outstanding balances, invoice reprint
- On-demand reporting (admin, when reporting flag is on)
- Scheduled owner reports: configuration, generation, history, optional email
- Appearance settings (light / dark / system) in the browser
- Document number series for bill vs tax invoices (env-configurable start values)
- Health check and production packaging/backup practices documented separately

### Out of scope (current product)

- Native mobile apps
- Multi-branch / multi-company tenancy
- Online customer storefront or e-commerce
- Full GST return filing / e-invoice government integration
- Server-side theme or company profile settings API (invoice letterhead is build-time / code config)
- Features whose UI flags are off by default and not part of the primary go-live path (e.g. promotions UI, unused inventory sub-navs) — documented only as optional when enabled

---

## 6. Functional requirements

Priority legend: **Must** | **Should** | **Could**

### 6.1 Authentication and session

| ID | Requirement | Priority | Acceptance criteria |
|----|-------------|----------|---------------------|
| FR-AUTH-01 | Users shall sign in with username and password and receive an access token for subsequent API calls. | Must | Valid credentials return token + user profile; invalid credentials return unauthorized without issuing a token. |
| FR-AUTH-02 | Protected API operations shall require a valid Bearer token for an active user. | Must | Missing/invalid/expired token yields 401; inactive users cannot authenticate. |
| FR-AUTH-03 | Failed login attempts shall be rate-limited per client IP. | Must | After the configured max failures in the window, further attempts are rejected until the window resets (configurable; default 10 / 15 minutes). |
| FR-AUTH-04 | Admin/Manager users shall be able to switch the effective (“acting”) user when multiple staff accounts exist. | Should | Cashiers cannot switch; admins can select another active user; permissions follow the acting user where enforced. |
| FR-AUTH-05 | The client shall restore session state after reload while the token remains valid. | Must | Reloading the app with a stored valid token returns the user to an authenticated console without re-entering credentials. |

### 6.2 Home / dashboard

| ID | Requirement | Priority | Acceptance criteria |
|----|-------------|----------|---------------------|
| FR-HOME-01 | After login, users shall land on a Home view with navigation to primary tasks. | Must | Home shows shortcuts appropriate to role. |
| FR-HOME-02 | Home shall surface recent activity and stock-related alert counts from live catalog data. | Should | Low/out-of-stock style counts reflect current product stock/reorder data. |
| FR-HOME-03 | Admin/Manager Home shall include revenue / timeseries oriented dashboard data when reports are available. | Should | Admin sees revenue chart or equivalent; cashier focuses on sell shortcuts. |

### 6.3 Catalog (products)

| ID | Requirement | Priority | Acceptance criteria |
|----|-------------|----------|---------------------|
| FR-CAT-01 | Admin/Manager shall create, update, and delete products with SKU, name, units, pricing, and GST-related fields (HSN, tax %). | Must | Mutations succeed for admin; cashiers cannot mutate via UI/API. |
| FR-CAT-02 | Cashiers shall view the product catalog in read-only mode. | Must | Cashiers can open Products and see data but cannot add/edit/delete. |
| FR-CAT-03 | Products shall support multi-unit definitions and optional barcodes. | Must | Units convert to a base unit; barcodes uniquely identify products/packs as configured. |
| FR-CAT-04 | Brand codes shall be unique when present (case-insensitive). | Must | Duplicate brand codes are rejected; blank brand code may auto-generate (e.g. `BC-#####`). |
| FR-CAT-05 | Admin shall import products from CSV/Excel up to ~1,500 rows per batch. | Should | Template available; successful import creates products and shows a concise success summary. |
| FR-CAT-06 | Large catalogs shall be browsable with server-side pagination and search. | Must | Products table loads a page size (e.g. 50) with search, not the entire catalog at once in the grid. |
| FR-CAT-07 | When a purchase lowers cost, the system shall keep current selling price and flag the product for price review with a suggested price. | Must | Flagged products appear for admin review; apply/dismiss works per item and in bulk. |
| FR-CAT-08 | When purchase cost rises, selling price may increase according to markup rules without requiring a review flag. | Must | Documented go-live behavior: cost up → shelf price can rise via markup; cost down → review flag. |

### 6.4 Suppliers and customers

| ID | Requirement | Priority | Acceptance criteria |
|----|-------------|----------|---------------------|
| FR-PARTY-01 | Admin/Manager shall maintain suppliers (name, contact, GST, etc.). | Must | Supplier list/create available to admin; used on purchases. |
| FR-PARTY-02 | Authenticated users shall be able to list and create customers with optional GST/state fields for invoicing. | Must | Customer records can be linked or snapshotted on sales. |

### 6.5 Purchases and supplier payments

| ID | Requirement | Priority | Acceptance criteria |
|----|-------------|----------|---------------------|
| FR-PUR-01 | Admin/Manager shall record purchases from a supplier with line items (product, quantity, unit cost). | Must | Recording a purchase increases stock and updates cost/pricing per business rules. |
| FR-PUR-02 | Admin shall import purchase lines from CSV/Excel (up to ~1,500 lines) matching catalog by brand code and/or name. | Should | Required columns validated; large imports show summary UI; Record Purchase commits stock. |
| FR-PUR-03 | Admin shall record payments against purchases and track purchase balance outstanding. | Should | Payments reduce balance; unpaid received purchases appear in supplier outstanding reporting. |
| FR-PUR-04 | Cashiers shall not access purchase create/list APIs or the Purchases nav. | Must | Non-admin receives forbidden / nav hidden. |

### 6.6 Point of sale (POS)

| ID | Requirement | Priority | Acceptance criteria |
|----|-------------|----------|---------------------|
| FR-POS-01 | Authenticated users shall create sales by searching products, setting quantities/units, and completing payment. | Must | Completed sale decreases stock and assigns a sale number. |
| FR-POS-02 | Checkout shall support Cash and Online banking payment methods. | Must | Method is stored on payment records for reporting. |
| FR-POS-03 | Checkout shall support split cash + online amounts; unpaid remainder remains balance due. | Must | Split validation prevents over-allocation; remainder is outstanding, not auto-filled. |
| FR-POS-04 | Sales shall support discounts, optional transport/freight amount, and walk-in or registered customer details (including tax invoice party fields where used). | Should | Totals reflect lines + discount + tax + transport; party GST/state captured when provided. |
| FR-POS-05 | Concurrent sales shall not oversell the same product stock. | Must | One sale succeeds; conflicting sale returns insufficient stock. |
| FR-POS-06 | Bill vs tax invoice numbering shall use separate configurable series. | Should | Numbers follow configured starts (e.g. `BIL-n` / `INV-n`). |

### 6.7 Outstanding balances

| ID | Requirement | Priority | Acceptance criteria |
|----|-------------|----------|---------------------|
| FR-OUT-01 | Users shall list completed sales with remaining balance due. | Must | Outstanding list shows unpaid/partial sales. |
| FR-OUT-02 | Users shall record additional payments against an outstanding sale. | Must | Payment reduces balance; method recorded. |

### 6.8 Invoices (reprint)

| ID | Requirement | Priority | Acceptance criteria |
|----|-------------|----------|---------------------|
| FR-INV-01 | Users shall see the latest invoices and search or look up sales by number to reprint or view them. | Must | Opening Invoices lists at least the 10 most recent completed or cancelled invoices when that many exist. Search still retrieves a sale by number, name, or phone and renders the invoice for print. |
| FR-INV-02 | Admin/Manager shall cancel a completed invoice from the invoice list after an explicit confirmation. | Must | Only `COMPLETED` sales can be cancelled. The sale row is kept with status `CANCELLED` (not deleted). Stock from every line is restored in the same transaction. The list keeps the row, shows a non-clickable Cancelled indicator, and the reprinted invoice is marked cancelled. Cashiers cannot cancel. `RETURNED` and `DRAFT` sales are not cancellable from this action. |

### 6.9 Stock overview and adjustments

| ID | Requirement | Priority | Acceptance criteria |
|----|-------------|----------|---------------------|
| FR-STK-01 | Authenticated users shall view inventory overview with stock levels and status (in stock / low / out). | Must | Overview searchable/sortable as implemented. |
| FR-STK-02 | Admin/Manager shall post stock adjustments with reason (and optional note), updating on-hand quantity with an audit trail. | Must | Before/after quantities stored; stock movements recorded; cashiers cannot adjust. |

### 6.10 On-demand reporting

| ID | Requirement | Priority | Acceptance criteria |
|----|-------------|----------|---------------------|
| FR-RPT-01 | When reporting is enabled, Admin/Manager shall run date-range reports for sales summary, sales by product/customer, purchases, supplier payments, gross margin, and tax invoice sales. | Must | Each report returns data for the selected `from`/`to` range for admin only. |
| FR-RPT-02 | Admin shall access dashboard timeseries / revenue series for charts. | Should | Home/reporting charts load for admin. |
| FR-RPT-03 | Cashiers shall not access reporting APIs or the Reporting nav. | Must | Forbidden / nav hidden. |

### 6.11 Scheduled owner reports

| ID | Requirement | Priority | Acceptance criteria |
|----|-------------|----------|---------------------|
| FR-SCH-01 | Admin shall configure which report types are enabled, their period (daily/monthly/quarterly/yearly), and a notify email. | Must | Config persists; email required if any type enabled. |
| FR-SCH-02 | The system shall generate scheduled reports for the **previous** completed period for: Sales, Inventory snapshot, Supplier outstanding, Customer outstanding. | Must | Runs appear in history with status and payload when successful. |
| FR-SCH-03 | When SMTP and notify email are configured, the system shall email a link to open the saved report in the app. | Should | Without SMTP, runs still save; email is skipped with operational awareness. |
| FR-SCH-04 | Scheduler shall run in Asia/Kolkata on a configurable cron, staggering report types to avoid overload. | Should | Default morning stagger; one type processed per tick; idempotent completed runs. |
| FR-SCH-05 | Admin shall open a saved report run from history or deep link (`?reportRun=`). | Must | Viewer shows the stored report content for authorized admin. |

### 6.12 Promotions (optional)

| ID | Requirement | Priority | Acceptance criteria |
|----|-------------|----------|---------------------|
| FR-PROMO-01 | When the promotions feature flag is enabled, Admin shall create/update/delete percentage promotions (cart / product / category scope). | Could | UI and mutate APIs available only when flag on; cashiers cannot mutate. |

### 6.13 Settings and branding

| ID | Requirement | Priority | Acceptance criteria |
|----|-------------|----------|---------------------|
| FR-SET-01 | Users shall choose Light, Dark, or System appearance preference stored in the browser. | Should | Preference persists locally; no server round-trip required. |
| FR-SET-02 | Company display name used in the UI shall be configurable at frontend build time. | Should | Changing Vite company env vars updates visible brand strings after rebuild. |

### 6.14 Quotations

| ID | Requirement | Priority | Acceptance criteria |
|----|-------------|----------|---------------------|
| FR-QUO-01 | Admin/Manager shall create quotations for an existing customer or for a new customer who is not yet in the customer master. | Must | A quotation can be issued with `customerId` set or null. New-customer details are not required to exist in `Customer` first. Optional “Save as customer” creates or links a customer by phone without blocking issue. |
| FR-QUO-02 | Quotation lines shall reference existing active products and use `Product.sellingPrice`. The client cannot submit a unit price or totals. | Must | Missing selling price or an inactive product is rejected. Stored `unitPrice` matches selling price × unit conversion. No second product catalog is created. |
| FR-QUO-03 | Creating, editing, or issuing a quotation shall not change stock, sales, purchases, or payments. Only converting an issued quotation (FR-QUO-08) records a sale. | Must | Until a quotation is converted, `Product.currentStock` and stock movements are unchanged and no `Sale` row is created. |
| FR-QUO-04 | The server shall number quotations `QUO-YYYY-####` and set validity to 2 calendar days from the quotation date in Asia/Kolkata. | Must | Numbers are unique under concurrent creates. `validUntil` is the quotation date plus 2 days. Dates are not taken from the browser. |
| FR-QUO-05 | Discount, transport, and totals shall be recomputed on the server with decimal arithmetic. GST follows the tax-invoice calculation when Include GST is on, and is omitted when Include GST is off. | Must | Include GST defaults to on, including when the request omits the flag. When it is on, line and order discounts, CGST/SGST/IGST from the product rates, taxable amount, and grand total match the tax-invoice math. When it is off, line tax, CGST, SGST, IGST, and tax amount are 0.00 and the total is subtotal minus discount plus transport. Product GST percentages are still stored on each line and are not charged. Issuing a draft keeps the saved choice and does not start charging GST. Client totals and unit prices are rejected. |
| FR-QUO-06 | Draft quotations can be edited. Issued quotations cannot be edited. Cancelled quotations cannot be issued. Expired is derived when the current India date is after `validUntil`. | Must | Status transitions above are enforced. Historical quotations are not deleted. |
| FR-QUO-07 | Admin/Manager shall list, view, print, and download a customer-facing quotation PDF. | Must | List filters by number/customer, status, and date. PDF shows business letterhead, quotation number, dates, customer snapshot, lines, and totals. A quotation saved without GST states that GST is not included and does not present CGST, SGST, or IGST as charged amounts. |
| FR-QUO-08 | Admin/Manager shall convert an issued quotation (including an expired one, after a warning) into a normal sale from the POS. The sale shall keep the quoted unit price, discount and GST, may cover only part of the quotation, shall be a tax invoice when the quotation includes GST and a bill when it does not, shall need the customer details the POS already requires, and shall be refused when any line is short on stock. A quotation can be converted once; whatever is left out is not converted later. | Must | **Convert to sale** appears on issued and expired quotations and opens the POS cart pre-filled with the quoted lines, customer, and transport. Prices, discount and tax cannot be changed and quantities cannot be raised; lines can be lowered or removed (discount is pro-rated). The sale is saved as `INV-*` (GST) or `BIL-*` (no GST) and the quotation shows **Converted** with that number, cannot be converted or cancelled again, and is not editable. Stock is checked on the server: the error lists every short item and nothing is saved. A cashier calling the API with a quotation gets 403. |

---

## 7. Role permission matrix

Effective admin = `ADMIN` or `MANAGER`.

| Capability | Admin / Manager | Cashier |
|------------|-----------------|---------|
| Login / JWT session | Yes | Yes |
| Switch acting user | Yes | No |
| Home, POS, Outstanding, Invoices | Yes | Yes |
| Cancel a completed invoice | Yes | No |
| Quotations | Yes | No |
| Convert a quotation to a sale | Yes | No |
| Products — view | Yes | Yes |
| Products — create/update/delete/import/price review | Yes | No |
| Inventory overview | Yes | Yes |
| Purchases & suppliers | Yes | No |
| Stock adjustments | Yes | No |
| Reporting (on-demand) | Yes | No |
| Scheduled owner reports | Yes | No |
| Promotions mutate (if flag on) | Yes | No |
| Settings (theme) | Yes | Yes |
| Customers list/create | Yes | Yes |

---

## 8. Non-functional requirements

| ID | Requirement | Priority | Acceptance criteria |
|----|-------------|----------|---------------------|
| NFR-SEC-01 | Production shall require a strong JWT secret and restrict browser CORS origins as configured. | Must | Misconfigured production JWT fails closed; CORS allows listed origins (+ same-origin when applicable). |
| NFR-SEC-02 | Passwords shall be stored hashed (not plaintext). | Must | Seed/login uses password hashes. |
| NFR-CON-01 | Stock updates for concurrent sales shall be concurrency-safe (no oversell). | Must | See FR-POS-05. |
| NFR-CON-02 | Quotation numbers shall be allocated inside a transaction with a year-row lock so concurrent creates cannot collide. | Must | See FR-QUO-04. |
| NFR-PERF-01 | API shall accept large JSON bodies sufficient for ~1,500-row imports (default 15 MB). | Must | Bulk import does not fail with 413 under default limit. |
| NFR-PERF-02 | Bulk product create and large purchase record shall complete without routine transaction timeouts for supported batch sizes. | Should | Chunked/batched writes as implemented. |
| NFR-OPS-01 | Operators shall be able to back up and restore the PostgreSQL database using provided scripts. | Must | Documented backup/restore path works on a maintained installation. |
| NFR-OPS-02 | `GET /api/health` shall report API liveness without authentication. | Must | Returns OK-style JSON when process is up. |
| NFR-OBS-01 | API requests shall be logged with method, path, status, and duration. | Should | Visible in server stdout for operations. |
| NFR-I18N-01 | Money presentation and invoice wording target INR / Indian retail practice. | Should | UI and invoices use rupee formatting conventions as implemented. |

---

## 9. Traceability (FR → FSD)

| FR area | FSD section |
|---------|-------------|
| FR-AUTH-* | §4 Auth & RBAC |
| FR-HOME-* | §6.1 Home |
| FR-CAT-* | §6.2 Catalog |
| FR-PARTY-* | §6.3 Parties |
| FR-PUR-* | §6.4 Purchases |
| FR-POS-* | §6.5 POS |
| FR-OUT-* | §6.6 Outstanding |
| FR-INV-* | §6.7 Invoices |
| FR-STK-* | §6.8 Stock |
| FR-RPT-* | §6.9 Reporting |
| FR-SCH-* | §6.10 Scheduled reports |
| FR-PROMO-* | §6.11 Promotions |
| FR-SET-* | §6.12 Settings |
| FR-QUO-* | §6.8a Quotations |
| NFR-* | §7 Cross-cutting & §9 Deployment |

---

## 10. Glossary

| Term | Meaning |
|------|---------|
| **Acting user** | Effective user identity for permissions and audit fields after optional admin switch |
| **Base unit** | Canonical stock unit for a product; other units convert via factors |
| **Outstanding** | Remaining unpaid balance on a completed sale (or unpaid purchase balance for suppliers) |
| **Price review** | Flag when cheaper purchase cost suggests a lower shelf price pending owner decision |
| **Report run** | Saved scheduled report instance with period bounds and JSON payload |

---

*End of FRD. Behavioral design is specified in `docs/FSD.md`.*
