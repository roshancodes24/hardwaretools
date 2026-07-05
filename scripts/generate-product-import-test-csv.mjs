/**
 * Generate a bulk product import CSV for UI/API testing.
 * Usage: node scripts/generate-product-import-test-csv.mjs [count] [outputPath]
 * Default: 1000 rows → testdata/product-import-1000.csv
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const count = Math.max(1, Number.parseInt(process.argv[2] ?? "1000", 10) || 1000);
const outPath = path.resolve(
  root,
  process.argv[3] ?? path.join("testdata", `product-import-${count}.csv`)
);

const categories = ["Electrical", "Hardware", "Paint"];
const brands = ["PowerLine", "BuildPro", "ColorMax", "SteelWorks", "VoltEdge"];
const colors = ["Red", "Blue", "White", "Black", "Green", "Yellow", ""];
const sizes = ["10mm", "25mm", "500 ml", "1 inch", "M6", "2m", ""];
const units = [
  { code: "pc", kind: "PIECE", fractional: "false" },
  { code: "kg", kind: "WEIGHT", fractional: "true" },
  { code: "m", kind: "LENGTH", fractional: "true" },
  { code: "l", kind: "VOLUME", fractional: "true" },
  { code: "box", kind: "PACK", fractional: "false" },
];

function csvCell(v) {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function row(cells) {
  return cells.map(csvCell).join(",");
}

const header = [
  "name",
  "sku",
  "category",
  "brand",
  "brandCode",
  "color",
  "size",
  "hsnCode",
  "description",
  "status",
  "baseUnitCode",
  "unitKind",
  "allowsFractional",
  "costPrice",
  "percentage",
  "sellingPrice",
  "mrp",
  "cgstPercent",
  "sgstPercent",
  "igstPercent",
  "currentStock",
  "reorderLevel",
];

const lines = [row(header)];

for (let i = 1; i <= count; i++) {
  const cat = categories[i % categories.length];
  const brand = brands[i % brands.length];
  const unit = units[i % units.length];
  const cost = 50 + (i % 450);
  const pct = 10 + (i % 25);
  const selling = Math.round(cost * (1 + pct / 100));
  const mrp = selling + 20 + (i % 80);
  const prefix = cat === "Electrical" ? "EL" : cat === "Hardware" ? "HW" : "PT";

  lines.push(
    row([
      `Bulk Test ${prefix} Item ${String(i).padStart(4, "0")}`,
      `BULK-${prefix}-${String(i).padStart(5, "0")}`,
      cat,
      brand,
      `BC-${prefix}-${String(i).padStart(5, "0")}`,
      colors[i % colors.length],
      sizes[i % sizes.length],
      String(8500 + (i % 500)),
      `Regression bulk import row ${i}`,
      "ACTIVE",
      unit.code,
      unit.kind,
      unit.fractional,
      cost.toFixed(2),
      pct.toFixed(2),
      selling.toFixed(2),
      mrp.toFixed(2),
      "9",
      "9",
      "",
      String(5 + (i % 50)),
      String(10 + (i % 20)),
    ])
  );
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
const bom = "\uFEFF";
fs.writeFileSync(outPath, bom + lines.join("\n") + "\n", "utf8");
console.log(`Wrote ${count} product rows to ${outPath}`);
