import type { FieldDetail } from "../api/errors";

/** Per-line errors from paths like `lines.0.quantity` */
export function lineErrorsFromDetails(
  details: FieldDetail[] | undefined
): Map<number, Record<string, string>> {
  const m = new Map<number, Record<string, string>>();
  const re = /^lines\.(\d+)\.(\w+)$/;
  for (const d of details ?? []) {
    const match = re.exec(d.field);
    if (!match) continue;
    const idx = Number(match[1]);
    const prop = match[2];
    if (!m.has(idx)) m.set(idx, {});
    const row = m.get(idx)!;
    if (!row[prop]) row[prop] = d.message;
  }
  return m;
}

/** Top-level / non-line field errors (first message per field path) */
export function recordFieldErrors(
  details: FieldDetail[] | undefined
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of details ?? []) {
    if (/^lines\.\d+\./.test(d.field)) continue;
    if (!out[d.field]) out[d.field] = d.message;
  }
  return out;
}

export function mapPurchaseDetailField(apiField: string): string {
  const m = /^lines\.0\.(\w+)$/.exec(apiField);
  if (m) {
    if (m[1] === "productUnitId") return "productId";
    return m[1];
  }
  return apiField;
}

export function mapAdjustmentDetailField(apiField: string): string {
  if (apiField === "quantityAfter") return "quantity";
  return apiField;
}
