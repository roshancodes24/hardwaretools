-- CreateEnum
CREATE TYPE "SalePaymentMethod" AS ENUM ('CASH', 'ONLINE_BANKING');

-- AlterTable
ALTER TABLE "SalePayment" ADD COLUMN "method" "SalePaymentMethod" NOT NULL DEFAULT 'CASH';
