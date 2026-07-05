import { describe, it, expect } from "vitest";
import {
  resolveSplitPayment,
  sumSplitPaymentStrings,
} from "../../frontend/src/lib/splitPayment";

describe("resolveSplitPayment", () => {
  it("accepts valid cash + online under the cap", () => {
    const result = resolveSplitPayment("100", "50.25", 200);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.clampedPaid).toBe(150.25);
    expect(result.initialPayments).toEqual([
      { method: "cash", amount: 100 },
      { method: "online_banking", amount: 50.25 },
    ]);
  });

  it("rejects when total exceeds max", () => {
    const result = resolveSplitPayment("150", "60", 200);
    expect(result).toEqual({
      ok: false,
      error: "Total received cannot exceed the sale total.",
    });
  });

  it("uses custom exceed message for outstanding balances", () => {
    const result = resolveSplitPayment("300", "0", 250, "Total received cannot exceed balance due.");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("Total received cannot exceed balance due.");
  });

  it("rejects invalid amounts", () => {
    expect(resolveSplitPayment("", "10", 100).ok).toBe(false);
    expect(resolveSplitPayment("-1", "10", 100).ok).toBe(false);
  });

  it("rejects zero total received", () => {
    const result = resolveSplitPayment("0", "0", 100);
    expect(result.ok).toBe(false);
  });
});

describe("sumSplitPaymentStrings", () => {
  it("sums parsed amounts", () => {
    expect(sumSplitPaymentStrings("10.5", "20")).toBe(30.5);
  });

  it("returns null for invalid input", () => {
    expect(sumSplitPaymentStrings("abc", "10")).toBeNull();
  });
});
