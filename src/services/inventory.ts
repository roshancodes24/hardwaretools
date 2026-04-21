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
  customerPartyGstNo?: string;
  customerPartyState?: string;
  /** Added to total after line taxes (non-negative). */
  transportAmount?: string | number;
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
        paidAmount: money(dec(0)),
        balanceAmount: totalAmount,
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
        createdBy: { select: { fullName: true } },
        lines: {
          include: {
            product: true,
            productUnit: true,
          },
        },
        payments: {
          orderBy: { paidAt: "asc" },
          include: { createdBy: { select: { fullName: true } } },
        },
      },
    });
  });
}

export type RecordPurchasePaymentInput = {
  purchaseId: string;
  amount: string | number;
  createdById: string;
  note?: string;
  /** Business date of payment (defaults to now). */
  paidAt?: Date;
};

export async function recordPurchasePayment(input: RecordPurchasePaymentInput) {
  return prisma.$transaction(async (tx) => {
    const purchase = await tx.purchase.findUnique({
      where: { id: input.purchaseId },
    });
    if (!purchase) {
      throw new Error("Purchase not found.");
    }
    if (purchase.status !== PurchaseStatus.RECEIVED) {
      throw new Error("Only received purchases can receive supplier payments.");
    }
    const balance = dec(purchase.balanceAmount);
    const pay = money(dec(input.amount));
    if (!pay.gt(0)) {
      throw new Error("Payment amount must be greater than zero.");
    }
    if (pay.greaterThan(balance)) {
      throw new Error("Payment exceeds outstanding balance owed to supplier.");
    }

    const newPaid = money(dec(purchase.paidAmount).plus(pay));
    const newBal = money(balance.minus(pay));
    const paidAt = input.paidAt ?? new Date();

    await tx.purchase.update({
      where: { id: purchase.id },
      data: {
        paidAmount: newPaid,
        balanceAmount: newBal,
      },
    });

    await tx.purchasePayment.create({
      data: {
        purchaseId: purchase.id,
        amount: pay,
        paidAt,
        note: input.note?.trim() || null,
        createdById: input.createdById,
      },
    });

    return tx.purchase.findUnique({
      where: { id: purchase.id },
      include: {
        supplier: true,
        createdBy: { select: { fullName: true } },
        lines: {
          include: {
            product: true,
            productUnit: true,
          },
        },
        payments: {
          orderBy: { paidAt: "asc" },
          include: { createdBy: { select: { fullName: true } } },
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

    const transportRaw = dec(input.transportAmount ?? 0);
    if (transportRaw.lessThan(0)) {
      throw new Error("Transport amount cannot be negative.");
    }
    const transportAmount = money(transportRaw);

    const totalAmount = money(
      subtotal.minus(discountAmount).plus(taxAmount).plus(transportAmount)
    );

    let resolvedCustomerId: string | null = null;
    let customerNameSnapshot: string | null = null;
    let customerName: string | null = null;
    let customerPhone: string | null =
      input.customerPhone != null &&
      String(input.customerPhone).trim() !== ""
        ? String(input.customerPhone).trim()
        : null;

    const gstFromInput =
      input.customerPartyGstNo != null &&
      String(input.customerPartyGstNo).trim() !== ""
        ? String(input.customerPartyGstNo).trim()
        : null;

    const stateFromInput =
      input.customerPartyState != null &&
      String(input.customerPartyState).trim() !== ""
        ? String(input.customerPartyState).trim()
        : null;

    let resolvedPartyGstNo: string | null = null;
    let resolvedPartyState: string | null = null;

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
      resolvedPartyGstNo =
        gstFromInput ?? (cust.partyGstNo?.trim() ? cust.partyGstNo.trim() : null);
      resolvedPartyState =
        stateFromInput ??
        (cust.partyState?.trim() ? cust.partyState.trim() : null);
    } else if (
      input.customerName != null &&
      String(input.customerName).trim() !== ""
    ) {
      const n = String(input.customerName).trim();
      customerNameSnapshot = n;
      customerName = n;
      resolvedPartyGstNo = gstFromInput;
      resolvedPartyState = stateFromInput;
    }

    let paidAmount = money(dec(input.paidAmount ?? totalAmount));
    if (paidAmount.greaterThan(totalAmount)) {
      const over = paidAmount.minus(totalAmount);
      // Tiny overpay from float vs Decimal rounding (POS total vs line sums).
      if (over.lessThanOrEqualTo(dec("0.05"))) {
        paidAmount = totalAmount;
      } else {
        throw new Error("Amount paid cannot exceed sale total.");
      }
    }
    const balanceAmount = money(totalAmount.minus(paidAmount));
    if (balanceAmount.greaterThan(0)) {
      const hasRegistered = resolvedCustomerId != null;
      const walkInOk =
        Boolean(customerName && String(customerName).trim()) &&
        Boolean(customerPhone && String(customerPhone).trim());
      if (!hasRegistered && !walkInOk) {
        throw new Error(
          "Balance due requires a registered customer, or walk-in name and phone number."
        );
      }
    } else {
      const hasRegistered = resolvedCustomerId != null;
      const walkInNameOk = Boolean(customerName && String(customerName).trim());
      if (!hasRegistered && !walkInNameOk) {
        throw new Error(
          "Walk-in name is required when paying in full (phone optional)."
        );
      }
    }

    const sale = await tx.sale.create({
      data: {
        saleNumber,
        status: SaleStatus.COMPLETED,
        customerId: resolvedCustomerId,
        customerNameSnapshot,
        customerName,
        customerPhone,
        customerPartyGstNo: resolvedPartyGstNo,
        customerPartyState: resolvedPartyState,
        note: input.note,
        subtotal: money(subtotal),
        discountAmount,
        taxAmount,
        transportAmount,
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

    if (paidAmount.greaterThan(0)) {
      await tx.salePayment.create({
        data: {
          saleId: sale.id,
          amount: paidAmount,
          note: "Initial payment",
          createdById: input.createdById,
        },
      });
    }

    return tx.sale.findUnique({
      where: { id: sale.id },
      include: {
        customer: { select: { partyGstNo: true, partyState: true } },
        lines: {
          include: {
            product: true,
            productUnit: true,
          },
        },
        payments: { orderBy: { createdAt: "asc" } },
      },
    });
  });
}

export type RecordSalePaymentInput = {
  saleId: string;
  amount: string | number;
  createdById: string;
  note?: string;
};

export async function recordSalePayment(input: RecordSalePaymentInput) {
  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findUnique({
      where: { id: input.saleId },
    });
    if (!sale) {
      throw new Error("Sale not found.");
    }
    if (sale.status !== SaleStatus.COMPLETED) {
      throw new Error("Only completed sales can receive payments.");
    }
    const balance = dec(sale.balanceAmount);
    const pay = money(dec(input.amount));
    if (!pay.gt(0)) {
      throw new Error("Payment amount must be greater than zero.");
    }
    if (pay.greaterThan(balance)) {
      throw new Error("Payment exceeds outstanding balance.");
    }

    const newPaid = money(dec(sale.paidAmount).plus(pay));
    const newBal = money(balance.minus(pay));

    await tx.sale.update({
      where: { id: sale.id },
      data: {
        paidAmount: newPaid,
        balanceAmount: newBal,
      },
    });

    await tx.salePayment.create({
      data: {
        saleId: sale.id,
        amount: pay,
        note: input.note?.trim() || null,
        createdById: input.createdById,
      },
    });

    return tx.sale.findUnique({
      where: { id: sale.id },
      include: {
        customer: { select: { partyGstNo: true, partyState: true } },
        lines: {
          include: {
            product: true,
            productUnit: true,
          },
        },
        payments: { orderBy: { createdAt: "asc" } },
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
