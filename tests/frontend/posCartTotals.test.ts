import { describe, it, expect } from "vitest";
import { computePosTotals } from "../../frontend/src/lib/posCartTotals";

describe("computePosTotals", () => {
  const emptyMaps = {
    productPromotionPctById: new Map<string, number>(),
    categoryPromotionPctByName: new Map<string, number>(),
  };

  it("computes net total without tax or transport", () => {
    const result = computePosTotals({
      cart: [
        { id: "a", price: 100, qty: 2, category: "Tools" },
        { id: "b", price: 50, qty: 1, category: "Paint" },
      ],
      discountPercent: 10,
      cartPromoPercent: 0,
      ...emptyMaps,
      posTaxInvoice: false,
      transportAmount: 0,
    });
    expect(result.subtotal).toBe(250);
    expect(result.discountAmt).toBe(25);
    expect(result.total).toBe(225);
    expect(result.grandTotal).toBe(225);
  });

  it("applies line promotions before order discount", () => {
    const result = computePosTotals({
      cart: [{ id: "a", price: 200, qty: 1, category: "Tools" }],
      discountPercent: 0,
      cartPromoPercent: 0,
      productPromotionPctById: new Map([["a", 10]]),
      categoryPromotionPctByName: new Map(),
      posTaxInvoice: false,
      transportAmount: 0,
    });
    expect(result.linePromotionDiscounts[0]).toBe(20);
    expect(result.subtotalAfterLinePromos).toBe(180);
    expect(result.total).toBe(180);
  });

  it("includes per-line GST and transport in grand total", () => {
    const result = computePosTotals({
      cart: [{ id: "a", price: 100, qty: 1, category: "X", cgstPercent: 9, sgstPercent: 9 }],
      discountPercent: 0,
      cartPromoPercent: 0,
      ...emptyMaps,
      posTaxInvoice: true,
      transportAmount: 50,
    });
    expect(result.posLineTaxSum).toBe(18);
    expect(result.grandTotal).toBe(168);
  });
});
