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

describe("computePosTotals with quotation lines", () => {
  const emptyMaps = {
    productPromotionPctById: new Map<string, number>(),
    categoryPromotionPctByName: new Map<string, number>(),
  };
  const gst = { cgstPercent: 9, sgstPercent: 9, igstPercent: 0 };

  // Quoted: 10 x 100 with a 10% order discount (100.00 on the line), GST 18% on 900 = 162.00, transport 40.
  const quoted = { quotedQty: 10, quotedDiscount: 100, quotedTax: 162 };

  it("keeps the quoted discount and tax for the full quantity", () => {
    const result = computePosTotals({
      cart: [{ id: "a", price: 100, qty: 10, category: "Tools", ...gst, quote: quoted }],
      discountPercent: 0,
      cartPromoPercent: 0,
      ...emptyMaps,
      posTaxInvoice: true,
      transportAmount: 40,
    });
    expect(result.subtotal).toBe(1000);
    expect(result.quoteDiscountAmt).toBe(100);
    expect(result.lineDiscountsForPos).toEqual([100]);
    expect(result.lineTaxesForPos).toEqual([162]);
    expect(result.total).toBe(900);
    expect(result.grandTotal).toBe(1102); // 900 + 162 + 40
  });

  it("pro-rates the discount and recomputes tax for a partial quantity", () => {
    const result = computePosTotals({
      cart: [{ id: "a", price: 100, qty: 4, category: "Tools", ...gst, quote: quoted }],
      discountPercent: 0,
      cartPromoPercent: 0,
      ...emptyMaps,
      posTaxInvoice: true,
      transportAmount: 0,
    });
    expect(result.lineDiscountsForPos).toEqual([40]); // 100 x 4 / 10
    expect(result.lineTaxesForPos).toEqual([64.8]); // (400 - 40) x 18%
    expect(result.grandTotal).toBe(424.8);
  });

  it("charges no tax on a quotation saved without GST and ignores promotions on quoted lines", () => {
    const result = computePosTotals({
      cart: [
        {
          id: "a",
          price: 100,
          qty: 10,
          category: "Tools",
          ...gst,
          quote: { quotedQty: 10, quotedDiscount: 0, quotedTax: 0 },
        },
      ],
      discountPercent: 0,
      cartPromoPercent: 0,
      productPromotionPctById: new Map([["a", 50]]),
      categoryPromotionPctByName: new Map(),
      posTaxInvoice: false,
      transportAmount: 0,
    });
    expect(result.linePromotionDiscounts).toEqual([0]);
    expect(result.lineTaxesForPos).toEqual([0]);
    expect(result.grandTotal).toBe(1000);
  });

  it("leaves ordinary lines as before: allocated discount and paise-rounded tax per line", () => {
    const cart = [
      { id: "a", price: 33.33, qty: 3, category: "Tools", ...gst },
      { id: "b", price: 10.1, qty: 3, category: "Tools", ...gst },
    ];
    const result = computePosTotals({
      cart,
      discountPercent: 7,
      cartPromoPercent: 0,
      ...emptyMaps,
      posTaxInvoice: true,
      transportAmount: 0,
    });
    expect(result.quoteDiscountAmt).toBe(0);
    result.lineTaxesForPos.forEach((tax, i) => {
      const taxable = cart[i].price * cart[i].qty - result.lineDiscountsForPos[i];
      expect(tax).toBe(Math.round(((taxable * 18) / 100) * 100) / 100);
    });
    expect(result.posLineTaxSum).toBe(
      Math.round(result.lineTaxesForPos.reduce((s, x) => s + x, 0) * 100) / 100
    );
  });
});
