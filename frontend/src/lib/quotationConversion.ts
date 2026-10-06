import type { QuotationDetail } from "../api/types";
import type { UiProduct } from "./mapProduct";
import type { PosQuoteLine } from "./posCartTotals";

/** Quotation info a POS cart line carries while converting. */
export type CartQuoteInfo = PosQuoteLine & {
  /** Quotation line this cart line comes from (sent as `quotationLineId`). */
  lineId: string;
};

/** A POS cart line; `quote` is set only while converting a quotation. */
export type CartLine = UiProduct & { qty: number; quote?: CartQuoteInfo };

export type ConversionCart = {
  lines: CartLine[];
  /** Quotation lines that cannot be put in the cart (unknown product / unit). */
  skipped: string[];
};

/** Quantity for the line's unit; stock is shown in that same unit. */
function num(value: string | null | undefined): number {
  const n = Number.parseFloat(value ?? "");
  return Number.isFinite(n) ? n : 0;
}

/**
 * Builds the POS cart for an issued quotation: quoted price, unit, quantity, GST
 * rates and discount/tax per line. Everything else (catalog fields) comes from the
 * live product so the cart behaves like any other POS line.
 */
export function buildConversionCart(
  quotation: QuotationDetail,
  products: readonly UiProduct[]
): ConversionCart {
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines: CartLine[] = [];
  const skipped: string[] = [];

  for (const line of quotation.lines) {
    const product = byId.get(line.productId);
    if (!product) {
      skipped.push(`${line.productName} (product is no longer available)`);
      continue;
    }
    const unit = line.units.find((u) => u.id === line.productUnitId);
    if (!unit) {
      skipped.push(`${line.productName} (quoted unit no longer exists)`);
      continue;
    }

    const factor = num(unit.conversionToBase) || 1;
    lines.push({
      ...product,
      price: num(line.unitPrice),
      unit: unit.displayName || unit.code,
      baseUnitId: unit.id,
      allowsFractionalSale: unit.allowsFractionalSale,
      stock: num(line.currentStock) / factor,
      avgCost: product.avgCost != null ? product.avgCost * factor : null,
      cgstPercent: num(line.cgstPercent),
      sgstPercent: num(line.sgstPercent),
      igstPercent: num(line.igstPercent),
      hsnCode: line.hsnCode?.trim() ? line.hsnCode.trim() : product.hsnCode,
      qty: num(line.quantity),
      quote: {
        lineId: line.id,
        quotedQty: num(line.quantity),
        quotedDiscount: num(line.lineDiscount),
        quotedTax: num(line.lineTax),
      },
    });
  }

  return { lines, skipped };
}

/** Lines asking for more than is in stock, e.g. `Hammer (need 5, have 3)`. */
export function stockShortfalls(cart: readonly CartLine[]): string[] {
  return cart
    .filter((line) => line.qty > line.stock + 1e-9)
    .map(
      (line) =>
        `${line.name} (need ${line.qty}, have ${Number(line.stock.toFixed(4))} ${line.unit})`
    );
}

/** Key that is unique per cart row (a product can appear on two quotation lines). */
export function cartLineKey(line: Pick<CartLine, "id" | "quote">): string {
  return line.quote?.lineId ?? line.id;
}
