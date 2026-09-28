import { Prisma } from "@prisma/client";

const D = Prisma.Decimal;
const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;

/**
 * Quotation pricing follows the tax-invoice path in
 * `frontend/src/lib/posCartTotals.ts` and `frontend/src/invoice/invoiceGst.ts`:
 * order discount percent is allocated across line amounts (2 dp, remainder on
 * the last line), then each GST component is rate × taxable, rounded to paise.
 * Transport is added after tax and is not itself taxed.
 * When `includeGst` is false, tax is zero the same way as a non-tax bill.
 * Callers still snapshot the product GST percents; this function does not charge them.
 * Arithmetic stays on Decimal so values such as 10.10 × 3 stay exact.
 */
export function d(value: string | number | Prisma.Decimal): Prisma.Decimal {
  return new D(value);
}

export function money(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(2, HALF_UP);
}

export function qty(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(4, HALF_UP);
}

export function price4(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(4, HALF_UP);
}

export type PricedLineInput = {
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  /** Explicit rupee discount, before the order-level percent is allocated. */
  lineDiscount: Prisma.Decimal;
  cgstPercent: Prisma.Decimal;
  sgstPercent: Prisma.Decimal;
  igstPercent: Prisma.Decimal;
};

export type PricedLineResult = {
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  lineDiscount: Prisma.Decimal;
  taxable: Prisma.Decimal;
  cgstAmount: Prisma.Decimal;
  sgstAmount: Prisma.Decimal;
  igstAmount: Prisma.Decimal;
  lineTax: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
};

export type PricedDocument = {
  lines: PricedLineResult[];
  subtotal: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  taxableAmount: Prisma.Decimal;
  cgstAmount: Prisma.Decimal;
  sgstAmount: Prisma.Decimal;
  igstAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  transportAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
};

function allocatePercent(
  bases: Prisma.Decimal[],
  discountPercent: Prisma.Decimal
): Prisma.Decimal[] {
  const subtotal = bases.reduce((sum, value) => sum.plus(value), d(0));
  if (subtotal.lte(0) || discountPercent.lte(0)) {
    return bases.map(() => d(0));
  }

  const discountAmt = subtotal.mul(discountPercent).div(100);
  let allocated = d(0);

  return bases.map((base, index) => {
    const isLast = index === bases.length - 1;
    let share: Prisma.Decimal;
    if (isLast) {
      share = money(discountAmt.minus(allocated));
    } else {
      share = money(discountAmt.mul(base).div(subtotal));
      allocated = allocated.plus(share);
    }
    if (share.lt(0)) return d(0);
    if (share.gt(base)) return money(base);
    return share;
  });
}

export function priceQuotation(args: {
  lines: PricedLineInput[];
  discountPercent: Prisma.Decimal;
  transportAmount: Prisma.Decimal;
  /** Defaults to true so omitted callers keep charging GST. */
  includeGst?: boolean;
}): PricedDocument {
  if (args.lines.length === 0) {
    throw new Error("Quotation must contain at least one line.");
  }
  if (args.transportAmount.lt(0)) {
    throw new Error("Transport amount cannot be negative.");
  }
  if (args.discountPercent.lt(0) || args.discountPercent.gt(100)) {
    throw new Error("Discount percent must be between 0 and 100.");
  }

  const grosses = args.lines.map((line) => {
    if (line.quantity.lte(0)) {
      throw new Error("Quantity must be greater than zero.");
    }
    if (line.unitPrice.lt(0)) {
      throw new Error("Unit price cannot be negative.");
    }
    return line.quantity.mul(line.unitPrice);
  });

  const explicit = args.lines.map((line, index) => {
    if (line.lineDiscount.lt(0)) {
      throw new Error("Line discount cannot be negative.");
    }
    if (line.lineDiscount.gt(grosses[index])) {
      throw new Error("Line discount cannot exceed the line amount.");
    }
    return money(line.lineDiscount);
  });

  const bases = grosses.map((gross, index) => gross.minus(explicit[index]));
  const allocated = allocatePercent(bases, args.discountPercent);
  const includeGst = args.includeGst !== false;

  let cgstSum = d(0);
  let sgstSum = d(0);
  let igstSum = d(0);
  let taxSum = d(0);
  let discountSum = d(0);
  let grossSum = d(0);

  const lines: PricedLineResult[] = args.lines.map((line, index) => {
    const lineDiscount = money(explicit[index].plus(allocated[index]));
    const lineGross = grosses[index];
    if (lineDiscount.gt(lineGross)) {
      throw new Error("Line discount cannot exceed the line amount.");
    }
    const taxableRaw = lineGross.minus(lineDiscount);
    const cgstAmount = includeGst ? money(taxableRaw.mul(line.cgstPercent).div(100)) : d(0);
    const sgstAmount = includeGst ? money(taxableRaw.mul(line.sgstPercent).div(100)) : d(0);
    const igstAmount = includeGst ? money(taxableRaw.mul(line.igstPercent).div(100)) : d(0);
    const lineTax = cgstAmount.plus(sgstAmount).plus(igstAmount);
    const lineTotal = money(taxableRaw.plus(lineTax));

    cgstSum = cgstSum.plus(cgstAmount);
    sgstSum = sgstSum.plus(sgstAmount);
    igstSum = igstSum.plus(igstAmount);
    taxSum = taxSum.plus(lineTax);
    discountSum = discountSum.plus(lineDiscount);
    grossSum = grossSum.plus(lineGross);

    return {
      quantity: qty(line.quantity),
      unitPrice: price4(line.unitPrice),
      lineDiscount,
      taxable: money(taxableRaw),
      cgstAmount,
      sgstAmount,
      igstAmount,
      lineTax,
      lineTotal,
    };
  });

  const subtotal = money(grossSum);
  const discountAmount = money(discountSum);
  const taxableAmount = money(subtotal.minus(discountAmount));
  const transportAmount = money(args.transportAmount);
  const taxAmount = money(taxSum);
  const totalAmount = money(
    subtotal.minus(discountAmount).plus(taxAmount).plus(transportAmount)
  );

  return {
    lines,
    subtotal,
    discountAmount,
    taxableAmount,
    cgstAmount: money(cgstSum),
    sgstAmount: money(sgstSum),
    igstAmount: money(igstSum),
    taxAmount,
    transportAmount,
    totalAmount,
  };
}
