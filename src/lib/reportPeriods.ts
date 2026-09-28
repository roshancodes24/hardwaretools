import { ReportPeriod } from "@prisma/client";
import { DateTime } from "luxon";

/** India Standard Time — matches scheduled reports and live reporting. */
export const REPORT_ZONE = "Asia/Kolkata";

/** Indian financial year quarters: Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, Q4 Jan–Mar. */
export type IndianFYQuarter = 1 | 2 | 3 | 4;

export type PeriodBounds = {
  periodStart: Date;
  periodEnd: Date;
  label: string;
};

export function nowIndia(): DateTime {
  return DateTime.now().setZone(REPORT_ZONE);
}

/** Start of the Indian FY quarter containing `dt` (00:00 IST). */
export function startOfIndianFYQuarter(dt: DateTime): DateTime {
  const d = dt.setZone(REPORT_ZONE).startOf("day");
  const { month, year } = d;
  if (month >= 4 && month <= 6) {
    return DateTime.fromObject({ year, month: 4, day: 1 }, { zone: REPORT_ZONE });
  }
  if (month >= 7 && month <= 9) {
    return DateTime.fromObject({ year, month: 7, day: 1 }, { zone: REPORT_ZONE });
  }
  if (month >= 10 && month <= 12) {
    return DateTime.fromObject({ year, month: 10, day: 1 }, { zone: REPORT_ZONE });
  }
  return DateTime.fromObject({ year, month: 1, day: 1 }, { zone: REPORT_ZONE });
}

/** Indian FY quarter number (1–4) and label e.g. "Q1 FY 2026-27". */
export function indianFYQuarterLabel(quarterStart: DateTime): {
  quarter: IndianFYQuarter;
  label: string;
} {
  const start = quarterStart.setZone(REPORT_ZONE).startOf("day");
  const month = start.month;
  let quarter: IndianFYQuarter;
  let fyStartYear: number;

  switch (month) {
    case 4:
      quarter = 1;
      fyStartYear = start.year;
      break;
    case 7:
      quarter = 2;
      fyStartYear = start.year;
      break;
    case 10:
      quarter = 3;
      fyStartYear = start.year;
      break;
    case 1:
      quarter = 4;
      fyStartYear = start.year - 1;
      break;
    default:
      throw new Error(
        `Invalid Indian FY quarter start month: ${month} (expected 1, 4, 7, or 10).`
      );
  }

  const fyEndSuffix = String(fyStartYear + 1).slice(-2);
  return {
    quarter,
    label: `Q${quarter} FY ${fyStartYear}-${fyEndSuffix}`,
  };
}

/** Previous calendar / Indian FY period relative to `reference` (06:00 IST job). */
export function computePreviousPeriodBounds(
  period: ReportPeriod,
  reference: DateTime = nowIndia()
): PeriodBounds {
  const ref = reference.setZone(REPORT_ZONE);

  switch (period) {
    case ReportPeriod.DAILY: {
      const day = ref.minus({ days: 1 });
      return {
        periodStart: day.startOf("day").toJSDate(),
        periodEnd: day.endOf("day").toJSDate(),
        label: day.toFormat("d MMMM yyyy"),
      };
    }
    case ReportPeriod.MONTHLY: {
      const prev = ref.minus({ months: 1 });
      return {
        periodStart: prev.startOf("month").toJSDate(),
        periodEnd: prev.endOf("month").toJSDate(),
        label: prev.toFormat("MMMM yyyy"),
      };
    }
    case ReportPeriod.QUARTERLY: {
      const currentQuarterStart = startOfIndianFYQuarter(ref);
      const prevQuarterEnd = currentQuarterStart.minus({ days: 1 });
      const start = startOfIndianFYQuarter(prevQuarterEnd);
      const { label } = indianFYQuarterLabel(start);
      return {
        periodStart: start.toJSDate(),
        periodEnd: prevQuarterEnd.endOf("day").toJSDate(),
        label,
      };
    }
    case ReportPeriod.YEARLY: {
      const prev = ref.minus({ years: 1 });
      return {
        periodStart: prev.startOf("year").toJSDate(),
        periodEnd: prev.endOf("year").toJSDate(),
        label: prev.toFormat("yyyy"),
      };
    }
    default: {
      const _exhaustive: never = period;
      throw new Error(`Unknown period: ${_exhaustive}`);
    }
  }
}

/**
 * Whether the scheduler may generate a report for this frequency at `reference`.
 * Quarterly uses Indian FY: runs on 1 Apr, 1 Jul, 1 Oct, 1 Jan (after 06:00 IST).
 */
export function isSchedulerWindowOpen(
  period: ReportPeriod,
  reference: DateTime = nowIndia()
): boolean {
  const ref = reference.setZone(REPORT_ZONE);
  if (ref.hour < 6) return false;

  switch (period) {
    case ReportPeriod.DAILY:
      return true;
    case ReportPeriod.MONTHLY:
      return true;
    case ReportPeriod.QUARTERLY:
      // Indian FY quarter ends in Mar, Jun, Sep, Dec — catch-up all of the following month.
      return [1, 4, 7, 10].includes(ref.month);
    case ReportPeriod.YEARLY:
      return ref.month === 1;
    default: {
      const _exhaustive: never = period;
      return _exhaustive;
    }
  }
}

export function reportTypeLabel(type: string): string {
  switch (type) {
    case "SALES":
      return "Sales report";
    case "INVENTORY":
      return "Inventory report";
    case "SUPPLIER_OUTSTANDING":
      return "Supplier outstanding";
    case "CUSTOMER_OUTSTANDING":
      return "Customer outstanding";
    default:
      return type;
  }
}

export function reportPeriodLabel(period: ReportPeriod): string {
  switch (period) {
    case ReportPeriod.DAILY:
      return "Daily";
    case ReportPeriod.MONTHLY:
      return "Monthly";
    case ReportPeriod.QUARTERLY:
      return "Quarterly (Indian FY)";
    case ReportPeriod.YEARLY:
      return "Yearly";
    default: {
      const _exhaustive: never = period;
      return String(_exhaustive);
    }
  }
}
