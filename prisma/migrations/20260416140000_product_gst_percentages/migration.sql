-- GST split fields replace single tax rate (existing rows: half rate each to CGST/SGST, IGST 0).
ALTER TABLE "Product" ADD COLUMN "cgstPercent" DECIMAL(5,2),
ADD COLUMN "sgstPercent" DECIMAL(5,2),
ADD COLUMN "igstPercent" DECIMAL(5,2);

UPDATE "Product"
SET
  "cgstPercent" = "taxRate" / 2,
  "sgstPercent" = "taxRate" / 2,
  "igstPercent" = 0
WHERE "taxRate" IS NOT NULL;

ALTER TABLE "Product" DROP COLUMN "taxRate";
