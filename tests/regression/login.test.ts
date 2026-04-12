/**
 * Login module — POST /api/login, JWT shape, and session coupling.
 *
 * Prerequisites: same as api.test.ts (`DATABASE_URL`, migrate, `npm run seed`).
 */
import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { describe, it, expect, afterAll } from "vitest";
import { UserRole } from "@prisma/client";
import { buildApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";
import { jwtSecret } from "../../src/lib/jwt";

const app = buildApp();

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin123";
const CASHIER_USERNAME = "cashier";
const CASHIER_PASSWORD = "cashier123";

describe("Login — POST /api/login validation", () => {
  it("returns 422 when body is empty", async () => {
    const res = await request(app).post("/api/login").send({});
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/validation/i);
    expect(Array.isArray(res.body.details)).toBe(true);
  });

  it("returns 422 when only legacy email field is sent (username required)", async () => {
    const res = await request(app).post("/api/login").send({
      email: "admin@shop.com",
      password: ADMIN_PASSWORD,
    });
    expect(res.status).toBe(422);
    expect(
      res.body.details?.some((d: { field: string }) => /username/i.test(d.field))
    ).toBe(true);
  });

  it("returns 422 when username is missing", async () => {
    const res = await request(app)
      .post("/api/login")
      .send({ password: "x" });
    expect(res.status).toBe(422);
    expect(
      res.body.details?.some((d: { field: string }) => /username/i.test(d.field))
    ).toBe(true);
  });

  it("returns 422 when password is missing", async () => {
    const res = await request(app)
      .post("/api/login")
      .send({ username: ADMIN_USERNAME });
    expect(res.status).toBe(422);
    expect(
      res.body.details?.some((d: { field: string }) => /password/i.test(d.field))
    ).toBe(true);
  });

  it("returns 422 for invalid username characters", async () => {
    const res = await request(app).post("/api/login").send({
      username: "no spaces!",
      password: "secret",
    });
    expect(res.status).toBe(422);
  });

  it("returns 422 when username exceeds max length", async () => {
    const res = await request(app).post("/api/login").send({
      username: "x".repeat(65),
      password: "secret",
    });
    expect(res.status).toBe(422);
  });

  it("trims username before validation (leading/trailing spaces)", async () => {
    const res = await request(app).post("/api/login").send({
      username: `  ${ADMIN_USERNAME}  `,
      password: ADMIN_PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(res.body.user?.email).toBeUndefined();
    expect(res.body.user?.role).toBe("ADMIN");
  });
});

describe("Login — credentials", () => {
  it("returns 401 for wrong password", async () => {
    const res = await request(app).post("/api/login").send({
      username: ADMIN_USERNAME,
      password: "wrong-password",
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid credentials/i);
  });

  it("returns 401 for unknown username", async () => {
    const res = await request(app).post("/api/login").send({
      username: "nobody_user_xyz",
      password: "any-password",
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid credentials/i);
  });

  it("matches username case-insensitively", async () => {
    const res = await request(app).post("/api/login").send({
      username: "AdMiN",
      password: ADMIN_PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(res.body.user?.role).toBe("ADMIN");
  });

  it("accepts seeded email in username field (local part used for lookup)", async () => {
    const res = await request(app).post("/api/login").send({
      username: "admin@shop.com",
      password: ADMIN_PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(res.body.user?.role).toBe("ADMIN");
  });

  it("returns admin profile and ADMIN role", async () => {
    const res = await request(app).post("/api/login").send({
      username: ADMIN_USERNAME,
      password: ADMIN_PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(/\S+/);
    expect(res.body.user).toMatchObject({
      role: "ADMIN",
    });
    expect(res.body.user.id).toMatch(/\S+/);
    expect(res.body.user.name).toBeTruthy();
    expect(new Set(Object.keys(res.body.user))).toEqual(
      new Set(["id", "name", "role"])
    );
  });

  it("returns cashier profile and CASHIER role", async () => {
    const res = await request(app).post("/api/login").send({
      username: CASHIER_USERNAME,
      password: CASHIER_PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(res.body.user?.role).toBe("CASHIER");
    expect(res.body.user?.name).toBeTruthy();
  });
});

describe("Login — JWT and session", () => {
  it("JWT sub matches returned user id and verifies with server secret", async () => {
    const res = await request(app).post("/api/login").send({
      username: ADMIN_USERNAME,
      password: ADMIN_PASSWORD,
    });
    expect(res.status).toBe(200);
    const token = res.body.token as string;
    const decoded = jwt.verify(token, jwtSecret()) as jwt.JwtPayload;
    expect(decoded.sub).toBe(res.body.user.id);
  });

  it("token from login works on GET /api/session", async () => {
    const login = await request(app).post("/api/login").send({
      username: CASHIER_USERNAME,
      password: CASHIER_PASSWORD,
    });
    expect(login.status).toBe(200);
    const session = await request(app)
      .get("/api/session")
      .set("Authorization", `Bearer ${login.body.token as string}`);
    expect(session.status).toBe(200);
    expect(session.body.user?.id).toBe(login.body.user.id);
    expect(session.body.user?.role).toBe("CASHIER");
  });

  it("GET /api/session returns 401 with malformed Bearer token", async () => {
    const res = await request(app)
      .get("/api/session")
      .set("Authorization", "Bearer not.a.valid.jwt");
    expect(res.status).toBe(401);
  });

  it("GET /api/session returns 401 without Authorization", async () => {
    const res = await request(app).get("/api/session");
    expect(res.status).toBe(401);
  });
});

describe("Login — inactive user", () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const inactiveUsername = `inactive_${suffix}`;
  const inactiveEmail = `inactive-${suffix}@test.com`;
  const inactivePhone = `+1555${String(Date.now()).slice(-10)}`;

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: inactiveUsername } });
  });

  it("returns 401 when user exists but isActive is false", async () => {
    const hash = await bcrypt.hash("secretpass", 8);
    await prisma.user.create({
      data: {
        fullName: "Inactive Test",
        username: inactiveUsername,
        email: inactiveEmail,
        phone: inactivePhone,
        passwordHash: hash,
        role: UserRole.CASHIER,
        isActive: false,
      },
    });

    const res = await request(app).post("/api/login").send({
      username: inactiveUsername,
      password: "secretpass",
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid credentials/i);
  });
});

describe("Login — HTTP surface", () => {
  it("GET /api/login is not supported (falls through to auth middleware → 401)", async () => {
    const res = await request(app).get("/api/login");
    expect(res.status).toBe(401);
  });

  it("POST /api/login returns 401 when password is only whitespace (not trimmed)", async () => {
    const res = await request(app).post("/api/login").send({
      username: ADMIN_USERNAME,
      password: "   ",
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid credentials/i);
  });
});
