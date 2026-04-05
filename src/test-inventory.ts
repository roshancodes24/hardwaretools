import "dotenv/config";
import { prisma } from "./lib/prisma";
import {
  createPurchase,
  createSale,
  adjustStock,
  getProductStock,
} from "./services/inventory";

async function main() {
  const admin = await prisma.user.findFirstOrThrow({
    where: { role: "ADMIN" },
  });

  const supplier = await prisma.supplier.findFirstOrThrow({
    where: { name: "ABC Hardware Suppliers" },
  });

  const nails = await prisma.product.findFirstOrThrow({
    where: { sku: "NAILS-001" },
    include: { units: true },
  });

  const hammer = await prisma.product.findFirstOrThrow({
    where: { sku: "HAMMER-001" },
    include: { units: true },
  });

  const nailsKgUnit = nails.units.find((u) => u.code === "kg");
  const hammerPcUnit = hammer.units.find((u) => u.code === "pc");

  if (!nailsKgUnit || !hammerPcUnit) {
    throw new Error("Required product units not found.");
  }

  console.log("Before sale:");
  console.log(
    await getProductStock(nails.id).then((p) => ({
      product: p.name,
      currentStock: p.currentStock.toString(),
    }))
  );

  const sale = await createSale({
    createdById: admin.id,
    customerName: "Test Customer",
    customerPhone: "9111111111",
    note: "Service test sale",
    paidAmount: "330.00",
    lines: [
      {
        productId: nails.id,
        productUnitId: nailsKgUnit.id,
        quantity: "0.2000",
        unitPrice: "150.0000",
      },
      {
        productId: hammer.id,
        productUnitId: hammerPcUnit.id,
        quantity: "1.0000",
        unitPrice: "300.0000",
      },
    ],
  });

  console.log("Sale created:", sale?.saleNumber);

  const adjusted = await adjustStock({
    productId: nails.id,
    adjustedById: admin.id,
    quantityAfter: "24100.0000",
    reason: "Manual stock recount",
    note: "Testing stock adjustment flow (100g below post-sale level)",
  });

  console.log("Adjusted product stock:", adjusted.currentStock.toString());

  const stock = await getProductStock(nails.id);

  console.log("After operations:");
  console.log({
    product: stock.name,
    currentStock: stock.currentStock.toString(),
    recentMovements: stock.stockMovements.map((m) => ({
      type: m.type,
      qtyBase: m.quantityInBase.toString(),
      createdAt: m.createdAt,
    })),
  });

  const purchase = await createPurchase({
    supplierId: supplier.id,
    createdById: admin.id,
    invoiceNumber: "TEST-PUR-001",
    invoiceDate: new Date(),
    note: "Service test purchase",
    lines: [
      {
        productId: nails.id,
        productUnitId: nailsKgUnit.id,
        quantity: "1.0000",
        unitCost: "100.0000",
      },
    ],
  });

  console.log("Purchase created:", purchase?.purchaseNumber);

  const finalStock = await getProductStock(nails.id);

  console.log("Final stock:");
  console.log({
    product: finalStock.name,
    currentStock: finalStock.currentStock.toString(),
  });
}

main()
  .catch((error) => {
    console.error("Test failed:");
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
