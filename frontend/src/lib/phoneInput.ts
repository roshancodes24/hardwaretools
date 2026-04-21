/** Indian mobile: digits only, max 10 (for controlled inputs). */
export function sanitizePhoneDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, 10);
}
