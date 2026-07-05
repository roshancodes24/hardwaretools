import type { UiProduct } from "./mapProduct";

export function stockStatus(p: UiProduct): "ok" | "low" | "out" {
  return p.stock === 0 ? "out" : p.stock <= p.lowStock ? "low" : "ok";
}

export type InventorySortKey =
  | "sku"
  | "name"
  | "category"
  | "price"
  | "stock"
  | "unit"
  | "status";

function statusSortRank(p: UiProduct): number {
  const st = stockStatus(p);
  if (st === "out") return 0;
  if (st === "low") return 1;
  return 2;
}

export function compareInventoryRows(
  a: UiProduct,
  b: UiProduct,
  key: InventorySortKey,
  dir: "asc" | "desc"
): number {
  const sign = dir === "asc" ? 1 : -1;
  let cmp = 0;
  switch (key) {
    case "sku":
      cmp = a.sku.localeCompare(b.sku, undefined, { sensitivity: "base" });
      break;
    case "name":
      cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      break;
    case "category":
      cmp = a.category.localeCompare(b.category, undefined, {
        sensitivity: "base",
      });
      break;
    case "price":
      cmp = a.price - b.price;
      break;
    case "stock":
      cmp = a.stock - b.stock;
      break;
    case "unit":
      cmp = a.unit.localeCompare(b.unit, undefined, { sensitivity: "base" });
      break;
    case "status":
      cmp = statusSortRank(a) - statusSortRank(b);
      break;
  }
  if (cmp !== 0) return sign * cmp;
  return a.sku.localeCompare(b.sku, undefined, { sensitivity: "base" });
}
