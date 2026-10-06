import { describe, it, expect } from "vitest";
import { compareInventoryRows } from "../../frontend/src/lib/inventoryTable";
import type { UiProduct } from "../../frontend/src/lib/mapProduct";

function product(sku: string, color: string | null): UiProduct {
  return {
    id: sku,
    name: sku,
    sku,
    brandCode: null,
    color,
    size: null,
    category: "Paint",
    price: 10,
    avgCost: null,
    stock: 5,
    unit: "Piece",
    lowStock: 2,
    baseUnitId: "u",
    allowsFractionalSale: false,
    cgstPercent: null,
    sgstPercent: null,
    igstPercent: null,
    hsnCode: null,
  };
}

describe("compareInventoryRows by color", () => {
  const rows = [
    product("A", null),
    product("B", "Red"),
    product("C", "blue"),
    product("D", null),
    product("E", "Green"),
  ];

  it("sorts colours A to Z and keeps products without a colour last", () => {
    const sorted = [...rows].sort((a, b) => compareInventoryRows(a, b, "color", "asc"));
    expect(sorted.map((p) => p.color)).toEqual(["blue", "Green", "Red", null, null]);
  });

  it("sorts colours Z to A and still keeps products without a colour last", () => {
    const sorted = [...rows].sort((a, b) => compareInventoryRows(a, b, "color", "desc"));
    expect(sorted.map((p) => p.color)).toEqual(["Red", "Green", "blue", null, null]);
  });

  it("breaks ties by SKU", () => {
    const sorted = [...rows].sort((a, b) => compareInventoryRows(a, b, "color", "asc"));
    expect(sorted.filter((p) => p.color === null).map((p) => p.sku)).toEqual(["A", "D"]);
  });
});
