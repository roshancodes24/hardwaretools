import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { validateBody } from "../middleware/validateBody";
import type { CreateCustomerValidated } from "../validation/schemas";
import { createCustomerSchema } from "../validation/schemas";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const customers = await prisma.customer.findMany({
      orderBy: { name: "asc" },
    });
    res.status(200).json(customers);
  } catch (error) {
    console.error("GET /customers failed:", error);
    res.status(500).json({ error: "Failed to fetch customers" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id },
    });
    if (!customer) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }
    res.status(200).json(customer);
  } catch (error) {
    console.error("GET /customers/:id failed:", error);
    res.status(500).json({ error: "Failed to fetch customer" });
  }
});

router.post(
  "/",
  validateBody(createCustomerSchema),
  async (req, res) => {
    const body = req.validatedBody as CreateCustomerValidated;
    try {
      const customer = await prisma.customer.create({
        data: {
          name: body.name,
          phone: body.phone,
          email: body.email ?? null,
          address: body.address ?? null,
        },
      });
      res.status(201).json(customer);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        res.status(409).json({
          error: {
            code: "CUSTOMER_PHONE_EXISTS",
            message:
              "A customer with this phone number already exists. Please select the existing customer.",
            field: "customerPhone",
          },
        });
        return;
      }
      console.error("POST /customers failed:", error);
      res.status(500).json({ error: "Failed to create customer" });
    }
  }
);

export default router;
