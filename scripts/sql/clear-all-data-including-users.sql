-- Full data wipe matching prisma/seed.ts cleanup (then you must run `npm run seed` to get users + demo data).
-- Deletes ALL users. Also removes "Customer" rows (seed does not recreate customers by default).
-- Do NOT truncate "_prisma_migrations".

BEGIN;

DELETE FROM "PromotionProduct";
DELETE FROM "Promotion";
DELETE FROM "StockMovement";
DELETE FROM "StockAdjustment";
DELETE FROM "SaleLine";
DELETE FROM "PurchaseLine";
DELETE FROM "SalePayment";
DELETE FROM "Sale";
DELETE FROM "PurchasePayment";
DELETE FROM "Purchase";
DELETE FROM "Customer";
DELETE FROM "Barcode";
DELETE FROM "ProductUnit";
DELETE FROM "Product";
DELETE FROM "Supplier";
DELETE FROM "User";

COMMIT;
