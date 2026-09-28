/**
 * Scheduled owner reports — period helpers, API, and idempotency.
 */
import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DateTime } from "luxon";
import { buildApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";
import {
  computePreviousPeriodBounds,
  isSchedulerWindowOpen,
  REPORT_ZONE,
} from "../../src/lib/reportPeriods";
import {
  isReportSlotReached,
  reportSlotTimeLabel,
  REPORT_RUN_ORDER,
} from "../../src/lib/reportScheduleSlots";
import { ReportPeriod, ReportRunStatus, ScheduledReportType } from "@prisma/client";
import { runDueScheduledReports } from "../../src/services/scheduledReports";

const app = buildApp();

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin123";

let adminToken = "";

beforeAll(async () => {
  const login = await request(app).post("/api/login").send({
    username: ADMIN_USERNAME,
    password: ADMIN_PASSWORD,
  });
  expect(login.status).toBe(200);
  adminToken = login.body.token as string;
});

afterAll(async () => {
  await prisma.reportRun.deleteMany({
    where: {
      reportType: ScheduledReportType.SALES,
      period: ReportPeriod.DAILY,
    },
  });
  await prisma.reportScheduleConfig.upsert({
    where: { id: "default" },
    create: { id: "default", notifyEmail: "" },
    update: {
      notifyEmail: "",
      salesEnabled: false,
      salesPeriod: null,
      inventoryEnabled: false,
      inventoryPeriod: null,
      supplierOutstandingEnabled: false,
      supplierOutstandingPeriod: null,
      customerOutstandingEnabled: false,
      customerOutstandingPeriod: null,
    },
  });
});

function authAdmin(): { Authorization: string } {
  return { Authorization: `Bearer ${adminToken}` };
}

describe("reportPeriods", () => {
  it("computes previous daily period in IST", () => {
    const ref = DateTime.fromISO("2026-07-05T06:30:00", { zone: REPORT_ZONE });
    const bounds = computePreviousPeriodBounds(ReportPeriod.DAILY, ref);
    expect(bounds.label).toBe("4 July 2026");
    const start = DateTime.fromJSDate(bounds.periodStart).setZone(REPORT_ZONE);
    expect(start.toFormat("yyyy-MM-dd")).toBe("2026-07-04");
  });

  it("computes previous monthly period in IST", () => {
    const ref = DateTime.fromISO("2026-07-01T07:00:00", { zone: REPORT_ZONE });
    const bounds = computePreviousPeriodBounds(ReportPeriod.MONTHLY, ref);
    expect(bounds.label).toBe("June 2026");
  });

  it("computes previous Indian FY quarter in IST", () => {
    const ref = DateTime.fromISO("2026-07-01T07:00:00", { zone: REPORT_ZONE });
    const bounds = computePreviousPeriodBounds(ReportPeriod.QUARTERLY, ref);
    expect(bounds.label).toBe("Q1 FY 2026-27");
    const start = DateTime.fromJSDate(bounds.periodStart).setZone(REPORT_ZONE);
    const end = DateTime.fromJSDate(bounds.periodEnd).setZone(REPORT_ZONE);
    expect(start.toFormat("yyyy-MM-dd")).toBe("2026-04-01");
    expect(end.toFormat("yyyy-MM-dd")).toBe("2026-06-30");
  });

  it("computes previous Indian FY Q4 on 1 April", () => {
    const ref = DateTime.fromISO("2026-04-01T07:00:00", { zone: REPORT_ZONE });
    const bounds = computePreviousPeriodBounds(ReportPeriod.QUARTERLY, ref);
    expect(bounds.label).toBe("Q4 FY 2025-26");
    const start = DateTime.fromJSDate(bounds.periodStart).setZone(REPORT_ZONE);
    expect(start.toFormat("yyyy-MM-dd")).toBe("2026-01-01");
  });

  it("computes previous yearly period in IST", () => {
    const ref = DateTime.fromISO("2026-01-01T07:00:00", { zone: REPORT_ZONE });
    const bounds = computePreviousPeriodBounds(ReportPeriod.YEARLY, ref);
    expect(bounds.label).toBe("2025");
  });

  it("isSchedulerWindowOpen respects 06:00 IST and frequency", () => {
    const early = DateTime.fromISO("2026-07-05T05:59:00", { zone: REPORT_ZONE });
    expect(isSchedulerWindowOpen(ReportPeriod.DAILY, early)).toBe(false);

    const daily = DateTime.fromISO("2026-07-05T06:01:00", { zone: REPORT_ZONE });
    expect(isSchedulerWindowOpen(ReportPeriod.DAILY, daily)).toBe(true);

    const yearlyFeb = DateTime.fromISO("2026-02-01T07:00:00", {
      zone: REPORT_ZONE,
    });
    expect(isSchedulerWindowOpen(ReportPeriod.YEARLY, yearlyFeb)).toBe(false);

    const yearlyJan = DateTime.fromISO("2026-01-15T07:00:00", {
      zone: REPORT_ZONE,
    });
    expect(isSchedulerWindowOpen(ReportPeriod.YEARLY, yearlyJan)).toBe(true);
  });
});

describe("reportScheduleSlots", () => {
  it("assigns 30 min stagger slots in stable order", () => {
    expect(reportSlotTimeLabel(REPORT_RUN_ORDER[0])).toBe("06:00 IST");
    expect(reportSlotTimeLabel(REPORT_RUN_ORDER[1])).toBe("06:30 IST");
    expect(reportSlotTimeLabel(REPORT_RUN_ORDER[2])).toBe("07:00 IST");
    expect(reportSlotTimeLabel(REPORT_RUN_ORDER[3])).toBe("07:30 IST");
  });

  it("isReportSlotReached gates each type by stagger time", () => {
    const at600 = DateTime.fromISO("2026-07-05T06:00:00", { zone: REPORT_ZONE });
    const at630 = DateTime.fromISO("2026-07-05T06:30:00", { zone: REPORT_ZONE });
    expect(isReportSlotReached(REPORT_RUN_ORDER[0], at600)).toBe(true);
    expect(isReportSlotReached(REPORT_RUN_ORDER[1], at600)).toBe(false);
    expect(isReportSlotReached(REPORT_RUN_ORDER[1], at630)).toBe(true);
  });
});

describe("scheduled-reports API", () => {
  it("GET /config returns schedule config for admin", async () => {
    const res = await request(app)
      .get("/api/scheduled-reports/config")
      .set(authAdmin());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("notifyEmail");
    expect(res.body).toHaveProperty("salesEnabled");
  });

  it("GET /config returns 403 for cashier", async () => {
    const login = await request(app).post("/api/login").send({
      username: "cashier",
      password: "cashier123",
    });
    const res = await request(app)
      .get("/api/scheduled-reports/config")
      .set({ Authorization: `Bearer ${login.body.token}` });
    expect(res.status).toBe(403);
  });

  it("PUT /config validates enabled report requires email and period", async () => {
    const res = await request(app)
      .put("/api/scheduled-reports/config")
      .set(authAdmin())
      .send({
        notifyEmail: "",
        salesEnabled: true,
        salesPeriod: "DAILY",
        inventoryEnabled: false,
        inventoryPeriod: null,
        supplierOutstandingEnabled: false,
        supplierOutstandingPeriod: null,
        customerOutstandingEnabled: false,
        customerOutstandingPeriod: null,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  it("PUT /config saves valid configuration", async () => {
    const res = await request(app)
      .put("/api/scheduled-reports/config")
      .set(authAdmin())
      .send({
        notifyEmail: "owner@test.example",
        salesEnabled: true,
        salesPeriod: "MONTHLY",
        inventoryEnabled: false,
        inventoryPeriod: null,
        supplierOutstandingEnabled: false,
        supplierOutstandingPeriod: null,
        customerOutstandingEnabled: false,
        customerOutstandingPeriod: null,
      });
    expect(res.status).toBe(200);
    expect(res.body.salesEnabled).toBe(true);
    expect(res.body.salesPeriod).toBe("MONTHLY");
  });

  it("GET /runs lists report history", async () => {
    const res = await request(app)
      .get("/api/scheduled-reports/runs?limit=10")
      .set(authAdmin());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.runs)).toBe(true);
  });
});

describe("scheduled report generation", () => {
  it("runDueScheduledReports runs only one report per invocation when all are due", async () => {
    const ref = DateTime.fromISO("2026-07-05T07:00:00", { zone: REPORT_ZONE });

    await prisma.reportRun.deleteMany({
      where: { period: ReportPeriod.DAILY },
    });

    await prisma.reportScheduleConfig.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        notifyEmail: "owner@test.example",
        salesEnabled: true,
        salesPeriod: ReportPeriod.DAILY,
        inventoryEnabled: true,
        inventoryPeriod: ReportPeriod.DAILY,
      },
      update: {
        notifyEmail: "owner@test.example",
        salesEnabled: true,
        salesPeriod: ReportPeriod.DAILY,
        inventoryEnabled: true,
        inventoryPeriod: ReportPeriod.DAILY,
        supplierOutstandingEnabled: false,
        supplierOutstandingPeriod: null,
        customerOutstandingEnabled: false,
        customerOutstandingPeriod: null,
      },
    });

    const originalNow = DateTime.now;
    DateTime.now = () => ref;

    try {
      await runDueScheduledReports();
      const afterFirst = await prisma.reportRun.count({
        where: { period: ReportPeriod.DAILY, status: ReportRunStatus.COMPLETED },
      });
      expect(afterFirst).toBe(1);

      await runDueScheduledReports();
      const afterSecond = await prisma.reportRun.count({
        where: { period: ReportPeriod.DAILY, status: ReportRunStatus.COMPLETED },
      });
      expect(afterSecond).toBe(2);
    } finally {
      DateTime.now = originalNow;
    }
  });

  it("runDueScheduledReports is idempotent for the same period", async () => {
    const ref = DateTime.fromISO("2026-07-05T07:00:00", { zone: REPORT_ZONE });
    const bounds = computePreviousPeriodBounds(ReportPeriod.DAILY, ref);

    await prisma.reportRun.deleteMany({
      where: {
        reportType: ScheduledReportType.SALES,
        period: ReportPeriod.DAILY,
        periodStart: bounds.periodStart,
      },
    });

    await prisma.reportScheduleConfig.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        notifyEmail: "owner@test.example",
        salesEnabled: true,
        salesPeriod: ReportPeriod.DAILY,
      },
      update: {
        notifyEmail: "owner@test.example",
        salesEnabled: true,
        salesPeriod: ReportPeriod.DAILY,
        inventoryEnabled: false,
        inventoryPeriod: null,
        supplierOutstandingEnabled: false,
        supplierOutstandingPeriod: null,
        customerOutstandingEnabled: false,
        customerOutstandingPeriod: null,
      },
    });

    const originalNow = DateTime.now;
    DateTime.now = () => ref;

    try {
      await runDueScheduledReports();
      await runDueScheduledReports();

      const runs = await prisma.reportRun.findMany({
        where: {
          reportType: ScheduledReportType.SALES,
          period: ReportPeriod.DAILY,
          periodStart: bounds.periodStart,
        },
      });
      expect(runs.length).toBe(1);
      expect(runs[0]?.status).toBe(ReportRunStatus.COMPLETED);
      expect(runs[0]?.payload).toBeTruthy();
    } finally {
      DateTime.now = originalNow;
    }
  });
});
