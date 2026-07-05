import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  catalogPricingFromPurchaseLine,
  computePurchasePricingUpdate,
  sellingPriceFromCostAndPercent,
  unitCostToBaseUnitCost,
  weightedAverageCost,
} from "../../src/lib/productPricing";

const D = (v: string) => new Prisma.Decimal(v);

describe("productPricing", () => {
  it("computes selling price from cost and percentage", () => {
    expect(sellingPriceFromCostAndPercent(100, 10)).toBe(110);
    expect(sellingPriceFromCostAndPercent(200, 10)).toBe(220);
  });

  it("converts pack unit cost to base unit cost", () => {
    expect(unitCostToBaseUnitCost("200", "10").toFixed(4)).toBe("20.0000");
    expect(unitCostToBaseUnitCost("100", "1").toFixed(4)).toBe("100.0000");
  });

  it("updates catalog pricing from a purchase line", () => {
    const pricing = catalogPricingFromPurchaseLine({
      unitCost: new Prisma.Decimal("200"),
      conversionToBase: new Prisma.Decimal("1"),
      percentage: new Prisma.Decimal("10"),
    });
    expect(pricing.costPrice.toFixed(4)).toBe("200.0000");
    expect(pricing.sellingPrice?.toString()).toBe("220");
  });

  it("updates cost only when product has no percentage markup", () => {
    const pricing = catalogPricingFromPurchaseLine({
      unitCost: new Prisma.Decimal("200"),
      conversionToBase: new Prisma.Decimal("1"),
      percentage: null,
    });
    expect(pricing.costPrice.toFixed(4)).toBe("200.0000");
    expect(pricing.sellingPrice).toBeUndefined();
  });
});

describe("weightedAverageCost", () => {
  it("blends old and new stock costs", () => {
    // 100 @ 498 + 100 @ 300 → 399
    const avg = weightedAverageCost({
      currentStockBase: "100",
      currentAvgCost: "498",
      receivedQtyBase: "100",
      receivedUnitBaseCost: "300",
    });
    expect(avg.toFixed(2)).toBe("399.00");
  });

  it("uses received cost when there is no prior stock", () => {
    const avg = weightedAverageCost({
      currentStockBase: "0",
      currentAvgCost: null,
      receivedQtyBase: "50",
      receivedUnitBaseCost: "250",
    });
    expect(avg.toFixed(2)).toBe("250.00");
  });
});

describe("computePurchasePricingUpdate", () => {
  const commonNoMrp = {
    conversionToBase: D("1"),
    percentage: D("10"),
    mrp: null,
  };

  it("raises selling price (rounded to rupee) when cost goes up", () => {
    const r = computePurchasePricingUpdate({
      ...commonNoMrp,
      currentStockBase: D("100"),
      receivedQtyBase: D("100"),
      unitCost: D("200"),
      currentAvgCost: D("100"),
      currentCostPrice: D("100"),
      currentSellingPrice: D("110"),
    });
    expect(r.costPrice.toFixed(2)).toBe("200.00");
    expect(r.avgCostPrice.toFixed(2)).toBe("150.00"); // (100*100 + 100*200)/200
    expect(r.sellingPrice?.toString()).toBe("220");
    expect(r.priceReviewNeeded).toBe(false);
  });

  it("keeps selling price but flags review with a suggestion when cost drops", () => {
    const r = computePurchasePricingUpdate({
      ...commonNoMrp,
      currentStockBase: D("100"),
      receivedQtyBase: D("100"),
      unitCost: D("300"),
      currentAvgCost: D("498"),
      currentCostPrice: D("498"),
      currentSellingPrice: D("547.80"),
    });
    expect(r.costPrice.toFixed(2)).toBe("300.00");
    expect(r.avgCostPrice.toFixed(2)).toBe("399.00");
    expect(r.sellingPrice).toBeNull(); // unchanged
    expect(r.priceReviewNeeded).toBe(true);
    expect(r.suggestedSellingPrice?.toString()).toBe("330"); // 300 + 10%, rounded
    expect(r.priceReviewNote).toContain("suggested");
  });

  it("caps an auto-raised selling price at MRP and flags review", () => {
    const r = computePurchasePricingUpdate({
      currentStockBase: D("10"),
      receivedQtyBase: D("10"),
      unitCost: D("500"),
      conversionToBase: D("1"),
      currentAvgCost: D("100"),
      currentCostPrice: D("100"),
      currentSellingPrice: D("110"),
      percentage: D("10"), // → 550 candidate
      mrp: D("520"),
    });
    expect(r.sellingPrice?.toString()).toBe("520"); // capped at MRP
    expect(r.priceReviewNeeded).toBe(true);
    expect(r.priceReviewNote).toContain("MRP");
  });

  it("updates costs only when the product has no markup percentage", () => {
    const r = computePurchasePricingUpdate({
      currentStockBase: D("10"),
      receivedQtyBase: D("10"),
      unitCost: D("300"),
      conversionToBase: D("1"),
      currentAvgCost: D("100"),
      currentCostPrice: D("100"),
      currentSellingPrice: D("110"),
      percentage: null,
      mrp: null,
    });
    expect(r.costPrice.toFixed(2)).toBe("300.00");
    expect(r.sellingPrice).toBeNull();
    expect(r.priceReviewNeeded).toBe(false);
  });
});
