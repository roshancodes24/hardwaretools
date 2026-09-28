/** Matches backend REPORT_RUN_ORDER / 30 min stagger (06:00 IST base). */
const REPORT_RUN_ORDER = [
  "SALES",
  "INVENTORY",
  "SUPPLIER_OUTSTANDING",
  "CUSTOMER_OUTSTANDING",
] as const;

const STAGGER_MINUTES = 30;
const BASE_HOUR = 6;

export function reportSlotTimeLabel(reportType: string): string {
  const index = REPORT_RUN_ORDER.indexOf(
    reportType as (typeof REPORT_RUN_ORDER)[number]
  );
  if (index < 0) return "";
  const totalMinutes = BASE_HOUR * 60 + index * STAGGER_MINUTES;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} IST`;
}

export const REPORT_STAGGER_NOTE =
  "When several reports share the same frequency, they run 30 minutes apart starting at 06:00 IST (Sales → Inventory → Supplier → Customer).";
