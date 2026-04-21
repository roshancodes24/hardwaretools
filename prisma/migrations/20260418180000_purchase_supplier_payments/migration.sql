-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "Purchase" ADD COLUMN "balanceAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- Existing bills: nothing paid yet; full amount still owed to supplier
UPDATE "Purchase" SET "paidAmount" = 0, "balanceAmount" = "totalAmount";

-- CreateTable
CREATE TABLE "PurchasePayment" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchasePayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchasePayment_purchaseId_paidAt_idx" ON "PurchasePayment"("purchaseId", "paidAt");

-- CreateIndex
CREATE INDEX "PurchasePayment_createdById_idx" ON "PurchasePayment"("createdById");

-- AddForeignKey
ALTER TABLE "PurchasePayment" ADD CONSTRAINT "PurchasePayment_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchasePayment" ADD CONSTRAINT "PurchasePayment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
