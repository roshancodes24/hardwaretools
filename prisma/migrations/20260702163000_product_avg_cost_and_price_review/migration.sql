-- AlterTable
ALTER TABLE "Product" ADD COLUMN "avgCostPrice" DECIMAL(14,4);
ALTER TABLE "Product" ADD COLUMN "priceReviewNeeded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN "suggestedSellingPrice" DECIMAL(14,4);
ALTER TABLE "Product" ADD COLUMN "priceReviewNote" TEXT;

-- Seed average cost from the existing (last) cost price so margin reports have a basis.
UPDATE "Product" SET "avgCostPrice" = "costPrice" WHERE "costPrice" IS NOT NULL;
