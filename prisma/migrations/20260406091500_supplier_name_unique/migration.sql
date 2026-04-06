-- DropIndex
DROP INDEX "Supplier_name_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_name_key" ON "Supplier"("name");
