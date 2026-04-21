/** GSTIN-style: strip anything that is not A–Z or 0–9, then cap length. */
export function sanitizeGstinInput(value: string, maxLen: number): string {
  return value.replace(/[^A-Za-z0-9]/g, "").slice(0, maxLen);
}

/** For comparing stored vs pasted GST (ignore spaces/special chars, case-insensitive). */
export function normalizeGstinForMatch(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}
