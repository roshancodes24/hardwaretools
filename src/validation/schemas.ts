import { ProductStatus } from "@prisma/client";
import { z } from "zod";

const nonNegativeMoney = z.coerce
  .number({ error: "Must be a number" })
  .finite("Must be a finite number")
  .min(0, "Must be greater than or equal to 0");

const positiveQty = z.coerce
  .number({ error: "Must be a number" })
  .finite("Must be a finite number")
  .gt(0, "Must be greater than 0");

const positiveMoney = z.coerce
  .number({ error: "Must be a number" })
  .finite("Must be a finite number")
  .gt(0, "Must be greater than 0");

const nonNegativeStock = z.coerce
  .number({ error: "Must be a number" })
  .finite("Must be a finite number")
  .min(0, "Must be greater than or equal to 0");

const optionalSupplierTrimmed = (max: number, label: string) =>
  z.preprocess(
    (v) => (v === null || v === undefined || v === "" ? undefined : v),
    z.string().trim().max(max, `${label} is too long`).optional()
  );

export const saleLineSchema = z.object({
  productId: z.string().trim().min(1, "productId is required"),
  productUnitId: z.string().trim().min(1, "productUnitId is required"),
  quantity: positiveQty,
  unitPrice: nonNegativeMoney,
  lineDiscount: nonNegativeMoney.optional().default(0),
  lineTax: nonNegativeMoney.optional().default(0),
});

const optionalCustomerId = z.preprocess(
  (v) => (v === null || v === undefined || v === "" ? undefined : v),
  z.string().trim().min(1, "customerId is invalid").optional()
);

export const createSaleSchema = z.object({
  createdById: z.string().trim().min(1, "createdById is required"),
  customerId: optionalCustomerId,
  customerName: z.string().trim().max(500).optional(),
  customerPhone: z.string().trim().max(50).optional(),
  note: z.string().max(5000).optional(),
  paidAmount: nonNegativeMoney,
  lines: z
    .array(saleLineSchema)
    .min(1, "At least one line item is required"),
});

export const recordSalePaymentSchema = z.object({
  amount: positiveMoney,
  createdById: z.string().trim().min(1, "createdById is required"),
  note: z.string().max(500).optional(),
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
export type RecordSalePaymentValidated = z.infer<
  typeof recordSalePaymentSchema
>;

export const createCustomerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(500, "Name is too long"),
  phone: z
    .string()
    .trim()
    .min(1, "Phone number is required to save a customer.")
    .max(50, "Phone is too long"),
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
});

export type CreateCustomerValidated = z.infer<typeof createCustomerSchema>;
export type CreatePurchaseValidated = z.infer<typeof createPurchaseSchema>;
export type CreateStockAdjustmentValidated = z.infer<
  typeof createStockAdjustmentSchema
>;

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

const optionalDateField = z.preprocess(
  (v) => (v === null || v === undefined || v === "" ? undefined : v),
  z.coerce.date().optional()
);

export const createPromotionSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Name is required")
      .max(200, "Name is too long"),
    code: z.preprocess(
      (v) => (v === null || v === undefined || v === "" ? undefined : v),
      z
        .string()
        .trim()
        .min(1, "Code is required")
        .max(50, "Code is too long")
        .optional()
    ),
    scope: z.enum(["CART", "PRODUCT", "CATEGORY"]),
    percentage: z.coerce
      .number()
      .finite("Percentage must be finite")
      .gt(0, "Percentage must be greater than 0")
      .max(100, "Percentage must be less than or equal to 100"),
    category: z.preprocess(
      (v) => (v === null || v === undefined || v === "" ? undefined : v),
      z.enum(["Electrical", "Hardware", "Paint"]).optional()
    ),
    productIds: z.array(z.string().trim().min(1)).optional(),
    isActive: z.boolean().optional().default(true),
    startsAt: optionalDateField,
    endsAt: optionalDateField,
    note: z.preprocess(
      (v) => (v === null || v === undefined || v === "" ? undefined : v),
      z.string().trim().max(2000, "Note is too long").optional()
    ),
  })
  .superRefine((v, ctx) => {
    if (v.scope === "CART" && !v.code) {
      ctx.addIssue({
        code: "custom",
        path: ["code"],
        message: "Code is required for cart promotions",
      });
    }
    if (v.scope === "CATEGORY" && !v.category) {
      ctx.addIssue({
        code: "custom",
        path: ["category"],
        message: "Category is required for category promotions",
      });
    }
    if (v.scope === "PRODUCT" && (!v.productIds || v.productIds.length === 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["productIds"],
        message: "At least one product is required for product promotions",
      });
    }
    if (v.startsAt && v.endsAt && v.startsAt > v.endsAt) {
      ctx.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "End date must be after start date",
      });
    }
  });

export type CreatePromotionValidated = z.infer<typeof createPromotionSchema>;
export const updatePromotionSchema = createPromotionSchema;
export type UpdatePromotionValidated = z.infer<typeof updatePromotionSchema>;

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

export type BatchCreateProductsValidated = z.infer<
  typeof batchCreateProductsSchema
>;

/** Partial update — at least one field required (validated by refine). */
export const updateProductBodySchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(500, "Name is too long").optional(),
    description: z.preprocess(
      (v) => (v === null || v === undefined ? undefined : v === "" ? null : v),
      z.union([z.string().trim().max(2000), z.null()]).optional()
    ),
    category: z.enum(["Electrical", "Hardware", "Paint"]).optional(),
    brand: z.preprocess(
      (v) => {
        if (v === undefined || v === "") return undefined;
        if (v === null) return null;
        return v;
      },
      z.union([z.string().trim().max(200), z.null()]).optional()
    ),
    sellingPrice: optionalNonNegative,
    costPrice: optionalNonNegative,
    taxRate: z.preprocess(
      (v) => (v === null || v === undefined || v === "" ? undefined : v),
      z.coerce.number().finite().min(0).max(100).optional()
    ),
    reorderLevel: optionalNonNegative,
    allowsFractional: z.boolean().optional(),
    status: z.nativeEnum(ProductStatus).optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
    path: ["_root"],
  });

export type UpdateProductBodyValidated = z.infer<typeof updateProductBodySchema>;

/** Strip domain if user pasted an email (e.g. admin@shop.com → admin). */
function loginUsernameFromInput(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const s = raw.trim();
  const at = s.indexOf("@");
  if (at > 0) return s.slice(0, at).trim();
  return s;
}

export const loginBodySchema = z.object({
  username: z.preprocess(
    loginUsernameFromInput,
    z
      .string()
      .min(1, "Username is required")
      .max(64, "Username is too long")
      .regex(
        /^[a-zA-Z0-9._-]+$/,
        "Username may only contain letters, numbers, dot, underscore, hyphen"
      )
      .transform((s) => s.toLowerCase())
  ),
  password: z.string().min(1, "Password is required"),
});

export type LoginBodyValidated = z.infer<typeof loginBodySchema>;
