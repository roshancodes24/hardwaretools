import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  BarcodeType,
  PrismaClient,
  ProductStatus,
  PurchaseStatus,
  SaleStatus,
  StockMovementType,
  UnitKind,
  UserRole,
} from "@prisma/client";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.$transaction(async (tx) => {
    // Optional cleanup for repeatable local seeding
    await tx.stockMovement.deleteMany();
    await tx.stockAdjustment.deleteMany();
    await tx.saleLine.deleteMany();
    await tx.purchaseLine.deleteMany();
    await tx.sale.deleteMany();
    await tx.purchase.deleteMany();
    await tx.barcode.deleteMany();
    await tx.productUnit.deleteMany();
    await tx.product.deleteMany();
    await tx.supplier.deleteMany();
    await tx.user.deleteMany();

    // 1) Users
    const admin = await tx.user.create({
      data: {
        fullName: "Admin User",
        email: "admin@shop.local",
        phone: "9999999999",
        passwordHash: "change-this-later",
        role: UserRole.ADMIN,
        isActive: true,
      },
    });

    const cashier = await tx.user.create({
      data: {
        fullName: "Cashier User",
        email: "cashier@shop.local",
        phone: "8888888888",
        passwordHash: "change-this-later",
        role: UserRole.CASHIER,
        isActive: true,
      },
    });

    // 2) Supplier
    const supplier = await tx.supplier.create({
      data: {
        name: "ABC Hardware Suppliers",
        contactPerson: "Rajesh Kumar",
        phone: "9876543210",
        email: "rajesh@abchardware.com",
        address: "Bhiwandi, Maharashtra",
        gstNumber: "27ABCDE1234F1Z5",
        note: "Primary supplier for fasteners and hand tools",
      },
    });

    // 3) Products
    const nails = await tx.product.create({
      data: {
        sku: "NAILS-001",
        name: "Mild Steel Nails 1 inch",
        slug: "mild-steel-nails-1-inch",
        description: "Loose nails sold by weight",
        category: "Fasteners",
        brand: "Generic",
        status: ProductStatus.ACTIVE,
        baseUnitCode: "g",
        unitKind: UnitKind.WEIGHT,
        allowsFractional: true,
        costPrice: "0.10",
        sellingPrice: "0.15",
        taxRate: "18.00",
        reorderLevel: "5000.0000",
        currentStock: "25000.0000",
      },
    });

    const screws = await tx.product.create({
      data: {
        sku: "SCREW-001",
        name: "Wood Screws 2 inch",
        slug: "wood-screws-2-inch",
        description: "Screws sold by piece or box",
        category: "Fasteners",
        brand: "FixPro",
        status: ProductStatus.ACTIVE,
        baseUnitCode: "pc",
        unitKind: UnitKind.PIECE,
        allowsFractional: false,
        costPrice: "2.50",
        sellingPrice: "4.00",
        taxRate: "18.00",
        reorderLevel: "200.0000",
        currentStock: "500.0000",
      },
    });

    const hammer = await tx.product.create({
      data: {
        sku: "HAMMER-001",
        name: "Claw Hammer 16oz",
        slug: "claw-hammer-16oz",
        description: "Standard claw hammer",
        category: "Tools",
        brand: "Master Tools",
        status: ProductStatus.ACTIVE,
        baseUnitCode: "pc",
        unitKind: UnitKind.PIECE,
        allowsFractional: false,
        costPrice: "200.00",
        sellingPrice: "300.00",
        taxRate: "18.00",
        reorderLevel: "10.0000",
        currentStock: "20.0000",
      },
    });

    // 4) Product units
    const nailsGram = await tx.productUnit.create({
      data: {
        productId: nails.id,
        code: "g",
        displayName: "Gram",
        isBaseUnit: true,
        conversionToBase: "1.0000",
        allowsFractionalSale: true,
      },
    });

    const nailsKg = await tx.productUnit.create({
      data: {
        productId: nails.id,
        code: "kg",
        displayName: "Kilogram",
        isBaseUnit: false,
        conversionToBase: "1000.0000",
        allowsFractionalSale: true,
      },
    });

    const screwsPiece = await tx.productUnit.create({
      data: {
        productId: screws.id,
        code: "pc",
        displayName: "Piece",
        isBaseUnit: true,
        conversionToBase: "1.0000",
        allowsFractionalSale: false,
      },
    });

    const screwsBox = await tx.productUnit.create({
      data: {
        productId: screws.id,
        code: "box",
        displayName: "Box (100 pcs)",
        isBaseUnit: false,
        conversionToBase: "100.0000",
        allowsFractionalSale: false,
      },
    });

    const hammerPiece = await tx.productUnit.create({
      data: {
        productId: hammer.id,
        code: "pc",
        displayName: "Piece",
        isBaseUnit: true,
        conversionToBase: "1.0000",
        allowsFractionalSale: false,
      },
    });

    // 5) Barcodes
    await tx.barcode.createMany({
      data: [
        {
          code: "8901000000011",
          type: BarcodeType.PRODUCT,
          productId: nails.id,
          productUnitId: nailsKg.id,
          note: "Nails sold by kilogram",
        },
        {
          code: "8901000000028",
          type: BarcodeType.PRODUCT,
          productId: screws.id,
          productUnitId: screwsPiece.id,
          note: "Single screw barcode",
        },
        {
          code: "8901000000035",
          type: BarcodeType.PACK,
          productId: screws.id,
          productUnitId: screwsBox.id,
          note: "Box of 100 screws",
        },
        {
          code: "8901000000042",
          type: BarcodeType.PRODUCT,
          productId: hammer.id,
          productUnitId: hammerPiece.id,
          note: "Hammer piece barcode",
        },
      ],
    });

    // 6) Purchase: buy 25 kg nails and 5 boxes of screws
    const purchase = await tx.purchase.create({
      data: {
        purchaseNumber: "PUR-0001",
        supplierId: supplier.id,
        status: PurchaseStatus.RECEIVED,
        invoiceNumber: "INV-1001",
        invoiceDate: new Date("2026-04-04T09:00:00.000Z"),
        note: "Opening supplier purchase",
        subtotal: "3750.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        totalAmount: "3750.00",
        createdById: admin.id,
      },
    });

    await tx.purchaseLine.createMany({
      data: [
        {
          purchaseId: purchase.id,
          productId: nails.id,
          productUnitId: nailsKg.id,
          quantity: "25.0000",
          quantityInBase: "25000.0000",
          unitCost: "100.0000",
          lineDiscount: "0.00",
          lineTax: "0.00",
          lineTotal: "2500.00",
        },
        {
          purchaseId: purchase.id,
          productId: screws.id,
          productUnitId: screwsBox.id,
          quantity: "5.0000",
          quantityInBase: "500.0000",
          unitCost: "250.0000",
          lineDiscount: "0.00",
          lineTax: "0.00",
          lineTotal: "1250.00",
        },
      ],
    });

    await tx.stockMovement.createMany({
      data: [
        {
          type: StockMovementType.PURCHASE_IN,
          productId: nails.id,
          productUnitId: nailsKg.id,
          quantity: "25.0000",
          quantityInBase: "25000.0000",
          note: "Purchased 25 kg nails",
          purchaseId: purchase.id,
          createdById: admin.id,
        },
        {
          type: StockMovementType.PURCHASE_IN,
          productId: screws.id,
          productUnitId: screwsBox.id,
          quantity: "5.0000",
          quantityInBase: "500.0000",
          note: "Purchased 5 boxes screws",
          purchaseId: purchase.id,
          createdById: admin.id,
        },
      ],
    });

    // 7) Sale: sell 0.5 kg nails and 2 hammers
    const sale = await tx.sale.create({
      data: {
        saleNumber: "SAL-0001",
        status: SaleStatus.COMPLETED,
        customerName: "Walk-in Customer",
        customerPhone: "9000000000",
        note: "First sample sale",
        subtotal: "675.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        totalAmount: "675.00",
        paidAmount: "675.00",
        balanceAmount: "0.00",
        createdById: cashier.id,
      },
    });

    await tx.saleLine.createMany({
      data: [
        {
          saleId: sale.id,
          productId: nails.id,
          productUnitId: nailsKg.id,
          quantity: "0.5000",
          quantityInBase: "500.0000",
          unitPrice: "150.0000",
          lineDiscount: "0.00",
          lineTax: "0.00",
          lineTotal: "75.00",
        },
        {
          saleId: sale.id,
          productId: hammer.id,
          productUnitId: hammerPiece.id,
          quantity: "2.0000",
          quantityInBase: "2.0000",
          unitPrice: "300.0000",
          lineDiscount: "0.00",
          lineTax: "0.00",
          lineTotal: "600.00",
        },
      ],
    });

    await tx.stockMovement.createMany({
      data: [
        {
          type: StockMovementType.SALE_OUT,
          productId: nails.id,
          productUnitId: nailsKg.id,
          quantity: "0.5000",
          quantityInBase: "500.0000",
          note: "Sold 0.5 kg nails",
          saleId: sale.id,
          createdById: cashier.id,
        },
        {
          type: StockMovementType.SALE_OUT,
          productId: hammer.id,
          productUnitId: hammerPiece.id,
          quantity: "2.0000",
          quantityInBase: "2.0000",
          note: "Sold 2 hammers",
          saleId: sale.id,
          createdById: cashier.id,
        },
      ],
    });

    // 8) Stock adjustment example
    await tx.stockAdjustment.create({
      data: {
        productId: nails.id,
        quantityBefore: "24500.0000",
        quantityAfter: "24400.0000",
        difference: "-100.0000",
        reason: "Physical count shortage",
        note: "Found 100 g shortage during manual count",
        adjustedById: admin.id,
      },
    });

    await tx.stockMovement.create({
      data: {
        type: StockMovementType.RECOUNT_OUT,
        productId: nails.id,
        productUnitId: nailsGram.id,
        quantity: "100.0000",
        quantityInBase: "100.0000",
        note: "Stock adjusted after physical count",
        createdById: admin.id,
      },
    });

    // 9) Update cached currentStock values
    await tx.product.update({
      where: { id: nails.id },
      data: { currentStock: "24400.0000" },
    });

    await tx.product.update({
      where: { id: screws.id },
      data: { currentStock: "500.0000" },
    });

    await tx.product.update({
      where: { id: hammer.id },
      data: { currentStock: "18.0000" },
    });
  });

  console.log("✅ Seed completed successfully");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed");
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
