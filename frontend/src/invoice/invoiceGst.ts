import type { SaleLineDetail } from "../api/types";

export function lineTaxableBase(line: SaleLineDetail): number {
  const qty = Number.parseFloat(line.quantity);
  const unit = Number.parseFloat(line.unitPrice);
  const disc = Number.parseFloat(line.lineDiscount);
  if (!Number.isFinite(qty) || !Number.isFinite(unit) || !Number.isFinite(disc)) {
    return 0;
  }
  return Math.max(0, qty * unit - disc);
}

export function parseGstPercent(s: string | null | undefined): number {
  if (s == null || s === "") return 0;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export type LineGstBreakdown = {
  taxable: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  cgstAmt: number;
  sgstAmt: number;
  igstAmt: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** GST amounts = taxable value × each rate from the product (same as POS). No allocation from lineTax. */
export function lineGstBreakdown(line: SaleLineDetail): LineGstBreakdown {
  const taxable = lineTaxableBase(line);
  const cgstRate = parseGstPercent(line.cgstPercent);
  const sgstRate = parseGstPercent(line.sgstPercent);
  const igstRate = parseGstPercent(line.igstPercent);
  const cgstAmt = round2((taxable * cgstRate) / 100);
  const sgstAmt = round2((taxable * sgstRate) / 100);
  const igstAmt = round2((taxable * igstRate) / 100);

  return {
    taxable,
    cgstRate,
    sgstRate,
    igstRate,
    cgstAmt,
    sgstAmt,
    igstAmt,
  };
}

export function saleGstTotals(lines: SaleLineDetail[]): {
  cgst: number;
  sgst: number;
  igst: number;
  sum: number;
} {
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  for (const line of lines) {
    const b = lineGstBreakdown(line);
    cgst += b.cgstAmt;
    sgst += b.sgstAmt;
    igst += b.igstAmt;
  }
  return {
    cgst: round2(cgst),
    sgst: round2(sgst),
    igst: round2(igst),
    sum: round2(cgst + sgst + igst),
  };
}
