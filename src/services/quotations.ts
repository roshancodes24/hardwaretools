import {
  Prisma,
  ProductStatus,
  QuotationStatus,
  type QuotationLine,
} from "@prisma/client";
import { allocateQuotationNumber } from "../lib/documentNumbers";
import {
  formatQuotationDate,
  isQuotationExpired,
  isoDate,
  quotationValidity,
} from "../lib/quotationDates";
import { prisma } from "../lib/prisma";
import {
  d,
  priceQuotation,
  qty,
  type PricedLineInput,
} from "../lib/quotationTotals";
import type { QuotationWriteValidated } from "../validation/schemas";

export class QuotationError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "QuotationError";
    this.statusCode = statusCode;
  }
}

const detailInclude = {
  createdBy: { select: { id: true, fullName: true } },
  convertedSale: { select: { id: true, saleNumber: true } },
  lines: {
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
    include: {
      product: {
        select: {
          currentStock: true,
          sellingPrice: true,
          baseUnitCode: true,
          units: {
            select: {
              id: true,
              code: true,
              displayName: true,
              isBaseUnit: true,
              conversionToBase: true,
              allowsFractionalSale: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.QuotationInclude;

type QuotationRow = Prisma.QuotationGetPayload<{ include: typeof detailInclude }>;

export type QuotationLineDto = {
  id: string;
  productId: string;
  productUnitId: string | null;
  quantity: string;
  quantityInBase: string;
  unitPrice: string;
  lineDiscount: string;
  lineTax: string;
  lineTotal: string;
  productName: string;
  sku: string;
  description: string | null;
  hsnCode: string | null;
  unitCode: string;
  unitDisplayName: string;
  cgstPercent: string;
  sgstPercent: string;
  igstPercent: string;
  /** Live catalog values for the editor. The stored unitPrice is the snapshot. */
  currentSellingPrice: string | null;
  currentStock: string;
  units: Array<{
    id: string;
    code: string;
    displayName: string;
    isBaseUnit: boolean;
    conversionToBase: string;
    allowsFractionalSale: boolean;
  }>;
};

export type QuotationDetailDto = {
  id: string;
  quotationNumber: string;
  /** DRAFT, ISSUED, EXPIRED (derived), CONVERTED (derived: a sale was created from it), or CANCELLED. */
  status: "DRAFT" | "ISSUED" | "EXPIRED" | "CONVERTED" | "CANCELLED";
  recordStatus: QuotationStatus;
  quotationDate: string;
  validUntil: string;
  quotationDateLabel: string;
  validUntilLabel: string;
  /** Sale created from this quotation, if any. A converted quotation cannot be converted again. */
  convertedSaleId: string | null;
  convertedSaleNumber: string | null;
  customerId: string | null;
  customerName: string;
  customerContactPerson: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  customerAddress: string | null;
  customerPartyGstNo: string | null;
  customerPartyState: string | null;
  includeGst: boolean;
  discountPercent: string;
  subtotal: string;
  discountAmount: string;
  taxableAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  taxAmount: string;
  transportAmount: string;
  totalAmount: string;
  note: string | null;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  lines: QuotationLineDto[];
};

export type QuotationListItemDto = {
  id: string;
  quotationNumber: string;
  quotationDate: string;
  validUntil: string;
  customerId: string | null;
  customerName: string;
  totalAmount: string;
  includeGst: boolean;
  status: QuotationDetailDto["status"];
  convertedSaleNumber: string | null;
  createdByName: string;
};

function moneyStr(value: Prisma.Decimal): string {
  return value.toDecimalPlaces(2).toFixed(2);
}

function effectiveStatus(
  status: QuotationStatus,
  validUntil: Date,
  convertedSaleId: string | null
): QuotationDetailDto["status"] {
  if (status === QuotationStatus.ISSUED && convertedSaleId) {
    return "CONVERTED";
  }
  if (status === QuotationStatus.ISSUED && isQuotationExpired(validUntil)) {
    return "EXPIRED";
  }
  return status;
}

function serializeLine(
  line: QuotationLine & {
    product: {
      currentStock: Prisma.Decimal;
      sellingPrice: Prisma.Decimal | null;
      baseUnitCode: string;
      units: Array<{
        id: string;
        code: string;
        displayName: string;
        isBaseUnit: boolean;
        conversionToBase: Prisma.Decimal;
        allowsFractionalSale: boolean;
      }>;
    };
  }
): QuotationLineDto {
  return {
    id: line.id,
    productId: line.productId,
    productUnitId: line.productUnitId,
    quantity: line.quantity.toString(),
    quantityInBase: line.quantityInBase.toString(),
    unitPrice: line.unitPrice.toString(),
    lineDiscount: moneyStr(line.lineDiscount),
    lineTax: moneyStr(line.lineTax),
    lineTotal: moneyStr(line.lineTotal),
    productName: line.productName,
    sku: line.sku,
    description: line.description,
    hsnCode: line.hsnCode,
    unitCode: line.unitCode,
    unitDisplayName: line.unitDisplayName,
    cgstPercent: line.cgstPercent.toString(),
    sgstPercent: line.sgstPercent.toString(),
    igstPercent: line.igstPercent.toString(),
    currentSellingPrice:
      line.product.sellingPrice != null
        ? line.product.sellingPrice.toString()
        : null,
    currentStock: line.product.currentStock.toString(),
    units: line.product.units.map((unit) => ({
      id: unit.id,
      code: unit.code,
      displayName: unit.displayName,
      isBaseUnit: unit.isBaseUnit,
      conversionToBase: unit.conversionToBase.toString(),
      allowsFractionalSale: unit.allowsFractionalSale,
    })),
  };
}

export function serializeQuotation(row: QuotationRow): QuotationDetailDto {
  return {
    id: row.id,
    quotationNumber: row.quotationNumber,
    status: effectiveStatus(row.status, row.validUntil, row.convertedSaleId),
    recordStatus: row.status,
    quotationDate: isoDate(row.quotationDate),
    validUntil: isoDate(row.validUntil),
    quotationDateLabel: formatQuotationDate(row.quotationDate),
    validUntilLabel: formatQuotationDate(row.validUntil),
    convertedSaleId: row.convertedSaleId,
    convertedSaleNumber: row.convertedSale?.saleNumber ?? null,
    customerId: row.customerId,
    customerName: row.customerName,
    customerContactPerson: row.customerContactPerson,
    customerPhone: row.customerPhone,
    customerEmail: row.customerEmail,
    customerAddress: row.customerAddress,
    customerPartyGstNo: row.customerPartyGstNo,
    customerPartyState: row.customerPartyState,
    includeGst: row.includeGst,
    discountPercent: row.discountPercent.toString(),
    subtotal: moneyStr(row.subtotal),
    discountAmount: moneyStr(row.discountAmount),
    taxableAmount: moneyStr(row.taxableAmount),
    cgstAmount: moneyStr(row.cgstAmount),
    sgstAmount: moneyStr(row.sgstAmount),
    igstAmount: moneyStr(row.igstAmount),
    taxAmount: moneyStr(row.taxAmount),
    transportAmount: moneyStr(row.transportAmount),
    totalAmount: moneyStr(row.totalAmount),
    note: row.note,
    createdById: row.createdById,
    createdByName: row.createdBy.fullName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lines: row.lines.map(serializeLine),
  };
}

async function loadQuotation(
  tx: Prisma.TransactionClient | typeof prisma,
  id: string
): Promise<QuotationRow> {
  const row = await tx.quotation.findUnique({
    where: { id },
    include: detailInclude,
  });
  if (!row) {
    throw new QuotationError("Quotation not found.", 404);
  }
  return row;
}

type CustomerSnapshot = {
  customerId: string | null;
  customerName: string;
  customerContactPerson: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  customerAddress: string | null;
  customerPartyGstNo: string | null;
  customerPartyState: string | null;
};

function prefer(
  provided: string | null | undefined,
  fallback: string | null | undefined
): string | null {
  if (provided !== undefined) return provided;
  const trimmed = fallback?.trim();
  return trimmed ? trimmed : null;
}

async function resolveCustomer(
  tx: Prisma.TransactionClient,
  input: QuotationWriteValidated
): Promise<CustomerSnapshot> {
  const master = input.customerId
    ? await tx.customer.findUnique({ where: { id: input.customerId } })
    : null;
  if (input.customerId && !master) {
    throw new QuotationError("Customer not found.", 404);
  }

  const name = (input.customerName?.trim() || master?.name || "").trim();
  if (!name) {
    throw new QuotationError("Customer name is required.");
  }

  const snapshot: CustomerSnapshot = {
    customerId: master?.id ?? null,
    customerName: name,
    customerContactPerson: prefer(input.customerContactPerson, null),
    customerPhone: prefer(input.customerPhone, master?.phone),
    customerEmail: prefer(input.customerEmail, master?.email),
    customerAddress: prefer(input.customerAddress, master?.address),
    customerPartyGstNo: prefer(input.customerPartyGstNo, master?.partyGstNo),
    customerPartyState: prefer(input.customerPartyState, master?.partyState),
  };

  if (input.saveAsCustomer && !snapshot.customerId) {
    if (!snapshot.customerPhone) {
      throw new QuotationError("Phone number is required to save a customer.");
    }
    const existing = await tx.customer.findUnique({
      where: { phone: snapshot.customerPhone },
    });
    if (existing) {
      snapshot.customerId = existing.id;
    } else {
      const created = await tx.customer.create({
        data: {
          name: snapshot.customerName,
          phone: snapshot.customerPhone,
          email: snapshot.customerEmail,
          address: snapshot.customerAddress,
          partyGstNo: snapshot.customerPartyGstNo,
          partyState: snapshot.customerPartyState,
        },
      });
      snapshot.customerId = created.id;
    }
  }

  return snapshot;
}

type BuiltLine = {
  productId: string;
  productUnitId: string;
  quantity: Prisma.Decimal;
  quantityInBase: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  lineDiscount: Prisma.Decimal;
  lineTax: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  productName: string;
  sku: string;
  description: string | null;
  hsnCode: string | null;
  unitCode: string;
  unitDisplayName: string;
  cgstPercent: Prisma.Decimal;
  sgstPercent: Prisma.Decimal;
  igstPercent: Prisma.Decimal;
  createdAt: Date;
};

type LineBuildInput = {
  includeGst: boolean;
  discountPercent: string | number | Prisma.Decimal;
  transportAmount: string | number | Prisma.Decimal;
  lines: Array<{
    productId: string;
    productUnitId?: string;
    quantity: string | number | Prisma.Decimal;
    lineDiscount: string | number | Prisma.Decimal;
  }>;
};

async function buildLines(
  tx: Prisma.TransactionClient,
  input: LineBuildInput,
  options?: { preserveLineDiscounts?: boolean }
): Promise<{
  lines: BuiltLine[];
  totals: ReturnType<typeof priceQuotation>;
}> {
  const prepared: PricedLineInput[] = [];
  const meta: Array<{
    productId: string;
    productUnitId: string;
    quantity: Prisma.Decimal;
    quantityInBase: Prisma.Decimal;
    productName: string;
    sku: string;
    description: string | null;
    hsnCode: string | null;
    unitCode: string;
    unitDisplayName: string;
    cgstPercent: Prisma.Decimal;
    sgstPercent: Prisma.Decimal;
    igstPercent: Prisma.Decimal;
  }> = [];

  for (const line of input.lines) {
    const product = await tx.product.findUnique({
      where: { id: line.productId },
      include: { units: true },
    });
    if (!product) {
      throw new QuotationError(`Product not found: ${line.productId}`, 404);
    }
    if (product.status !== ProductStatus.ACTIVE) {
      throw new QuotationError(`Product "${product.name}" is inactive.`);
    }
    if (product.sellingPrice == null) {
      throw new QuotationError(
        `Product "${product.name}" has no selling price and cannot be added to a quotation.`
      );
    }

    const unit = line.productUnitId
      ? product.units.find((row) => row.id === line.productUnitId)
      : (product.units.find((row) => row.isBaseUnit) ?? product.units[0]);
    if (!unit) {
      throw new QuotationError(
        line.productUnitId
          ? "Product and product unit do not match."
          : `Product "${product.name}" has no unit.`
      );
    }

    const quantity = qty(d(line.quantity));
    if (!unit.allowsFractionalSale && !quantity.isInteger()) {
      throw new QuotationError(
        `Fractional quantity is not allowed for unit ${unit.code}.`
      );
    }

    const unitPrice = product.sellingPrice.mul(unit.conversionToBase);
    const lineDiscount = d(line.lineDiscount ?? 0);
    const gross = quantity.mul(unitPrice);
    if (lineDiscount.gt(gross)) {
      throw new QuotationError(
        `Line discount cannot exceed the line amount for ${product.name}.`
      );
    }

    const cgstPercent = product.cgstPercent ?? d(0);
    const sgstPercent = product.sgstPercent ?? d(0);
    const igstPercent = product.igstPercent ?? d(0);

    prepared.push({
      quantity,
      unitPrice,
      lineDiscount,
      cgstPercent,
      sgstPercent,
      igstPercent,
    });
    meta.push({
      productId: product.id,
      productUnitId: unit.id,
      quantity,
      quantityInBase: qty(quantity.mul(unit.conversionToBase)),
      productName: product.name,
      sku: product.sku,
      description: product.description,
      hsnCode: product.hsnCode,
      unitCode: unit.code,
      unitDisplayName: unit.displayName || unit.code,
      cgstPercent,
      sgstPercent,
      igstPercent,
    });
  }

  let totals: ReturnType<typeof priceQuotation>;
  try {
    totals = priceQuotation({
      lines: prepared,
      discountPercent: d(options?.preserveLineDiscounts ? 0 : input.discountPercent),
      transportAmount: d(input.transportAmount ?? 0),
      includeGst: input.includeGst,
    });
  } catch (error) {
    throw new QuotationError(
      error instanceof Error ? error.message : "Could not price quotation."
    );
  }

  const stamp = Date.now();
  const lines: BuiltLine[] = meta.map((row, index) => {
    const priced = totals.lines[index];
    return {
      productId: row.productId,
      productUnitId: row.productUnitId,
      quantity: priced.quantity,
      quantityInBase: row.quantityInBase,
      unitPrice: priced.unitPrice,
      lineDiscount: priced.lineDiscount,
      lineTax: priced.lineTax,
      lineTotal: priced.lineTotal,
      productName: row.productName,
      sku: row.sku,
      description: row.description,
      hsnCode: row.hsnCode,
      unitCode: row.unitCode,
      unitDisplayName: row.unitDisplayName,
      cgstPercent: row.cgstPercent,
      sgstPercent: row.sgstPercent,
      igstPercent: row.igstPercent,
      createdAt: new Date(stamp + index),
    };
  });

  return { lines, totals };
}

function moneyFields(totals: ReturnType<typeof priceQuotation>, discountPercent: Prisma.Decimal) {
  return {
    discountPercent,
    subtotal: totals.subtotal,
    discountAmount: totals.discountAmount,
    taxableAmount: totals.taxableAmount,
    cgstAmount: totals.cgstAmount,
    sgstAmount: totals.sgstAmount,
    igstAmount: totals.igstAmount,
    taxAmount: totals.taxAmount,
    transportAmount: totals.transportAmount,
    totalAmount: totals.totalAmount,
  };
}

/**
 * Creates a draft quotation. Does not create a sale, payment, or stock movement,
 * and does not change Product.currentStock.
 */
export async function createQuotation(
  input: QuotationWriteValidated & { createdById: string }
): Promise<QuotationDetailDto> {
  return prisma.$transaction(async (tx) => {
    const dates = quotationValidity();
    const quotationNumber = await allocateQuotationNumber(tx, dates.year);
    const customer = await resolveCustomer(tx, input);
    const { lines, totals } = await buildLines(tx, input);

    const created = await tx.quotation.create({
      data: {
        quotationNumber,
        status: QuotationStatus.DRAFT,
        quotationDate: dates.quotationDate,
        validUntil: dates.validUntil,
        customerId: customer.customerId,
        customerName: customer.customerName,
        customerContactPerson: customer.customerContactPerson,
        customerPhone: customer.customerPhone,
        customerEmail: customer.customerEmail,
        customerAddress: customer.customerAddress,
        customerPartyGstNo: customer.customerPartyGstNo,
        customerPartyState: customer.customerPartyState,
        includeGst: input.includeGst,
        note: input.note?.trim() ? input.note.trim() : null,
        createdById: input.createdById,
        ...moneyFields(totals, d(input.discountPercent)),
        lines: { create: lines },
      },
    });

    return serializeQuotation(await loadQuotation(tx, created.id));
  });
}

export async function updateQuotation(
  id: string,
  input: QuotationWriteValidated
): Promise<QuotationDetailDto> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.quotation.findUnique({ where: { id } });
    if (!existing) {
      throw new QuotationError("Quotation not found.", 404);
    }
    if (existing.status !== QuotationStatus.DRAFT) {
      throw new QuotationError("Only draft quotations can be edited.");
    }

    const customer = await resolveCustomer(tx, input);
    const { lines, totals } = await buildLines(tx, input);

    await tx.quotationLine.deleteMany({ where: { quotationId: id } });
    await tx.quotation.update({
      where: { id },
      data: {
        customerId: customer.customerId,
        customerName: customer.customerName,
        customerContactPerson: customer.customerContactPerson,
        customerPhone: customer.customerPhone,
        customerEmail: customer.customerEmail,
        customerAddress: customer.customerAddress,
        customerPartyGstNo: customer.customerPartyGstNo,
        customerPartyState: customer.customerPartyState,
        includeGst: input.includeGst,
        note: input.note?.trim() ? input.note.trim() : null,
        ...moneyFields(totals, d(input.discountPercent)),
        lines: { create: lines },
      },
    });

    return serializeQuotation(await loadQuotation(tx, id));
  });
}

/**
 * Finalises a draft. Refreshes the quotation date, validity, and price snapshot
 * from current product selling prices. Keeps the saved includeGst flag, so a
 * no-GST draft is not charged GST at issue. Does not change stock.
 */
export async function issueQuotation(id: string): Promise<QuotationDetailDto> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.quotation.findUnique({
      where: { id },
      include: { lines: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
    });
    if (!existing) {
      throw new QuotationError("Quotation not found.", 404);
    }
    if (existing.status === QuotationStatus.CANCELLED) {
      throw new QuotationError("Cancelled quotations cannot be issued.");
    }
    if (existing.status === QuotationStatus.ISSUED) {
      throw new QuotationError("Quotation is already issued.");
    }

    const replay: LineBuildInput = {
      includeGst: existing.includeGst,
      discountPercent: 0,
      transportAmount: existing.transportAmount,
      lines: existing.lines.map((line) => ({
        productId: line.productId,
        productUnitId: line.productUnitId ?? undefined,
        quantity: line.quantity,
        lineDiscount: line.lineDiscount,
      })),
    };

    const { lines, totals } = await buildLines(tx, replay, {
      preserveLineDiscounts: true,
    });
    const dates = quotationValidity();

    await tx.quotationLine.deleteMany({ where: { quotationId: id } });
    await tx.quotation.update({
      where: { id },
      data: {
        status: QuotationStatus.ISSUED,
        quotationDate: dates.quotationDate,
        validUntil: dates.validUntil,
        includeGst: existing.includeGst,
        ...moneyFields(totals, existing.discountPercent),
        lines: { create: lines },
      },
    });

    return serializeQuotation(await loadQuotation(tx, id));
  });
}

export async function cancelQuotation(id: string): Promise<QuotationDetailDto> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.quotation.findUnique({ where: { id } });
    if (!existing) {
      throw new QuotationError("Quotation not found.", 404);
    }
    if (existing.status === QuotationStatus.CANCELLED) {
      throw new QuotationError("Quotation is already cancelled.");
    }
    if (existing.convertedSaleId) {
      throw new QuotationError(
        "A converted quotation cannot be cancelled. Cancel the sale from Invoices instead."
      );
    }
    await tx.quotation.update({
      where: { id },
      data: { status: QuotationStatus.CANCELLED },
    });
    return serializeQuotation(await loadQuotation(tx, id));
  });
}

export async function getQuotation(id: string): Promise<QuotationDetailDto> {
  return serializeQuotation(await loadQuotation(prisma, id));
}

export type QuotationListQuery = {
  q?: string;
  customerId?: string;
  status?: "DRAFT" | "ISSUED" | "EXPIRED" | "CONVERTED" | "CANCELLED";
  from?: Date;
  to?: Date;
  page: number;
  limit: number;
};

export async function listQuotations(query: QuotationListQuery): Promise<{
  items: QuotationListItemDto[];
  total: number;
  page: number;
  limit: number;
}> {
  const today = quotationValidity().quotationDate;
  const where: Prisma.QuotationWhereInput = {};
  const and: Prisma.QuotationWhereInput[] = [];

  if (query.q) {
    and.push({
      OR: [
        { quotationNumber: { contains: query.q, mode: "insensitive" } },
        { customerName: { contains: query.q, mode: "insensitive" } },
        { customerPhone: { contains: query.q, mode: "insensitive" } },
      ],
    });
  }
  if (query.customerId) {
    and.push({ customerId: query.customerId });
  }
  if (query.from || query.to) {
    and.push({
      quotationDate: {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      },
    });
  }
  if (query.status === "DRAFT" || query.status === "CANCELLED") {
    and.push({ status: query.status });
  } else if (query.status === "ISSUED") {
    and.push({
      status: QuotationStatus.ISSUED,
      convertedSaleId: null,
      validUntil: { gte: today },
    });
  } else if (query.status === "EXPIRED") {
    and.push({
      status: QuotationStatus.ISSUED,
      convertedSaleId: null,
      validUntil: { lt: today },
    });
  } else if (query.status === "CONVERTED") {
    and.push({ status: QuotationStatus.ISSUED, convertedSaleId: { not: null } });
  }
  if (and.length) where.AND = and;

  const [total, rows] = await prisma.$transaction([
    prisma.quotation.count({ where }),
    prisma.quotation.findMany({
      where,
      orderBy: [{ quotationDate: "desc" }, { createdAt: "desc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: {
        createdBy: { select: { fullName: true } },
        convertedSale: { select: { saleNumber: true } },
      },
    }),
  ]);

  return {
    total,
    page: query.page,
    limit: query.limit,
    items: rows.map((row) => ({
      id: row.id,
      quotationNumber: row.quotationNumber,
      quotationDate: isoDate(row.quotationDate),
      validUntil: isoDate(row.validUntil),
      customerId: row.customerId,
      customerName: row.customerName,
      totalAmount: moneyStr(row.totalAmount),
      includeGst: row.includeGst,
      status: effectiveStatus(row.status, row.validUntil, row.convertedSaleId),
      convertedSaleNumber: row.convertedSale?.saleNumber ?? null,
      createdByName: row.createdBy.fullName,
    })),
  };
}
