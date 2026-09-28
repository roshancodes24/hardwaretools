import { DateTime } from "luxon";
import { REPORT_ZONE } from "./reportPeriods";

/** Issued quotations stay valid through this many calendar days after the quotation date. */
export const QUOTATION_VALIDITY_DAYS = 2;

export function businessToday(now: DateTime = DateTime.now()): DateTime {
  return now.setZone(REPORT_ZONE).startOf("day");
}

/** UTC midnight Date for a calendar day, matching PostgreSQL `date` values. */
export function toPgDate(day: DateTime): Date {
  const d = day.setZone(REPORT_ZONE).startOf("day");
  return new Date(Date.UTC(d.year, d.month - 1, d.day));
}

export function quotationValidity(now: DateTime = DateTime.now()): {
  quotationDate: Date;
  validUntil: Date;
  year: number;
} {
  const today = businessToday(now);
  const until = today.plus({ days: QUOTATION_VALIDITY_DAYS });
  return {
    quotationDate: toPgDate(today),
    validUntil: toPgDate(until),
    year: today.year,
  };
}

export function isoDate(value: Date): string {
  const y = value.getUTCFullYear();
  const m = String(value.getUTCMonth() + 1).padStart(2, "0");
  const d = String(value.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Display format used on quotations and invoices: DD/MM/YYYY. */
export function formatQuotationDate(value: Date): string {
  const [y, m, d] = isoDate(value).split("-");
  return `${d}/${m}/${y}`;
}

export function parseIsoDate(raw: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const dt = DateTime.fromObject(
    { year, month, day },
    { zone: REPORT_ZONE }
  );
  if (!dt.isValid || dt.year !== year || dt.month !== month || dt.day !== day) {
    return null;
  }
  return toPgDate(dt);
}

/** Expired only after the valid-until calendar day (that day is still valid). */
export function isQuotationExpired(
  validUntil: Date,
  now: DateTime = DateTime.now()
): boolean {
  const today = businessToday(now);
  const until = DateTime.fromObject(
    {
      year: validUntil.getUTCFullYear(),
      month: validUntil.getUTCMonth() + 1,
      day: validUntil.getUTCDate(),
    },
    { zone: REPORT_ZONE }
  ).startOf("day");
  return today > until;
}
