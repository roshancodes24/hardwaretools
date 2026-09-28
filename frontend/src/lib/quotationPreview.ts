function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type PreviewLine = {
  quantity: number;
  unitPrice: number;
  lineDiscount: number;
  cgstPercent: number;
  sgstPercent: number;
  igstPercent: number;
};

export type PreviewResult = {
  lineDiscounts: number[];
  lineTaxes: number[];
  lineTotals: number[];
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  taxAmount: number;
  transportAmount: number;
  totalAmount: number;
};

/** Screen preview of the server quotation pricer (paise rounding, last-line remainder). */
export function previewQuotationTotals(args: {
  lines: PreviewLine[];
  discountPercent: number;
  transportAmount: number;
  /** Defaults to true so a missing flag still previews GST. */
  includeGst?: boolean;
}): PreviewResult {
  const grosses = args.lines.map((line) => line.quantity * line.unitPrice);
  const explicit = args.lines.map((line, index) => {
    const requested = round2(Math.max(0, line.lineDiscount));
    return Math.min(requested, Math.max(0, grosses[index]));
  });
  const bases = grosses.map((gross, index) => Math.max(0, gross - explicit[index]));
  const baseSum = bases.reduce((sum, value) => sum + value, 0);
  const percent = Math.min(100, Math.max(0, args.discountPercent));
  let allocatedRunning = 0;
  const allocated =
    baseSum <= 0 || percent <= 0
      ? bases.map(() => 0)
      : bases.map((base, index) => {
          const isLast = index === bases.length - 1;
          let share = isLast
            ? round2(baseSum * (percent / 100) - allocatedRunning)
            : round2((baseSum * (percent / 100) * base) / baseSum);
          if (!isLast) allocatedRunning += share;
          if (share < 0) share = 0;
          if (share > base) share = round2(base);
          return share;
        });

  const includeGst = args.includeGst !== false;
  let cgstAmount = 0;
  let sgstAmount = 0;
  let igstAmount = 0;
  const lineDiscounts: number[] = [];
  const lineTaxes: number[] = [];
  const lineTotals: number[] = [];
  let grossSum = 0;

  args.lines.forEach((line, index) => {
    const lineDiscount = round2(explicit[index] + allocated[index]);
    const taxable = Math.max(0, grosses[index] - lineDiscount);
    const cgst = includeGst ? round2((taxable * line.cgstPercent) / 100) : 0;
    const sgst = includeGst ? round2((taxable * line.sgstPercent) / 100) : 0;
    const igst = includeGst ? round2((taxable * line.igstPercent) / 100) : 0;
    const lineTax = round2(cgst + sgst + igst);
    cgstAmount += cgst;
    sgstAmount += sgst;
    igstAmount += igst;
    grossSum += grosses[index];
    lineDiscounts.push(lineDiscount);
    lineTaxes.push(lineTax);
    lineTotals.push(round2(taxable + lineTax));
  });

  const subtotal = round2(grossSum);
  const discountAmount = round2(lineDiscounts.reduce((sum, value) => sum + value, 0));
  const taxableAmount = round2(subtotal - discountAmount);
  const taxAmount = round2(cgstAmount + sgstAmount + igstAmount);
  const transportAmount = round2(Math.max(0, args.transportAmount));
  return {
    lineDiscounts,
    lineTaxes,
    lineTotals,
    subtotal,
    discountAmount,
    taxableAmount,
    cgstAmount: round2(cgstAmount),
    sgstAmount: round2(sgstAmount),
    igstAmount: round2(igstAmount),
    taxAmount,
    transportAmount,
    totalAmount: round2(taxableAmount + taxAmount + transportAmount),
  };
}
