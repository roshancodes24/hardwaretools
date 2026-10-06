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

export function lineDiscountPercent(line: SaleLineDetail): number {
  const qty = Number.parseFloat(line.quantity);
  const unit = Number.parseFloat(line.unitPrice);
  const disc = Number.parseFloat(line.lineDiscount);
  if (!Number.isFinite(qty) || !Number.isFinite(unit) || !Number.isFinite(disc)) {
    return 0;
  }
  const gross = qty * unit;
  if (gross <= 0) return 0;
  return round2((disc / gross) * 100);
}

/** Unit price after line discount, before GST (the "Price" column). */
export function lineNetUnitPrice(line: SaleLineDetail): number {
  const qty = Number.parseFloat(line.quantity);
  const unit = Number.parseFloat(line.unitPrice);
  if (!Number.isFinite(qty) || qty <= 0) return Number.isFinite(unit) ? unit : 0;
  return round2(lineTaxableBase(line) / qty);
}

export type HsnTaxRow = {
  hsn: string;
  /** cgst + sgst + igst rates, e.g. 18 */
  ratePct: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
};

/** Per-HSN, per-rate tax summary (bottom table of a GST invoice). */
export function hsnTaxSummary(lines: SaleLineDetail[]): HsnTaxRow[] {
  const map = new Map<string, HsnTaxRow>();
  for (const line of lines) {
    const b = lineGstBreakdown(line);
    const hsn = line.productHsnCode?.trim() ?? "";
    const ratePct = round2(b.cgstRate + b.sgstRate + b.igstRate);
    const key = `${hsn}|${ratePct}`;
    const row =
      map.get(key) ??
      { hsn, ratePct, taxable: 0, cgst: 0, sgst: 0, igst: 0, totalTax: 0 };
    row.taxable += b.taxable;
    row.cgst += b.cgstAmt;
    row.sgst += b.sgstAmt;
    row.igst += b.igstAmt;
    map.set(key, row);
  }
  return [...map.values()]
    .map((r) => ({
      ...r,
      taxable: round2(r.taxable),
      cgst: round2(r.cgst),
      sgst: round2(r.sgst),
      igst: round2(r.igst),
      totalTax: round2(r.cgst + r.sgst + r.igst),
    }))
    .sort((a, b) => a.hsn.localeCompare(b.hsn) || a.ratePct - b.ratePct);
}

/** Sum of taxable values across all lines. */
export function saleTaxableTotal(lines: SaleLineDetail[]): number {
  return round2(lines.reduce((s, l) => s + lineTaxableBase(l), 0));
}

/** Returns the shared rate if every line uses it, otherwise null (mixed rates). */
export function commonRate(rates: number[]): number | null {
  if (rates.length === 0) return null;
  return rates.every((r) => r === rates[0]) ? rates[0] : null;
}
