/**
 * Generate a bulk purchase-line import CSV for UI testing.
 * Rows reference products from a product import CSV (brand code + name).
 *
 * Usage:
 *   node scripts/generate-purchase-import-test-csv.mjs [count] [outputPath] [productsCsv] [supplierName]
 *
 * Defaults:
 *   1000 rows → testdata/purchase-import-1000.csv
 *   products from testdata/product-import-1000.csv
 *   supplier "ABC Hardware Suppliers" (seed data)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const count = Math.max(1, Number.parseInt(process.argv[2] ?? "1000", 10) || 1000);
const outPath = path.resolve(
  root,
  process.argv[3] ?? path.join("testdata", `purchase-import-${count}.csv`)
);
const productsPath = path.resolve(
  root,
  process.argv[4] ?? path.join("testdata", "product-import-1000.csv")
);
const supplierName = process.argv[5] ?? "ABC Hardware Suppliers";

function csvCell(v) {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function row(cells) {
  return cells.map(csvCell).join(",");
}

function parseSimpleCsvLine(line) {
  const cells = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

function loadProductsFromCsv(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return null;

  const header = parseSimpleCsvLine(lines[0]).map((h) =>
    h.trim().toLowerCase().replace(/\s+/g, "")
  );
  const nameIdx = header.indexOf("name");
  const brandCodeIdx = header.indexOf("brandcode");
  const costIdx = header.indexOf("costprice");
  if (nameIdx < 0 || brandCodeIdx < 0) return null;

  const products = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseSimpleCsvLine(lines[i]);
    const name = cells[nameIdx]?.trim();
    const brandCode = cells[brandCodeIdx]?.trim();
    if (!name || !brandCode) continue;
    const costRaw = costIdx >= 0 ? cells[costIdx]?.trim() : "";
    const cost = Number.parseFloat(costRaw.replace(/,/g, ""));
    products.push({
      name,
      brandCode,
      costPrice: Number.isFinite(cost) ? cost : 50,
    });
  }
  return products.length > 0 ? products : null;
}

function fallbackProducts(n) {
  const categories = ["Electrical", "Hardware", "Paint"];
  const products = [];
  for (let i = 1; i <= n; i++) {
    const cat = categories[i % categories.length];
    const prefix = cat === "Electrical" ? "EL" : cat === "Hardware" ? "HW" : "PT";
    const cost = 50 + (i % 450);
    products.push({
      name: `Bulk Test ${prefix} Item ${String(i).padStart(4, "0")}`,
      brandCode: `BC-${prefix}-${String(i).padStart(5, "0")}`,
      costPrice: cost,
    });
  }
  return products;
}

const catalog = loadProductsFromCsv(productsPath);
const productsSource = catalog ? productsPath : null;
const effectiveCatalog = catalog ?? fallbackProducts(count);
if (effectiveCatalog.length < count) {
  console.warn(
    `Only ${effectiveCatalog.length} product(s) in ${productsPath}; cycling catalog to ${count} purchase rows.`
  );
}

const header = ["supplier", "brand code", "product name", "quantity", "unit cost", "notes"];
const outLines = [row(header)];

for (let i = 0; i < count; i++) {
  const p = effectiveCatalog[i % effectiveCatalog.length];
  const qty = 1 + (i % 48);
  const costBump = 0.95 + (i % 11) * 0.01;
  const unitCost = (p.costPrice * costBump).toFixed(2);
  const note =
    i % 7 === 0 ? `PO batch ${Math.floor(i / 100) + 1} / line ${i + 1}` : "";

  outLines.push(
    row([
      supplierName,
      p.brandCode,
      p.name,
      String(qty),
      unitCost,
      note,
    ])
  );
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
const bom = "\uFEFF";
fs.writeFileSync(outPath, bom + outLines.join("\n") + "\n", "utf8");
console.log(`Wrote ${count} purchase line(s) to ${outPath}`);
console.log(`Supplier: ${supplierName}`);
console.log(
  productsSource
    ? `Products: ${productsSource} (${effectiveCatalog.length} row(s))`
    : `Products: generated fallback (missing or invalid ${productsPath})`
);
