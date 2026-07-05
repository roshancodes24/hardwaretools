import { parseMoneyField } from "./formatMoney";

export type SplitPaymentPart = {
  method: "cash" | "online_banking";
  amount: number;
};

export type SplitPaymentResult =
  | { ok: true; clampedPaid: number; initialPayments: SplitPaymentPart[] }
  | { ok: false; error: string };

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseNonNegativeAmount(raw: string): number | null {
  const parsed = parseMoneyField(raw);
  if (parsed == null || parsed < 0) return null;
  return roundMoney(Math.max(0, parsed));
}

/** Validate split cash + online amounts against a maximum total (sale or balance due). */
export function resolveSplitPayment(
  cashStr: string,
  onlineStr: string,
  maxTotal: number,
  exceedError = "Total received cannot exceed the sale total."
): SplitPaymentResult {
  const cashAmt = parseNonNegativeAmount(cashStr);
  const onlineAmt = parseNonNegativeAmount(onlineStr);
  if (cashAmt == null || onlineAmt == null) {
    return {
      ok: false,
      error: "Enter valid cash and online banking amounts (0 or more).",
    };
  }
  const totalReceived = roundMoney(cashAmt + onlineAmt);
  if (totalReceived <= 0) {
    return {
      ok: false,
      error: "Enter at least one payment amount (cash or online banking).",
    };
  }
  if (totalReceived > maxTotal + 0.005) {
    return { ok: false, error: exceedError };
  }
  const initialPayments: SplitPaymentPart[] = [];
  if (cashAmt > 0.005) initialPayments.push({ method: "cash", amount: cashAmt });
  if (onlineAmt > 0.005) {
    initialPayments.push({ method: "online_banking", amount: onlineAmt });
  }
  return { ok: true, clampedPaid: totalReceived, initialPayments };
}

/** Sum of valid non-negative split amounts (for UI hints). */
export function sumSplitPaymentStrings(cashStr: string, onlineStr: string): number | null {
  const cash = parseNonNegativeAmount(cashStr);
  const online = parseNonNegativeAmount(onlineStr);
  if (cash == null || online == null) return null;
  return roundMoney(cash + online);
}
