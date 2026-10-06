/**
 * Converting an issued quotation into a sale.
 *
 * The pure rules (`assertConversionAllowed`) always run. The API tests create real
 * sales and stock movements, so they only run with `REGRESSION_WRITES=1`. They use
 * their own CONV-TEST-* products and remove everything they create.
 */
import { Prisma, ProductStatus, QuotationStatus, UnitKind } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";
import {
  assertConversionAllowed,
  conversionDocumentKind,
  type ConversionQuotation,
  type ConversionSaleLine,
} from "../../src/lib/quotationConversion";

const D = Prisma.Decimal;

function quote(over: Partial<ConversionQuotation> = {}): ConversionQuotation {
  return {
    quotationNumber: "QUO-2026-0001",
    status: QuotationStatus.ISSUED,
    convertedSaleId: null,
    includeGst: true,
    lines: [
      {
        id: "ql1",
        productId: "p1",
        productUnitId: "u1",
        productName: "Hammer",
        quantity: new D(10),
        unitPrice: new D("100"),
        lineDiscount: new D("100.00"),
      },
      {
        id: "ql2",
        productId: "p2",
        productUnitId: "u2",
        productName: "Nails",
        quantity: new D(2),
        unitPrice: new D("50"),
        lineDiscount: new D("0"),
      },
    ],
    ...over,
  };
}

function saleLine(over: Partial<ConversionSaleLine> = {}): ConversionSaleLine {
  return {
    quotationLineId: "ql1",
    productId: "p1",
    productUnitId: "u1",
    quantity: new D(10),
    unitPrice: new D("100"),
    lineDiscount: new D("100.00"),
    lineTax: new D("162.00"),
    ...over,
  };
}

describe("assertConversionAllowed (pure rules)", () => {
  it("maps GST on/off to tax invoice / bill", () => {
    expect(conversionDocumentKind(true)).toBe("tax_invoice");
    expect(conversionDocumentKind(false)).toBe("bill");
  });

  it("accepts the full quotation and a partial one", () => {
    expect(() =>
      assertConversionAllowed(quote(), "tax_invoice", [
        saleLine(),
        saleLine({
          quotationLineId: "ql2",
          productId: "p2",
          productUnitId: "u2",
          quantity: new D(2),
          unitPrice: new D("50"),
          lineDiscount: new D(0),
          lineTax: new D("18"),
        }),
      ])
    ).not.toThrow();

    // 4 of 10 with the discount pro-rated: 100 × 4 / 10 = 40
    expect(() =>
      assertConversionAllowed(quote(), "tax_invoice", [
        saleLine({ quantity: new D(4), lineDiscount: new D("40.00") }),
      ])
    ).not.toThrow();
  });

  it("rejects a quotation that is a draft, cancelled, or already converted", () => {
    expect(() =>
      assertConversionAllowed(quote({ status: QuotationStatus.DRAFT }), "tax_invoice", [saleLine()])
    ).toThrow(/draft/i);
    expect(() =>
      assertConversionAllowed(quote({ status: QuotationStatus.CANCELLED }), "tax_invoice", [saleLine()])
    ).toThrow(/cancelled/i);
    expect(() =>
      assertConversionAllowed(quote({ convertedSaleId: "s1" }), "tax_invoice", [saleLine()])
    ).toThrow(/already been converted/i);
  });

  it("requires a tax invoice for a GST quotation and a bill for a no-GST one", () => {
    expect(() => assertConversionAllowed(quote(), "bill", [saleLine()])).toThrow(/tax invoice/i);
    const noGst = quote({ includeGst: false });
    expect(() =>
      assertConversionAllowed(noGst, "tax_invoice", [saleLine({ lineTax: new D(0) })])
    ).toThrow(/bill/i);
    expect(() =>
      assertConversionAllowed(noGst, "bill", [saleLine({ lineTax: new D(0) })])
    ).not.toThrow();
    expect(() => assertConversionAllowed(noGst, "bill", [saleLine()])).toThrow(/cannot carry GST/i);
  });

  it("keeps the quoted price, unit, product and a quantity ceiling", () => {
    expect(() =>
      assertConversionAllowed(quote(), "tax_invoice", [saleLine({ unitPrice: new D("99") })])
    ).toThrow(/quoted price/i);
    expect(() =>
      assertConversionAllowed(quote(), "tax_invoice", [saleLine({ quantity: new D(11) })])
    ).toThrow(/cannot be increased/i);
    expect(() =>
      assertConversionAllowed(quote(), "tax_invoice", [saleLine({ productUnitId: "other" })])
    ).toThrow(/quoted unit/i);
    expect(() =>
      assertConversionAllowed(quote(), "tax_invoice", [saleLine({ productId: "other" })])
    ).toThrow(/quoted product/i);
  });

  it("caps the discount at the quoted share for the quantity sold", () => {
    expect(() =>
      assertConversionAllowed(quote(), "tax_invoice", [
        saleLine({ quantity: new D(4), lineDiscount: new D("40.02") }),
      ])
    ).toThrow(/quoted discount/i);
    // one paisa of rounding slack is allowed
    expect(() =>
      assertConversionAllowed(quote(), "tax_invoice", [
        saleLine({ quantity: new D(3), lineDiscount: new D("30.01") }),
      ])
    ).not.toThrow();
  });

  it("rejects lines that are not from the quotation, duplicates, and empty conversions", () => {
    expect(() =>
      assertConversionAllowed(quote(), "tax_invoice", [saleLine({ quotationLineId: undefined })])
    ).toThrow(/must come from quotation/i);
    expect(() =>
      assertConversionAllowed(quote(), "tax_invoice", [saleLine({ quotationLineId: "nope" })])
    ).toThrow(/not part of quotation/i);
    expect(() =>
      assertConversionAllowed(quote(), "tax_invoice", [saleLine(), saleLine()])
    ).toThrow(/only be converted once/i);
    expect(() => assertConversionAllowed(quote(), "tax_invoice", [])).toThrow(/at least one/i);
  });
});

// ─── API tests (write sales + stock; opt in with REGRESSION_WRITES=1) ───────────────────

const runWrites = process.env.REGRESSION_WRITES === "1";
const NOTE = "regression-quotation-conversion";
const SKU_PREFIX = "CONV-TEST-";

describe.runIf(runWrites)("quotation → sale conversion API (REGRESSION_WRITES=1)", () => {
  const app = buildApp();
  let adminToken = "";
  let adminId = "";
  let cashierToken = "";
  let cashierId = "";

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const round2 = (n: number) => Math.round(n * 100) / 100;

  function phone(): string {
    return `8${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, "0")}`;
  }

  async function login(username: string, password: string) {
    const res = await request(app).post("/api/login").send({ username, password });
    expect(res.status, res.body?.error).toBe(200);
    return { token: res.body.token as string, id: res.body.user.id as string };
  }

  async function makeProduct(tag: string, stock: number, price: number) {
    const sku = `${SKU_PREFIX}${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const product = await prisma.product.create({
      data: {
        sku,
        name: `Conv Test ${tag}`,
        status: ProductStatus.ACTIVE,
        baseUnitCode: "pc",
        unitKind: UnitKind.PIECE,
        allowsFractional: false,
        costPrice: "10",
        sellingPrice: String(price),
        cgstPercent: "9",
        sgstPercent: "9",
        igstPercent: "0",
        currentStock: String(stock),
        units: {
          create: {
            code: "pc",
            displayName: "Piece",
            isBaseUnit: true,
            conversionToBase: "1",
            allowsFractionalSale: false,
          },
        },
      },
      include: { units: true },
    });
    return { product, unit: product.units[0] };
  }

  async function stockOf(productId: string): Promise<number> {
    const p = await prisma.product.findUnique({
      where: { id: productId },
      select: { currentStock: true },
    });
    return Number(p?.currentStock ?? NaN);
  }

  type QuoteLineBody = { productId: string; productUnitId: string; quantity: number };

  async function issuedQuotation(args: {
    lines: QuoteLineBody[];
    includeGst?: boolean;
    discountPercent?: number;
    transportAmount?: number;
    issue?: boolean;
  }) {
    const created = await request(app)
      .post("/api/quotations")
      .set(auth(adminToken))
      .send({
        customerName: "Conv Test Customer",
        customerPhone: phone(),
        note: NOTE,
        includeGst: args.includeGst ?? true,
        discountPercent: args.discountPercent ?? 0,
        transportAmount: args.transportAmount ?? 0,
        lines: args.lines,
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    if (args.issue === false) return created.body;
    const issued = await request(app)
      .post(`/api/quotations/${created.body.id}/issue`)
      .set(auth(adminToken));
    expect(issued.status, JSON.stringify(issued.body)).toBe(200);
    return issued.body;
  }

  /** Sale lines that match the quotation exactly (full conversion). */
  function fullLines(q: {
    lines: Array<{
      id: string;
      productId: string;
      productUnitId: string | null;
      quantity: string;
      unitPrice: string;
      lineDiscount: string;
      lineTax: string;
    }>;
  }) {
    return q.lines.map((l) => ({
      quotationLineId: l.id,
      productId: l.productId,
      productUnitId: l.productUnitId as string,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      lineDiscount: Number(l.lineDiscount),
      lineTax: Number(l.lineTax),
    }));
  }

  function convert(
    q: { id: string; includeGst: boolean; transportAmount: string; totalAmount: string; lines: any[] },
    over: Record<string, unknown> = {},
    token = adminToken,
    userId = adminId
  ) {
    return request(app)
      .post("/api/sales")
      .set(auth(token))
      .send({
        createdById: userId,
        documentKind: q.includeGst ? "tax_invoice" : "bill",
        customerName: "Conv Test Customer",
        customerPhone: phone(),
        transportAmount: Number(q.transportAmount),
        paidAmount: Number(q.totalAmount),
        paymentMethod: "cash",
        quotationId: q.id,
        lines: fullLines(q),
        ...over,
      });
  }

  beforeAll(async () => {
    const admin = await login("admin", "admin123");
    adminToken = admin.token;
    adminId = admin.id;
    const cashier = await login("cashier", "cashier123");
    cashierToken = cashier.token;
    cashierId = cashier.id;
  });

  afterAll(async () => {
    const products = await prisma.product.findMany({
      where: { sku: { startsWith: SKU_PREFIX } },
      select: { id: true },
    });
    const productIds = products.map((p) => p.id);
    const sales = await prisma.sale.findMany({
      where: { lines: { some: { productId: { in: productIds } } } },
      select: { id: true },
    });
    const saleIds = sales.map((s) => s.id);
    await prisma.stockMovement.deleteMany({
      where: { OR: [{ productId: { in: productIds } }, { saleId: { in: saleIds } }] },
    });
    await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
    await prisma.quotation.deleteMany({ where: { note: NOTE } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  });

  it("converts a whole quotation at the quoted price and marks it converted", async () => {
    const a = await makeProduct("A", 20, 100);
    const b = await makeProduct("B", 5, 50);
    const q = await issuedQuotation({
      discountPercent: 10,
      transportAmount: 40,
      lines: [
        { productId: a.product.id, productUnitId: a.unit.id, quantity: 10 },
        { productId: b.product.id, productUnitId: b.unit.id, quantity: 2 },
      ],
    });

    const res = await convert(q);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.saleNumber).toMatch(/^INV-/);
    expect(res.body.totalAmount).toBe(q.totalAmount);
    expect(res.body.balanceAmount).toBe("0.00");
    expect(String(res.body.note)).toContain(`Converted from ${q.quotationNumber}`);
    expect(res.body.lines).toHaveLength(2);
    expect(Number(res.body.lines[0].unitPrice)).toBe(100);

    expect(await stockOf(a.product.id)).toBe(10);
    expect(await stockOf(b.product.id)).toBe(3);

    const after = await request(app).get(`/api/quotations/${q.id}`).set(auth(adminToken));
    expect(after.body.status).toBe("CONVERTED");
    expect(after.body.convertedSaleId).toBe(res.body.id);
    expect(after.body.convertedSaleNumber).toBe(res.body.saleNumber);

    const converted = await request(app)
      .get("/api/quotations?status=CONVERTED&limit=100")
      .set(auth(adminToken));
    expect(
      converted.body.items.some((i: { id: string; convertedSaleNumber: string }) =>
        i.id === q.id && i.convertedSaleNumber === res.body.saleNumber
      )
    ).toBe(true);
    const issuedList = await request(app).get("/api/quotations?status=ISSUED&limit=100").set(auth(adminToken));
    expect(issuedList.body.items.some((i: { id: string }) => i.id === q.id)).toBe(false);

    // never re-convertible, never cancellable
    const again = await convert(q);
    expect(again.status).toBe(400);
    expect(String(again.body.error)).toMatch(/already been converted/i);
    expect(await stockOf(a.product.id)).toBe(10);
    const cancel = await request(app).post(`/api/quotations/${q.id}/cancel`).set(auth(adminToken));
    expect(cancel.status).toBe(400);
    expect(String(cancel.body.error)).toMatch(/converted/i);
  });

  it("supports a partial conversion and then closes the quotation", async () => {
    const a = await makeProduct("PA", 20, 100);
    const b = await makeProduct("PB", 5, 50);
    const q = await issuedQuotation({
      discountPercent: 10,
      transportAmount: 40,
      lines: [
        { productId: a.product.id, productUnitId: a.unit.id, quantity: 10 },
        { productId: b.product.id, productUnitId: b.unit.id, quantity: 2 },
      ],
    });
    const lineA = q.lines.find((l: { productId: string }) => l.productId === a.product.id);

    const qty = 4;
    const discount = round2((Number(lineA.lineDiscount) * qty) / Number(lineA.quantity));
    const tax = round2(((100 * qty - discount) * 18) / 100);
    const total = round2(100 * qty - discount + tax + 40);

    const res = await convert(q, {
      paidAmount: total,
      lines: [
        {
          quotationLineId: lineA.id,
          productId: a.product.id,
          productUnitId: a.unit.id,
          quantity: qty,
          unitPrice: 100,
          lineDiscount: discount,
          lineTax: tax,
        },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.totalAmount).toBe(total.toFixed(2));
    expect(res.body.lines).toHaveLength(1);
    expect(await stockOf(a.product.id)).toBe(16);
    expect(await stockOf(b.product.id)).toBe(5);

    const after = await request(app).get(`/api/quotations/${q.id}`).set(auth(adminToken));
    expect(after.body.status).toBe("CONVERTED");
    const again = await convert(q);
    expect(again.status).toBe(400);
  });

  it("converts a quotation without GST as a plain bill, never as a tax invoice", async () => {
    const a = await makeProduct("N", 20, 100);
    const q = await issuedQuotation({
      includeGst: false,
      lines: [{ productId: a.product.id, productUnitId: a.unit.id, quantity: 3 }],
    });
    expect(q.taxAmount).toBe("0.00");

    const wrong = await convert(q, { documentKind: "tax_invoice" });
    expect(wrong.status).toBe(400);
    expect(String(wrong.body.error)).toMatch(/bill/i);
    expect(await stockOf(a.product.id)).toBe(20);

    const ok = await convert(q);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.saleNumber).toMatch(/^BIL-/);
    expect(ok.body.totalAmount).toBe(q.totalAmount);
  });

  it("rejects price, quantity, document-type and discount tampering without changing anything", async () => {
    const a = await makeProduct("T", 20, 100);
    const q = await issuedQuotation({
      discountPercent: 10,
      lines: [{ productId: a.product.id, productUnitId: a.unit.id, quantity: 10 }],
    });
    const base = fullLines(q)[0];

    const cases: Array<[string, Record<string, unknown>, RegExp]> = [
      ["lower price", { lines: [{ ...base, unitPrice: 90 }] }, /quoted price/i],
      ["more quantity", { lines: [{ ...base, quantity: 11 }] }, /cannot be increased/i],
      ["bill instead of tax invoice", { documentKind: "bill" }, /tax invoice/i],
      ["extra discount", { lines: [{ ...base, lineDiscount: base.lineDiscount + 5 }] }, /quoted discount/i],
      ["line from nowhere", { lines: [{ ...base, quotationLineId: "does-not-exist" }] }, /not part of/i],
    ];
    for (const [label, over, message] of cases) {
      const res = await convert(q, over);
      expect(res.status, label).toBe(400);
      expect(String(res.body.error), label).toMatch(message);
    }

    const noLineId = await convert(q, { lines: [{ ...base, quotationLineId: undefined }] });
    expect(noLineId.status).toBe(422);

    expect(await stockOf(a.product.id)).toBe(20);
    const after = await request(app).get(`/api/quotations/${q.id}`).set(auth(adminToken));
    expect(after.body.status).toBe("ISSUED");
    expect(after.body.convertedSaleId).toBeNull();
  });

  it("refuses draft and cancelled quotations", async () => {
    const a = await makeProduct("DC", 20, 100);
    const lines = [{ productId: a.product.id, productUnitId: a.unit.id, quantity: 2 }];

    const draft = await issuedQuotation({ lines, issue: false });
    const draftRes = await convert(draft);
    expect(draftRes.status).toBe(400);
    expect(String(draftRes.body.error)).toMatch(/draft/i);

    const cancelled = await issuedQuotation({ lines });
    const cancel = await request(app).post(`/api/quotations/${cancelled.id}/cancel`).set(auth(adminToken));
    expect(cancel.status).toBe(200);
    const cancelledRes = await convert(cancelled);
    expect(cancelledRes.status).toBe(400);
    expect(String(cancelledRes.body.error)).toMatch(/cancelled/i);

    expect(await stockOf(a.product.id)).toBe(20);
  });

  it("is admin only", async () => {
    const a = await makeProduct("R", 20, 100);
    const q = await issuedQuotation({
      lines: [{ productId: a.product.id, productUnitId: a.unit.id, quantity: 2 }],
    });
    const res = await convert(q, {}, cashierToken, cashierId);
    expect(res.status).toBe(403);
    expect(await stockOf(a.product.id)).toBe(20);
    const after = await request(app).get(`/api/quotations/${q.id}`).set(auth(adminToken));
    expect(after.body.convertedSaleId).toBeNull();
  });

  it("blocks the conversion and names every item that is short on stock", async () => {
    const a = await makeProduct("S1", 3, 100);
    const b = await makeProduct("S2", 1, 50);
    const c = await makeProduct("S3", 50, 20);
    const q = await issuedQuotation({
      lines: [
        { productId: a.product.id, productUnitId: a.unit.id, quantity: 5 },
        { productId: b.product.id, productUnitId: b.unit.id, quantity: 2 },
        { productId: c.product.id, productUnitId: c.unit.id, quantity: 5 },
      ],
    });

    const res = await convert(q);
    expect(res.status).toBe(400);
    const message = String(res.body.error);
    expect(message).toMatch(/Insufficient stock/);
    expect(message).toContain("Conv Test S1");
    expect(message).toContain("Conv Test S2");
    expect(message).not.toContain("Conv Test S3");

    expect(await stockOf(a.product.id)).toBe(3);
    expect(await stockOf(b.product.id)).toBe(1);
    expect(await stockOf(c.product.id)).toBe(50);
    const after = await request(app).get(`/api/quotations/${q.id}`).set(auth(adminToken));
    expect(after.body.status).toBe("ISSUED");

    // dropping the short lines (partial conversion) works
    const lineC = q.lines.find((l: { productId: string }) => l.productId === c.product.id);
    const onlyC = {
      lines: [
        {
          quotationLineId: lineC.id,
          productId: c.product.id,
          productUnitId: c.unit.id,
          quantity: 5,
          unitPrice: Number(lineC.unitPrice),
          lineDiscount: Number(lineC.lineDiscount),
          lineTax: Number(lineC.lineTax),
        },
      ],
      paidAmount: round2(5 * 20 + Number(lineC.lineTax)),
    };
    const ok = await convert(q, onlyC);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(await stockOf(c.product.id)).toBe(45);
  });

  it("does not let a normal sale reference a quotation line", async () => {
    const a = await makeProduct("X", 20, 100);
    const res = await request(app)
      .post("/api/sales")
      .set(auth(adminToken))
      .send({
        createdById: adminId,
        documentKind: "bill",
        customerName: "Conv Test Customer",
        paidAmount: 100,
        lines: [
          {
            productId: a.product.id,
            productUnitId: a.unit.id,
            quantity: 1,
            unitPrice: 100,
            quotationLineId: "something",
          },
        ],
      });
    expect(res.status).toBe(422);
    expect(await stockOf(a.product.id)).toBe(20);
  });
});
