import { ReportPeriod } from "@prisma/client";
import { Router, type Request, type Response } from "express";
import { requireAdmin } from "../middleware/requireRole";
import {
  getOrCreateReportScheduleConfig,
  getReportRunById,
  listReportRuns,
  updateReportScheduleConfig,
} from "../services/scheduledReports";
import { reportScheduleConfigSchema } from "../validation/schemas";

const router = Router();

router.use(requireAdmin);

function sendError(res: Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : "Request failed";
  const status =
    message.includes("required") ||
    message.includes("Invalid") ||
    message.includes("must be") ||
    message.includes("email")
      ? 400
      : 500;
  if (status >= 500) {
    console.error(`${label}:`, error);
  }
  res.status(status).json({ error: message });
}

router.get("/config", async (_req, res) => {
  try {
    const config = await getOrCreateReportScheduleConfig();
    res.status(200).json(config);
  } catch (error) {
    sendError(res, error, "GET /scheduled-reports/config");
  }
});

router.put("/config", async (req, res) => {
  try {
    const parsed = reportScheduleConfigSchema.parse(req.body);
    const config = await updateReportScheduleConfig(parsed);
    res.status(200).json(config);
  } catch (error) {
    sendError(res, error, "PUT /scheduled-reports/config");
  }
});

router.get("/runs", async (req, res) => {
  try {
    const limitRaw = Number.parseInt(String(req.query.limit ?? "50"), 10);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
    const runs = await listReportRuns(limit);
    res.status(200).json({ runs });
  } catch (error) {
    sendError(res, error, "GET /scheduled-reports/runs");
  }
});

router.get("/runs/:id", async (req: Request<{ id: string }>, res) => {
  try {
    const run = await getReportRunById(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Report run not found" });
      return;
    }
    res.status(200).json(run);
  } catch (error) {
    sendError(res, error, "GET /scheduled-reports/runs/:id");
  }
});

export default router;
