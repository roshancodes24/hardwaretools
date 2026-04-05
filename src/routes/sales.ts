import { Router } from "express";
import { validateBody } from "../middleware/validateBody";
import { createSale } from "../services/inventory";
import type { CreateSaleValidated } from "../validation/schemas";
import { createSaleSchema } from "../validation/schemas";

const router = Router();

router.post(
  "/",
  validateBody(createSaleSchema),
  async (req, res) => {
    const body = req.validatedBody as CreateSaleValidated;
    try {
      const sale = await createSale({
        createdById: body.createdById,
        customerName: body.customerName,
        customerPhone: body.customerPhone,
        note: body.note,
        paidAmount: body.paidAmount,
        lines: body.lines,
      });
      res.status(201).json(sale);
    } catch (error) {
      console.error("POST /sales failed:", error);
      res.status(400).json({
        error:
          error instanceof Error ? error.message : "Failed to create sale",
      });
    }
  }
);

export default router;
