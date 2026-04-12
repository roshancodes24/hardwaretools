import { Router, type Request, type Response } from "express";
import { requireAdmin } from "../middleware/requireRole";
import {
  getDashboardTimeSeries,
  getGrossMarginReport,
  getPurchasesReport,
  getSalesByProductReport,
  getSalesRevenueTimeSeries,
  getSalesSummaryReport,
  parseReportRange,
} from "../services/reports";
import type { SalesRevenueGranularity } from "../services/reports";

const router = Router();

router.use(requireAdmin);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function reportRangeOrThrow(req: Request) {
  const from = String(req.query.from ?? "").trim();
  const to = String(req.query.to ?? "").trim();
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    throw new Error(
      "Query parameters 'from' and 'to' are required (format YYYY-MM-DD)."
    );
  }
  return parseReportRange(from, to);
}

function sendReportError(res: Response, error: unknown, label: string) {
  const message =
    error instanceof Error ? error.message : "Report failed";
  const status = message.includes("required") || message.includes("Invalid") || message.includes("must be") ? 400 : 500;
  if (status >= 500) {
    console.error(`${label}:`, error);
  }
  res.status(status).json({ error: message });
}

router.get("/sales-summary", async (req, res) => {
  try {
    const range = reportRangeOrThrow(req);
    const data = await getSalesSummaryReport(range);
    res.status(200).json(data);
  } catch (error) {
    sendReportError(res, error, "GET /reports/sales-summary");
  }
});

router.get("/sales-by-product", async (req, res) => {
  try {
    const range = reportRangeOrThrow(req);
    const data = await getSalesByProductReport(range);
    res.status(200).json(data);
  } catch (error) {
    sendReportError(res, error, "GET /reports/sales-by-product");
  }
});

router.get("/purchases", async (req, res) => {
  try {
    const range = reportRangeOrThrow(req);
    const data = await getPurchasesReport(range);
    res.status(200).json(data);
  } catch (error) {
    sendReportError(res, error, "GET /reports/purchases");
  }
});

router.get("/gross-margin", async (req, res) => {
  try {
    const range = reportRangeOrThrow(req);
    const data = await getGrossMarginReport(range);
    res.status(200).json(data);
  } catch (error) {
    sendReportError(res, error, "GET /reports/gross-margin");
  }
});

router.get("/dashboard-timeseries", async (req, res) => {
  try {
    const raw = Number.parseInt(String(req.query.days ?? "14"), 10);
    const days = Number.isFinite(raw) ? raw : 14;
    const data = await getDashboardTimeSeries(days);
    res.status(200).json({ days: data.length, series: data });
  } catch (error) {
    sendReportError(res, error, "GET /reports/dashboard-timeseries");
  }
});

router.get("/sales-revenue-series", async (req, res) => {
  try {
    const g = String(req.query.granularity ?? "day").toLowerCase();
    if (g !== "day" && g !== "week" && g !== "month") {
      res.status(400).json({
        error: "granularity must be day, week, or month",
      });
      return;
    }
    const raw = Number.parseInt(String(req.query.buckets ?? ""), 10);
    const defaultBuckets = g === "day" ? 14 : 12;
    const buckets = Number.isFinite(raw) ? raw : defaultBuckets;
    const series = await getSalesRevenueTimeSeries(
      g as SalesRevenueGranularity,
      buckets
    );
    res.status(200).json({ granularity: g, buckets: series.length, series });
  } catch (error) {
    sendReportError(res, error, "GET /reports/sales-revenue-series");
  }
});

export default router;
