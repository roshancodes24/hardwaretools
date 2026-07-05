import { describe, it, expect } from "vitest";
import { allocateLineDiscounts } from "../../frontend/src/lib/allocateLineDiscounts";

describe("allocateLineDiscounts", () => {
  it("returns zeros when discount is zero", () => {
    expect(allocateLineDiscounts([100, 200], 0)).toEqual([0, 0]);
  });

  it("splits discount proportionally with remainder on last line", () => {
    const shares = allocateLineDiscounts([100, 100, 100], 10);
    expect(shares.reduce((s, x) => s + x, 0)).toBeCloseTo(30, 2);
    expect(shares[0]).toBeCloseTo(10, 2);
    expect(shares[1]).toBeCloseTo(10, 2);
    expect(shares[2]).toBeCloseTo(10, 2);
  });
});
