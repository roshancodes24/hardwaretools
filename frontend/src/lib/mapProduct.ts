import type { ApiProduct } from "../api/types";

export type UiProduct = {
  id: string;
  name: string;
  sku: string;
  category: string;
  price: number;
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
    category: p.category ?? "Uncategorized",
    price: Number(p.sellingPrice ?? 0),
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
