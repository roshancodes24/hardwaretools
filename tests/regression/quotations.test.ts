/**
 * Quotation API. Requires the seeded database (admin / cashier) and the
 * quotations migration. Creates rows tagged note=regression-quotation and
 * removes them afterwards.
 */
import { ProductStatus, UnitKind } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";

const app = buildApp();
const NOTE = "regression-quotation";

let adminToken = "";
let cashierToken = "";

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function login(username: string, password: string): Promise<string> {
  const res = await request(app).post("/api/login").send({ username, password });
  expect(res.status, res.body?.error).toBe(200);
  return res.body.token as string;
}

function testPhone(): string {
  const n = Math.floor(Math.random() * 1_000_000_000);
  return `8${String(n).padStart(9, "0")}`;
}

/** PDFKit writes WinAnsi text as hex with kerning gaps. Join those runs. */
function pdfPlainText(bytes: Buffer): string {
  const raw = bytes.toString("latin1");
  const chunks: string[] = [];
  for (const match of raw.matchAll(/<([0-9A-Fa-f]+)>/g)) {
    const hex = match[1];
    if (hex.length < 2 || hex.length % 2 !== 0) continue;
    let text = "";
    for (let i = 0; i < hex.length; i += 2) {
      text += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
    }
    chunks.push(text);
  }
  return chunks.join("");
}

beforeAll(async () => {
  adminToken = await login("admin", "admin123");
  cashierToken = await login("cashier", "cashier123");
});

afterAll(async () => {
  await prisma.quotation.deleteMany({ where: { note: NOTE } });
  await prisma.product.deleteMany({ where: { sku: { startsWith: "QUO-TEST-" } } });
  await prisma.customer.deleteMany({ where: { name: { startsWith: "QUO Test" } } });
});

async function hammer() {
  const product = await prisma.product.findUnique({
    where: { sku: "HAMMER-001" },
    include: { units: true },
  });
  expect(product?.sellingPrice?.toString()).toBeTruthy();
  const unit = product?.units.find((row) => row.isBaseUnit) ?? product?.units[0];
  expect(unit).toBeTruthy();
  return { product: product!, unit: unit! };
}

async function stockSnapshot(productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { currentStock: true },
  });
  const movements = await prisma.stockMovement.count({ where: { productId } });
  const sales = await prisma.sale.count();
  const products = await prisma.product.count();
  return {
    stock: product?.currentStock.toString(),
    movements,
    sales,
    products,
  };
}

describe("quotations", () => {
  it("rejects unauthenticated and non-admin callers", async () => {
    const open = await request(app).post("/api/quotations").send({});
    expect(open.status).toBe(401);

    const cashier = await request(app)
      .post("/api/quotations")
      .set(auth(cashierToken))
      .send({ customerName: "Nope", lines: [] });
    expect(cashier.status).toBe(403);
  });

  it("creates a quotation from the product selling price without touching stock", async () => {
    const { product, unit } = await hammer();
    const before = await stockSnapshot(product.id);
    const productCount = before.products;

    const created = await request(app)
      .post("/api/quotations")
      .set(auth(adminToken))
      .send({
        customerName: "QUO Test ABC Hardware",
        customerContactPerson: "Ravi",
        customerPhone: testPhone(),
        customerAddress: "Karjat",
        customerPartyGstNo: "27ABCDE1234F1Z5",
        customerPartyState: "Maharashtra",
        note: NOTE,
        discountPercent: 10,
        transportAmount: 0,
        lines: [{ productId: product.id, productUnitId: unit.id, quantity: 10 }],
        totalAmount: 1,
      });
    expect(created.status, JSON.stringify(created.body)).toBe(422);
    expect(String(created.body.error)).toMatch(/cannot be submitted/i);

    const res = await request(app)
      .post("/api/quotations")
      .set(auth(adminToken))
      .send({
        customerName: "QUO Test ABC Hardware",
        customerContactPerson: "Ravi",
        customerPhone: testPhone(),
        customerAddress: "Karjat",
        customerPartyGstNo: "27ABCDE1234F1Z5",
        customerPartyState: "Maharashtra",
        note: NOTE,
        discountPercent: 10,
        lines: [
          {
            productId: product.id,
            productUnitId: unit.id,
            quantity: 10,
            unitPrice: 1,
          },
        ],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(String(res.body.error)).toMatch(/selling price/i);

    const ok = await request(app)
      .post("/api/quotations")
      .set(auth(adminToken))
      .send({
        customerName: "QUO Test ABC Hardware",
        customerContactPerson: "Ravi",
        customerPhone: testPhone(),
        customerEmail: "abc@example.com",
        customerAddress: "Karjat",
        customerPartyGstNo: "27ABCDE1234F1Z5",
        customerPartyState: "Maharashtra",
        note: NOTE,
        discountPercent: 10,
        lines: [{ productId: product.id, productUnitId: unit.id, quantity: 10 }],
      });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.customerId).toBeNull();
    expect(ok.body.customerName).toBe("QUO Test ABC Hardware");
    expect(ok.body.customerContactPerson).toBe("Ravi");
    expect(ok.body.customerAddress).toBe("Karjat");
    expect(ok.body.customerPartyGstNo).toBe("27ABCDE1234F1Z5");
    expect(ok.body.customerPartyState).toBe("Maharashtra");
    expect(ok.body.status).toBe("DRAFT");
    expect(ok.body.quotationNumber).toMatch(/^QUO-\d{4}-\d{4,}$/);
    expect(ok.body.quotationNumber.startsWith(`QUO-${ok.body.quotationDate.slice(0, 4)}-`)).toBe(
      true
    );
    const [y, m, d] = ok.body.quotationDate.split("-").map(Number);
    const until = new Date(Date.UTC(y, m - 1, d + 2)).toISOString().slice(0, 10);
    expect(ok.body.validUntil).toBe(until);
    expect(ok.body.lines).toHaveLength(1);
    expect(ok.body.lines[0].productId).toBe(product.id);
    expect(Number(ok.body.lines[0].unitPrice)).toBe(Number(product.sellingPrice));
    expect(ok.body.lines[0].productName).toBe(product.name);
    expect(ok.body.lines[0].sku).toBe(product.sku);
    const gross = Number(product.sellingPrice) * 10;
    const discount = Math.round(gross * 0.1 * 100) / 100;
    const taxable = gross - discount;
    const cgstRate = Number(product.cgstPercent ?? 0);
    const sgstRate = Number(product.sgstPercent ?? 0);
    const igstRate = Number(product.igstPercent ?? 0);
    const cgst = Math.round(((taxable * cgstRate) / 100) * 100) / 100;
    const sgst = Math.round(((taxable * sgstRate) / 100) * 100) / 100;
    const igst = Math.round(((taxable * igstRate) / 100) * 100) / 100;
    const total = Math.round((taxable + cgst + sgst + igst) * 100) / 100;
    expect(ok.body.subtotal).toBe(gross.toFixed(2));
    expect(ok.body.discountAmount).toBe(discount.toFixed(2));
    expect(ok.body.taxableAmount).toBe(taxable.toFixed(2));
    expect(ok.body.cgstAmount).toBe(cgst.toFixed(2));
    expect(ok.body.sgstAmount).toBe(sgst.toFixed(2));
    expect(ok.body.igstAmount).toBe(igst.toFixed(2));
    expect(ok.body.totalAmount).toBe(total.toFixed(2));
    expect(ok.body.includeGst).toBe(true);
    expect(ok.body.createdByName).toBeTruthy();

    const after = await stockSnapshot(product.id);
    expect(after).toEqual(before);
    expect(await prisma.product.count()).toBe(productCount);

    const edited = await request(app)
      .patch(`/api/quotations/${ok.body.id}`)
      .set(auth(adminToken))
      .send({
        customerName: "QUO Test ABC Hardware",
        note: NOTE,
        lines: [{ productId: product.id, productUnitId: unit.id, quantity: 2, lineDiscount: 0 }],
      });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.lines[0].quantity).toBe("2");
    expect(Number(edited.body.totalAmount)).toBeGreaterThan(0);

    const issued = await request(app)
      .post(`/api/quotations/${ok.body.id}/issue`)
      .set(auth(adminToken));
    expect(issued.status, JSON.stringify(issued.body)).toBe(200);
    expect(issued.status).toBe(200);
    expect(issued.body.status).toBe("ISSUED");
    const [iy, im, iday] = String(issued.body.quotationDate).split("-").map(Number);
    expect(issued.body.validUntil).toBe(
      new Date(Date.UTC(iy, im - 1, iday + 2)).toISOString().slice(0, 10)
    );
    expect(await stockSnapshot(product.id)).toEqual(before);

    const locked = await request(app)
      .patch(`/api/quotations/${ok.body.id}`)
      .set(auth(adminToken))
      .send({
        customerName: "QUO Test ABC Hardware",
        note: NOTE,
        lines: [{ productId: product.id, quantity: 1 }],
      });
    expect(locked.status).toBe(400);

    const pdf = await request(app)
      .get(`/api/quotations/${ok.body.id}/pdf`)
      .set(auth(adminToken))
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toMatch(/pdf/);
    const bytes = pdf.body as Buffer;
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const text = pdfPlainText(bytes);
    expect(text).toContain("QUOTATION");
    expect(text).toContain(issued.body.quotationNumber as string);
    expect(text).toContain("QUO Test ABC Hardware");
    expect(text).toContain(product.name);
    expect(text).toContain("Valid Until");
    expect(text).not.toContain("Customer ID");

    const cancelled = await request(app)
      .post(`/api/quotations/${ok.body.id}/cancel`)
      .set(auth(adminToken));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("CANCELLED");
    const reissue = await request(app)
      .post(`/api/quotations/${ok.body.id}/issue`)
      .set(auth(adminToken));
    expect(reissue.status).toBe(400);
    expect(await stockSnapshot(product.id)).toEqual(before);
  });

  it("snapshots an existing customer and can save a new one without duplicating a phone", async () => {
    const { product, unit } = await hammer();
    const phone = testPhone();
    const customer = await request(app).post("/api/customers").set(auth(adminToken)).send({
      name: "QUO Test Master",
      phone,
      address: "Master street",
      partyGstNo: "27MASTER1234F1Z5",
      partyState: "Maharashtra",
    });
    expect(customer.status, JSON.stringify(customer.body)).toBe(201);

    const quoted = await request(app)
      .post("/api/quotations")
      .set(auth(adminToken))
      .send({
        customerId: customer.body.id,
        customerName: "QUO Test Reviewed",
        customerPhone: phone,
        note: NOTE,
        lines: [{ productId: product.id, productUnitId: unit.id, quantity: 1 }],
      });
    expect(quoted.status, JSON.stringify(quoted.body)).toBe(201);
    expect(quoted.body.customerId).toBe(customer.body.id);
    expect(quoted.body.customerName).toBe("QUO Test Reviewed");
    expect(quoted.body.customerAddress).toBe("Master street");
    const master = await prisma.customer.findUnique({ where: { id: customer.body.id } });
    expect(master?.name).toBe("QUO Test Master");

    const freshPhone = testPhone();
    const saved = await request(app)
      .post("/api/quotations")
      .set(auth(adminToken))
      .send({
        customerName: "QUO Test Fresh Co",
        customerPhone: freshPhone,
        customerAddress: "New lane",
        saveAsCustomer: true,
        note: NOTE,
        lines: [{ productId: product.id, productUnitId: unit.id, quantity: 1 }],
      });
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    expect(saved.body.customerId).toBeTruthy();
    const again = await request(app)
      .post("/api/quotations")
      .set(auth(adminToken))
      .send({
        customerName: "QUO Test Fresh Co Copy",
        customerPhone: freshPhone,
        saveAsCustomer: true,
        note: NOTE,
        lines: [{ productId: product.id, productUnitId: unit.id, quantity: 1 }],
      });
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body.customerId).toBe(saved.body.customerId);
    expect(await prisma.customer.count({ where: { phone: freshPhone } })).toBe(1);
    const linked = await prisma.customer.findUnique({ where: { id: saved.body.customerId } });
    expect(linked?.name).toBe("QUO Test Fresh Co");
  });

  it("rejects a missing selling price and an inactive product", async () => {
    const sku = `QUO-TEST-NOPRICE-${Date.now()}`;
    const missing = await prisma.product.create({
      data: {
        sku,
        name: "QUO Test No Price",
        status: ProductStatus.ACTIVE,
        baseUnitCode: "pc",
        unitKind: UnitKind.PIECE,
        allowsFractional: false,
        costPrice: "5",
        mrp: "9",
        currentStock: "4",
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
    });
    const rejected = await request(app)
      .post("/api/quotations")
      .set(auth(adminToken))
      .send({
        customerName: "QUO Test Walk In",
        note: NOTE,
        lines: [{ productId: missing.id, quantity: 1 }],
      });
    expect(rejected.status).toBe(400);
    expect(String(rejected.body.error)).toMatch(/selling price/i);

    await prisma.product.update({
      where: { id: missing.id },
      data: { status: ProductStatus.INACTIVE, sellingPrice: "12" },
    });
    const inactive = await request(app)
      .post("/api/quotations")
      .set(auth(adminToken))
      .send({
        customerName: "QUO Test Walk In",
        note: NOTE,
        lines: [{ productId: missing.id, quantity: 1 }],
      });
    expect(inactive.status).toBe(400);
    expect(String(inactive.body.error)).toMatch(/inactive/i);
  });

  it("prices 10.10 with decimal-safe GST and ignores cost price", async () => {
    const sku = `QUO-TEST-DEC-${Date.now()}`;
    const product = await prisma.product.create({
      data: {
        sku,
        name: "QUO Test Decimal",
        status: ProductStatus.ACTIVE,
        baseUnitCode: "pc",
        unitKind: UnitKind.PIECE,
        allowsFractional: false,
        costPrice: "1.00",
        sellingPrice: "10.10",
        cgstPercent: "9",
        sgstPercent: "9",
        igstPercent: "0",
        currentStock: "50",
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
    });
    const res = await request(app)
      .post("/api/quotations")
      .set(auth(adminToken))
      .send({
        customerName: "QUO Test Decimal Buyer",
        note: NOTE,
        lines: [{ productId: product.id, quantity: 3 }],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(Number(res.body.lines[0].unitPrice)).toBe(10.1);
    expect(res.body.subtotal).toBe("30.30");
    expect(res.body.includeGst).toBe(true);
    expect(res.body.cgstAmount).toBe("2.73");
    expect(res.body.sgstAmount).toBe("2.73");
    expect(res.body.totalAmount).toBe("35.76");
    expect(res.body.lines[0].cgstPercent).toBeTruthy();
    const stock = await prisma.product.findUnique({ where: { id: product.id } });
    expect(stock?.currentStock.toString()).toBe("50");
  });

  it("prices a quotation without GST and keeps that choice when issued", async () => {
    const sku = `QUO-TEST-NOGST-${Date.now()}`;
    const product = await prisma.product.create({
      data: {
        sku,
        name: "QUO Test No GST",
        status: ProductStatus.ACTIVE,
        baseUnitCode: "pc",
        unitKind: UnitKind.PIECE,
        allowsFractional: false,
        costPrice: "1.00",
        sellingPrice: "10.10",
        cgstPercent: "9",
        sgstPercent: "9",
        igstPercent: "0",
        currentStock: "50",
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
    });
    const before = await stockSnapshot(product.id);

    const created = await request(app)
      .post("/api/quotations")
      .set(auth(adminToken))
      .send({
        customerName: "QUO Test No GST Buyer",
        note: NOTE,
        includeGst: false,
        discountPercent: 10,
        transportAmount: 15.5,
        lines: [{ productId: product.id, quantity: 3 }],
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.includeGst).toBe(false);
    expect(created.body.subtotal).toBe("30.30");
    expect(created.body.discountAmount).toBe("3.03");
    expect(created.body.taxableAmount).toBe("27.27");
    expect(created.body.cgstAmount).toBe("0.00");
    expect(created.body.sgstAmount).toBe("0.00");
    expect(created.body.igstAmount).toBe("0.00");
    expect(created.body.taxAmount).toBe("0.00");
    expect(created.body.lines[0].lineTax).toBe("0.00");
    expect(Number(created.body.lines[0].cgstPercent)).toBe(9);
    expect(Number(created.body.lines[0].sgstPercent)).toBe(9);
    expect(created.body.transportAmount).toBe("15.50");
    expect(created.body.totalAmount).toBe("42.77");
    expect(await stockSnapshot(product.id)).toEqual(before);

    await prisma.product.update({
      where: { id: product.id },
      data: { cgstPercent: "18", sgstPercent: "18" },
    });

    const stillOff = await request(app)
      .patch(`/api/quotations/${created.body.id}`)
      .set(auth(adminToken))
      .send({
        customerName: "QUO Test No GST Buyer",
        note: NOTE,
        includeGst: false,
        discountPercent: 10,
        transportAmount: 15.5,
        lines: [{ productId: product.id, quantity: 3 }],
      });
    expect(stillOff.status, JSON.stringify(stillOff.body)).toBe(200);
    expect(stillOff.body.includeGst).toBe(false);
    expect(stillOff.body.cgstAmount).toBe("0.00");
    expect(stillOff.body.taxAmount).toBe("0.00");
    expect(stillOff.body.totalAmount).toBe("42.77");
    expect(Number(stillOff.body.lines[0].cgstPercent)).toBe(18);

    const turnedOn = await request(app)
      .patch(`/api/quotations/${created.body.id}`)
      .set(auth(adminToken))
      .send({
        customerName: "QUO Test No GST Buyer",
        note: NOTE,
        includeGst: true,
        discountPercent: 10,
        transportAmount: 15.5,
        lines: [{ productId: product.id, quantity: 3 }],
      });
    expect(turnedOn.status, JSON.stringify(turnedOn.body)).toBe(200);
    expect(turnedOn.body.includeGst).toBe(true);
    expect(turnedOn.body.cgstAmount).toBe("4.91");
    expect(turnedOn.body.sgstAmount).toBe("4.91");
    expect(turnedOn.body.taxAmount).toBe("9.82");
    expect(turnedOn.body.totalAmount).toBe("52.59");

    const turnedOff = await request(app)
      .patch(`/api/quotations/${created.body.id}`)
      .set(auth(adminToken))
      .send({
        customerName: "QUO Test No GST Buyer",
        note: NOTE,
        includeGst: false,
        discountPercent: 10,
        transportAmount: 15.5,
        lines: [{ productId: product.id, quantity: 3 }],
      });
    expect(turnedOff.status, JSON.stringify(turnedOff.body)).toBe(200);
    expect(turnedOff.body.includeGst).toBe(false);
    expect(turnedOff.body.taxAmount).toBe("0.00");
    expect(turnedOff.body.totalAmount).toBe("42.77");

    const issued = await request(app)
      .post(`/api/quotations/${created.body.id}/issue`)
      .set(auth(adminToken));
    expect(issued.status, JSON.stringify(issued.body)).toBe(200);
    expect(issued.body.status).toBe("ISSUED");
    expect(issued.body.includeGst).toBe(false);
    expect(issued.body.cgstAmount).toBe("0.00");
    expect(issued.body.sgstAmount).toBe("0.00");
    expect(issued.body.igstAmount).toBe("0.00");
    expect(issued.body.taxAmount).toBe("0.00");
    expect(issued.body.lines[0].lineTax).toBe("0.00");
    expect(issued.body.totalAmount).toBe("42.77");
    expect(await stockSnapshot(product.id)).toEqual(before);

    const listed = await request(app)
      .get("/api/quotations")
      .query({ q: issued.body.quotationNumber })
      .set(auth(adminToken));
    expect(listed.status).toBe(200);
    const row = listed.body.items.find(
      (item: { id: string }) => item.id === issued.body.id
    );
    expect(row?.includeGst).toBe(false);

    const pdf = await request(app)
      .get(`/api/quotations/${issued.body.id}/pdf`)
      .set(auth(adminToken))
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(pdf.status).toBe(200);
    const text = pdfPlainText(pdf.body as Buffer);
    expect(text).toContain("GST is not included in this quotation.");
    expect(text).toContain("42.77");
    expect(text).not.toContain("CGST");
    expect(text).not.toContain("SGST");
    expect(text).not.toContain("IGST");
    expect(text).not.toContain("4.91");
    expect(text).not.toContain("9.82");
  });

  it("allocates distinct quotation numbers under concurrent creates", async () => {
    const { product, unit } = await hammer();
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        request(app)
          .post("/api/quotations")
          .set(auth(adminToken))
          .send({
            customerName: "QUO Test Concurrent",
            note: NOTE,
            lines: [{ productId: product.id, productUnitId: unit.id, quantity: 1 }],
          })
      )
    );
    for (const res of results) {
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
    const numbers = results.map((res) => res.body.quotationNumber as string);
    expect(new Set(numbers).size).toBe(numbers.length);
    const seq = numbers
      .map((value) => Number(value.split("-")[2]))
      .sort((a, b) => a - b);
    for (let i = 1; i < seq.length; i++) {
      expect(seq[i]).toBe(seq[i - 1] + 1);
    }
  });
});
