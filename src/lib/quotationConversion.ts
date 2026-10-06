import { Prisma, QuotationStatus } from "@prisma/client";

const D = Prisma.Decimal;

/** Slack for paise rounding when the client pro-rates a quoted line discount. */
const DISCOUNT_TOLERANCE = new D("0.01");

export type ConversionQuotation = {
  quotationNumber: string;
  status: QuotationStatus;
  convertedSaleId: string | null;
  includeGst: boolean;
  lines: Array<{
    id: string;
    productId: string;
    productUnitId: string | null;
    productName: string;
    quantity: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    lineDiscount: Prisma.Decimal;
  }>;
};

export type ConversionSaleLine = {
  quotationLineId?: string;
  productId: string;
  productUnitId: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  lineDiscount: Prisma.Decimal;
  lineTax: Prisma.Decimal;
};

/** Document kind a converted quotation must be sold as: GST quotation → tax invoice, no-GST → bill. */
export function conversionDocumentKind(
  includeGst: boolean
): "tax_invoice" | "bill" {
  return includeGst ? "tax_invoice" : "bill";
}

/**
 * Throws a user-readable Error when a sale cannot be recorded as the conversion of
 * `quotation`. Keeps the quoted price, caps quantity at what was quoted, and caps the
 * discount at the quoted line discount pro-rated to the quantity sold (partial sales
 * are allowed; anything not sold is simply not converted).
 */
export function assertConversionAllowed(
  quotation: ConversionQuotation,
  documentKind: "bill" | "tax_invoice",
  lines: ConversionSaleLine[]
): void {
  const number = quotation.quotationNumber;

  if (quotation.status === QuotationStatus.DRAFT) {
    throw new Error(`Quotation ${number} is a draft. Issue it before converting to a sale.`);
  }
  if (quotation.status === QuotationStatus.CANCELLED) {
    throw new Error(`Quotation ${number} is cancelled and cannot be converted.`);
  }
  if (quotation.convertedSaleId) {
    throw new Error(`Quotation ${number} has already been converted to a sale.`);
  }

  const expectedKind = conversionDocumentKind(quotation.includeGst);
  if (documentKind !== expectedKind) {
    throw new Error(
      quotation.includeGst
        ? `Quotation ${number} includes GST, so it must be converted to a tax invoice.`
        : `Quotation ${number} does not include GST, so it must be converted to a bill, not a tax invoice.`
    );
  }

  if (lines.length === 0) {
    throw new Error("Select at least one quotation line to convert.");
  }

  const byId = new Map(quotation.lines.map((line) => [line.id, line]));
  const seen = new Set<string>();

  for (const line of lines) {
    const quotationLineId = line.quotationLineId?.trim();
    if (!quotationLineId) {
      throw new Error(
        `Every sale line must come from quotation ${number}. Other items cannot be added when converting.`
      );
    }
    if (seen.has(quotationLineId)) {
      throw new Error("A quotation line can only be converted once.");
    }
    seen.add(quotationLineId);

    const quoted = byId.get(quotationLineId);
    if (!quoted) {
      throw new Error(`Line ${quotationLineId} is not part of quotation ${number}.`);
    }
    const label = quoted.productName;

    if (line.productId !== quoted.productId) {
      throw new Error(`"${label}" does not match the quoted product.`);
    }
    if (!quoted.productUnitId || line.productUnitId !== quoted.productUnitId) {
      throw new Error(`"${label}" must be sold in the quoted unit.`);
    }
    if (!line.unitPrice.equals(quoted.unitPrice)) {
      throw new Error(
        `"${label}" must keep the quoted price of ${quoted.unitPrice.toFixed(2)}.`
      );
    }
    if (line.quantity.greaterThan(quoted.quantity)) {
      throw new Error(
        `"${label}" was quoted for ${quoted.quantity.toString()}; quantity cannot be increased.`
      );
    }

    const maxDiscount = quoted.lineDiscount
      .mul(line.quantity)
      .div(quoted.quantity)
      .toDecimalPlaces(2)
      .plus(DISCOUNT_TOLERANCE);
    if (line.lineDiscount.greaterThan(maxDiscount)) {
      throw new Error(
        `"${label}" cannot have more than the quoted discount (${quoted.lineDiscount.toFixed(2)} for the full quantity).`
      );
    }

    if (!quotation.includeGst && !line.lineTax.isZero()) {
      throw new Error(`"${label}" cannot carry GST: quotation ${number} does not include GST.`);
    }
  }
}
