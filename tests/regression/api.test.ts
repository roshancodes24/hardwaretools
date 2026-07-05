/**
 * API regression suite (QA-style).
 *
 * Prerequisites: `DATABASE_URL` set, PostgreSQL up, `npx prisma migrate deploy`,
 * and `npm run seed` (users: admin / admin123, cashier / cashier123).
 *
 * Read-only by default. Set `REGRESSION_WRITES=1` to run checkout tests that
 * create a real sale and reduce stock (use a non-production DB).
 */
import request from "supertest";
import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";
const app = buildApp();

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin123";
const CASHIER_USERNAME = "cashier";
const CASHIER_PASSWORD = "cashier123";

let adminToken = "";
let cashierToken = "";

beforeAll(async () => {
  const adminLogin = await request(app).post("/api/login").send({
    username: ADMIN_USERNAME,
    password: ADMIN_PASSWORD,
  });
  expect(adminLogin.status, adminLogin.body?.error).toBe(200);
  adminToken = adminLogin.body.token as string;
  expect(adminToken).toMatch(/\S+/);

  const cashierLogin = await request(app).post("/api/login").send({
    username: CASHIER_USERNAME,
    password: CASHIER_PASSWORD,
  });
  expect(cashierLogin.status, cashierLogin.body?.error).toBe(200);
  cashierToken = cashierLogin.body.token as string;
});

function authAdmin(): { Authorization: string } {
  return { Authorization: `Bearer ${adminToken}` };
}

function authCashier(): { Authorization: string } {
  return { Authorization: `Bearer ${cashierToken}` };
}

describe("R0 — Login & JWT", () => {
  it("POST /api/login returns 401 for wrong password", async () => {
    const res = await request(app).post("/api/login").send({
      username: ADMIN_USERNAME,
      password: "wrong-password",
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid credentials/i);
  });

  it("GET /api/products returns 401 without Authorization", async () => {
    const res = await request(app).get("/api/products");
    expect(res.status).toBe(401);
  });

  it("POST /api/login returns token and user for admin", async () => {
    const res = await request(app).post("/api/login").send({
      username: ADMIN_USERNAME,
      password: ADMIN_PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(/\S+/);
    expect(res.body.user?.id).toMatch(/\S+/);
    expect(res.body.user?.name).toBeTruthy();
    expect(res.body.user?.role).toBe("ADMIN");
  });
});

describe("R1 — Smoke / health", () => {
  it("GET /api/health returns API message", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.message).toMatch(/Inventory API/i);
  });
});

describe("R2 — Session & reference data (seeded DB)", () => {
  it("GET /api/session returns user + admin + cashier ids", async () => {
    const res = await request(app).get("/api/session/").set(authAdmin());
    expect(res.status, "Run `npm run seed` if this is 503").toBe(200);
    expect(res.body.user?.id).toMatch(/\S+/);
    expect(res.body.user?.role).toBe("ADMIN");
    expect(res.body.adminUserId).toMatch(/\S+/);
    expect(res.body.cashierUserId).toMatch(/\S+/);
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(res.body.users.length).toBeGreaterThanOrEqual(2);
  });

  it("GET /api/products returns a non-empty array", async () => {
    const res = await request(app).get("/api/products").set(authAdmin());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty("id");
    expect(res.body[0]).toHaveProperty("sku");
  });

  it("GET /api/products?page=1&limit=10 returns paginated envelope", async () => {
    const res = await request(app)
      .get("/api/products")
      .query({ page: 1, limit: 10 })
      .set(authAdmin());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeLessThanOrEqual(10);
    expect(typeof res.body.total).toBe("number");
    expect(typeof res.body.catalogTotal).toBe("number");
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(10);
    expect(res.body.total).toBeGreaterThanOrEqual(res.body.items.length);
    expect(res.body.catalogTotal).toBeGreaterThanOrEqual(res.body.total);
  });

  it("GET /api/suppliers returns array", async () => {
    const res = await request(app).get("/api/suppliers").set(authAdmin());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /api/customers returns array", async () => {
    const res = await request(app).get("/api/customers").set(authAdmin());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /api/promotions returns array", async () => {
    const res = await request(app).get("/api/promotions").set(authAdmin());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("R10 — Role access (CASHIER vs ADMIN)", () => {
  it("GET /api/suppliers returns 403 for CASHIER JWT", async () => {
    const res = await request(app).get("/api/suppliers").set(authCashier());
    expect(res.status).toBe(403);
  });

  it("GET /api/reports/sales-summary returns 403 for CASHIER", async () => {
    const res = await request(app)
      .get("/api/reports/sales-summary")
      .query({ from: "2024-01-01", to: "2024-01-31" })
      .set(authCashier());
    expect(res.status).toBe(403);
  });

  it("PATCH /api/products/:id returns 403 for CASHIER", async () => {
    const list = await request(app).get("/api/products").set(authAdmin());
    const id = list.body[0]?.id as string;
    expect(id).toBeTruthy();
    const res = await request(app)
      .patch(`/api/products/${id}`)
      .set(authCashier())
      .send({ name: "Should not apply" });
    expect(res.status).toBe(403);
  });

  it("GET /api/products returns 200 for CASHIER", async () => {
    const res = await request(app).get("/api/products").set(authCashier());
    expect(res.status).toBe(200);
  });

  it("admin JWT + X-Acting-User-Id cashier still blocks suppliers for effective cashier", async () => {
    const session = await request(app).get("/api/session/").set(authAdmin());
    const cashierId = session.body.cashierUserId as string;
    const res = await request(app)
      .get("/api/suppliers")
      .set(authAdmin())
      .set("X-Acting-User-Id", cashierId);
    expect(res.status).toBe(403);
  });
});

describe("R3b — Product update/delete", () => {
  it("PATCH /api/products/:id rejects empty body", async () => {
    const list = await request(app).get("/api/products").set(authAdmin());
    expect(list.status).toBe(200);
    const id = list.body[0]?.id as string;
    expect(id).toBeTruthy();
    const res = await request(app)
      .patch(`/api/products/${id}`)
      .set(authAdmin())
      .send({});
    expect(res.status).toBe(422);
  });

  it("PATCH /api/products/:id updates product", async () => {
    const list = await request(app).get("/api/products").set(authAdmin());
    const p =
      (list.body as Array<{ id: string; sku?: string; name: string }>).find(
        (row) => row.sku === "NAILS-001"
      ) ?? list.body[0];
    expect(p?.id).toBeTruthy();
    const originalName = String(p.name);
    const tempName = `${originalName} (QA patch)`;
    try {
      const res = await request(app)
        .patch(`/api/products/${p.id}`)
        .set(authAdmin())
        .send({ name: tempName });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe(tempName);
    } finally {
      await request(app)
        .patch(`/api/products/${p.id}`)
        .set(authAdmin())
        .send({ name: originalName });
    }
  });

  it("DELETE /api/products/:id returns 404 for missing id", async () => {
    const res = await request(app)
      .delete("/api/products/clxxxxxxxxxxxxxxxxxxxxxxxx")
      .set(authAdmin());
    expect(res.status).toBe(404);
  });
});

describe("R3 — Product stock endpoint", () => {
  it("GET /api/products/:id/stock returns stock payload", async () => {
    const list = await request(app).get("/api/products").set(authAdmin());
    expect(list.status).toBe(200);
    const id = list.body[0]?.id as string;
    expect(id).toBeTruthy();
    const res = await request(app)
      .get(`/api/products/${id}/stock`)
      .set(authAdmin());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("currentStock");
    expect(res.body).toHaveProperty("name");
  });
});

describe("R4 — Reporting APIs", () => {
  const from = "2026-01-01";
  const to = "2026-12-31";

  it("GET /api/reports/dashboard-timeseries returns series", async () => {
    const res = await request(app)
      .get("/api/reports/dashboard-timeseries?days=7")
      .set(authAdmin());
    expect(res.status).toBe(200);
    expect(res.body.days).toBe(7);
    expect(Array.isArray(res.body.series)).toBe(true);
    expect(res.body.series.length).toBe(7);
    const p = res.body.series[0];
    expect(p).toHaveProperty("date");
    expect(p).toHaveProperty("salesTotal");
    expect(p).toHaveProperty("purchasesTotal");
  });

  it("GET /api/reports/sales-revenue-series supports day / week / month", async () => {
    for (const g of ["day", "week", "month"] as const) {
      const res = await request(app)
        .get(`/api/reports/sales-revenue-series?granularity=${g}&buckets=4`)
        .set(authAdmin());
      expect(res.status).toBe(200);
      expect(res.body.granularity).toBe(g);
      expect(res.body.buckets).toBe(4);
      expect(res.body.series.length).toBe(4);
      const b = res.body.series[0];
      expect(b).toHaveProperty("key");
      expect(b).toHaveProperty("label");
      expect(b).toHaveProperty("total");
      expect(b).toHaveProperty("count");
    }
  });

  it("GET /api/reports/sales-revenue-series rejects bad granularity", async () => {
    const res = await request(app)
      .get("/api/reports/sales-revenue-series?granularity=hour")
      .set(authAdmin());
    expect(res.status).toBe(400);
  });

  it("GET /api/reports/sales-summary requires from & to", async () => {
    const res = await request(app)
      .get("/api/reports/sales-summary")
      .set(authAdmin());
    expect(res.status).toBe(400);
  });

  it("GET /api/reports/sales-summary rejects inverted range", async () => {
    const res = await request(app)
      .get("/api/reports/sales-summary?from=2026-06-10&to=2026-06-01")
      .set(authAdmin());
    expect(res.status).toBe(400);
  });

  it("GET /api/reports/sales-summary returns summary + sales list shape", async () => {
    const res = await request(app)
      .get(`/api/reports/sales-summary?from=${from}&to=${to}`)
      .set(authAdmin());
    expect(res.status).toBe(200);
    expect(res.body.summary).toHaveProperty("saleCount");
    expect(res.body.summary).toHaveProperty("totalAmount");
    expect(Array.isArray(res.body.sales)).toBe(true);
  });

  it("GET /api/reports/sales-by-product returns products array", async () => {
    const res = await request(app)
      .get(`/api/reports/sales-by-product?from=${from}&to=${to}`)
      .set(authAdmin());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.products)).toBe(true);
  });

  it("GET /api/reports/purchases returns summary + purchases", async () => {
    const res = await request(app)
      .get(`/api/reports/purchases?from=${from}&to=${to}`)
      .set(authAdmin());
    expect(res.status).toBe(200);
    expect(res.body.summary).toHaveProperty("purchaseCount");
    expect(Array.isArray(res.body.purchases)).toBe(true);
  });

  it("GET /api/reports/gross-margin returns metrics", async () => {
    const res = await request(app)
      .get(`/api/reports/gross-margin?from=${from}&to=${to}`)
      .set(authAdmin());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("revenue");
    expect(res.body).toHaveProperty("grossMargin");
  });
});

describe("R5 — Sales (read + validation)", () => {
  it("GET /api/sales/outstanding returns array", async () => {
    const res = await request(app).get("/api/sales/outstanding").set(authAdmin());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /api/sales/search rejects short q", async () => {
    const res = await request(app).get("/api/sales/search?q=a").set(authAdmin());
    expect(res.status).toBe(400);
  });

  it("GET /api/sales/search returns array", async () => {
    const res = await request(app).get("/api/sales/search?q=xx").set(authAdmin());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /api/sales/by-number returns 404 when missing", async () => {
    const res = await request(app)
      .get("/api/sales/by-number/NO-SUCH-SALE-NUMBER-XYZ")
      .set(authAdmin());
    expect(res.status).toBe(404);
  });

  it("GET /api/sales/by-number returns detail when sale exists", async () => {
    const one = await prisma.sale.findFirst({
      select: { saleNumber: true },
    });
    if (!one) {
      return;
    }
    const res = await request(app)
      .get(`/api/sales/by-number/${encodeURIComponent(one.saleNumber)}`)
      .set(authAdmin());
    expect(res.status).toBe(200);
    expect(res.body.saleNumber).toBe(one.saleNumber);
    expect(Array.isArray(res.body.lines)).toBe(true);
  });

  it("GET /api/sales/:id returns 404 for missing sale", async () => {
    const res = await request(app)
      .get("/api/sales/00000000-0000-4000-8000-000000000001")
      .set(authAdmin());
    expect(res.status).toBe(404);
  });

  it("POST /api/sales with empty body returns 422 validation", async () => {
    const res = await request(app).post("/api/sales").set(authAdmin()).send({});
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("Validation failed");
  });

  it("POST /api/purchases with empty body returns 422 validation", async () => {
    const res = await request(app).post("/api/purchases").set(authAdmin()).send({});
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("Validation failed");
  });
});

const runWrites = process.env.REGRESSION_WRITES === "1";

describe.runIf(runWrites)("R6 — Write path: POS sale (opt-in REGRESSION_WRITES=1)", () => {
  let adminId: string;
  let writerAuth: { Authorization: string };

  beforeAll(async () => {
    const admin = await prisma.user.findFirst({
      where: { username: ADMIN_USERNAME, isActive: true },
    });
    if (!admin) {
      throw new Error("No admin user; run npm run seed");
    }
    adminId = admin.id;
    const login = await request(app).post("/api/login").send({
      username: ADMIN_USERNAME,
      password: ADMIN_PASSWORD,
    });
    expect(login.status).toBe(200);
    writerAuth = { Authorization: `Bearer ${login.body.token as string}` };
  });

  it("creates a small paid sale and loads it by id", async () => {
    const nails = await prisma.product.findFirst({
      where: { sku: "NAILS-001" },
      include: { units: true },
    });
    const kg = nails?.units.find((u) => u.code === "kg");
    if (!nails || !kg) {
      throw new Error("Seed product NAILS-001 with kg unit not found");
    }

    const payload = {
      createdById: adminId,
      customerName: "Regression QA",
      customerPhone: "9876543210",
      paidAmount: 30,
      paymentMethod: "cash",
      note: `REGRESSION_WRITES sale ${Date.now()}`,
      lines: [
        {
          productId: nails.id,
          productUnitId: kg.id,
          quantity: 0.2,
          unitPrice: 150,
        },
      ],
    };

    const create = await request(app)
      .post("/api/sales")
      .set(writerAuth)
      .send(payload);
    expect(create.status, create.body?.error ?? JSON.stringify(create.body)).toBe(
      201
    );
    expect(create.body.saleNumber).toMatch(/^BIL-\d+$/);
    expect(create.body.totalAmount).toBe("30.00");
    expect(create.body.payments?.length).toBeGreaterThanOrEqual(1);
    expect(create.body.payments[0].method).toBe("cash");

    const id = create.body.id as string;
    const get = await request(app).get(`/api/sales/${id}`).set(writerAuth);
    expect(get.status).toBe(200);
    expect(get.body.id).toBe(id);
    expect(get.body.lines.length).toBe(1);

    const byNum = await request(app)
      .get(
        `/api/sales/by-number/${encodeURIComponent(create.body.saleNumber as string)}`
      )
      .set(writerAuth);
    expect(byNum.status).toBe(200);
    expect(byNum.body.id).toBe(id);
    expect(byNum.body.saleNumber).toBe(create.body.saleNumber);
  });

  it("creates a split payment sale with separate cash and online rows", async () => {
    const nails = await prisma.product.findFirst({
      where: { sku: "NAILS-001" },
      include: { units: true },
    });
    const kg = nails?.units.find((u) => u.code === "kg");
    if (!nails || !kg) {
      throw new Error("Seed product NAILS-001 with kg unit not found");
    }

    const payload = {
      createdById: adminId,
      customerName: "Split Pay QA",
      customerPhone: "9876543211",
      paidAmount: 20,
      initialPayments: [
        { method: "cash", amount: 15 },
        { method: "online_banking", amount: 5 },
      ],
      note: `REGRESSION_WRITES split sale ${Date.now()}`,
      lines: [
        {
          productId: nails.id,
          productUnitId: kg.id,
          quantity: 0.2,
          unitPrice: 150,
        },
      ],
    };

    const create = await request(app)
      .post("/api/sales")
      .set(writerAuth)
      .send(payload);
    expect(create.status, create.body?.error ?? JSON.stringify(create.body)).toBe(
      201
    );
    expect(create.body.totalAmount).toBe("30.00");
    expect(create.body.paidAmount).toBe("20.00");
    expect(create.body.balanceAmount).toBe("10.00");
    expect(create.body.payments).toHaveLength(2);
    expect(create.body.payments[0].method).toBe("cash");
    expect(create.body.payments[0].amount).toBe("15.00");
    expect(create.body.payments[1].method).toBe("online_banking");
    expect(create.body.payments[1].amount).toBe("5.00");

    const settle = await request(app)
      .post(`/api/sales/${create.body.id}/payments`)
      .set(writerAuth)
      .send({
        createdById: adminId,
        amount: 10,
        payments: [
          { method: "cash", amount: 6 },
          { method: "online_banking", amount: 4 },
        ],
      });
    expect(settle.status, settle.body?.error ?? JSON.stringify(settle.body)).toBe(
      200
    );
    expect(settle.body.balanceAmount).toBe("0.00");
    expect(settle.body.paidAmount).toBe("30.00");
    expect(settle.body.payments).toHaveLength(4);
  });
});
