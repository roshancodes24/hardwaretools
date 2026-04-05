import { z } from "zod";

const nonNegativeMoney = z.coerce
  .number({ error: "Must be a number" })
  .finite("Must be a finite number")
  .min(0, "Must be greater than or equal to 0");

const positiveQty = z.coerce
  .number({ error: "Must be a number" })
  .finite("Must be a finite number")
  .gt(0, "Must be greater than 0");

const nonNegativeStock = z.coerce
  .number({ error: "Must be a number" })
  .finite("Must be a finite number")
  .min(0, "Must be greater than or equal to 0");

export const saleLineSchema = z.object({
  productId: z.string().trim().min(1, "productId is required"),
  productUnitId: z.string().trim().min(1, "productUnitId is required"),
  quantity: positiveQty,
  unitPrice: nonNegativeMoney,
  lineDiscount: nonNegativeMoney.optional().default(0),
  lineTax: nonNegativeMoney.optional().default(0),
});

export const createSaleSchema = z.object({
  createdById: z.string().trim().min(1, "createdById is required"),
  customerName: z.string().trim().max(500).optional(),
  customerPhone: z.string().trim().max(50).optional(),
  note: z.string().max(5000).optional(),
  paidAmount: nonNegativeMoney,
  lines: z
    .array(saleLineSchema)
    .min(1, "At least one line item is required"),
});

export const purchaseLineSchema = z.object({
  productId: z.string().trim().min(1, "productId is required"),
  productUnitId: z.string().trim().min(1, "productUnitId is required"),
  quantity: positiveQty,
  unitCost: nonNegativeMoney,
  lineDiscount: nonNegativeMoney.optional().default(0),
  lineTax: nonNegativeMoney.optional().default(0),
});

const optionalInvoiceDate = z.preprocess(
  (v) => (v === null || v === undefined || v === "" ? undefined : v),
  z.coerce.date().optional()
);

export const createPurchaseSchema = z.object({
  supplierId: z.string().trim().min(1, "supplierId is required"),
  createdById: z.string().trim().min(1, "createdById is required"),
  invoiceNumber: z.string().trim().max(200).optional(),
  invoiceDate: optionalInvoiceDate,
  note: z.string().max(5000).optional(),
  lines: z
    .array(purchaseLineSchema)
    .min(1, "At least one line item is required"),
});

export const createStockAdjustmentSchema = z.object({
  productId: z.string().trim().min(1, "productId is required"),
  adjustedById: z.string().trim().min(1, "adjustedById is required"),
  quantityAfter: nonNegativeStock,
  reason: z
    .string()
    .trim()
    .min(1, "reason is required")
    .max(1000, "reason is too long"),
  note: z.string().max(5000).optional(),
});

export type CreateSaleValidated = z.infer<typeof createSaleSchema>;
export type CreatePurchaseValidated = z.infer<typeof createPurchaseSchema>;
export type CreateStockAdjustmentValidated = z.infer<
  typeof createStockAdjustmentSchema
>;
