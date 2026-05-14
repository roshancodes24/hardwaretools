import * as XLSX from "xlsx";
import { PRODUCT_CATEGORIES, type ProductCategory } from "../productCategories";

/** Fields accepted from CSV/Excel; merged into `newDraft()` in ProductsPage. */
export type ProductImportPatch = {
  name: string;
  sku?: string;
  description?: string;
  category?: string;
  brand?: string;
  brandCode?: string;
  color?: string;
  size?: string;
  baseUnitCode?: string;
  unitKind?: string;
  allowsFractional?: boolean;
  sellingPrice?: string;
  costPrice?: string;
  percentage?: string;
  mrp?: string;
  cgstPercent?: string;
  sgstPercent?: string;
  igstPercent?: string;
  currentStock?: string;
  reorderLevel?: string;
  hsnCode?: string;
  status?: string;
};

const UNIT_KINDS = new Set([
  "PIECE",
  "WEIGHT",
  "LENGTH",
  "VOLUME",
  "PACK",
  "OTHER",
]);

function normHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\uFEFF/g, "")
    .replace(/\s+/g, " ");
}

/** Map header cell → canonical field key */
function headerToField(h: string): keyof ProductImportPatch | null {
  const s = normHeader(h);
  const compact = s.replace(/[\s_-]/g, "");

  const direct: Record<string, keyof ProductImportPatch> = {
    name: "name",
    productname: "name",
    sku: "sku",
    itemsku: "sku",
    productsku: "sku",
    itemcode: "sku",
    /** Common spreadsheet labels that mean product SKU / item code */
    code: "sku",
    productcode: "sku",
    materialcode: "sku",
    partno: "sku",
    partnumber: "sku",
    articleno: "sku",
    articlenumber: "sku",
    article: "sku",
    stockcode: "sku",
    vendorcode: "sku",
    suppliercode: "sku",
    customerpart: "sku",
    customerpartno: "sku",
    itemid: "sku",
    itemnumber: "sku",
    description: "description",
    category: "category",
    brand: "brand",
    brandcode: "brandCode",
    color: "color",
    colour: "color",
    size: "size",
    dimensions: "size",
    baseunitcode: "baseUnitCode",
    unitcode: "baseUnitCode",
    unit: "baseUnitCode",
    uom: "baseUnitCode",
    unitkind: "unitKind",
    kind: "unitKind",
    allowsfractional: "allowsFractional",
    fractional: "allowsFractional",
    sellingprice: "sellingPrice",
    price: "sellingPrice",
    percentage: "percentage",
    marginpercent: "percentage",
    markuppercent: "percentage",
    mrp: "mrp",
    costprice: "costPrice",
    cost: "costPrice",
    cgstpercent: "cgstPercent",
    cgst: "cgstPercent",
    sgstpercent: "sgstPercent",
    sgst: "sgstPercent",
    igstpercent: "igstPercent",
    igst: "igstPercent",
    currentstock: "currentStock",
    stock: "currentStock",
    openingstock: "currentStock",
    qty: "currentStock",
    reorderlevel: "reorderLevel",
    reorder: "reorderLevel",
    hsncode: "hsnCode",
    hsn: "hsnCode",
    status: "status",
  };

  if (direct[compact]) return direct[compact];

  const spaced: Record<string, keyof ProductImportPatch> = {
    "product name": "name",
    "product": "name",
    "sku code": "sku",
    "item code": "sku",
    "product code": "sku",
    "stock code": "sku",
    "part no": "sku",
    "part number": "sku",
    "material code": "sku",
    "article no": "sku",
    "article number": "sku",
    "vendor code": "sku",
    "supplier code": "sku",
    "customer part": "sku",
    "brand code": "brandCode",
    "colour": "color",
    "color": "color",
    "size": "size",
    "dimension": "size",
    "dimensions": "size",
    "base unit": "baseUnitCode",
    "base unit code": "baseUnitCode",
    "unit kind": "unitKind",
    "allow fractional": "allowsFractional",
    "selling price": "sellingPrice",
    "cost price": "costPrice",
    "percentage": "percentage",
    "margin %": "percentage",
    "markup %": "percentage",
    "mrp": "mrp",
    "cgst %": "cgstPercent",
    "sgst %": "sgstPercent",
    "igst %": "igstPercent",
    "current stock": "currentStock",
    "opening stock": "currentStock",
    "reorder level": "reorderLevel",
    "hsn code": "hsnCode",
  };
  if (spaced[s]) return spaced[s];

  return null;
}

function parseBool(v: string): boolean | undefined {
  const t = v.trim().toLowerCase();
  if (t === "") return undefined;
  if (["y", "yes", "true", "1", "x"].includes(t)) return true;
  if (["n", "no", "false", "0"].includes(t)) return false;
  return undefined;
}

function parseCategory(v: string): ProductCategory | undefined {
  const t = v.trim().toLowerCase();
  for (const c of PRODUCT_CATEGORIES) {
    if (c.toLowerCase() === t) return c;
  }
  return undefined;
}

function cellStr(v: string | undefined): string {
  if (v == null) return "";
  return String(v).trim();
}

export async function readSpreadsheetToRows(file: File): Promise<string[][]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  if (!wb.SheetNames.length) {
    throw new Error("The file has no sheets.");
  }
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<(string | number | boolean | null | undefined)[]>(
    sheet,
    { header: 1, defval: "", raw: false }
  ) as unknown[][];

  return raw.map((row) =>
    (row ?? []).map((c) => {
      if (c === null || c === undefined) return "";
      if (typeof c === "number" && Number.isFinite(c)) return String(c);
      return String(c).trim();
    })
  );
}

export type ImportProductsParseResult = {
  patches: ProductImportPatch[];
  /** 1-based spreadsheet row numbers (including header row as row 1) */
  rowErrors: { row: number; message: string }[];
  /** Rows skipped (blank lines) */
  skippedBlankRows: number;
  /** Non-fatal hints (e.g. no SKU column → server will assign SKUs). */
  warnings: string[];
};

/**
 * Parse first sheet: row 1 = headers, following rows = products.
 * Requires a column mapped to `name`.
 */
export function rowsToImportPatches(matrix: string[][]): ImportProductsParseResult {
  const rowErrors: { row: number; message: string }[] = [];
  let skippedBlankRows = 0;

  const warnings: string[] = [];

  if (!matrix.length) {
    rowErrors.push({ row: 1, message: "File is empty." });
    return { patches: [], rowErrors, skippedBlankRows: 0, warnings };
  }

  const headerRow = matrix[0];
  const fieldCol = new Map<keyof ProductImportPatch, number>();
  headerRow.forEach((cell, colIdx) => {
    const f = headerToField(cell);
    if (f && !fieldCol.has(f)) fieldCol.set(f, colIdx);
  });

  if (!fieldCol.has("name")) {
    rowErrors.push({
      row: 1,
      message:
        "Missing a name column. Use header \"name\" or \"product name\" (check spelling).",
    });
    return { patches: [], rowErrors, skippedBlankRows: 0, warnings };
  }

  if (!fieldCol.has("sku")) {
    const seen = headerRow
      .map((h) => cellStr(h))
      .filter(Boolean)
      .join(", ");
    warnings.push(
      "No SKU column was recognized — the system will assign SKUs (e.g. EL-00001). " +
        "Use a header such as \"sku\", \"item code\", or \"product code\". " +
        (seen ? `Row 1 headers: ${seen}.` : ""),
    );
  }

  const patches: ProductImportPatch[] = [];

  for (let r = 1; r < matrix.length; r++) {
    const spreadsheetRow = r + 1;
    const line = matrix[r];
    if (!line || line.every((c) => cellStr(c) === "")) {
      skippedBlankRows += 1;
      continue;
    }

    const patch: Record<string, string | boolean | undefined> = {};
    let skipRow = false;

    for (const [field, colIdx] of fieldCol) {
      const raw = colIdx < line.length ? line[colIdx] : "";
      const s = cellStr(raw);
      if (s === "") continue;

      switch (field) {
        case "allowsFractional": {
          const b = parseBool(s);
          if (b !== undefined) patch.allowsFractional = b;
          break;
        }
        case "category": {
          const cat = parseCategory(s);
          if (cat) patch.category = cat;
          else {
            rowErrors.push({
              row: spreadsheetRow,
              message: `Unknown category "${s}" (use Electrical, Hardware, or Paint).`,
            });
            skipRow = true;
          }
          break;
        }
        case "unitKind": {
          const up = s.toUpperCase().replace(/\s/g, "");
          if (UNIT_KINDS.has(up)) patch.unitKind = up;
          else {
            rowErrors.push({
              row: spreadsheetRow,
              message: `Invalid unitKind "${s}" (use PIECE, WEIGHT, LENGTH, VOLUME, PACK, OTHER).`,
            });
            skipRow = true;
          }
          break;
        }
        case "status": {
          const up = s.toUpperCase();
          if (up === "ACTIVE" || up === "INACTIVE") patch.status = up;
          break;
        }
        default:
          patch[field] = s;
      }
    }

    if (skipRow) continue;

    const name = typeof patch.name === "string" ? patch.name.trim() : "";
    if (!name) {
      rowErrors.push({ row: spreadsheetRow, message: "Missing product name." });
      continue;
    }

    patches.push(patch as ProductImportPatch);
  }

  return { patches, rowErrors, skippedBlankRows, warnings };
}

export async function parseProductImportFile(
  file: File
): Promise<ImportProductsParseResult> {
  const matrix = await readSpreadsheetToRows(file);
  return rowsToImportPatches(matrix);
}

/** CSV template for download (UTF-8 BOM added by caller if needed). */
export const PRODUCT_IMPORT_TEMPLATE_CSV = `name,sku,category,brand,brandCode,color,size,hsnCode,description,status,baseUnitCode,unitKind,allowsFractional,costPrice,percentage,sellingPrice,mrp,cgstPercent,sgstPercent,igstPercent,currentStock,reorderLevel
"Example MCB 16A",,Electrical,PowerLine,PL-16A,White,16A,8536,Optional notes,ACTIVE,pc,PIECE,false,320,40.625,450,500,9,9,,5,10
`;
