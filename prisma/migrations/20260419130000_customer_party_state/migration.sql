-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "partyState" TEXT;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN "customerPartyState" TEXT;
