/** India Standard Time (IST) — matches backend report and chart bucketing. */
export const INDIA_TIMEZONE = "Asia/Kolkata";

/** YYYY-MM-DD for the given instant in IST (for `<input type="date">` defaults). */
export function ymdInIndia(date: Date = new Date()): string {
  return date.toLocaleDateString("en-CA", { timeZone: INDIA_TIMEZONE });
}

/** First calendar day of the month containing `date`, in IST, as YYYY-MM-DD. */
export function firstDayOfMonthYmdIndia(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: INDIA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  return `${y}-${m}-01`;
}

export function formatIndiaDateTime(
  isoOrDate: string | Date,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
  }
): string {
  const d =
    typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) {
    return typeof isoOrDate === "string" ? isoOrDate : "—";
  }
  return d.toLocaleString("en-IN", {
    ...options,
    timeZone: INDIA_TIMEZONE,
  });
}

export function formatIndiaDateLong(date: Date = new Date()): string {
  return date.toLocaleDateString("en-IN", {
    dateStyle: "long",
    timeZone: INDIA_TIMEZONE,
  });
}
