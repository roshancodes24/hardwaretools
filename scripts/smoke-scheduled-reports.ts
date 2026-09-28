/**
 * Smoke test scheduled owner reports (all four report types + API).
 * Usage: npx tsx scripts/smoke-scheduled-reports.ts
 */
import request from "supertest";
import { DateTime } from "luxon";
import { ReportPeriod, ScheduledReportType } from "@prisma/client";
import { buildApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { runDueScheduledReports } from "../src/services/scheduledReports";

const app = buildApp();
const ADMIN = { username: "admin", password: "admin123" };

const errors: string[] = [];
const ok = (label: string) => console.log(`  OK  ${label}`);
const fail = (label: string, detail: string) => {
  console.error(` FAIL ${label}: ${detail}`);
  errors.push(`${label}: ${detail}`);
};

async function main() {
  console.log("Scheduled reports smoke test\n");

  const login = await request(app).post("/api/login").send(ADMIN);
  if (login.status !== 200) {
    fail("login", String(login.body?.error ?? login.status));
    process.exit(1);
  }
  const auth = { Authorization: `Bearer ${login.body.token as string}` };
  ok("admin login");

  const putCfg = await request(app)
    .put("/api/scheduled-reports/config")
    .set(auth)
    .send({
      notifyEmail: "owner@test.example",
      salesEnabled: true,
      salesPeriod: "DAILY",
      inventoryEnabled: true,
      inventoryPeriod: "DAILY",
      supplierOutstandingEnabled: true,
      supplierOutstandingPeriod: "DAILY",
      customerOutstandingEnabled: true,
      customerOutstandingPeriod: "DAILY",
    });
  if (putCfg.status !== 200) fail("PUT config", String(putCfg.body?.error ?? putCfg.status));
  else ok("PUT config (all types daily)");

  const ref = DateTime.fromISO("2026-07-05T08:00:00", { zone: "Asia/Kolkata" });
  const originalNow = DateTime.now;
  DateTime.now = () => ref;

  try {
    for (let i = 0; i < 4; i += 1) {
      await runDueScheduledReports();
    }
    ok("runDueScheduledReports (4 staggered passes for 4 types)");
    await runDueScheduledReports();
    ok("runDueScheduledReports (idempotent fifth pass)");

    for (const type of [
      ScheduledReportType.SALES,
      ScheduledReportType.INVENTORY,
      ScheduledReportType.SUPPLIER_OUTSTANDING,
      ScheduledReportType.CUSTOMER_OUTSTANDING,
    ]) {
      const runs = await prisma.reportRun.findMany({
        where: { reportType: type, period: ReportPeriod.DAILY },
        orderBy: { createdAt: "desc" },
        take: 1,
      });
      const run = runs[0];
      if (!run) {
        fail(`generated ${type}`, "no run row");
        continue;
      }
      if (run.status !== "COMPLETED") {
        fail(`generated ${type}`, `status=${run.status} ${run.errorMessage ?? ""}`);
        continue;
      }
      if (!run.payload) {
        fail(`generated ${type}`, "empty payload");
        continue;
      }
      ok(`generated ${type}`);

      const detail = await request(app)
        .get(`/api/scheduled-reports/runs/${run.id}`)
        .set(auth);
      if (detail.status !== 200 || !detail.body.payload) {
        fail(`GET run ${type}`, String(detail.body?.error ?? detail.status));
      } else {
        ok(`GET run detail ${type}`);
      }
    }

    const list = await request(app).get("/api/scheduled-reports/runs?limit=20").set(auth);
    if (list.status !== 200 || !Array.isArray(list.body.runs) || list.body.runs.length < 4) {
      fail("GET runs list", `got ${list.body.runs?.length ?? 0} runs`);
    } else {
      ok(`GET runs list (${list.body.runs.length} rows)`);
    }
  } finally {
    DateTime.now = originalNow;
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
  }

  console.log("");
  if (errors.length) {
    console.error(`${errors.length} error(s):`);
    for (const e of errors) console.error(" -", e);
    process.exit(1);
  }
  console.log("All smoke checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
