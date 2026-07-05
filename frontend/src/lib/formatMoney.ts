/** Indian Rupee display (2dp). */
export function fmt(n: number): string {
  return `₹${Number(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Parse a money field from user input; returns null when invalid. */
export function parseMoneyField(raw: string): number | null {
  const n = Number.parseFloat(String(raw).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}
