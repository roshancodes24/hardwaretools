const HEADER_TOTAL_KEYS = [
  "subtotal",
  "discountAmount",
  "taxableAmount",
  "cgstAmount",
  "sgstAmount",
  "igstAmount",
  "taxAmount",
  "totalAmount",
  "quotationNumber",
  "quotationDate",
  "validUntil",
] as const;

const LINE_COMPUTED_KEYS = [
  "lineTax",
  "lineTotal",
  "productName",
  "sku",
  "hsnCode",
  "cgstPercent",
  "sgstPercent",
  "igstPercent",
] as const;

function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/**
 * Quotations never accept a client unit price or precomputed totals.
 * The server prices every line from Product.sellingPrice.
 */
export function clientPricingOverrideMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;

  if (hasOwn(record, "unitPrice")) {
    return "Unit price cannot be overridden. Quotations use the product selling price.";
  }
  for (const key of HEADER_TOTAL_KEYS) {
    if (hasOwn(record, key)) {
      return "Totals are calculated by the server and cannot be submitted.";
    }
  }

  if (!Array.isArray(record.lines)) return null;
  for (const line of record.lines) {
    if (!line || typeof line !== "object") continue;
    const lineRecord = line as Record<string, unknown>;
    if (hasOwn(lineRecord, "unitPrice")) {
      return "Unit price cannot be overridden. Quotations use the product selling price.";
    }
    for (const key of LINE_COMPUTED_KEYS) {
      if (hasOwn(lineRecord, key)) {
        return "Line totals and tax are calculated by the server and cannot be submitted.";
      }
    }
  }
  return null;
}
