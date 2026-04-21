/**
 * Removes all products, suppliers, customers, and product-dependent rows
 * (sales, purchases, stock, promotions) while keeping users.
 * Use after seed if you want an empty catalog for testing.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  await prisma.$transaction(async (tx) => {
    await tx.promotionProduct.deleteMany();
    await tx.promotion.deleteMany();
    await tx.stockMovement.deleteMany();
    await tx.stockAdjustment.deleteMany();
    await tx.saleLine.deleteMany();
    await tx.purchaseLine.deleteMany();
    await tx.sale.deleteMany();
    await tx.customer.deleteMany();
    await tx.purchase.deleteMany();
    await tx.barcode.deleteMany();
    await tx.productUnit.deleteMany();
    await tx.product.deleteMany();
    await tx.supplier.deleteMany();
  });
  console.log(
    "Catalog cleared: no products, suppliers, or customers. Users are unchanged.",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
