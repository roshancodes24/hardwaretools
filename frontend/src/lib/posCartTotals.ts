import { allocateLineDiscounts } from "./allocateLineDiscounts";

/** What a quotation line carried, so a converted line keeps its quoted discount and tax. */
export type PosQuoteLine = {
  quotedQty: number;
  /** Total discount quoted for the full quantity. */
  quotedDiscount: number;
  /** Total GST quoted for the full quantity. */
  quotedTax: number;
};

export type PosCartLineInput = {
  id: string;
  price: number;
  qty: number;
  category: string;
  cgstPercent?: number;
  sgstPercent?: number;
  igstPercent?: number;
  /** Present only when converting a quotation (price is already the quoted price). */
  quote?: PosQuoteLine;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Quoted discount for `qty` units: exact for the full quoted quantity, pro-rated for fewer. */
export function quotedLineDiscount(quote: PosQuoteLine, qty: number): number {
  if (qty >= quote.quotedQty) return quote.quotedDiscount;
  return round2((quote.quotedDiscount * qty) / quote.quotedQty);
}

export type ComputePosTotalsArgs = {
  cart: PosCartLineInput[];
  discountPercent: number;
  cartPromoPercent: number;
  productPromotionPctById: ReadonlyMap<string, number>;
  categoryPromotionPctByName: ReadonlyMap<string, number>;
  posTaxInvoice: boolean;
  transportAmount: number;
};

export type PosTotalsResult = {
  lineSubtotals: number[];
  linePromotionDiscounts: number[];
  subtotal: number;
  productCategoryPromoAmt: number;
  subtotalAfterLinePromos: number;
  discountAmt: number;
  cartPromoAmt: number;
  total: number;
  lineDiscountsForPos: number[];
  /** Discount carried from quotation lines (0 when not converting a quotation). */
  quoteDiscountAmt: number;
  /** GST per line (paise-rounded); 0 on a plain bill. Quoted tax is kept as-is for the full quoted quantity. */
  lineTaxesForPos: number[];
  posLineTaxSum: number;
  grandTotal: number;
};

/** POS cart totals — mirrors checkout math in App POSView. */
export function computePosTotals(args: ComputePosTotalsArgs): PosTotalsResult {
  const {
    cart,
    discountPercent,
    cartPromoPercent,
    productPromotionPctById,
    categoryPromotionPctByName,
    posTaxInvoice,
    transportAmount,
  } = args;

  const lineSubtotals = cart.map((x) => x.price * x.qty);
  const linePromotionDiscounts = cart.map((line) => {
    if (line.quote) return 0;
    const productPct = productPromotionPctById.get(line.id) ?? 0;
    const categoryPct = categoryPromotionPctByName.get(line.category) ?? 0;
    const pct = Math.max(productPct, categoryPct);
    return (line.price * line.qty * pct) / 100;
  });
  const subtotal = lineSubtotals.reduce((s, x) => s + x, 0);
  const productCategoryPromoAmt = linePromotionDiscounts.reduce((s, x) => s + x, 0);
  const subtotalAfterLinePromos = subtotal - productCategoryPromoAmt;
  const discountAmt = subtotal * (discountPercent / 100);
  const cartPromoAmt = subtotalAfterLinePromos * (cartPromoPercent / 100);
  const quoteLineDiscounts = cart.map((line) =>
    line.quote ? quotedLineDiscount(line.quote, line.qty) : 0
  );
  const quoteDiscountAmt = quoteLineDiscounts.reduce((s, x) => s + x, 0);
  const total =
    subtotalAfterLinePromos - discountAmt - cartPromoAmt - quoteDiscountAmt;

  const orderLevelDiscountAmt = discountAmt + cartPromoAmt;
  const orderLevelDiscountPercent =
    subtotalAfterLinePromos > 0
      ? (orderLevelDiscountAmt / subtotalAfterLinePromos) * 100
      : 0;
  const orderLevelLineDiscounts = allocateLineDiscounts(
    lineSubtotals.map((v, i) =>
      cart[i].quote ? 0 : Math.max(0, v - linePromotionDiscounts[i])
    ),
    orderLevelDiscountPercent
  );
  const lineDiscountsForPos = linePromotionDiscounts.map(
    (v, i) => v + (orderLevelLineDiscounts[i] ?? 0) + quoteLineDiscounts[i]
  );

  const lineTaxesForPos = cart.map((line, i) => {
    if (!posTaxInvoice) return 0;
    if (line.quote && line.qty >= line.quote.quotedQty) {
      return line.quote.quotedTax;
    }
    const taxable = Math.max(
      0,
      line.price * line.qty - (lineDiscountsForPos[i] ?? 0)
    );
    const rateSum =
      (line.cgstPercent ?? 0) +
      (line.sgstPercent ?? 0) +
      (line.igstPercent ?? 0);
    return rateSum > 0 ? round2((taxable * rateSum) / 100) : 0;
  });
  const posLineTaxSum = posTaxInvoice
    ? round2(lineTaxesForPos.reduce((s, x) => s + x, 0))
    : 0;

  const base =
    !posTaxInvoice || cart.length === 0
      ? total
      : Math.round((total + posLineTaxSum) * 100) / 100;
  const grandTotal = Math.round((base + transportAmount) * 100) / 100;

  return {
    lineSubtotals,
    linePromotionDiscounts,
    subtotal,
    productCategoryPromoAmt,
    subtotalAfterLinePromos,
    discountAmt,
    cartPromoAmt,
    total,
    lineDiscountsForPos,
    quoteDiscountAmt,
    lineTaxesForPos,
    posLineTaxSum,
    grandTotal,
  };
}
