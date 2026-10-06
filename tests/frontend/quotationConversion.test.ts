import { describe, it, expect } from "vitest";
import type { QuotationDetail, QuotationLineDetail } from "../../frontend/src/api/types";
import type { UiProduct } from "../../frontend/src/lib/mapProduct";
import {
  buildConversionCart,
  cartLineKey,
  stockShortfalls,
} from "../../frontend/src/lib/quotationConversion";

function product(over: Partial<UiProduct> = {}): UiProduct {
  return {
    id: "p1",
    name: "Hammer",
    sku: "HAM-1",
    brandCode: null,
    color: null,
    size: null,
    category: "Tools",
    price: 120,
    avgCost: 60,
    stock: 50,
    unit: "Piece",
    lowStock: 10,
    baseUnitId: "u-pc",
    allowsFractionalSale: false,
    cgstPercent: 9,
    sgstPercent: 9,
    igstPercent: 0,
    hsnCode: null,
    ...over,
  };
}

function line(over: Partial<QuotationLineDetail> = {}): QuotationLineDetail {
  return {
    id: "ql1",
    productId: "p1",
    productUnitId: "u-pc",
    quantity: "10.0000",
    quantityInBase: "10.0000",
    unitPrice: "100.0000",
    lineDiscount: "100.00",
    lineTax: "162.00",
    lineTotal: "1062.00",
    productName: "Hammer",
    sku: "HAM-1",
    description: null,
    hsnCode: "8205",
    unitCode: "pc",
    unitDisplayName: "Piece",
    cgstPercent: "9",
    sgstPercent: "9",
    igstPercent: "0",
    currentSellingPrice: "120.0000",
    currentStock: "50.0000",
    units: [
      {
        id: "u-pc",
        code: "pc",
        displayName: "Piece",
        isBaseUnit: true,
        conversionToBase: "1",
        allowsFractionalSale: false,
      },
      {
        id: "u-box",
        code: "box",
        displayName: "Box",
        isBaseUnit: false,
        conversionToBase: "12",
        allowsFractionalSale: false,
      },
    ],
    ...over,
  };
}

function quotation(lines: QuotationLineDetail[]): QuotationDetail {
  return { id: "q1", lines } as unknown as QuotationDetail;
}

describe("buildConversionCart", () => {
  it("uses the quoted price, quantity, discount and tax, not the current catalog price", () => {
    const { lines, skipped } = buildConversionCart(quotation([line()]), [product()]);
    expect(skipped).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0].price).toBe(100); // the catalog now says 120
    expect(lines[0].qty).toBe(10);
    expect(lines[0].baseUnitId).toBe("u-pc");
    expect(lines[0].hsnCode).toBe("8205");
    expect(lines[0].quote).toEqual({
      lineId: "ql1",
      quotedQty: 10,
      quotedDiscount: 100,
      quotedTax: 162,
    });
  });

  it("keeps a non-base unit: price per box, stock counted in boxes", () => {
    const boxLine = line({
      productUnitId: "u-box",
      unitPrice: "1200.0000",
      quantity: "2.0000",
      currentStock: "50.0000",
    });
    const { lines } = buildConversionCart(quotation([boxLine]), [product({ avgCost: 60 })]);
    expect(lines[0].unit).toBe("Box");
    expect(lines[0].baseUnitId).toBe("u-box");
    expect(lines[0].price).toBe(1200);
    expect(lines[0].stock).toBeCloseTo(50 / 12, 6);
    expect(lines[0].avgCost).toBe(720); // 60 per piece x 12
  });

  it("skips lines whose product or unit is gone and reports them", () => {
    const { lines, skipped } = buildConversionCart(
      quotation([
        line({ id: "ql1" }),
        line({ id: "ql2", productId: "gone", productName: "Old item" }),
        line({ id: "ql3", productUnitId: "missing-unit", productName: "Odd unit" }),
      ]),
      [product()]
    );
    expect(lines.map((l) => l.quote?.lineId)).toEqual(["ql1"]);
    expect(skipped).toHaveLength(2);
    expect(skipped[0]).toMatch(/Old item/);
    expect(skipped[1]).toMatch(/Odd unit/);
  });

  it("gives two quotation lines for the same product different cart keys", () => {
    const { lines } = buildConversionCart(
      quotation([line({ id: "ql1" }), line({ id: "ql2" })]),
      [product()]
    );
    expect(lines).toHaveLength(2);
    expect(new Set(lines.map(cartLineKey)).size).toBe(2);
    expect(cartLineKey({ id: "p1" })).toBe("p1");
  });
});

describe("stockShortfalls", () => {
  it("lists every line that asks for more than is in stock", () => {
    const cart = buildConversionCart(
      quotation([
        line({ id: "ql1", quantity: "10.0000", currentStock: "3.0000", productName: "Hammer" }),
        line({
          id: "ql2",
          productId: "p2",
          quantity: "2.0000",
          currentStock: "9.0000",
          productName: "Nails",
        }),
      ]),
      [product(), product({ id: "p2", name: "Nails" })]
    ).lines;
    const short = stockShortfalls(cart);
    expect(short).toHaveLength(1);
    expect(short[0]).toBe("Hammer (need 10, have 3 Piece)");
  });
});
