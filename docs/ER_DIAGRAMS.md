# ER Diagrams

**Product:** Hardware Inventory System  
**Source of truth:** [`prisma/schema.prisma`](../prisma/schema.prisma)  
**Version:** 1.0  
**Date:** 2026-07-24  
**Related docs:** [DATA_DICTIONARY.md](./DATA_DICTIONARY.md) (fields & enums), [FSD.md](./FSD.md) §8

Visual entity-relationship views of the PostgreSQL schema. Field-level definitions live in the data dictionary — diagrams here show structure and key attributes only.

**Mermaid note:** Unique keys are labeled `UK` (Mermaid’s unique-key marker). Types in diagrams are simplified (`string`, `float`, `bool`, `date`) for renderer compatibility; see the data dictionary for exact Prisma/`Decimal` types.

---

## 1. High-level relationships

```mermaid
erDiagram
  User ||--o{ Purchase : creates
  User ||--o{ Sale : creates
  User ||--o{ StockAdjustment : adjusts
  User ||--o{ StockMovement : records
  User ||--o{ SalePayment : records
  User ||--o{ PurchasePayment : records
  Supplier ||--o{ Purchase : supplies
  Customer ||--o{ Sale : buys
  Product ||--o{ ProductUnit : has
  Product ||--o{ Barcode : has
  Product ||--o{ PurchaseLine : on
  Product ||--o{ SaleLine : on
  Product ||--o{ StockMovement : ledger
  Product ||--o{ StockAdjustment : corrected
  Product ||--o{ PromotionProduct : linked
  Promotion ||--o{ PromotionProduct : includes
  Purchase ||--o{ PurchaseLine : contains
  Purchase ||--o{ PurchasePayment : pays
  Purchase ||--o{ StockMovement : may_link
  Sale ||--o{ SaleLine : contains
  Sale ||--o{ SalePayment : pays
  Sale ||--o{ StockMovement : may_link
  User ||--o{ Quotation : creates
  Customer ||--o{ Quotation : optional
  Quotation ||--o| Sale : may_convert_later
  Quotation ||--o{ QuotationLine : contains
  Product ||--o{ QuotationLine : quoted
  ProductUnit ||--o{ QuotationLine : unit
  ProductUnit ||--o{ Barcode : optional
  ProductUnit ||--o{ PurchaseLine : used
  ProductUnit ||--o{ SaleLine : used
```

---

## 2. Catalog domain

```mermaid
erDiagram
  Product {
    string id PK
    string sku UK
    string name
    string brandCode
    string hsnCode
    string status
    string baseUnitCode
    string unitKind
    float costPrice
    float avgCostPrice
    float sellingPrice
    float currentStock
    bool priceReviewNeeded
  }
  ProductUnit {
    string id PK
    string productId FK
    string code
    bool isBaseUnit
    float conversionToBase
  }
  Barcode {
    string id PK
    string code UK
    string type
    string productId FK
    string productUnitId FK
  }
  Promotion {
    string id PK
    string name
    string scope
    float percentage
    bool isActive
  }
  PromotionProduct {
    string id PK
    string promotionId FK
    string productId FK
  }
  Product ||--o{ ProductUnit : has
  Product ||--o{ Barcode : has
  ProductUnit ||--o{ Barcode : optional
  Product ||--o{ PromotionProduct : linked
  Promotion ||--o{ PromotionProduct : includes
```

---

## 3. Purchasing domain

```mermaid
erDiagram
  Supplier {
    string id PK
    string name UK
    string gstNumber
  }
  User {
    string id PK
    string username UK
    string role
  }
  Purchase {
    string id PK
    string purchaseNumber UK
    string supplierId FK
    string status
    float totalAmount
    float paidAmount
    float balanceAmount
    string createdById FK
  }
  PurchaseLine {
    string id PK
    string purchaseId FK
    string productId FK
    string productUnitId FK
    float quantity
    float quantityInBase
    float unitCost
    float lineTotal
  }
  PurchasePayment {
    string id PK
    string purchaseId FK
    float amount
    date paidAt
    string createdById FK
  }
  Supplier ||--o{ Purchase : supplies
  User ||--o{ Purchase : creates
  Purchase ||--o{ PurchaseLine : contains
  Purchase ||--o{ PurchasePayment : pays
  User ||--o{ PurchasePayment : records
```

---

## 4. Sales domain

```mermaid
erDiagram
  Customer {
    string id PK
    string name
    string phone UK
    string partyGstNo
    string partyState
  }
  Sale {
    string id PK
    string saleNumber UK
    string status
    string customerId FK
    float transportAmount
    float totalAmount
    float paidAmount
    float balanceAmount
    string createdById FK
  }
  SaleLine {
    string id PK
    string saleId FK
    string productId FK
    string productUnitId FK
    float quantity
    float quantityInBase
    float unitPrice
    float lineTotal
  }
  SalePayment {
    string id PK
    string saleId FK
    float amount
    string method
    string createdById FK
  }
  Customer ||--o{ Sale : buys
  User ||--o{ Sale : creates
  Sale ||--o{ SaleLine : contains
  Sale ||--o{ SalePayment : pays
  User ||--o{ SalePayment : records
```

---

## 4a. Quotation domain

Quotations reference the existing product and an optional customer. They do not create stock movements. `convertedSaleId` points at the normal sale created when the quotation is converted (one sale per quotation).

```mermaid
erDiagram
  Quotation {
    string id PK
    string quotationNumber UK
    string customerId FK
    string status
    date quotationDate
    date validUntil
    string customerName
    float totalAmount
    string createdById FK
    string convertedSaleId FK
  }
  QuotationLine {
    string id PK
    string quotationId FK
    string productId FK
    string productUnitId FK
    float quantity
    float unitPrice
    string productName
    string sku
  }
  QuotationCounter {
    int year PK
    int lastNumber
  }
  User ||--o{ Quotation : creates
  Customer ||--o{ Quotation : optional
  Quotation ||--o{ QuotationLine : contains
  Product ||--o{ QuotationLine : quoted
  ProductUnit ||--o{ QuotationLine : unit
  Quotation ||--o| Sale : may_convert_later
```

---

## 5. Stock domain

```mermaid
erDiagram
  Product {
    string id PK
    float currentStock
    float reorderLevel
  }
  StockMovement {
    string id PK
    string type
    string productId FK
    string productUnitId FK
    float quantity
    float quantityInBase
    string purchaseId FK
    string saleId FK
    string createdById FK
  }
  StockAdjustment {
    string id PK
    string productId FK
    float quantityBefore
    float quantityAfter
    float difference
    string reason
    string adjustedById FK
  }
  Product ||--o{ StockMovement : ledger
  Product ||--o{ StockAdjustment : corrected
  Purchase ||--o{ StockMovement : may_link
  Sale ||--o{ StockMovement : may_link
  User ||--o{ StockMovement : records
  User ||--o{ StockAdjustment : adjusts
```

---

## 6. Scheduled reports domain

```mermaid
erDiagram
  ReportScheduleConfig {
    string id PK
    string notifyEmail
    bool salesEnabled
    string salesPeriod
    bool inventoryEnabled
    string inventoryPeriod
    bool supplierOutstandingEnabled
    string supplierOutstandingPeriod
    bool customerOutstandingEnabled
    string customerOutstandingPeriod
  }
  ReportRun {
    string id PK
    string reportType
    string period
    date periodStart
    date periodEnd
    date asOf
    string status
    string payload
    string errorMessage
    date emailSentAt
  }
```

`ReportScheduleConfig` is a singleton row with `id = "default"`. `ReportRun` rows are independent history (no FK between them); uniqueness is `(reportType, period, periodStart)`.

---

## Maintenance

- Update diagrams when relationships or key identifying fields change in `prisma/schema.prisma`.
- Keep field lists in sync via [DATA_DICTIONARY.md](./DATA_DICTIONARY.md).
- Regenerate Word/PDF:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/export-doc.ps1 -DocName ER_DIAGRAMS -Title "Hardware Inventory - ER Diagrams"
```

---

*End of ER Diagrams.*
