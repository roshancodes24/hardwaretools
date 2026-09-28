import { ScheduledReportType } from "@prisma/client";
import { DateTime } from "luxon";
import { REPORT_ZONE } from "./reportPeriods";

/** Gap between each report type when multiple are due the same window. */
export const REPORT_STAGGER_MINUTES = 30;

/** Stable run order — first type runs earliest each day. */
export const REPORT_RUN_ORDER: readonly ScheduledReportType[] = [
  ScheduledReportType.SALES,
  ScheduledReportType.INVENTORY,
  ScheduledReportType.SUPPLIER_OUTSTANDING,
  ScheduledReportType.CUSTOMER_OUTSTANDING,
] as const;

const DEFAULT_CRON = "0,30 6-8 * * *";

/** First hour from REPORT_CRON_IST (e.g. "0,30 6-8 * * *" → 6). */
export function parseReportCronBaseHour(
  expression = process.env.REPORT_CRON_IST ?? DEFAULT_CRON
): number {
  const parts = expression.trim().split(/\s+/);
  if (parts.length >= 2) {
    const hourPart = parts[1] ?? "6";
    const match = /^(\d+)/.exec(hourPart);
    if (match) {
      const h = Number.parseInt(match[1], 10);
      if (Number.isFinite(h)) return h;
    }
  }
  return 6;
}

export function defaultReportCronExpression(): string {
  return DEFAULT_CRON;
}

/** IST moment when this report type may start (base hour + index × 30 min). */
export function reportSlotStart(
  reportType: ScheduledReportType,
  reference: DateTime,
  baseHour = parseReportCronBaseHour()
): DateTime {
  const index = REPORT_RUN_ORDER.indexOf(reportType);
  if (index < 0) {
    throw new Error(`Unknown report type for scheduling slot: ${reportType}`);
  }
  return reference
    .setZone(REPORT_ZONE)
    .startOf("day")
    .plus({ hours: baseHour, minutes: index * REPORT_STAGGER_MINUTES });
}

/** Human label for admin UI, e.g. "06:00 IST". */
export function reportSlotTimeLabel(
  reportType: ScheduledReportType,
  baseHour = parseReportCronBaseHour()
): string {
  const index = REPORT_RUN_ORDER.indexOf(reportType);
  const totalMinutes = baseHour * 60 + index * REPORT_STAGGER_MINUTES;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} IST`;
}

/** True once the staggered slot for this type has been reached today. */
export function isReportSlotReached(
  reportType: ScheduledReportType,
  reference: DateTime,
  baseHour = parseReportCronBaseHour()
): boolean {
  const ref = reference.setZone(REPORT_ZONE);
  if (ref.hour < baseHour) return false;
  return ref >= reportSlotStart(reportType, ref, baseHour);
}
