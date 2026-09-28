import {
  Prisma,
  PurchaseStatus,
  SalePaymentMethod,
  SaleStatus,
  StockMovementType,
} from "@prisma/client";
import { computePurchasePricingUpdate } from "../lib/productPricing";
import {
  allocateSaleNumber,
  isUniqueConstraintError,
  nextPurchaseNumber,
} from "../lib/documentNumbers";
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

type SaleInitialPaymentInput = {
  method: "cash" | "online_banking";
  amount: string | number;
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
  /**
   * Bill (BIL-*) vs GST tax invoice (INV-*). Separate sequences; first in each series
   * uses SALE_NUMBER_BILL_START / SALE_NUMBER_TAX_START (default 1000).
   */
  documentKind?: "bill" | "tax_invoice";
  paymentMethod?: "cash" | "online_banking";
  /** One row per method/amount collected at checkout (split payment). */
  initialPayments?: SaleInitialPaymentInput[];
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

function salePaymentMethodFromInput(
  method?: "cash" | "online_banking"
): SalePaymentMethod {
  return method === "online_banking"
    ? SalePaymentMethod.ONLINE_BANKING
    : SalePaymentMethod.CASH;
}

const SALE_NUMBER_BILL_START = Number.parseInt(
  process.env.SALE_NUMBER_BILL_START ?? "1000",
  10
);
const SALE_NUMBER_TAX_START = Number.parseInt(
  process.env.SALE_NUMBER_TAX_START ?? "1000",
  10
);

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

/** Lock product rows for update (sorted by id to reduce deadlock risk). */
async function lockProductsForStockUpdate(
  tx: Prisma.TransactionClient,
  productIds: string[]
): Promise<Map<string, { currentStock: Prisma.Decimal; name: string }>> {
  const unique = [...new Set(productIds)].sort();
  if (unique.length === 0) return new Map();

  const rows = await tx.$queryRaw<
    Array<{ id: string; currentStock: Prisma.Decimal; name: string }>
  >`
    SELECT id, "currentStock", name
    FROM "Product"
    WHERE id IN (${Prisma.join(unique)})
    ORDER BY id
    FOR UPDATE
  `;

  return new Map(
    rows.map((row) => [
      row.id,
      { currentStock: row.currentStock, name: row.name },
    ])
  );
}

const LARGE_TX_OPTS = { timeout: 120_000, maxWait: 30_000 } as const;
const CREATE_MANY_CHUNK = 500;

type NormalizedPurchaseLine = {
  productId: string;
  productUnitId: string;
  quantity: Prisma.Decimal;
  quantityInBase: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  conversionToBase: Prisma.Decimal;
  lineDiscount: Prisma.Decimal;
  lineTax: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
};

type ProductPricingState = {
  currentStock: Prisma.Decimal;
  percentage: Prisma.Decimal | null;
  sellingPrice: Prisma.Decimal | null;
  mrp: Prisma.Decimal | null;
  avgCostPrice: Prisma.Decimal | null;
  costPrice: Prisma.Decimal | null;
  priceReviewNeeded: boolean;
  suggestedSellingPrice: Prisma.Decimal | null;
  priceReviewNote: string | null;
};

async function createManyInChunks<T extends object>(
  tx: Prisma.TransactionClient,
  model: {
    createMany: (args: { data: T[] }) => Promise<{ count: number }>;
  },
  rows: T[]
) {
  for (let i = 0; i < rows.length; i += CREATE_MANY_CHUNK) {
    const chunk = rows.slice(i, i + CREATE_MANY_CHUNK);
    if (chunk.length > 0) {
      await model.createMany({ data: chunk });
    }
  }
}

async function executeCreatePurchase(
  tx: Prisma.TransactionClient,
  input: CreatePurchaseInput
) {
  if (!input.lines.length) {
    throw new Error("Purchase must contain at least one line.");
  }

  const unitIds = [...new Set(input.lines.map((line) => line.productUnitId))];
  const units = await tx.productUnit.findMany({
    where: { id: { in: unitIds } },
  });
  const unitById = new Map(units.map((unit) => [unit.id, unit]));

  const purchaseNumber = nextPurchaseNumber();

  let subtotal = dec(0);
  let discountAmount = dec(0);
  let taxAmount = dec(0);

  const normalizedLines: NormalizedPurchaseLine[] = [];

  for (const line of input.lines) {
    const unit = unitById.get(line.productUnitId);
    if (!unit) {
      throw new Error(`Product unit not found: ${line.productUnitId}`);
    }
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
      conversionToBase: unit.conversionToBase,
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

  await createManyInChunks(
    tx,
    tx.purchaseLine,
    normalizedLines.map((line) => ({
      purchaseId: purchase.id,
      productId: line.productId,
      productUnitId: line.productUnitId,
      quantity: line.quantity,
      quantityInBase: line.quantityInBase,
      unitCost: line.unitCost,
      lineDiscount: line.lineDiscount,
      lineTax: line.lineTax,
      lineTotal: line.lineTotal,
    }))
  );

  await createManyInChunks(
    tx,
    tx.stockMovement,
    normalizedLines.map((line) => ({
      type: StockMovementType.PURCHASE_IN,
      productId: line.productId,
      productUnitId: line.productUnitId,
      quantity: line.quantity,
      quantityInBase: line.quantityInBase,
      note: `Purchase ${purchase.purchaseNumber}`,
      purchaseId: purchase.id,
      createdById: input.createdById,
    }))
  );

  const linesByProduct = new Map<string, NormalizedPurchaseLine[]>();
  for (const line of normalizedLines) {
    const group = linesByProduct.get(line.productId) ?? [];
    group.push(line);
    linesByProduct.set(line.productId, group);
  }

  const productIds = [...linesByProduct.keys()];
  const products = await tx.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      currentStock: true,
      percentage: true,
      sellingPrice: true,
      mrp: true,
      avgCostPrice: true,
      costPrice: true,
      priceReviewNeeded: true,
      suggestedSellingPrice: true,
      priceReviewNote: true,
    },
  });
  const productState = new Map<string, ProductPricingState>(
    products.map((product) => [
      product.id,
      {
        currentStock: dec(product.currentStock),
        percentage: product.percentage,
        sellingPrice: product.sellingPrice,
        mrp: product.mrp,
        avgCostPrice: product.avgCostPrice,
        costPrice: product.costPrice,
        priceReviewNeeded: product.priceReviewNeeded,
        suggestedSellingPrice: product.suggestedSellingPrice,
        priceReviewNote: product.priceReviewNote,
      },
    ])
  );

  for (const [productId, lines] of linesByProduct) {
    const state = productState.get(productId);
    if (!state) {
      throw new Error(`Product not found: ${productId}`);
    }

    let nextStock = state.currentStock;
    let nextCostPrice = state.costPrice;
    let nextAvgCostPrice = state.avgCostPrice;
    let nextSellingPrice = state.sellingPrice;
    let nextPriceReviewNeeded = state.priceReviewNeeded;
    let nextSuggestedSellingPrice = state.suggestedSellingPrice;
    let nextPriceReviewNote = state.priceReviewNote;

    for (const line of lines) {
      const pricing = computePurchasePricingUpdate({
        currentStockBase: nextStock,
        receivedQtyBase: line.quantityInBase,
        unitCost: line.unitCost,
        conversionToBase: line.conversionToBase,
        currentAvgCost: nextAvgCostPrice,
        currentCostPrice: nextCostPrice,
        currentSellingPrice: nextSellingPrice,
        percentage: state.percentage,
        mrp: state.mrp,
      });

      nextStock = qty(nextStock.plus(line.quantityInBase));
      nextCostPrice = pricing.costPrice;
      nextAvgCostPrice = pricing.avgCostPrice;
      if (pricing.sellingPrice != null) {
        nextSellingPrice = pricing.sellingPrice;
      }
      nextPriceReviewNeeded = pricing.priceReviewNeeded;
      nextSuggestedSellingPrice = pricing.suggestedSellingPrice;
      nextPriceReviewNote = pricing.priceReviewNote;
    }

    await tx.product.update({
      where: { id: productId },
      data: {
        currentStock: nextStock,
        costPrice: nextCostPrice,
        avgCostPrice: nextAvgCostPrice,
        ...(nextSellingPrice != null ? { sellingPrice: nextSellingPrice } : {}),
        priceReviewNeeded: nextPriceReviewNeeded,
        suggestedSellingPrice: nextSuggestedSellingPrice,
        priceReviewNote: nextPriceReviewNote,
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
}

export async function createPurchase(input: CreatePurchaseInput) {
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await prisma.$transaction(
        (tx) => executeCreatePurchase(tx, input),
        LARGE_TX_OPTS
      );
    } catch (error) {
      if (isUniqueConstraintError(error) && attempt < maxAttempts - 1) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Could not create purchase after multiple attempts.");
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

    const saleNumber = await allocateSaleNumber(
      tx,
      input.documentKind === "tax_invoice" ? "tax_invoice" : "bill",
      SALE_NUMBER_BILL_START,
      SALE_NUMBER_TAX_START
    );

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

    const deductByProduct = new Map<string, Prisma.Decimal>();
    for (const line of normalizedLines) {
      const prev = deductByProduct.get(line.productId) ?? dec(0);
      deductByProduct.set(line.productId, qty(prev.plus(line.quantityInBase)));
    }

    const lockedProducts = await lockProductsForStockUpdate(
      tx,
      [...deductByProduct.keys()]
    );

    for (const [productId, needed] of deductByProduct) {
      const product = lockedProducts.get(productId);
      if (!product) {
        throw new Error(`Product not found: ${productId}`);
      }
      if (dec(product.currentStock).lessThan(needed)) {
        throw new Error(`Insufficient stock for ${product.name}`);
      }
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
    }

    for (const [productId, deductQty] of deductByProduct) {
      const product = lockedProducts.get(productId);
      if (!product) {
        throw new Error(`Product not found: ${productId}`);
      }
      await tx.product.update({
        where: { id: productId },
        data: {
          currentStock: qty(dec(product.currentStock).minus(deductQty)),
        },
      });
    }

    if (paidAmount.greaterThan(0)) {
      const splitPayments =
        input.initialPayments?.filter((p) => money(dec(p.amount)).greaterThan(0)) ??
        [];
      const paymentRows =
        splitPayments.length > 0
          ? splitPayments.map((p) => ({
              method: salePaymentMethodFromInput(p.method),
              amount: money(dec(p.amount)),
            }))
          : [
              {
                method: salePaymentMethodFromInput(input.paymentMethod),
                amount: paidAmount,
              },
            ];

      let paymentSum = dec(0);
      for (const row of paymentRows) {
        paymentSum = paymentSum.plus(row.amount);
      }
      if (!money(paymentSum).equals(paidAmount)) {
        throw new Error("Payment total does not match amount received.");
      }

      const paymentNote =
        paymentRows.length > 1 ? "Split payment" : "Initial payment";
      for (const row of paymentRows) {
        await tx.salePayment.create({
          data: {
            saleId: sale.id,
            amount: row.amount,
            method: row.method,
            note: paymentNote,
            createdById: input.createdById,
          },
        });
      }
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

const saleDetailInclude = {
  customer: { select: { partyGstNo: true, partyState: true } },
  lines: {
    include: {
      product: true,
      productUnit: true,
    },
  },
  payments: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.SaleInclude;

export async function cancelSale(input: { saleId: string; cancelledById: string }) {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT id, status::text AS status
      FROM "Sale"
      WHERE id = ${input.saleId}
      FOR UPDATE
    `;
    const lockedSale = locked[0];
    if (!lockedSale) {
      throw new Error("Sale not found.");
    }
    if (lockedSale.status !== SaleStatus.COMPLETED) {
      throw new Error("Only completed sales can be cancelled.");
    }

    const sale = await tx.sale.findUnique({
      where: { id: input.saleId },
      include: { lines: true },
    });
    if (!sale) {
      throw new Error("Sale not found.");
    }

    const restoreByProduct = new Map<string, Prisma.Decimal>();
    for (const line of sale.lines) {
      const prev = restoreByProduct.get(line.productId) ?? dec(0);
      restoreByProduct.set(line.productId, qty(prev.plus(line.quantityInBase)));
    }

    const lockedProducts = await lockProductsForStockUpdate(
      tx,
      [...restoreByProduct.keys()]
    );

    for (const line of sale.lines) {
      await tx.stockMovement.create({
        data: {
          type: StockMovementType.SALE_RETURN_IN,
          productId: line.productId,
          productUnitId: line.productUnitId,
          quantity: line.quantity,
          quantityInBase: line.quantityInBase,
          note: `Cancel sale ${sale.saleNumber}`,
          saleId: sale.id,
          createdById: input.cancelledById,
        },
      });
    }

    for (const [productId, restoreQty] of restoreByProduct) {
      const product = lockedProducts.get(productId);
      if (!product) {
        throw new Error(`Product not found: ${productId}`);
      }
      await tx.product.update({
        where: { id: productId },
        data: {
          currentStock: qty(dec(product.currentStock).plus(restoreQty)),
        },
      });
    }

    await tx.sale.update({
      where: { id: sale.id },
      data: { status: SaleStatus.CANCELLED },
    });

    return tx.sale.findUnique({
      where: { id: sale.id },
      include: saleDetailInclude,
    });
  });
}

export type RecordSalePaymentInput = {
  saleId: string;
  amount?: string | number;
  createdById: string;
  paymentMethod?: "cash" | "online_banking";
  payments?: SaleInitialPaymentInput[];
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

    const splitPayments =
      input.payments?.filter((p) => money(dec(p.amount)).greaterThan(0)) ?? [];
    const paymentRows =
      splitPayments.length > 0
        ? splitPayments.map((p) => ({
            method: salePaymentMethodFromInput(p.method),
            amount: money(dec(p.amount)),
          }))
        : [
            {
              method: salePaymentMethodFromInput(input.paymentMethod),
              amount: money(dec(input.amount ?? 0)),
            },
          ];

    let totalPay = dec(0);
    for (const row of paymentRows) {
      totalPay = totalPay.plus(row.amount);
    }
    const pay = money(totalPay);
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

    const paymentNote = input.note?.trim() || null;
    const rowNote =
      paymentRows.length > 1
        ? paymentNote ?? "Split payment"
        : paymentNote;

    for (const row of paymentRows) {
      await tx.salePayment.create({
        data: {
          saleId: sale.id,
          amount: row.amount,
          method: row.method,
          note: rowNote,
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
