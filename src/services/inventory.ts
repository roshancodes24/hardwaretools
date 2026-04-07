import {
  Prisma,
  PurchaseStatus,
  SaleStatus,
  StockMovementType,
} from "@prisma/client";
import { prisma } from "../lib/prisma";

type PurchaseLineInput = {
  productId: string;
  productUnitId: string;
  quantity: string | number;
  unitCost: string | number;
  lineDiscount?: string | number;
  lineTax?: string | number;
};

type CreatePurchaseInput = {
  supplierId: string;
  createdById: string;
  invoiceNumber?: string;
  invoiceDate?: Date;
  note?: string;
  lines: PurchaseLineInput[];
};

type SaleLineInput = {
  productId: string;
  productUnitId: string;
  quantity: string | number;
  unitPrice: string | number;
  lineDiscount?: string | number;
  lineTax?: string | number;
};

type CreateSaleInput = {
  createdById: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  note?: string;
  paidAmount?: string | number;
  lines: SaleLineInput[];
};

type AdjustStockInput = {
  productId: string;
  adjustedById: string;
  quantityAfter: string | number;
  reason: string;
  note?: string;
};

const D = Prisma.Decimal;

function dec(value: string | number | Prisma.Decimal) {
  return new D(value);
}

function money(value: Prisma.Decimal) {
  return value.toDecimalPlaces(2);
}

function qty(value: Prisma.Decimal) {
  return value.toDecimalPlaces(4);
}

function makePurchaseNumber() {
  return `PUR-${Date.now()}`;
}

function makeSaleNumber() {
  return `SAL-${Date.now()}`;
}

async function getUnitOrThrow(
  tx: Prisma.TransactionClient,
  productUnitId: string
) {
  const unit = await tx.productUnit.findUnique({
    where: { id: productUnitId },
    include: { product: true },
  });

  if (!unit) {
    throw new Error(`Product unit not found: ${productUnitId}`);
  }

  return unit;
}

export async function createPurchase(input: CreatePurchaseInput) {
  return prisma.$transaction(async (tx) => {
    if (!input.lines.length) {
      throw new Error("Purchase must contain at least one line.");
    }

    const purchaseNumber = makePurchaseNumber();

    let subtotal = dec(0);
    let discountAmount = dec(0);
    let taxAmount = dec(0);

    const normalizedLines: Array<{
      productId: string;
      productUnitId: string;
      quantity: Prisma.Decimal;
      quantityInBase: Prisma.Decimal;
      unitCost: Prisma.Decimal;
      lineDiscount: Prisma.Decimal;
      lineTax: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
    }> = [];

    for (const line of input.lines) {
      const unit = await getUnitOrThrow(tx, line.productUnitId);

      if (unit.productId !== line.productId) {
        throw new Error("Product and product unit do not match.");
      }

      const quantityValue = qty(dec(line.quantity));
      const unitCostValue = dec(line.unitCost);
      const lineDiscountValue = money(dec(line.lineDiscount ?? 0));
      const lineTaxValue = money(dec(line.lineTax ?? 0));
      const quantityInBase = qty(quantityValue.mul(unit.conversionToBase));
      const lineTotal = money(
        quantityValue.mul(unitCostValue).minus(lineDiscountValue).plus(lineTaxValue)
      );

      subtotal = subtotal.plus(quantityValue.mul(unitCostValue));
      discountAmount = discountAmount.plus(lineDiscountValue);
      taxAmount = taxAmount.plus(lineTaxValue);

      normalizedLines.push({
        productId: line.productId,
        productUnitId: line.productUnitId,
        quantity: quantityValue,
        quantityInBase,
        unitCost: unitCostValue,
        lineDiscount: lineDiscountValue,
        lineTax: lineTaxValue,
        lineTotal,
      });
    }

    const totalAmount = money(subtotal.minus(discountAmount).plus(taxAmount));

    const purchase = await tx.purchase.create({
      data: {
        purchaseNumber,
        supplierId: input.supplierId,
        status: PurchaseStatus.RECEIVED,
        invoiceNumber: input.invoiceNumber,
        invoiceDate: input.invoiceDate,
        note: input.note,
        subtotal: money(subtotal),
        discountAmount,
        taxAmount,
        totalAmount,
        createdById: input.createdById,
      },
    });

    for (const line of normalizedLines) {
      await tx.purchaseLine.create({
        data: {
          purchaseId: purchase.id,
          productId: line.productId,
          productUnitId: line.productUnitId,
          quantity: line.quantity,
          quantityInBase: line.quantityInBase,
          unitCost: line.unitCost,
          lineDiscount: line.lineDiscount,
          lineTax: line.lineTax,
          lineTotal: line.lineTotal,
        },
      });

      await tx.stockMovement.create({
        data: {
          type: StockMovementType.PURCHASE_IN,
          productId: line.productId,
          productUnitId: line.productUnitId,
          quantity: line.quantity,
          quantityInBase: line.quantityInBase,
          note: `Purchase ${purchase.purchaseNumber}`,
          purchaseId: purchase.id,
          createdById: input.createdById,
        },
      });

      const product = await tx.product.findUnique({
        where: { id: line.productId },
        select: { currentStock: true },
      });

      if (!product) {
        throw new Error(`Product not found: ${line.productId}`);
      }

      await tx.product.update({
        where: { id: line.productId },
        data: {
          currentStock: qty(dec(product.currentStock).plus(line.quantityInBase)),
        },
      });
    }

    return tx.purchase.findUnique({
      where: { id: purchase.id },
      include: {
        supplier: true,
        lines: {
          include: {
            product: true,
            productUnit: true,
          },
        },
      },
    });
  });
}

export async function createSale(input: CreateSaleInput) {
  return prisma.$transaction(async (tx) => {
    if (!input.lines.length) {
      throw new Error("Sale must contain at least one line.");
    }

    const saleNumber = makeSaleNumber();

    let subtotal = dec(0);
    let discountAmount = dec(0);
    let taxAmount = dec(0);

    const normalizedLines: Array<{
      productId: string;
      productUnitId: string;
      quantity: Prisma.Decimal;
      quantityInBase: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      lineDiscount: Prisma.Decimal;
      lineTax: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
    }> = [];

    for (const line of input.lines) {
      const unit = await tx.productUnit.findUnique({
        where: { id: line.productUnitId },
        include: { product: true },
      });

      if (!unit) {
        throw new Error(`Product unit not found: ${line.productUnitId}`);
      }

      if (unit.productId !== line.productId) {
        throw new Error("Product and product unit do not match.");
      }

      const quantityValue = qty(dec(line.quantity));

      if (!unit.allowsFractionalSale && !quantityValue.isInteger()) {
        throw new Error(`Fractional sale not allowed for unit ${unit.code}`);
      }

      const unitPriceValue = dec(line.unitPrice);
      const lineDiscountValue = money(dec(line.lineDiscount ?? 0));
      const lineTaxValue = money(dec(line.lineTax ?? 0));
      const quantityInBase = qty(quantityValue.mul(unit.conversionToBase));

      const product = await tx.product.findUnique({
        where: { id: line.productId },
        select: { currentStock: true, name: true },
      });

      if (!product) {
        throw new Error(`Product not found: ${line.productId}`);
      }

      if (dec(product.currentStock).lessThan(quantityInBase)) {
        throw new Error(`Insufficient stock for ${product.name}`);
      }

      const lineTotal = money(
        quantityValue.mul(unitPriceValue).minus(lineDiscountValue).plus(lineTaxValue)
      );

      subtotal = subtotal.plus(quantityValue.mul(unitPriceValue));
      discountAmount = discountAmount.plus(lineDiscountValue);
      taxAmount = taxAmount.plus(lineTaxValue);

      normalizedLines.push({
        productId: line.productId,
        productUnitId: line.productUnitId,
        quantity: quantityValue,
        quantityInBase,
        unitPrice: unitPriceValue,
        lineDiscount: lineDiscountValue,
        lineTax: lineTaxValue,
        lineTotal,
      });
    }

    const totalAmount = money(subtotal.minus(discountAmount).plus(taxAmount));
    const paidAmount = money(dec(input.paidAmount ?? totalAmount));
    const balanceAmount = money(totalAmount.minus(paidAmount));

    let resolvedCustomerId: string | null = null;
    let customerNameSnapshot: string | null = null;
    let customerName: string | null = null;
    let customerPhone: string | null =
      input.customerPhone != null &&
      String(input.customerPhone).trim() !== ""
        ? String(input.customerPhone).trim()
        : null;

    if (input.customerId) {
      const cust = await tx.customer.findUnique({
        where: { id: input.customerId },
      });
      if (!cust) {
        throw new Error("Customer not found");
      }
      resolvedCustomerId = cust.id;
      customerNameSnapshot = cust.name;
      customerName = cust.name;
      if (!customerPhone && cust.phone) {
        customerPhone = cust.phone;
      }
    } else if (
      input.customerName != null &&
      String(input.customerName).trim() !== ""
    ) {
      const n = String(input.customerName).trim();
      customerNameSnapshot = n;
      customerName = n;
    }

    const sale = await tx.sale.create({
      data: {
        saleNumber,
        status: SaleStatus.COMPLETED,
        customerId: resolvedCustomerId,
        customerNameSnapshot,
        customerName,
        customerPhone,
        note: input.note,
        subtotal: money(subtotal),
        discountAmount,
        taxAmount,
        totalAmount,
        paidAmount,
        balanceAmount,
        createdById: input.createdById,
      },
    });

    for (const line of normalizedLines) {
      await tx.saleLine.create({
        data: {
          saleId: sale.id,
          productId: line.productId,
          productUnitId: line.productUnitId,
          quantity: line.quantity,
          quantityInBase: line.quantityInBase,
          unitPrice: line.unitPrice,
          lineDiscount: line.lineDiscount,
          lineTax: line.lineTax,
          lineTotal: line.lineTotal,
        },
      });

      await tx.stockMovement.create({
        data: {
          type: StockMovementType.SALE_OUT,
          productId: line.productId,
          productUnitId: line.productUnitId,
          quantity: line.quantity,
          quantityInBase: line.quantityInBase,
          note: `Sale ${sale.saleNumber}`,
          saleId: sale.id,
          createdById: input.createdById,
        },
      });

      const product = await tx.product.findUnique({
        where: { id: line.productId },
        select: { currentStock: true },
      });

      if (!product) {
        throw new Error(`Product not found: ${line.productId}`);
      }

      await tx.product.update({
        where: { id: line.productId },
        data: {
          currentStock: qty(dec(product.currentStock).minus(line.quantityInBase)),
        },
      });
    }

    return tx.sale.findUnique({
      where: { id: sale.id },
      include: {
        lines: {
          include: {
            product: true,
            productUnit: true,
          },
        },
      },
    });
  });
}

export async function adjustStock(input: AdjustStockInput) {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: input.productId },
      include: {
        units: true,
      },
    });

    if (!product) {
      throw new Error("Product not found.");
    }

    const baseUnit = product.units.find((u) => u.isBaseUnit);

    if (!baseUnit) {
      throw new Error("Base unit not found for product.");
    }

    const quantityBefore = qty(dec(product.currentStock));
    const quantityAfter = qty(dec(input.quantityAfter));
    const difference = qty(quantityAfter.minus(quantityBefore));

    if (difference.equals(0)) {
      throw new Error("No stock difference to adjust.");
    }

    await tx.stockAdjustment.create({
      data: {
        productId: input.productId,
        quantityBefore,
        quantityAfter,
        difference,
        reason: input.reason,
        note: input.note,
        adjustedById: input.adjustedById,
      },
    });

    await tx.stockMovement.create({
      data: {
        type: difference.greaterThan(0)
          ? StockMovementType.RECOUNT_IN
          : StockMovementType.RECOUNT_OUT,
        productId: input.productId,
        productUnitId: baseUnit.id,
        quantity: qty(difference.abs()),
        quantityInBase: qty(difference.abs()),
        note: input.note ?? input.reason,
        createdById: input.adjustedById,
      },
    });

    return tx.product.update({
      where: { id: input.productId },
      data: {
        currentStock: quantityAfter,
      },
    });
  });
}

export async function getProductStock(productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      units: true,
      barcodes: true,
      stockMovements: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      stockAdjustments: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });

  if (!product) {
    throw new Error("Product not found.");
  }

  return product;
}
