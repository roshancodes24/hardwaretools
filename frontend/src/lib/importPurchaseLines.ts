import { readSpreadsheetToRows } from "./importProducts";
import type { ApiSupplier } from "../api/types";
import { normalizeGstinForMatch } from "./gstinInput";
import type { UiProduct } from "./mapProduct";

/** One row from CSV/Excel before resolving against the product catalog. */
export type PurchaseLineImportPatch = {
  brandCode?: string;
  productName?: string;
  quantity: string;
  unitCost: string;
  /** Supplier display string from file (name or GST number). */
  supplierName?: string;
  /** Optional per-row note (stored on the line until submit; merged into purchase note). */
  lineNote?: string;
};

export type ImportPurchaseLinesParseResult = {
  patches: PurchaseLineImportPatch[];
  /** Same length as `patches`: 1-based spreadsheet row for each imported line. */
  patchSourceRows: number[];
  /** 1-based spreadsheet row numbers (header is row 1). */
  rowErrors: { row: number; message: string }[];
  skippedBlankRows: number;
  /** True when the sheet includes a supplier / vendor column. */
  hasSupplierColumn: boolean;
};

function normHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\uFEFF/g, "")
    .replace(/\s+/g, " ");
}

function headerToField(h: string): keyof PurchaseLineImportPatch | null {
  const s = normHeader(h);
  const compact = s.replace(/[\s_-]/g, "");

  const direct: Record<string, keyof PurchaseLineImportPatch> = {
    brandcode: "brandCode",
    itemcode: "brandCode",
    code: "brandCode",
    productcode: "brandCode",
    supplier: "supplierName",
    suppliername: "supplierName",
    vendor: "supplierName",
    party: "supplierName",
    name: "productName",
    productname: "productName",
    product: "productName",
    item: "productName",
    itemname: "productName",
    quantity: "quantity",
    qty: "quantity",
    qnty: "quantity",
    unitcost: "unitCost",
    purchasecost: "unitCost",
    purchaseprice: "unitCost",
    buyprice: "unitCost",
    netrate: "unitCost",
    rate: "unitCost",
    cost: "unitCost",
    note: "lineNote",
    notes: "lineNote",
    remark: "lineNote",
    remarks: "lineNote",
    comments: "lineNote",
    comment: "lineNote",
  };

  if (direct[compact]) return direct[compact];

  const spaced: Record<string, keyof PurchaseLineImportPatch> = {
    "brand code": "brandCode",
    "product code": "brandCode",
    "item code": "brandCode",
    "product name": "productName",
    "item name": "productName",
    "supplier name": "supplierName",
    "vendor name": "supplierName",
    "unit cost": "unitCost",
    "purchase price": "unitCost",
    "buy price": "unitCost",
    "net rate": "unitCost",
    "line note": "lineNote",
    "line notes": "lineNote",
  };
  if (spaced[s]) return spaced[s];

  return null;
}

function cellStr(v: string | undefined): string {
  if (v == null) return "";
  return String(v).trim();
}

function parseNumCell(s: string): number | null {
  const t = s.replace(/,/g, "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse first sheet: row 1 = headers. Required columns: quantity, unit cost (or equivalent).
 * Each data row must identify a product via brand code and/or product name.
 */
export function rowsToPurchaseLinePatches(
  matrix: string[][]
): ImportPurchaseLinesParseResult {
  const rowErrors: { row: number; message: string }[] = [];
  let skippedBlankRows = 0;

  if (!matrix.length) {
    rowErrors.push({ row: 1, message: "File is empty." });
    return {
      patches: [],
      patchSourceRows: [],
      rowErrors,
      skippedBlankRows: 0,
      hasSupplierColumn: false,
    };
  }

  const headerRow = matrix[0];
  const fieldCol = new Map<keyof PurchaseLineImportPatch, number>();
  headerRow.forEach((cell, colIdx) => {
    const f = headerToField(cell);
    if (f && !fieldCol.has(f)) fieldCol.set(f, colIdx);
  });

  const hasSupplierColumn = fieldCol.has("supplierName");

  if (!fieldCol.has("quantity")) {
    rowErrors.push({
      row: 1,
      message:
        'Missing a quantity column. Use header "quantity" or "qty".',
    });
    return {
      patches: [],
      patchSourceRows: [],
      rowErrors,
      skippedBlankRows: 0,
      hasSupplierColumn,
    };
  }
  if (!fieldCol.has("unitCost")) {
    rowErrors.push({
      row: 1,
      message:
        'Missing a unit cost column. Use header "unit cost", "rate", or "purchase price".',
    });
    return {
      patches: [],
      patchSourceRows: [],
      rowErrors,
      skippedBlankRows: 0,
      hasSupplierColumn,
    };
  }
  if (!fieldCol.has("brandCode") && !fieldCol.has("productName")) {
    rowErrors.push({
      row: 1,
      message:
        'Need a product column: add "brand code" and/or "product name" (or "product").',
    });
    return {
      patches: [],
      patchSourceRows: [],
      rowErrors,
      skippedBlankRows: 0,
      hasSupplierColumn,
    };
  }

  const patches: PurchaseLineImportPatch[] = [];
  const patchSourceRows: number[] = [];

  for (let r = 1; r < matrix.length; r++) {
    const spreadsheetRow = r + 1;
    const line = matrix[r];
    if (!line || line.every((c) => cellStr(c) === "")) {
      skippedBlankRows += 1;
      continue;
    }

    const patch: Partial<PurchaseLineImportPatch> = {};
    for (const [field, colIdx] of fieldCol) {
      const raw = colIdx < line.length ? line[colIdx] : "";
      const s = cellStr(raw);
      if (s === "") continue;
      if (field === "quantity" || field === "unitCost") {
        patch[field] = s;
      } else {
        patch[field] = s;
      }
    }

    const brandCode =
      typeof patch.brandCode === "string" ? patch.brandCode.trim() : "";
    const productName =
      typeof patch.productName === "string" ? patch.productName.trim() : "";
    if (!brandCode && !productName) {
      rowErrors.push({
        row: spreadsheetRow,
        message: "Missing product: enter brand code and/or product name.",
      });
      continue;
    }

    const qRaw = typeof patch.quantity === "string" ? patch.quantity : "";
    const cRaw = typeof patch.unitCost === "string" ? patch.unitCost : "";
    const q = parseNumCell(qRaw);
    const c = parseNumCell(cRaw);
    if (q == null || q <= 0) {
      rowErrors.push({
        row: spreadsheetRow,
        message: "Invalid quantity (need a number greater than 0).",
      });
      continue;
    }
    if (c == null || c < 0) {
      rowErrors.push({
        row: spreadsheetRow,
        message: "Invalid unit cost (need a number ≥ 0).",
      });
      continue;
    }

    const lineNoteRaw =
      typeof patch.lineNote === "string" ? patch.lineNote.trim() : "";

    patches.push({
      brandCode: brandCode || undefined,
      productName: productName || undefined,
      quantity: String(q),
      unitCost: String(c),
      supplierName:
        typeof patch.supplierName === "string" && patch.supplierName.trim() !== ""
          ? patch.supplierName.trim()
          : undefined,
      lineNote: lineNoteRaw !== "" ? lineNoteRaw : undefined,
    });
    patchSourceRows.push(spreadsheetRow);
  }

  return {
    patches,
    patchSourceRows,
    rowErrors,
    skippedBlankRows,
    hasSupplierColumn,
  };
}

export async function parsePurchaseLinesImportFile(
  file: File
): Promise<ImportPurchaseLinesParseResult> {
  const matrix = await readSpreadsheetToRows(file);
  return rowsToPurchaseLinePatches(matrix);
}

export type ResolvePurchaseLineResult = {
  lines: {
    key: string;
    productId: string;
    quantity: string;
    unitCost: string;
    lineNote: string;
  }[];
  unresolved: { row: number; message: string }[];
  supplierUnresolved: { row: number; message: string }[];
  /** When the file includes a supplier column and all rows agree, select this supplier. */
  resolvedSupplierId: string | null;
};

export type ResolvePurchaseImportSupplierOpts = {
  suppliers: ApiSupplier[];
  hasSupplierColumn: boolean;
  /** Used when a row leaves supplier blank but the sheet has a supplier column. */
  defaultSupplierId?: string | null;
};

/** Match against saved supplier name (case-insensitive) or GST number. */
export function matchSupplierImportRef(
  raw: string,
  suppliers: ApiSupplier[]
): ApiSupplier | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const lower = t.toLowerCase();
  let s = suppliers.find((x) => x.name.trim().toLowerCase() === lower);
  if (s) return s;
  const collapsed = lower.replace(/\s+/g, " ");
  if (collapsed !== lower) {
    s = suppliers.find(
      (x) => x.name.trim().replace(/\s+/g, " ").toLowerCase() === collapsed
    );
    if (s) return s;
  }
  const gstNorm = normalizeGstinForMatch(t);
  if (gstNorm.length >= 12) {
    s = suppliers.find(
      (x) => normalizeGstinForMatch(x.gstNumber ?? "") === gstNorm
    );
    if (s) return s;
  }
  return undefined;
}

function newLineKey(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `ln-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Match catalog: brand code (case-insensitive) first, then exact product name (case-insensitive). */
export function resolvePurchaseImportPatches(
  patches: PurchaseLineImportPatch[],
  products: UiProduct[],
  /** 1-based row numbers for patches (same order as patches array). */
  rowNumbers: number[],
  supplierOpts?: ResolvePurchaseImportSupplierOpts
): ResolvePurchaseLineResult {
  const lines: ResolvePurchaseLineResult["lines"] = [];
  const unresolved: { row: number; message: string }[] = [];
  const supplierUnresolved: { row: number; message: string }[] = [];
  let resolvedSupplierId: string | null = null;

  if (
    supplierOpts?.hasSupplierColumn &&
    (!supplierOpts.suppliers || supplierOpts.suppliers.length === 0)
  ) {
    return {
      lines: [],
      unresolved: [],
      supplierUnresolved: [
        {
          row: 1,
          message:
            "Add at least one supplier before importing a file that includes a supplier column.",
        },
      ],
      resolvedSupplierId: null,
    };
  }

  if (supplierOpts?.hasSupplierColumn && supplierOpts.suppliers.length > 0) {
    const { suppliers, defaultSupplierId } = supplierOpts;
    const effectiveIds: string[] = [];

    for (let i = 0; i < patches.length; i++) {
      const patch = patches[i]!;
      const row = rowNumbers[i] ?? i + 2;
      const raw = patch.supplierName?.trim() ?? "";

      if (raw) {
        const sup = matchSupplierImportRef(raw, suppliers);
        if (!sup) {
          supplierUnresolved.push({
            row,
            message: `Unknown supplier "${raw}". Use the exact name or GST number from Suppliers.`,
          });
          continue;
        }
        effectiveIds.push(sup.id);
      } else if (defaultSupplierId) {
        effectiveIds.push(defaultSupplierId);
      } else {
        supplierUnresolved.push({
          row,
          message:
            "Enter supplier on this row or choose a supplier in the form before importing.",
        });
      }
    }

    if (supplierUnresolved.length === 0 && effectiveIds.length === patches.length) {
      const unique = new Set(effectiveIds);
      if (unique.size > 1) {
        supplierUnresolved.push({
          row: rowNumbers[0] ?? 2,
          message:
            "All rows must be for the same supplier when you use a supplier column. Split into separate imports if needed.",
        });
      } else {
        resolvedSupplierId = effectiveIds[0]!;
      }
    }
  }

  if (supplierOpts?.hasSupplierColumn && supplierUnresolved.length > 0) {
    return {
      lines: [],
      unresolved: [],
      supplierUnresolved,
      resolvedSupplierId: null,
    };
  }

  patches.forEach((patch, i) => {
    const row = rowNumbers[i] ?? i + 2;
    const bc = patch.brandCode?.trim() ?? "";
    const name = patch.productName?.trim().toLowerCase() ?? "";

    let p: UiProduct | undefined;
    if (bc) {
      const lower = bc.toLowerCase();
      p = products.find(
        (x) => (x.brandCode ?? "").trim().toLowerCase() === lower
      );
    }
    if (!p && name) {
      p = products.find((x) => x.name.trim().toLowerCase() === name);
    }

    if (!p) {
      const hint =
        bc && patch.productName?.trim()
          ? `brand code "${bc}" / name "${patch.productName}"`
          : bc
            ? `brand code "${bc}"`
            : `name "${patch.productName}"`;
      unresolved.push({
        row,
        message: `No product found for ${hint}.`,
      });
      return;
    }

    lines.push({
      key: newLineKey(),
      productId: p.id,
      quantity: patch.quantity,
      unitCost: patch.unitCost,
      lineNote: (patch.lineNote ?? "").trim(),
    });
  });

  return {
    lines,
    unresolved,
    supplierUnresolved,
    resolvedSupplierId,
  };
}

export const PURCHASE_IMPORT_TEMPLATE_CSV = `supplier,brand code,product name,quantity,unit cost,notes
Example Supplier Ltd,BC-00001,,10,125.50,Batch A / shelf 2
Example Supplier Ltd,,Example product display name,2,99,
`;
