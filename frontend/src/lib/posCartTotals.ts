import { allocateLineDiscounts } from "./allocateLineDiscounts";

export type PosCartLineInput = {
  id: string;
  price: number;
  qty: number;
  category: string;
  cgstPercent?: number;
  sgstPercent?: number;
  igstPercent?: number;
};

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
  const total = subtotalAfterLinePromos - discountAmt - cartPromoAmt;

  const orderLevelDiscountAmt = discountAmt + cartPromoAmt;
  const orderLevelDiscountPercent =
    subtotalAfterLinePromos > 0
      ? (orderLevelDiscountAmt / subtotalAfterLinePromos) * 100
      : 0;
  const orderLevelLineDiscounts = allocateLineDiscounts(
    lineSubtotals.map((v, i) => Math.max(0, v - linePromotionDiscounts[i])),
    orderLevelDiscountPercent
  );
  const lineDiscountsForPos = linePromotionDiscounts.map(
    (v, i) => v + (orderLevelLineDiscounts[i] ?? 0)
  );

  let posLineTaxSum = 0;
  if (posTaxInvoice && cart.length > 0) {
    for (let i = 0; i < cart.length; i++) {
      const line = cart[i];
      const disc = lineDiscountsForPos[i] ?? 0;
      const taxable = Math.max(0, line.price * line.qty - disc);
      const rateSum =
        (line.cgstPercent ?? 0) +
        (line.sgstPercent ?? 0) +
        (line.igstPercent ?? 0);
      const lineTaxRaw = rateSum > 0 ? (taxable * rateSum) / 100 : 0;
      posLineTaxSum += Math.round(lineTaxRaw * 100) / 100;
    }
    posLineTaxSum = Math.round(posLineTaxSum * 100) / 100;
  }

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
    posLineTaxSum,
    grandTotal,
  };
}
