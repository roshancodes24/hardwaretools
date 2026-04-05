import { Router } from "express";
import { validateBody } from "../middleware/validateBody";
import { adjustStock } from "../services/inventory";
import type { CreateStockAdjustmentValidated } from "../validation/schemas";
import { createStockAdjustmentSchema } from "../validation/schemas";

const router = Router();

router.post(
  "/",
  validateBody(createStockAdjustmentSchema),
  async (req, res) => {
    const body = req.validatedBody as CreateStockAdjustmentValidated;
    try {
      const result = await adjustStock({
        productId: body.productId,
        adjustedById: body.adjustedById,
        quantityAfter: body.quantityAfter,
        reason: body.reason,
        note: body.note,
      });
      res.status(201).json(result);
    } catch (error) {
      console.error("POST /stock-adjustments failed:", error);
      res.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to adjust stock",
      });
    }
  }
);

export default router;
