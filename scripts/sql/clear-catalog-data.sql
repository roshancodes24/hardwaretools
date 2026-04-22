-- Clear products, suppliers, customers, sales, purchases, stock, promotions.
-- NEVER deletes "User" — admin / cashier logins stay (same as: npm run db:clear-catalog).
-- Run in psql / Railway Postgres query tab against your app database (usually public schema).
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

COMMIT;
