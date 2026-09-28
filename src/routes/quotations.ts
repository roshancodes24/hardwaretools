import { Router } from "express";
import { requireAdmin } from "../middleware/requireRole";
import { validateBody } from "../middleware/validateBody";
import { clientPricingOverrideMessage } from "../lib/quotationInputGuard";
import { parseIsoDate } from "../lib/quotationDates";
import { renderQuotationPdf } from "../services/quotationPdf";
import {
  QuotationError,
  cancelQuotation,
  createQuotation,
  getQuotation,
  issueQuotation,
  listQuotations,
  updateQuotation,
} from "../services/quotations";
import type { QuotationWriteValidated } from "../validation/schemas";
import { quotationWriteSchema } from "../validation/schemas";

const router = Router();

router.use(requireAdmin);

function paramId(v: string | string[] | undefined): string {
  const raw = Array.isArray(v) ? v[0] : v;
  return (raw ?? "").trim();
}

function rejectClientTotals(
  body: unknown
): { ok: true } | { ok: false; message: string } {
  const message = clientPricingOverrideMessage(body);
  if (message) return { ok: false, message };
  return { ok: true };
}

function sendError(res: import("express").Response, error: unknown, label: string) {
  if (error instanceof QuotationError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  console.error(label, error);
  res.status(500).json({ error: "Quotation request failed" });
}

router.post("/", (req, res, next) => {
  const guard = rejectClientTotals(req.body);
  if (!guard.ok) {
    res.status(422).json({ error: guard.message });
    return;
  }
  next();
}, validateBody(quotationWriteSchema), async (req, res) => {
  const acting = req.actingUser;
  if (!acting) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const body = req.validatedBody as QuotationWriteValidated;
  try {
    const quotation = await createQuotation({
      ...body,
      createdById: acting.id,
    });
    res.status(201).json(quotation);
  } catch (error) {
    sendError(res, error, "POST /quotations failed:");
  }
});

router.get("/", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const customerId = String(req.query.customerId ?? "").trim();
  const statusRaw = String(req.query.status ?? "").trim().toUpperCase();
  const status =
    statusRaw === "DRAFT" ||
    statusRaw === "ISSUED" ||
    statusRaw === "EXPIRED" ||
    statusRaw === "CANCELLED"
      ? statusRaw
      : undefined;
  if (statusRaw && !status) {
    res.status(400).json({ error: "Invalid status filter." });
    return;
  }

  const fromRaw = String(req.query.from ?? "").trim();
  const toRaw = String(req.query.to ?? "").trim();
  const from = fromRaw ? parseIsoDate(fromRaw) : undefined;
  const to = toRaw ? parseIsoDate(toRaw) : undefined;
  if (fromRaw && !from) {
    res.status(400).json({ error: "Invalid from date. Use YYYY-MM-DD." });
    return;
  }
  if (toRaw && !to) {
    res.status(400).json({ error: "Invalid to date. Use YYYY-MM-DD." });
    return;
  }

  let page = Number.parseInt(String(req.query.page ?? "1"), 10);
  let limit = Number.parseInt(String(req.query.limit ?? "20"), 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(limit) || limit < 1) limit = 20;
  limit = Math.min(100, limit);

  try {
    const result = await listQuotations({
      q: q || undefined,
      customerId: customerId || undefined,
      status,
      from: from ?? undefined,
      to: to ?? undefined,
      page,
      limit,
    });
    res.status(200).json(result);
  } catch (error) {
    sendError(res, error, "GET /quotations failed:");
  }
});

router.get("/:id/pdf", async (req, res) => {
  const id = paramId(req.params.id);
  if (!id) {
    res.status(404).json({ error: "Quotation not found." });
    return;
  }
  try {
    const quotation = await getQuotation(id);
    const pdf = await renderQuotationPdf(quotation);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${quotation.quotationNumber}.pdf"`
    );
    res.status(200).send(pdf);
  } catch (error) {
    sendError(res, error, "GET /quotations/:id/pdf failed:");
  }
});

router.get("/:id", async (req, res) => {
  const id = paramId(req.params.id);
  if (!id) {
    res.status(404).json({ error: "Quotation not found." });
    return;
  }
  try {
    res.status(200).json(await getQuotation(id));
  } catch (error) {
    sendError(res, error, "GET /quotations/:id failed:");
  }
});

router.patch("/:id", (req, res, next) => {
  const guard = rejectClientTotals(req.body);
  if (!guard.ok) {
    res.status(422).json({ error: guard.message });
    return;
  }
  next();
}, validateBody(quotationWriteSchema), async (req, res) => {
  const id = paramId(req.params.id);
  if (!id) {
    res.status(404).json({ error: "Quotation not found." });
    return;
  }
  const body = req.validatedBody as QuotationWriteValidated;
  try {
    res.status(200).json(await updateQuotation(id, body));
  } catch (error) {
    sendError(res, error, "PATCH /quotations/:id failed:");
  }
});

router.post("/:id/issue", async (req, res) => {
  const id = paramId(req.params.id);
  if (!id) {
    res.status(404).json({ error: "Quotation not found." });
    return;
  }
  try {
    res.status(200).json(await issueQuotation(id));
  } catch (error) {
    sendError(res, error, "POST /quotations/:id/issue failed:");
  }
});

router.post("/:id/cancel", async (req, res) => {
  const id = paramId(req.params.id);
  if (!id) {
    res.status(404).json({ error: "Quotation not found." });
    return;
  }
  try {
    res.status(200).json(await cancelQuotation(id));
  } catch (error) {
    sendError(res, error, "POST /quotations/:id/cancel failed:");
  }
});

export default router;
