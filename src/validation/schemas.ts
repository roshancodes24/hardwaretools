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

const optionalSupplierTrimmed = (max: number, label: string) =>
  z.preprocess(
    (v) => (v === null || v === undefined || v === "" ? undefined : v),
    z.string().trim().max(max, `${label} is too long`).optional()
  );

export const createSupplierSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(200, "Name is too long"),
  contactPerson: optionalSupplierTrimmed(200, "Contact person"),
  phone: optionalSupplierTrimmed(50, "Phone"),
  email: z.preprocess(
    (v) => (v === null || v === undefined || v === "" ? undefined : v),
    z
      .string()
      .trim()
      .max(255, "Email is too long")
      .email("Invalid email")
      .optional()
  ),
  address: optionalSupplierTrimmed(500, "Address"),
  gstNumber: optionalSupplierTrimmed(50, "GST number"),
  note: optionalSupplierTrimmed(5000, "Note"),
});

export type CreateSupplierValidated = z.infer<typeof createSupplierSchema>;

// ── Product batch creation ──────────────────────────────────────────────────

const optionalNonNegative = z.preprocess(
  (v) => (v === null || v === undefined || v === "" ? undefined : v),
  z.coerce.number().finite("Must be finite").min(0, "Must be ≥ 0").optional()
);

export const productCreateItemSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(500, "Name is too long"),
  description: z.string().trim().max(2000).optional(),
  category: z.enum(["Electrical", "Hardware", "Paint"], {
    error: "Category must be Electrical, Hardware, or Paint",
  }),
  brand: z.string().trim().max(200).optional(),
  baseUnitCode: z
    .string()
    .trim()
    .min(1, "Unit code is required")
    .max(50, "Unit code is too long"),
  unitKind: z.enum(["PIECE", "WEIGHT", "LENGTH", "VOLUME", "PACK", "OTHER"]),
  allowsFractional: z.boolean().optional().default(false),
  sellingPrice: optionalNonNegative,
  costPrice: optionalNonNegative,
  taxRate: z.preprocess(
    (v) => (v === null || v === undefined || v === "" ? undefined : v),
    z.coerce
      .number()
      .finite()
      .min(0, "Tax must be ≥ 0")
      .max(100, "Tax must be ≤ 100")
      .optional()
  ),
  currentStock: z.preprocess(
    (v) => (v === null || v === undefined || v === "" ? 0 : v),
    z.coerce.number().finite().min(0, "Stock must be ≥ 0").default(0)
  ),
  reorderLevel: optionalNonNegative,
});

export const batchCreateProductsSchema = z.object({
  products: z
    .array(productCreateItemSchema)
    .min(1, "At least one product is required"),
});

export type ProductCreateItemValidated = z.infer<
  typeof productCreateItemSchema
>;
export type BatchCreateProductsValidated = z.infer<
  typeof batchCreateProductsSchema
>;
