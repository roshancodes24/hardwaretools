import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import {
  formatQuotationDate,
  isQuotationExpired,
  isoDate,
  quotationValidity,
} from "../../src/lib/quotationDates";
import { d, priceQuotation } from "../../src/lib/quotationTotals";

describe("quotation dates", () => {
  it("uses the India calendar date and a 2-day validity", () => {
    const eveningUtc = DateTime.fromISO("2026-09-26T20:00:00Z");
    const dates = quotationValidity(eveningUtc);
    expect(isoDate(dates.quotationDate)).toBe("2026-09-27");
    expect(isoDate(dates.validUntil)).toBe("2026-09-29");
    expect(formatQuotationDate(dates.quotationDate)).toBe("27/09/2026");
    expect(formatQuotationDate(dates.validUntil)).toBe("29/09/2026");
    expect(dates.year).toBe(2026);

    const onValidUntil = DateTime.fromISO("2026-09-29T18:00:00", {
      zone: "Asia/Kolkata",
    });
    const dayAfter = DateTime.fromISO("2026-09-30T00:30:00", {
      zone: "Asia/Kolkata",
    });
    expect(isQuotationExpired(dates.validUntil, onValidUntil)).toBe(false);
    expect(isQuotationExpired(dates.validUntil, dayAfter)).toBe(true);
  });
});

describe("quotation totals", () => {
  it("matches tax-invoice discount allocation and GST rounding", () => {
    const priced = priceQuotation({
      lines: [
        {
          quantity: d(10),
          unitPrice: d("300"),
          lineDiscount: d(0),
          cgstPercent: d(9),
          sgstPercent: d(9),
          igstPercent: d(0),
        },
      ],
      discountPercent: d(10),
      transportAmount: d(0),
    });

    const lineSub = 300 * 10;
    const discountAmt = Math.round(lineSub * 0.1 * 100) / 100;
    const taxable = lineSub - discountAmt;
    const cgst = Math.round(((taxable * 9) / 100) * 100) / 100;
    const sgst = Math.round(((taxable * 9) / 100) * 100) / 100;
    const total = Math.round((lineSub - discountAmt + cgst + sgst) * 100) / 100;

    expect(priced.discountAmount.toFixed(2)).toBe(discountAmt.toFixed(2));
    expect(priced.cgstAmount.toFixed(2)).toBe(cgst.toFixed(2));
    expect(priced.sgstAmount.toFixed(2)).toBe(sgst.toFixed(2));
    expect(priced.igstAmount.toFixed(2)).toBe("0.00");
    expect(priced.taxableAmount.toFixed(2)).toBe(taxable.toFixed(2));
    expect(priced.totalAmount.toFixed(2)).toBe(total.toFixed(2));
    expect(priced.totalAmount.toFixed(2)).toBe("3186.00");
  });

  it("splits an order discount across lines with the remainder on the last line", () => {
    const priced = priceQuotation({
      lines: [
        {
          quantity: d(1),
          unitPrice: d(100),
          lineDiscount: d(0),
          cgstPercent: d(0),
          sgstPercent: d(0),
          igstPercent: d(0),
        },
        {
          quantity: d(1),
          unitPrice: d(200),
          lineDiscount: d(0),
          cgstPercent: d(0),
          sgstPercent: d(0),
          igstPercent: d(0),
        },
      ],
      discountPercent: d(10),
      transportAmount: d("15.50"),
    });
    expect(priced.lines[0].lineDiscount.toFixed(2)).toBe("10.00");
    expect(priced.lines[1].lineDiscount.toFixed(2)).toBe("20.00");
    expect(priced.discountAmount.toFixed(2)).toBe("30.00");
    expect(priced.totalAmount.toFixed(2)).toBe("285.50");
  });

  it("keeps 10.10 × 3 exact instead of a binary floating-point residue", () => {
    const priced = priceQuotation({
      lines: [
        {
          quantity: d(3),
          unitPrice: d("10.10"),
          lineDiscount: d(0),
          cgstPercent: d(9),
          sgstPercent: d(9),
          igstPercent: d(0),
        },
      ],
      discountPercent: d(0),
      transportAmount: d(0),
    });
    expect(priced.subtotal.toFixed(2)).toBe("30.30");
    expect(priced.cgstAmount.toFixed(2)).toBe("2.73");
    expect(priced.sgstAmount.toFixed(2)).toBe("2.73");
    expect(priced.lines[0].lineTax.toFixed(2)).toBe("5.46");
    expect(priced.totalAmount.toFixed(2)).toBe("35.76");
    expect(priced.subtotal.toString()).not.toContain("000000");
  });

  it("zeros tax when GST is excluded and still charges it when included", () => {
    const lines = [
      {
        quantity: d(3),
        unitPrice: d("10.10"),
        lineDiscount: d(0),
        cgstPercent: d(9),
        sgstPercent: d(9),
        igstPercent: d(0),
      },
    ];
    const shared = {
      lines,
      discountPercent: d(10),
      transportAmount: d("15.50"),
    };

    const excluded = priceQuotation({ ...shared, includeGst: false });
    expect(excluded.subtotal.toFixed(2)).toBe("30.30");
    expect(excluded.discountAmount.toFixed(2)).toBe("3.03");
    expect(excluded.taxableAmount.toFixed(2)).toBe("27.27");
    expect(excluded.cgstAmount.toFixed(2)).toBe("0.00");
    expect(excluded.sgstAmount.toFixed(2)).toBe("0.00");
    expect(excluded.igstAmount.toFixed(2)).toBe("0.00");
    expect(excluded.taxAmount.toFixed(2)).toBe("0.00");
    expect(excluded.lines[0].lineTax.toFixed(2)).toBe("0.00");
    expect(excluded.transportAmount.toFixed(2)).toBe("15.50");
    expect(excluded.totalAmount.toFixed(2)).toBe("42.77");
    expect(excluded.totalAmount.toFixed(2)).toBe(
      excluded.subtotal.minus(excluded.discountAmount).plus(excluded.transportAmount).toFixed(2)
    );

    const included = priceQuotation({ ...shared, includeGst: true });
    expect(included.cgstAmount.toFixed(2)).toBe("2.45");
    expect(included.sgstAmount.toFixed(2)).toBe("2.45");
    expect(included.igstAmount.toFixed(2)).toBe("0.00");
    expect(included.taxAmount.toFixed(2)).toBe("4.90");
    expect(included.totalAmount.toFixed(2)).toBe("47.67");

    const omitted = priceQuotation(shared);
    expect(omitted.cgstAmount.toFixed(2)).toBe(included.cgstAmount.toFixed(2));
    expect(omitted.totalAmount.toFixed(2)).toBe(included.totalAmount.toFixed(2));
  });
});
