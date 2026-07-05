# Go-live / production release notes

Use this document when rolling out a new version to the shop floor, admin users, or a production server. Share the **Staff** and **Admin** sections with users; keep the **Deployment** section for whoever installs or maintains the system.

---

## For shop staff (cashiers)

### Point of sale (POS)

- **Payment method at checkout** — Before confirming a sale, choose **Cash** or **Online banking**. This is recorded on the sale for reporting.
- **Split payments** — You can tick **Split payment** and enter separate cash and online amounts. The remainder shows as balance due (it is not auto-assigned to the other method).
- **Progress indicators** — Long operations (e.g. confirming a large sale) show a “Processing…” state so you know the system is working.

### What has not changed for cashiers

- Product search, cart, and bill/tax invoice flow work as before.
- Cashiers still have **view-only** access to the product catalog (no add/edit/delete).

---

## For admin / manager users

### Products

- **Bulk import (CSV / Excel)** — Import up to **1,500 products** per file from **Products → Import CSV / Excel**. A loading overlay appears while the file is read and while saving. After a successful batch save, you will see a simple message such as **“1000 Products created successfully”** (no long SKU list).
- **Download template** — Use the template button on the Products page for correct column headers.
- **Hidden columns in the main table** — Brand Code, HSN Code, Unit, and Markup % are hidden from the main products grid only; they remain in add/edit, batch entry, import, and search.
- **Large catalogs** — The products table loads **50 rows per page** with server-side search; use search to find items in large imports instead of scrolling the entire list.
- **Price review after cheaper purchases** — When stock is bought **cheaper** than before, the system **keeps** the current selling price and flags the product for review (selling prices **rise automatically** when cost goes up).
  - Review banner on the Products page shows flagged items.
  - **Apply all suggested** — Accepts suggested markdowns for all flagged products in one step.
  - **Keep all current** — Clears all flags without changing prices.
  - Per-product **Apply** / **Keep current** still available for individual items.
- **Brand codes must be unique** — Duplicate brand codes (even different capitalisation) are no longer allowed. This keeps purchase imports and catalog matching reliable.

### Purchases

- **Bulk import (CSV / Excel)** — Import up to **1,500 lines** per file from **Purchases → Import CSV / Excel**. Required columns: quantity, unit cost, and product (brand code and/or product name). Optional supplier column (all rows must be the same supplier).
- **Large imports** — When more than **40 lines** are loaded, the form shows a **summary** (count, estimated total, sample lines) instead of one editable row per line. Use **Record Purchase** to save; use **Clear import** to start over manually.
- **Loading overlay** — Shows progress while the file is matched to your catalog (“Matched X of Y rows…”).
- **After recording** — Catalog **cost** updates from unit cost; **selling price** follows your markup rules (same as manual purchase entry).

### Test data (if you used bulk import CSVs)

- Files under `testdata/` (e.g. `product-import-1000.csv`, `purchase-import-1000.csv`) are for **testing only**. Purchase test costs vary slightly per row, so many products may appear in **price review** — use **Keep all current** on the Products page if you do not want to change shelf prices.

---

## For IT / deployment (before go-live)

### 1. Environment

Copy **`.env.example`** to **`.env`** and set at minimum:

| Variable | Production |
|----------|------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Long random string (**required** when `NODE_ENV=production`) |
| `NODE_ENV` | `production` |
| `CORS_ORIGIN` | Browser URL(s) if UI and API are on different hosts (comma-separated) |
| `SERVE_FRONTEND` | `1` if serving built UI from Express on one port |

Optional: `LOGIN_RATE_LIMIT_MAX`, `LOGIN_RATE_LIMIT_WINDOW_MS`, `JSON_BODY_LIMIT` — see `.env.example`.

### 2. Database

```bash
npx prisma migrate deploy
```

New migrations in this release include:

- Average cost & price review fields on products
- Sale payment method (cash / online banking)
- Case-insensitive **unique brand code** index (migration fails if duplicate brand codes exist — resolve duplicates first)
- **Report date indexes** on `Sale.createdAt` and `Purchase.createdAt`

Seed is optional (`npm run seed`) — **do not run seed on a production database** with live data.

### 3. Backup (mandatory before go-live)

```bash
npm run db:backup
```

See **`scripts/BACKUP.md`**. Schedule regular backups (daily recommended).

Restore (destructive — use only when needed):

```bash
npm run db:restore -- backups/your-backup.sql
```

### 4. Build and start

```bash
npm run build:release
npm run start:prod
```

Or use **`scripts/start-production.bat`** on Windows. Default URL: **http://localhost:4000** when UI is served from the API.

Full install steps: **`packaging/README.md`**. Railway: **`packaging/RAILWAY.md`**.

### 5. Security changes in this release

- **Login rate limiting** — Max 10 failed login attempts per IP per 15 minutes (configurable). Reduces brute-force risk.
- **CORS** — In production, only origins listed in `CORS_ORIGIN` (plus same-origin requests) can call the API from a browser.
- **Stock locking** — Concurrent sales can no longer oversell the same product; one sale succeeds, others get “Insufficient stock”.
- **Larger API payloads** — JSON body limit raised to **15 MB** for bulk product/purchase imports (was 100 KB default).

### 6. Performance / reliability (bulk operations)

- **Products catalog pagination** — The Products page loads **50 rows at a time** from the server (search is server-side). POS and purchase flows still use the full catalog API for dropdowns.
- **Report query indexes** — Migrations add indexes on sale/purchase dates for faster reporting on large databases.
- **Sale/purchase numbers** — Number allocation uses indexed lookups; purchase creation retries on rare duplicate-number collisions.
- **HTTP request logging** — Each API request is logged with method, path, status, and duration (stdout in production).
- **Batch product create** — Chunked transactions (100 per chunk) with rollback on failure; avoids timeout on ~1,000 row imports.
- **Record purchase** — Bulk line inserts and single stock/pricing update per product; supports large purchase imports without transaction timeout.
- **Purchase import UI** — Catalog matching runs in chunks so the browser tab stays responsive.

### 7. Developer quality (this release)

- **Frontend unit tests** — Vitest covers POS cart totals, split-payment validation, CSV import header mapping, and line-discount allocation (`npm run test:frontend`).
- **CI-style test script** — `npm run test:ci` runs regression + frontend tests + write-path sale tests (`REGRESSION_WRITES=1`).
- **App structure** — Outstanding, Inventory, and Stock Adjustment views moved out of `App.tsx`; shared money/split-payment helpers live under `frontend/src/lib/`.
- **Feature flags** — Reporting nav respects `FEATURE_FLAGS.reporting` (enabled by default).

---

## Suggested go-live checklist

- [ ] `.env` configured (`JWT_SECRET`, `DATABASE_URL`, `CORS_ORIGIN` if needed)
- [ ] `npx prisma migrate deploy` on production database
- [ ] `npm run db:backup` before cutover
- [ ] `npm run build:release` and smoke test on staging
- [ ] Admin login works; change default passwords if seed was used
- [ ] POS: test one cash sale and one online/split payment
- [ ] Admin: test small product CSV import (optional)
- [ ] Brief staff on payment method and split payment at POS
- [ ] Brief admin on price review banner and bulk **Apply all** / **Keep all**

---

## Support / troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| **413** on bulk save | API not restarted after update; ensure `JSON_BODY_LIMIT=15mb` |
| **Transaction timeout** on bulk save | Old API build; redeploy latest code |
| **Page unresponsive** on purchase import | Old frontend; refresh; large imports use summary view (>40 lines) |
| **429** on login | Too many failed attempts; wait 15 minutes or adjust `LOGIN_RATE_LIMIT_*` |
| **CORS error** in browser | Set `CORS_ORIGIN` to your shop’s frontend URL |
| **456+ price reviews** after test purchase import | Expected with test CSV; use **Keep all current** |
| Migration fails on brand code | Duplicate brand codes in DB; fix duplicates then re-run migrate |

---

*Last updated for release preparation — adjust dates and version labels when tagging a formal release.*
