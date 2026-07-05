import { Prisma } from "@prisma/client";

const D = Prisma.Decimal;

/** Selling = cost + (cost × percentage / 100), rounded to 2 decimal places (paise). */
export function sellingPriceFromCostAndPercent(cost: number, pct: number): number {
  const raw = cost + (cost * pct) / 100;
  return Math.round(raw * 100) / 100;
}

/** Auto-computed selling prices are rounded to the nearest whole rupee. */
export function roundToNearestRupee(n: number): number {
  return Math.round(n);
}

function toNumber(v: Prisma.Decimal | string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v.toString());
  return Number.isFinite(n) ? n : null;
}

/**
 * Moving weighted-average cost after receiving stock.
 * newAvg = (stockOnHand × oldAvg + receivedQty × receivedUnitCost) / (stockOnHand + receivedQty)
 * If there was no stock (or no prior average), the received cost becomes the average.
 */
export function weightedAverageCost(input: {
  currentStockBase: Prisma.Decimal | string | number;
  currentAvgCost: Prisma.Decimal | string | number | null | undefined;
  receivedQtyBase: Prisma.Decimal | string | number;
  receivedUnitBaseCost: Prisma.Decimal | string | number;
}): Prisma.Decimal {
  const stock = new D(input.currentStockBase);
  const recvQty = new D(input.receivedQtyBase);
  const recvCost = new D(input.receivedUnitBaseCost);
  const prevAvgRaw = input.currentAvgCost;
  const prevAvg = prevAvgRaw != null ? new D(prevAvgRaw) : null;

  if (stock.lessThanOrEqualTo(0) || prevAvg == null) {
    return recvCost.toDecimalPlaces(4);
  }
  const totalQty = stock.plus(recvQty);
  if (totalQty.lessThanOrEqualTo(0)) {
    return recvCost.toDecimalPlaces(4);
  }
  const totalValue = stock.mul(prevAvg).plus(recvQty.mul(recvCost));
  return totalValue.div(totalQty).toDecimalPlaces(4);
}

/** Convert purchase-line unit cost to catalog cost per base unit. */
export function unitCostToBaseUnitCost(
  unitCost: Prisma.Decimal | string | number,
  conversionToBase: Prisma.Decimal | string | number
): Prisma.Decimal {
  const conv = new Prisma.Decimal(conversionToBase);
  if (!conv.greaterThan(0)) {
    throw new Error("Invalid unit conversion to base.");
  }
  return new Prisma.Decimal(unitCost).div(conv).toDecimalPlaces(4);
}

export function catalogPricingFromPurchaseLine(input: {
  unitCost: Prisma.Decimal | string | number;
  conversionToBase: Prisma.Decimal | string | number;
  percentage: Prisma.Decimal | null | undefined;
}): { costPrice: Prisma.Decimal; sellingPrice?: Prisma.Decimal } {
  const costPrice = unitCostToBaseUnitCost(input.unitCost, input.conversionToBase);
  const result: { costPrice: Prisma.Decimal; sellingPrice?: Prisma.Decimal } = {
    costPrice,
  };
  if (input.percentage != null) {
    const costNum = Number(costPrice.toString());
    const pctNum = Number(input.percentage.toString());
    if (Number.isFinite(costNum) && Number.isFinite(pctNum) && costNum >= 0 && pctNum >= 0) {
      result.sellingPrice = new Prisma.Decimal(
        sellingPriceFromCostAndPercent(costNum, pctNum)
      );
    }
  }
  return result;
}

export type PurchasePricingUpdate = {
  /** New last / replacement cost per base unit (drives the markup formula). */
  costPrice: Prisma.Decimal;
  /** New moving weighted-average cost per base unit (drives margin/valuation). */
  avgCostPrice: Prisma.Decimal;
  /** New selling price, or null to leave the current selling price unchanged. */
  sellingPrice: Prisma.Decimal | null;
  priceReviewNeeded: boolean;
  suggestedSellingPrice: Prisma.Decimal | null;
  priceReviewNote: string | null;
};

function money(n: number): string {
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Decide how a received purchase line updates a product's costs and selling price.
 *
 * Rules (agreed design for single-price-per-shelf retail):
 * - `costPrice` = latest purchase cost per base unit (replacement cost).
 * - `avgCostPrice` = moving weighted average of stock on hand (for margin truth).
 * - Selling price is **asymmetric**:
 *   - Cost rose → raise selling from markup %, rounded to nearest rupee, capped at MRP
 *     (flag for review if the markup would exceed MRP).
 *   - Cost fell → keep the current selling price, but flag for review with a suggested
 *     lower price so the owner can approve a markdown deliberately.
 */
export function computePurchasePricingUpdate(input: {
  currentStockBase: Prisma.Decimal | string | number;
  receivedQtyBase: Prisma.Decimal | string | number;
  unitCost: Prisma.Decimal | string | number;
  conversionToBase: Prisma.Decimal | string | number;
  currentAvgCost: Prisma.Decimal | null | undefined;
  currentCostPrice: Prisma.Decimal | null | undefined;
  currentSellingPrice: Prisma.Decimal | null | undefined;
  percentage: Prisma.Decimal | null | undefined;
  mrp: Prisma.Decimal | null | undefined;
}): PurchasePricingUpdate {
  const newCost = unitCostToBaseUnitCost(input.unitCost, input.conversionToBase);
  const avgCostPrice = weightedAverageCost({
    currentStockBase: input.currentStockBase,
    currentAvgCost: input.currentAvgCost ?? input.currentCostPrice ?? null,
    receivedQtyBase: input.receivedQtyBase,
    receivedUnitBaseCost: newCost,
  });

  const base: PurchasePricingUpdate = {
    costPrice: newCost,
    avgCostPrice,
    sellingPrice: null,
    priceReviewNeeded: false,
    suggestedSellingPrice: null,
    priceReviewNote: null,
  };

  const pct = toNumber(input.percentage);
  const costNum = toNumber(newCost);
  // No markup rule (or invalid cost) → update costs only, leave selling untouched.
  if (pct == null || costNum == null || pct < 0 || costNum < 0) {
    return base;
  }

  const candidateRaw = sellingPriceFromCostAndPercent(costNum, pct);
  const candidate = roundToNearestRupee(candidateRaw);
  const mrp = toNumber(input.mrp);
  const currentSelling = toNumber(input.currentSellingPrice);

  // No existing selling price yet: adopt the candidate (capped at MRP if set).
  if (currentSelling == null) {
    if (mrp != null && candidate > mrp) {
      return {
        ...base,
        sellingPrice: new D(mrp),
        priceReviewNeeded: true,
        priceReviewNote: `Markup price ₹${money(candidate)} exceeds MRP ₹${money(
          mrp
        )}; capped at MRP.`,
      };
    }
    return { ...base, sellingPrice: new D(candidate) };
  }

  // Cost rose (or markup now yields a higher price) → raise selling.
  if (candidate > currentSelling) {
    if (mrp != null && candidate > mrp) {
      // Cap at MRP; only actually change if MRP differs from current selling.
      const sellingChange = mrp !== currentSelling ? new D(mrp) : null;
      return {
        ...base,
        sellingPrice: sellingChange,
        priceReviewNeeded: true,
        priceReviewNote: `Markup price ₹${money(candidate)} exceeds MRP ₹${money(
          mrp
        )}; capped at MRP ₹${money(mrp)}.`,
      };
    }
    return { ...base, sellingPrice: new D(candidate) };
  }

  // Cost fell → keep current selling price, flag a suggested markdown for review.
  if (candidate < currentSelling) {
    return {
      ...base,
      sellingPrice: null,
      priceReviewNeeded: true,
      suggestedSellingPrice: new D(candidate),
      priceReviewNote: `Cost dropped to ₹${money(
        costNum
      )}. Current selling ₹${money(currentSelling)}; suggested ₹${money(
        candidate
      )}.`,
    };
  }

  // candidate === currentSelling → nothing to change.
  return base;
}
