import { Router } from "express";
import { Prisma } from "@prisma/client";
import { requireAdmin } from "../middleware/requireRole";
import { prisma } from "../lib/prisma";
import { validateBody } from "../middleware/validateBody";
import type { CreateSupplierValidated } from "../validation/schemas";
import { createSupplierSchema } from "../validation/schemas";

const router = Router();

router.use(requireAdmin);

router.get("/", async (_req, res) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      orderBy: { name: "asc" },
    });
    res.status(200).json(suppliers);
  } catch (error) {
    console.error("GET /suppliers failed:", error);
    res.status(500).json({ error: "Failed to fetch suppliers" });
  }
});

router.post(
  "/",
  validateBody(createSupplierSchema),
  async (req, res) => {
    const body = req.validatedBody as CreateSupplierValidated;
    try {
      const supplier = await prisma.supplier.create({
        data: {
          name: body.name,
          contactPerson: body.contactPerson ?? null,
          phone: body.phone ?? null,
          email: body.email ?? null,
          address: body.address ?? null,
          gstNumber: body.gstNumber ?? null,
          note: body.note ?? null,
        },
      });
      res.status(201).json(supplier);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        res.status(409).json({
          error: {
            code: "SUPPLIER_ALREADY_EXISTS",
            message:
              "A supplier with this name already exists. Please choose it from the dropdown or enter a different name.",
            field: "supplierName",
          },
        });
        return;
      }
      console.error("POST /suppliers failed:", error);
      res.status(500).json({ error: "Failed to create supplier" });
    }
  }
);

export default router;
