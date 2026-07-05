import { describe, it, expect } from "vitest";
import { rowsToImportPatches } from "../../frontend/src/lib/importProducts";

describe("rowsToImportPatches", () => {
  it("maps common spreadsheet headers to product fields", () => {
    const result = rowsToImportPatches([
      ["name", "sku", "category", "cost price", "selling price"],
      ["Hammer", "HAM-001", "Hardware", "80", "100"],
    ]);
    expect(result.rowErrors).toEqual([]);
    expect(result.patches).toHaveLength(1);
    expect(result.patches[0]).toMatchObject({
      name: "Hammer",
      sku: "HAM-001",
      category: "Hardware",
      costPrice: "80",
      sellingPrice: "100",
    });
  });

  it("accepts brand code and HSN aliases", () => {
    const result = rowsToImportPatches([
      ["Product Name", "Brand Code", "HSN Code", "Markup %"],
      ["Bolt M8", "BC-88", "73181500", "12"],
    ]);
    expect(result.patches[0]).toMatchObject({
      name: "Bolt M8",
      brandCode: "BC-88",
      hsnCode: "73181500",
      percentage: "12",
    });
  });

  it("reports missing name column", () => {
    const result = rowsToImportPatches([
      ["sku", "category"],
      ["X-1", "Tools"],
    ]);
    expect(result.patches).toHaveLength(0);
    expect(result.rowErrors.some((e) => /name/i.test(e.message))).toBe(true);
  });

  it("skips blank rows", () => {
    const result = rowsToImportPatches([
      ["name", "sku"],
      ["Widget", "W-1"],
      ["", ""],
      ["  ", "  "],
    ]);
    expect(result.patches).toHaveLength(1);
  });
});
