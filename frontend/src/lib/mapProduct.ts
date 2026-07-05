import type { ApiProduct } from "../api/types";

export type UiProduct = {
  id: string;
  name: string;
  sku: string;
  /** Business product identifier (catalog `brandCode`). */
  brandCode: string | null;
  color: string | null;
  /** Physical size / dimension label (optional). */
  size: string | null;
  category: string;
  price: number;
  /** Moving weighted-average cost per base unit (for below-cost warnings); null if unknown. */
  avgCost: number | null;
  stock: number;
  unit: string;
  lowStock: number;
  baseUnitId: string;
  allowsFractionalSale: boolean;
  cgstPercent: number | null;
  sgstPercent: number | null;
  igstPercent: number | null;
  hsnCode: string | null;
};

export function mapApiProduct(p: ApiProduct): UiProduct {
  const base = p.units?.find((u) => u.isBaseUnit) ?? p.units?.[0];
  if (!base) {
    throw new Error(`Product "${p.name}" (${p.sku}) has no units defined.`);
  }

  const low = Number(p.reorderLevel);
  const lowStock = Number.isFinite(low) && low > 0 ? low : 10;

  const numOrNull = (s: string | null | undefined) => {
    if (s == null || s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  return {
    id: p.id,
    name: p.name,
    sku: p.sku,
    brandCode: p.brandCode?.trim() ? p.brandCode.trim() : null,
    color: p.color?.trim() ? p.color.trim() : null,
    size: p.size?.trim() ? p.size.trim() : null,
    category: p.category ?? "Uncategorized",
    price: Number(p.sellingPrice ?? 0),
    avgCost: numOrNull(p.avgCostPrice ?? p.costPrice),
    stock: Number(p.currentStock),
    unit: base.displayName || base.code || p.baseUnitCode,
    lowStock,
    baseUnitId: base.id,
    allowsFractionalSale: base.allowsFractionalSale,
    cgstPercent: numOrNull(p.cgstPercent),
    sgstPercent: numOrNull(p.sgstPercent),
    igstPercent: numOrNull(p.igstPercent),
    hsnCode: p.hsnCode?.trim() ? p.hsnCode.trim() : null,
  };
}
