# Data Dictionary

**Product:** Hardware Inventory System  
**Source of truth:** [`prisma/schema.prisma`](../prisma/schema.prisma)  
**Version:** 1.0  
**Date:** 2026-07-24  
**Related docs:** [ER_DIAGRAMS.md](./ER_DIAGRAMS.md) (visual ER), [FSD.md](./FSD.md) §8, [FRD.md](./FRD.md)

This document describes every persisted entity, field, enum, and foreign key in the PostgreSQL schema. **ER diagrams** live in a separate file: [ER_DIAGRAMS.md](./ER_DIAGRAMS.md).

---

## 1. Conventions

| Convention | Meaning |
|------------|---------|
| **PK** | Primary key |
| **FK** | Foreign key |
| **UQ** | Unique constraint (column or composite) — shown as `UK` in Mermaid ER attribute blocks |
| **?** | Nullable |
| `Decimal(p,s)` | Prisma `@db.Decimal(p, s)` |
| `cuid()` | Client-generated CUID string id |
| Money | Amounts typically `Decimal(14,2)`; unit costs/prices often `Decimal(14,4)`; stock qty `Decimal(18,4)` |
| Timestamps | `createdAt` default `now()`; `updatedAt` auto on update where present |

Cascade notes are called out per FK (e.g. deleting a product cascades barcodes/units; deleting a sale cascades lines/payments).

---

## 2. Entity overview

| Entity | Purpose |
|--------|---------|
| **User** | Staff account (login, role, audit actor) |
| **Supplier** | Vendor master for purchases |
| **Customer** | Buyer master (optional link on sales) |
| **Product** | Catalog item + on-hand stock + pricing/GST |
| **ProductUnit** | Sell/buy unit with conversion to base |
| **Barcode** | Scan code on product or unit |
| **Promotion** / **PromotionProduct** | Optional %-off rules (UI may be flagged off) |
| **Purchase** / **PurchaseLine** / **PurchasePayment** | Stock-in + supplier payables |
| **Sale** / **SaleLine** / **SalePayment** | Stock-out + customer receivables |
| **Quotation** / **QuotationLine** / **QuotationCounter** | Customer quotation; does not move stock |
| **StockMovement** | Quantity ledger (typed in/out) |
| **StockAdjustment** | Explicit correction audit |
| **ReportScheduleConfig** | Singleton owner-report schedule |
| **ReportRun** | Saved scheduled report instance |

See also: [ER_DIAGRAMS.md](./ER_DIAGRAMS.md) for relationship and domain diagrams.

---

## 3. Enumerations

### UserRole

| Value | Meaning |
|-------|---------|
| `ADMIN` | Full back-office access |
| `MANAGER` | Treated as admin (legacy compat) |
| `CASHIER` | Counter / read-limited access |

### ProductStatus

| Value | Meaning |
|-------|---------|
| `ACTIVE` | Sellable / listed |
| `INACTIVE` | Soft-disabled |

### UnitKind

| Value | Meaning |
|-------|---------|
| `PIECE` | Discrete count |
| `WEIGHT` | Mass |
| `LENGTH` | Length |
| `VOLUME` | Volume |
| `PACK` | Pack/case style |
| `OTHER` | Unclassified |

### BarcodeType

| Value | Meaning |
|-------|---------|
| `PRODUCT` | Product-level code |
| `PACK` | Pack barcode |
| `INTERNAL` | Internal shop code |
| `SUPPLIER` | Supplier barcode |

### PurchaseStatus

| Value | Meaning |
|-------|---------|
| `DRAFT` | Not finalized |
| `RECEIVED` | Stock received / posted |
| `CANCELLED` | Cancelled |

### SaleStatus

| Value | Meaning |
|-------|---------|
| `DRAFT` | Open / incomplete |
| `COMPLETED` | Posted sale |
| `CANCELLED` | Cancelled |
| `RETURNED` | Return state |

### QuotationStatus

Stored on `Quotation`. **Expired is not a stored value.** An `ISSUED` quotation is treated as expired when the current Asia/Kolkata date is after `validUntil` (the valid-until day itself is still valid).

| Value | Meaning |
|-------|---------|
| `DRAFT` | Editable. Not a final quotation |
| `ISSUED` | Final. Pricing is frozen. Printable |
| `CANCELLED` | Cancelled by an admin. Kept for history |

### SalePaymentMethod

| Value | Meaning |
|-------|---------|
| `CASH` | Cash tender |
| `ONLINE_BANKING` | Online / UPI / bank transfer style |

### PromotionScope

| Value | Meaning |
|-------|---------|
| `CART` | Whole cart |
| `PRODUCT` | Specific products (via link table) |
| `CATEGORY` | Category string match |

### StockMovementType

| Value | Direction (typical) |
|-------|---------------------|
| `OPENING` | Opening balance in |
| `PURCHASE_IN` | Purchase receipt |
| `SALE_OUT` | Sale deduction |
| `SALE_RETURN_IN` | Sale return |
| `PURCHASE_RETURN_OUT` | Purchase return |
| `ADJUSTMENT_IN` / `ADJUSTMENT_OUT` | Manual adjust |
| `DAMAGE_OUT` / `WASTAGE_OUT` | Loss |
| `RECOUNT_IN` / `RECOUNT_OUT` | Recount |

### ScheduledReportType

| Value | Meaning |
|-------|---------|
| `SALES` | Sales + margin period report |
| `INVENTORY` | Stock snapshot |
| `SUPPLIER_OUTSTANDING` | Unpaid purchases |
| `CUSTOMER_OUTSTANDING` | Unpaid sales |

### ReportPeriod

| Value | Meaning |
|-------|---------|
| `DAILY` | Previous calendar day (IST rules in services) |
| `MONTHLY` | Previous month |
| `QUARTERLY` | Previous Indian FY quarter |
| `YEARLY` | Previous year window |

### ReportRunStatus

| Value | Meaning |
|-------|---------|
| `PENDING` | Queued |
| `RUNNING` | In progress |
| `COMPLETED` | Success (payload stored) |
| `FAILED` | Error (`errorMessage`) |

---

## 4. Table / field dictionary

### 4.1 User

Staff identity for login and audit.

| Field | Type | Null | Default | Keys | Description |
|-------|------|------|---------|------|-------------|
| id | String | N | cuid() | PK | User id |
| fullName | String | N | | | Display name |
| username | String | N | | UK | Login name |
| email | String | Y | | UK | Optional email |
| phone | String | Y | | UK | Optional phone |
| passwordHash | String | N | | | bcrypt hash (never plaintext) |
| role | UserRole | N | CASHIER | | Access role |
| isActive | Boolean | N | true | | Inactive users cannot auth |
| createdAt | DateTime | N | now() | | Created |
| updatedAt | DateTime | N | auto | | Updated |

**Indexes:** `(role, isActive)`

**Relations:** created purchases/sales; stock movements; stock adjustments; sale/purchase payments.

---

### 4.2 Supplier

| Field | Type | Null | Default | Keys | Description |
|-------|------|------|---------|------|-------------|
| id | String | N | cuid() | PK | Supplier id |
| name | String | N | | UK | Supplier name |
| contactPerson | String | Y | | | Contact name |
| phone | String | Y | | UK | Phone |
| email | String | Y | | | Email |
| address | String | Y | | | Address |
| gstNumber | String | Y | | | GSTIN |
| note | String | Y | | | Notes |
| createdAt | DateTime | N | now() | | Created |
| updatedAt | DateTime | N | auto | | Updated |

**Relations:** `purchases` → Purchase

---

### 4.3 Customer

| Field | Type | Null | Default | Keys | Description |
|-------|------|------|---------|------|-------------|
| id | String | N | cuid() | PK | Customer id |
| name | String | N | | | Name |
| phone | String | Y | | UK | Phone |
| email | String | Y | | | Email |
| address | String | Y | | | Address |
| partyGstNo | String | Y | | | Party GST for invoices |
| partyState | String | Y | | | State / place for tax invoice |
| createdAt | DateTime | N | now() | | Created |
| updatedAt | DateTime | N | auto | | Updated |

**Indexes:** `name`  
**Relations:** `sales` → Sale (`onDelete: SetNull` on sale.customerId)

---

### 4.4 Product

| Field | Type | Null | Default | Keys | Description |
|-------|------|------|---------|------|-------------|
| id | String | N | cuid() | PK | Product id |
| sku | String | N | | UK | Stock keeping unit |
| name | String | N | | | Product name |
| slug | String | Y | | UK | Optional URL-ish slug |
| description | String | Y | | | Description |
| category | String | Y | | | Category label |
| brand | String | Y | | | Brand name |
| brandCode | String | Y | | UK* | Business code; *case-insensitive unique when non-blank (DB index) |
| color | String | Y | | | Color |
| size | String | Y | | | Size/dimension label |
| hsnCode | String | Y | | | HSN for GST |
| status | ProductStatus | N | ACTIVE | | Active/inactive |
| baseUnitCode | String | N | | | Code of base unit |
| unitKind | UnitKind | N | | | Kind of measure |
| allowsFractional | Boolean | N | false | | Fractional base qty allowed |
| costPrice | Decimal(14,4) | Y | | | Latest / reference cost |
| avgCostPrice | Decimal(14,4) | Y | | | Moving weighted average cost |
| percentage | Decimal(8,4) | Y | | | Markup % |
| mrp | Decimal(14,4) | Y | | | MRP |
| sellingPrice | Decimal(14,4) | Y | | | Shelf selling price |
| cgstPercent | Decimal(5,2) | Y | | | CGST % |
| sgstPercent | Decimal(5,2) | Y | | | SGST % |
| igstPercent | Decimal(5,2) | Y | | | IGST % |
| priceReviewNeeded | Boolean | N | false | | Cheaper purchase → review flag |
| suggestedSellingPrice | Decimal(14,4) | Y | | | Suggested markdown |
| priceReviewNote | String | Y | | | Review reason text |
| reorderLevel | Decimal(14,4) | Y | | | Low-stock threshold (base units) |
| currentStock | Decimal(18,4) | N | 0 | | On-hand in **base units** |
| createdAt | DateTime | N | now() | | Created |
| updatedAt | DateTime | N | auto | | Updated |

**Indexes:** `name`, `category`, `brand`, `status`

---

### 4.5 ProductUnit

| Field | Type | Null | Default | Keys | Description |
|-------|------|------|---------|------|-------------|
| id | String | N | cuid() | PK | Unit id |
| productId | String | N | | FK → Product | Parent product (`onDelete: Cascade`) |
| code | String | N | | UK(productId,code) | Unit code |
| displayName | String | N | | | Display label |
| isBaseUnit | Boolean | N | false | | True for base unit row |
| conversionToBase | Decimal(18,4) | N | | | Multiply qty → base qty |
| allowsFractionalSale | Boolean | N | false | | Fractional sale in this unit |
| createdAt | DateTime | N | now() | | Created |
| updatedAt | DateTime | N | auto | | Updated |

**Indexes:** `(productId, isBaseUnit)`

---

### 4.6 Barcode

| Field | Type | Null | Default | Keys | Description |
|-------|------|------|---------|------|-------------|
| id | String | N | cuid() | PK | Barcode row id |
| code | String | N | | UK | Scanned value |
| type | BarcodeType | N | PRODUCT | | Barcode kind |
| productId | String | N | | FK → Product | Product (`Cascade`) |
| productUnitId | String | Y | | FK → ProductUnit | Optional unit (`SetNull`) |
| note | String | Y | | | Note |
| createdAt | DateTime | N | now() | | Created |
| updatedAt | DateTime | N | auto | | Updated |

---

### 4.7 Promotion

| Field | Type | Null | Default | Keys | Description |
|-------|------|------|---------|------|-------------|
| id | String | N | cuid() | PK | Promotion id |
| name | String | N | | | Name |
| code | String | Y | | UK | Optional promo code |
| scope | PromotionScope | N | | | CART / PRODUCT / CATEGORY |
| category | String | Y | | | Category when scope=CATEGORY |
| percentage | Decimal(5,2) | N | | | Discount % |
| isActive | Boolean | N | true | | Active flag |
| startsAt | DateTime | Y | | | Window start |
| endsAt | DateTime | Y | | | Window end |
| note | String | Y | | | Note |
| createdAt | DateTime | N | now() | | Created |
| updatedAt | DateTime | N | auto | | Updated |

**Indexes:** `(scope, isActive)`, `category`

---

### 4.8 PromotionProduct

| Field | Type | Null | Default | Keys | Description |
|-------|------|------|---------|------|-------------|
| id | String | N | cuid() | PK | Link id |
| promotionId | String | N | | FK → Promotion | (`Cascade`) |
| productId | String | N | | FK → Product | (`Cascade`) |
| createdAt | DateTime | N | now() | | Created |

**Unique:** `(promotionId, productId)`

---

### 4.9 Purchase

| Field | Type | Null | Default | Keys | Description |
|-------|------|------|---------|------|-------------|
| id | String | N | cuid() | PK | Purchase id |
| purchaseNumber | String | N | | UK | Human-readable number |
| supplierId | String | N | | FK → Supplier | Supplier |
| status | PurchaseStatus | N | DRAFT | | Lifecycle |
| invoiceNumber | String | Y | | | Supplier invoice # |
| invoiceDate | DateTime | Y | | | Supplier invoice date |
| note | String | Y | | | Note |
| subtotal | Decimal(14,2) | N | 0 | | Lines subtotal |
| discountAmount | Decimal(14,2) | N | 0 | | Header discount |
| taxAmount | Decimal(14,2) | N | 0 | | Tax |
| totalAmount | Decimal(14,2) | N | 0 | | Total |
| paidAmount | Decimal(14,2) | N | 0 | | Sum of payments |
| balanceAmount | Decimal(14,2) | N | 0 | | Amount still owed |
| createdById | String | N | | FK → User | Creator |
| createdAt | DateTime | N | now() | | Created |
| updatedAt | DateTime | N | auto | | Updated |

**Indexes:** `(supplierId, status)`, `invoiceDate`  
**Relations:** lines, payments, stockMovements

---

### 4.10 PurchaseLine

| Field | Type | Null | Default | Keys | Description |
|-------|------|------|---------|------|-------------|
| id | String | N | cuid() | PK | Line id |
| purchaseId | String | N | | FK → Purchase | Parent (`Cascade`) |
| productId | String | N | | FK → Product | Product |
| productUnitId | String | N | | FK → ProductUnit | Unit purchased |
| quantity | Decimal(18,4) | N | | | Qty in selected unit |
| quantityInBase | Decimal(18,4) | N | | | Qty in base units |
| unitCost | Decimal(14,4) | N | | | Cost per selected unit |
| lineDiscount | Decimal(14,2) | N | 0 | | Line discount |
| lineTax | Decimal(14,2) | N | 0 | | Line tax |
| lineTotal | Decimal(14,2) | N | | | Line total |
| createdAt | DateTime | N | now() | | Created |
| updatedAt | DateTime | N | auto | | Updated |

---

### 4.11 PurchasePayment

| Field | Type | Null | Default | Keys | Description |
|-------|------|------|---------|------|-------------|
| id | String | N | cuid() | PK | Payment id |
| purchaseId | String | N | | FK → Purchase | Parent (`Cascade`) |
| amount | Decimal(14,2) | N | | | Amount paid |
| paidAt | DateTime | N | now() | | Payment date (may be backdated) |
| note | String | Y | | | Note |
| createdById | String | N | | FK → User | Who recorded |
| createdAt | DateTime | N | now() | | Row created |

**Indexes:** `(purchaseId, paidAt)`, `createdById`

---

### 4.12 Sale

| Field | Type | Null | Default | Keys | Description |
|-------|------|------|---------|------|-------------|
| id | String | N | cuid() | PK | Sale id |
| saleNumber | String | N | | UK | Bill/tax series number |
| status | SaleStatus | N | DRAFT | | Lifecycle |
| customerName | String | Y | | | Walk-in / entered name |
| customerPhone | String | Y | | | Entered phone |
| customerId | String | Y | | FK → Customer | Linked customer (`SetNull`) |
| customerNameSnapshot | String | Y | | | Name snapshot at sale |
| customerPartyGstNo | String | Y | | | GST snapshot for invoice |
| customerPartyState | String | Y | | | State snapshot for invoice |
| note | String | Y | | | Note |
| subtotal | Decimal(14,2) | N | 0 | | Lines subtotal |
| discountAmount | Decimal(14,2) | N | 0 | | Header discount |
| taxAmount | Decimal(14,2) | N | 0 | | Tax |
| transportAmount | Decimal(14,2) | N | 0 | | Freight (not per line) |
| totalAmount | Decimal(14,2) | N | 0 | | Charged total |
| paidAmount | Decimal(14,2) | N | 0 | | Sum of payments |
| balanceAmount | Decimal(14,2) | N | 0 | | Outstanding balance |
| createdById | String | N | | FK → User | Creator |
| createdAt | DateTime | N | now() | | Created |
| updatedAt | DateTime | N | auto | | Updated |

**Indexes:** `(status, createdAt)`, `customerPhone`, `customerId`

---

### 4.13 SaleLine

| Field | Type | Null | Default | Keys | Description |
|-------|------|------|---------|------|-------------|
| id | String | N | cuid() | PK | Line id |
| saleId | String | N | | FK → Sale | Parent (`Cascade`) |
| productId | String | N | | FK → Product | Product |
| productUnitId | String | N | | FK → ProductUnit | Unit sold |
| quantity | Decimal(18,4) | N | | | Qty in selected unit |
| quantityInBase | Decimal(18,4) | N | | | Qty in base units |
| unitPrice | Decimal(14,4) | N | | | Price per selected unit |
| lineDiscount | Decimal(14,2) | N | 0 | | Line discount |
| lineTax | Decimal(14,2) | N | 0 | | Line tax |
| lineTotal | Decimal(14,2) | N | | | Line total |
| createdAt | DateTime | N | now() | | Created |
| updatedAt | DateTime | N | auto | | Updated |

---

### 4.14 SalePayment

| Field | Type | Null | Default | Keys | Description |
|-------|------|------|---------|------|-------------|
| id | String | N | cuid() | PK | Payment id |
| saleId | String | N | | FK → Sale | Parent (`Cascade`) |
| amount | Decimal(14,2) | N | | | Amount |
| method | SalePaymentMethod | N | CASH | | Cash or online banking |
| note | String | Y | | | Note |
| createdById | String | N | | FK → User | Who recorded |
| createdAt | DateTime | N | now() | | Created |

**Indexes:** `(saleId, createdAt)`

---

### 4.14a QuotationCounter

One row per calendar year. The create transaction locks this row so `QUO-YYYY-####` cannot collide.

| Field | Type | Null | Default | Keys | Description |
|-------|------|------|---------|------|-------------|
| year | Int | N | | PK | Asia/Kolkata year |
| lastNumber | Int | N | 0 | | Last allocated sequence |

### 4.14b Quotation

Does not post stock itself. `convertedSaleId` is set when the quotation is converted: the sale is created through `/api/sales` with `quotationId`, and the sale and this link are saved in one transaction. A quotation with `convertedSaleId` is shown as `CONVERTED` and cannot be converted or cancelled again.

| Field | Type | Null | Default | Keys | Description |
|-------|------|------|---------|------|-------------|
| id | String | N | cuid() | PK | Quotation id |
| quotationNumber | String | N | | UK | `QUO-YYYY-####` |
| customerId | String | Y | | FK → Customer | Optional link (`SetNull`) |
| status | QuotationStatus | N | DRAFT | | Stored status. Expired is derived |
| quotationDate | Date | N | | | India calendar date |
| validUntil | Date | N | | | Quotation date + 2 days |
| customerName | String | N | | | Snapshot |
| customerContactPerson | String | Y | | | Snapshot only |
| customerPhone | String | Y | | | Snapshot |
| customerEmail | String | Y | | | Snapshot |
| customerAddress | String | Y | | | Snapshot |
| customerPartyGstNo | String | Y | | | Snapshot |
| customerPartyState | String | Y | | | Snapshot |
| includeGst | Boolean | N | true | | When true, charge product CGST/SGST/IGST. When false, tax amounts stay 0. Existing rows default to true. |
| discountPercent | Decimal(5,2) | N | 0 | | Order discount % last applied |
| subtotal | Decimal(14,2) | N | 0 | | Sum of qty × price |
| discountAmount | Decimal(14,2) | N | 0 | | Sum of line discounts |
| taxableAmount | Decimal(14,2) | N | 0 | | Subtotal − discount |
| cgstAmount | Decimal(14,2) | N | 0 | | Charged CGST. 0 when `includeGst` is false |
| sgstAmount | Decimal(14,2) | N | 0 | | Charged SGST. 0 when `includeGst` is false |
| igstAmount | Decimal(14,2) | N | 0 | | Charged IGST. 0 when `includeGst` is false |
| taxAmount | Decimal(14,2) | N | 0 | | Line tax sum. 0 when `includeGst` is false |
| transportAmount | Decimal(14,2) | N | 0 | | Freight after tax |
| totalAmount | Decimal(14,2) | N | 0 | | Grand total |
| note | String | Y | | | Note |
| createdById | String | N | | FK → User | Creator |
| convertedSaleId | String | Y | | UK, FK → Sale | Sale created by Convert to sale (null until converted; unique so a quotation converts once) |
| createdAt | DateTime | N | now() | | Created |
| updatedAt | DateTime | N | auto | | Updated |

**Indexes:** unique `quotationNumber`, unique `convertedSaleId`, `customerId`, `status`, `quotationDate`, `validUntil`, `createdById`

### 4.14c QuotationLine

`productId` is the catalog product. Name, SKU, HSN, unit, and GST percents are snapshots.

| Field | Type | Null | Default | Keys | Description |
|-------|------|------|---------|------|-------------|
| id | String | N | cuid() | PK | Line id |
| quotationId | String | N | | FK → Quotation | Parent (`Cascade`) |
| productId | String | N | | FK → Product | Catalog product |
| productUnitId | String | Y | | FK → ProductUnit | Unit (`SetNull`) |
| quantity | Decimal(18,4) | N | | | Qty in selected unit |
| quantityInBase | Decimal(18,4) | N | | | Qty × conversion |
| unitPrice | Decimal(14,4) | N | | | Selling price × conversion |
| lineDiscount | Decimal(14,2) | N | 0 | | Discount |
| lineTax | Decimal(14,2) | N | 0 | | GST amount. 0 when the quotation excludes GST |
| lineTotal | Decimal(14,2) | N | | | Taxable + tax |
| productName | String | N | | | Snapshot |
| sku | String | N | | | Snapshot |
| description | String | Y | | | Snapshot |
| hsnCode | String | Y | | | Snapshot |
| unitCode | String | N | | | Snapshot |
| unitDisplayName | String | N | | | Snapshot |
| cgstPercent | Decimal(5,2) | N | 0 | | Rate snapshot, stored even when `includeGst` is false |
| sgstPercent | Decimal(5,2) | N | 0 | | Rate snapshot, stored even when `includeGst` is false |
| igstPercent | Decimal(5,2) | N | 0 | | Rate snapshot, stored even when `includeGst` is false |
| createdAt | DateTime | N | now() | | Created |
| updatedAt | DateTime | N | auto | | Updated |

**Indexes:** `quotationId`, `productId`, `productUnitId`

---

### 4.15 StockMovement

Ledger of quantity changes (base and unit qty).

| Field | Type | Null | Default | Keys | Description |
|-------|------|------|---------|------|-------------|
| id | String | N | cuid() | PK | Movement id |
| type | StockMovementType | N | | | Movement kind |
| productId | String | N | | FK → Product | Product |
| productUnitId | String | Y | | FK → ProductUnit | Unit context |
| quantity | Decimal(18,4) | N | | | Qty in unit (if any) |
| quantityInBase | Decimal(18,4) | N | | | Qty in base units |
| note | String | Y | | | Note |
| purchaseId | String | Y | | FK → Purchase | Link when from purchase |
| saleId | String | Y | | FK → Sale | Link when from sale |
| createdById | String | N | | FK → User | Actor |
| createdAt | DateTime | N | now() | | Created |

**Indexes:** `(productId, createdAt)`, `(type, createdAt)`, `purchaseId`, `saleId`

---

### 4.16 StockAdjustment

| Field | Type | Null | Default | Keys | Description |
|-------|------|------|---------|------|-------------|
| id | String | N | cuid() | PK | Adjustment id |
| productId | String | N | | FK → Product | Product |
| quantityBefore | Decimal(18,4) | N | | | Stock before (base) |
| quantityAfter | Decimal(18,4) | N | | | Stock after (base) |
| difference | Decimal(18,4) | N | | | After − before |
| reason | String | N | | | Required reason |
| note | String | Y | | | Optional note |
| adjustedById | String | N | | FK → User | Who adjusted |
| createdAt | DateTime | N | now() | | Created |

**Indexes:** `(productId, createdAt)`, `(adjustedById, createdAt)`

---

### 4.17 ReportScheduleConfig

Singleton schedule (`id` defaults to `"default"`).

| Field | Type | Null | Default | Keys | Description |
|-------|------|------|---------|------|-------------|
| id | String | N | `"default"` | PK | Singleton key |
| notifyEmail | String | N | `""` | | Owner notify email |
| salesEnabled | Boolean | N | false | | Enable sales schedule |
| salesPeriod | ReportPeriod | Y | | | Sales cadence |
| inventoryEnabled | Boolean | N | false | | Enable inventory |
| inventoryPeriod | ReportPeriod | Y | | | Inventory cadence |
| supplierOutstandingEnabled | Boolean | N | false | | Enable supplier OS |
| supplierOutstandingPeriod | ReportPeriod | Y | | | Supplier OS cadence |
| customerOutstandingEnabled | Boolean | N | false | | Enable customer OS |
| customerOutstandingPeriod | ReportPeriod | Y | | | Customer OS cadence |
| updatedAt | DateTime | N | auto | | Last config change |

---

### 4.18 ReportRun

| Field | Type | Null | Default | Keys | Description |
|-------|------|------|---------|------|-------------|
| id | String | N | cuid() | PK | Run id (used in `?reportRun=` links) |
| reportType | ScheduledReportType | N | | | Which report |
| period | ReportPeriod | N | | | Cadence used |
| periodStart | DateTime | N | | UK* | Period start (*with type+period) |
| periodEnd | DateTime | N | | | Period end |
| asOf | DateTime | N | | | Generation timestamp |
| status | ReportRunStatus | N | | | Run status |
| payload | Json | Y | | | Stored report body |
| errorMessage | String | Y | | | Failure detail |
| emailSentAt | DateTime | Y | | | When email sent |
| createdAt | DateTime | N | now() | | Created |

**Unique:** `(reportType, period, periodStart)`  
**Indexes:** `createdAt`, `(reportType, status)`

---

## 5. Relationship summary (FK map)

| From | Field | To | On delete (Prisma) |
|------|-------|----|--------------------|
| ProductUnit | productId | Product | Cascade |
| Barcode | productId | Product | Cascade |
| Barcode | productUnitId | ProductUnit | SetNull |
| PromotionProduct | promotionId | Promotion | Cascade |
| PromotionProduct | productId | Product | Cascade |
| Purchase | supplierId | Supplier | Restrict (default) |
| Purchase | createdById | User | Restrict |
| PurchaseLine | purchaseId | Purchase | Cascade |
| PurchaseLine | productId | Product | Restrict |
| PurchaseLine | productUnitId | ProductUnit | Restrict |
| PurchasePayment | purchaseId | Purchase | Cascade |
| PurchasePayment | createdById | User | Restrict |
| Sale | customerId | Customer | SetNull |
| Sale | createdById | User | Restrict |
| SaleLine | saleId | Sale | Cascade |
| SaleLine | productId | Product | Restrict |
| SaleLine | productUnitId | ProductUnit | Restrict |
| SalePayment | saleId | Sale | Cascade |
| SalePayment | createdById | User | Restrict |
| Quotation | customerId | Customer | SetNull |
| Quotation | createdById | User | Restrict |
| Quotation | convertedSaleId | Sale | SetNull |
| QuotationLine | quotationId | Quotation | Cascade |
| QuotationLine | productId | Product | Restrict |
| QuotationLine | productUnitId | ProductUnit | SetNull |
| StockMovement | productId | Product | Restrict |
| StockMovement | productUnitId | ProductUnit | Restrict |
| StockMovement | purchaseId | Purchase | Restrict |
| StockMovement | saleId | Sale | Restrict |
| StockMovement | createdById | User | Restrict |
| StockAdjustment | productId | Product | Restrict |
| StockAdjustment | adjustedById | User | Restrict |

---

## 6. Maintenance

- Schema changes land in `prisma/schema.prisma` + migrations first.
- Update **this file** (fields, enums, FK map) and [ER_DIAGRAMS.md](./ER_DIAGRAMS.md) (visual relationships) in the same change set.
- Regenerate Word/PDF:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/export-doc.ps1 -DocName DATA_DICTIONARY -Title "Hardware Inventory - Data Dictionary"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/export-doc.ps1 -DocName ER_DIAGRAMS -Title "Hardware Inventory - ER Diagrams"
```

---

*End of Data Dictionary. Behavioral use of these entities is in `docs/FSD.md`. Diagrams: `docs/ER_DIAGRAMS.md`.*
