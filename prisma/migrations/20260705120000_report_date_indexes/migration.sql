-- Speed up date-range reports on sales and purchases.

CREATE INDEX IF NOT EXISTS "Sale_createdAt_idx" ON "Sale"("createdAt");
CREATE INDEX IF NOT EXISTS "Purchase_createdAt_idx" ON "Purchase"("createdAt");
