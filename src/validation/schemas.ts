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

/** Customer / supplier / sale walk-in mobile: exactly 10 digits (no spaces or country code). */
const indianMobile10Digits = z
  .string()
  .trim()
  .regex(/^\d{10}$/, "Phone must be exactly 10 digits.");

const optionalIndianMobile10Digits = z.preprocess(
  (v) => {
    if (v === null || v === undefined) return undefined;
    const s = String(v).trim();
    return s === "" ? undefined : s;
  },
  indianMobile10Digits.optional()
);

/** GSTIN-style: letters and digits only (no spaces, hyphens, etc.). */
const gstinAlphanumericSegment = (max: number, label: string) =>
  z
    .string()
    .max(max, `${label} is too long`)
    .regex(
      /^[A-Za-z0-9]+$/,
      `${label} may only contain letters and numbers.`,
    );

const optionalGstinAlphanumeric = (max: number, label: string) =>
  z.preprocess(
    (v) => {
      if (v === null || v === undefined) return undefined;
      const s = String(v).trim();
      return s === "" ? undefined : s;
    },
    gstinAlphanumericSegment(max, label).optional()
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

const saleInitialPaymentSchema = z.object({
  method: z.enum(["cash", "online_banking"]),
  amount: positiveMoney,
});

export const createSaleSchema = z
  .object({
    createdById: z.string().trim().min(1, "createdById is required"),
    customerId: optionalCustomerId,
    customerName: z.string().trim().max(500).optional(),
    customerPhone: optionalIndianMobile10Digits,
    customerPartyGstNo: optionalGstinAlphanumeric(20, "Party GST No."),
    customerPartyState: optionalSupplierTrimmed(100, "State"),
    transportAmount: nonNegativeMoney.optional().default(0),
    note: z.string().max(5000).optional(),
    /** Bill → BIL-* ; GST tax invoice → INV-* (separate counters). */
    documentKind: z.enum(["bill", "tax_invoice"]).optional().default("bill"),
    paidAmount: nonNegativeMoney,
    paymentMethod: z
      .enum(["cash", "online_banking"])
      .optional()
      .default("cash"),
    /** When set, creates one payment row per entry (split cash / online at checkout). */
    initialPayments: z.array(saleInitialPaymentSchema).optional(),
    lines: z
      .array(saleLineSchema)
      .min(1, "At least one line item is required"),
  })
  .superRefine((data, ctx) => {
    if (!data.initialPayments?.length) return;
    const sum = data.initialPayments.reduce(
      (acc, p) => acc + Number(p.amount),
      0
    );
    const paid = Number(data.paidAmount);
    if (Math.abs(sum - paid) > 0.01) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "paidAmount must equal the sum of initialPayments",
        path: ["paidAmount"],
      });
    }
  });

export const recordSalePaymentSchema = z
  .object({
    amount: nonNegativeMoney.optional(),
    createdById: z.string().trim().min(1, "createdById is required"),
    paymentMethod: z
      .enum(["cash", "online_banking"])
      .optional()
      .default("cash"),
    payments: z.array(saleInitialPaymentSchema).optional(),
    note: z.string().max(500).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.payments?.length) {
      const sum = data.payments.reduce(
        (acc, p) => acc + Number(p.amount),
        0
      );
      if (sum <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "At least one split payment amount must be greater than zero",
          path: ["payments"],
        });
      }
      if (
        data.amount != null &&
        data.amount !== undefined &&
        Math.abs(sum - Number(data.amount)) > 0.01
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "amount must equal the sum of payments",
          path: ["amount"],
        });
      }
      return;
    }
    if (data.amount == null || data.amount === undefined || Number(data.amount) <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "amount must be greater than zero",
        path: ["amount"],
      });
    }
  });

const optionalPaidAt = z.preprocess(
  (v) => (v === null || v === undefined || v === "" ? undefined : v),
  z.coerce.date().optional()
);

export const recordPurchasePaymentSchema = z.object({
  amount: positiveMoney,
  createdById: z.string().trim().min(1, "createdById is required"),
  note: z.string().max(500).optional(),
  paidAt: optionalPaidAt,
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
export type RecordPurchasePaymentValidated = z.infer<
  typeof recordPurchasePaymentSchema
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
    .pipe(indianMobile10Digits),
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
  partyGstNo: optionalGstinAlphanumeric(20, "Party GST No."),
  partyState: optionalSupplierTrimmed(100, "State"),
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
  phone: optionalIndianMobile10Digits,
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
  gstNumber: optionalGstinAlphanumeric(50, "GST number"),
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

const optionalPercent0to100 = z.preprocess(
  (v) => (v === null || v === undefined || v === "" ? undefined : v),
  z.coerce
    .number()
    .finite()
    .min(0, "Must be ≥ 0")
    .max(100, "Must be ≤ 100")
    .optional()
);

/** Optional manual SKU (omit or empty → server assigns category sequence SKU). */
const optionalManualSkuSchema = z.preprocess(
  (v) =>
    v === null || v === undefined || v === ""
      ? undefined
      : String(v).trim(),
  z
    .string()
    .min(1, "SKU cannot be empty")
    .max(80, "SKU is too long")
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._\-\/\s]*$/,
      "SKU may only contain letters, numbers, spaces, . _ - /"
    )
    .optional()
);

export const productCreateItemSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(500, "Name is too long"),
  sku: optionalManualSkuSchema,
  description: z.string().trim().max(2000).optional(),
  category: z.enum(["Electrical", "Hardware", "Paint"], {
    error: "Category must be Electrical, Hardware, or Paint",
  }),
  brand: z.string().trim().max(200).optional(),
  brandCode: z.string().trim().max(100).optional(),
  color: z.string().trim().max(100).optional(),
  size: z.string().trim().max(100).optional(),
  baseUnitCode: z
    .string()
    .trim()
    .min(1, "Unit code is required")
    .max(50, "Unit code is too long"),
  unitKind: z.enum(["PIECE", "WEIGHT", "LENGTH", "VOLUME", "PACK", "OTHER"]),
  allowsFractional: z.boolean().optional().default(false),
  sellingPrice: optionalNonNegative,
  costPrice: optionalNonNegative,
  percentage: optionalNonNegative,
  mrp: optionalNonNegative,
  cgstPercent: optionalPercent0to100,
  sgstPercent: optionalPercent0to100,
  igstPercent: optionalPercent0to100,
  currentStock: z.preprocess(
    (v) => (v === null || v === undefined || v === "" ? 0 : v),
    z.coerce.number().finite().min(0, "Stock must be ≥ 0").default(0)
  ),
  reorderLevel: optionalNonNegative,
  hsnCode: optionalSupplierTrimmed(16, "HSN Code"),
});

export const batchCreateProductsSchema = z
  .object({
    products: z
      .array(productCreateItemSchema)
      .min(1, "At least one product is required"),
  })
  .superRefine((data, ctx) => {
    const seen = new Map<string, number>();
    const seenBrandCodes = new Map<string, number>();
    for (let i = 0; i < data.products.length; i++) {
      const brandCode = data.products[i]?.brandCode?.trim().toLowerCase();
      if (brandCode) {
        if (seenBrandCodes.has(brandCode)) {
          ctx.addIssue({
            code: "custom",
            path: ["products", i, "brandCode"],
            message: `Duplicate brand code "${data.products[i]?.brandCode}" in this batch (also row ${(seenBrandCodes.get(brandCode) ?? 0) + 1}).`,
          });
        } else {
          seenBrandCodes.set(brandCode, i);
        }
      }

      const sku = data.products[i]?.sku?.trim();
      if (!sku) continue;
      if (seen.has(sku)) {
        ctx.addIssue({
          code: "custom",
          path: ["products", i, "sku"],
          message: `Duplicate SKU "${sku}" in this batch (also row ${(seen.get(sku) ?? 0) + 1}).`,
        });
      } else {
        seen.set(sku, i);
      }
    }
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
    brandCode: z.preprocess(
      (v) => {
        if (v === undefined || v === "") return undefined;
        if (v === null) return null;
        return v;
      },
      z.union([z.string().trim().max(100), z.null()]).optional()
    ),
    color: z.preprocess(
      (v) => {
        if (v === undefined || v === "") return undefined;
        if (v === null) return null;
        return v;
      },
      z.union([z.string().trim().max(100), z.null()]).optional()
    ),
    size: z.preprocess(
      (v) => {
        if (v === undefined || v === "") return undefined;
        if (v === null) return null;
        return v;
      },
      z.union([z.string().trim().max(100), z.null()]).optional()
    ),
    sellingPrice: optionalNonNegative,
    costPrice: optionalNonNegative,
    percentage: optionalNonNegative,
    mrp: optionalNonNegative,
    cgstPercent: optionalPercent0to100,
    sgstPercent: optionalPercent0to100,
    igstPercent: optionalPercent0to100,
    reorderLevel: optionalNonNegative,
    allowsFractional: z.boolean().optional(),
    status: z.nativeEnum(ProductStatus).optional(),
    hsnCode: z.preprocess(
      (v) => {
        if (v === undefined) return undefined;
        if (v === null || v === "") return null;
        return v;
      },
      z
        .union([
          z.string().trim().max(16, "HSN Code is too long"),
          z.null(),
        ])
        .optional()
    ),
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
