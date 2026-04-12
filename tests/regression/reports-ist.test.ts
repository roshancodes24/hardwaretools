import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { parseReportRange } from "../../src/services/reports";

/**
 * Guards IST semantics for report filters (must stay aligned with product copy).
 */
describe("Regression: report ranges (IST calendar days)", () => {
  it("inclusive single day: start before end, same IST date", () => {
    const { start, end } = parseReportRange("2026-08-15", "2026-08-15");
    expect(end.getTime()).toBeGreaterThan(start.getTime());
    const s = DateTime.fromJSDate(start, { zone: "utc" }).setZone("Asia/Kolkata");
    const e = DateTime.fromJSDate(end, { zone: "utc" }).setZone("Asia/Kolkata");
    expect(s.toISODate()).toBe("2026-08-15");
    expect(e.toISODate()).toBe("2026-08-15");
  });

  it("rejects from > to", () => {
    expect(() => parseReportRange("2026-02-10", "2026-02-01")).toThrow(
      /on or before/
    );
  });
});
