/**
 * Split an order-level discount across lines proportionally (2dp).
 * Remainder goes to the last line so totals stay consistent.
 */
export function allocateLineDiscounts(
  lineSubtotals: number[],
  discountPercent: number
): number[] {
  const subtotal = lineSubtotals.reduce((s, x) => s + x, 0);
  if (subtotal <= 0 || discountPercent <= 0) {
    return lineSubtotals.map(() => 0);
  }

  const discountAmt = subtotal * (discountPercent / 100);
  let allocated = 0;

  return lineSubtotals.map((lineSub, i) => {
    const isLast = i === lineSubtotals.length - 1;
    if (isLast) {
      return Math.round((discountAmt - allocated) * 100) / 100;
    }
    const share =
      Math.round((discountAmt * (lineSub / subtotal)) * 100) / 100;
    allocated += share;
    return share;
  });
}
