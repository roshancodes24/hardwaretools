import { Router } from "express";
import { validateBody } from "../middleware/validateBody";
import { createPurchase } from "../services/inventory";
import type { CreatePurchaseValidated } from "../validation/schemas";
import { createPurchaseSchema } from "../validation/schemas";

const router = Router();

router.post(
  "/",
  validateBody(createPurchaseSchema),
  async (req, res) => {
    const body = req.validatedBody as CreatePurchaseValidated;
    try {
      const purchase = await createPurchase({
        supplierId: body.supplierId,
        createdById: body.createdById,
        invoiceNumber: body.invoiceNumber,
        invoiceDate: body.invoiceDate,
        note: body.note,
        lines: body.lines,
      });
      res.status(201).json(purchase);
    } catch (error) {
      console.error("POST /purchases failed:", error);
      res.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to create purchase",
      });
    }
  }
);

export default router;
