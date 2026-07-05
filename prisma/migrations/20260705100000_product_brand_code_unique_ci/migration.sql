-- Case-insensitive unique brand codes (non-null, non-blank only).
-- Resolve duplicates before applying:
--   SELECT LOWER(TRIM("brandCode")) AS bc, COUNT(*) FROM "Product"
--   WHERE "brandCode" IS NOT NULL AND TRIM("brandCode") <> ''
--   GROUP BY 1 HAVING COUNT(*) > 1;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Product"
    WHERE "brandCode" IS NOT NULL AND TRIM("brandCode") <> ''
    GROUP BY LOWER(TRIM("brandCode"))
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate brandCode values exist; resolve before migration';
  END IF;
END $$;

CREATE UNIQUE INDEX "Product_brandCode_lower_key"
ON "Product" (LOWER(TRIM("brandCode")))
WHERE "brandCode" IS NOT NULL AND TRIM("brandCode") <> '';
