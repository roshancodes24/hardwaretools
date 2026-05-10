import type { Prisma } from "@prisma/client";

const CATEGORY_PREFIX: Record<"Electrical" | "Hardware" | "Paint", string> = {
  Electrical: "EL",
  Hardware: "HW",
  Paint: "PT",
};

/**
 * Next SKU for a category, e.g. EL-00001, HW-00042, PT-00123.
 * Only counts SKUs matching `{PREFIX}-\d+` so legacy free-text SKUs in DB are ignored for sequencing.
 */
export async function generateNextSku(
  tx: Prisma.TransactionClient,
  category: "Electrical" | "Hardware" | "Paint"
): Promise<string> {
  const prefix = CATEGORY_PREFIX[category];
  const start = `${prefix}-`;
  const rows = await tx.product.findMany({
    where: { sku: { startsWith: start } },
    select: { sku: true },
  });
  let max = 0;
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  for (const { sku } of rows) {
    const m = re.exec(sku);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  for (let n = max + 1; n < max + 100_000; n++) {
    const candidate = `${prefix}-${String(n).padStart(5, "0")}`;
    const clash = await tx.product.findUnique({
      where: { sku: candidate },
    });
    if (!clash) return candidate;
  }
  throw new Error("Could not generate a unique SKU");
}

const BRAND_CODE_PREFIX = "BC";

/**
 * Next brand code, e.g. BC-00001, BC-00002.
 * Brand code is the product's business identifier; counts only values matching `BC-\\d+`.
 */
export async function generateNextBrandCode(
  tx: Prisma.TransactionClient
): Promise<string> {
  const start = `${BRAND_CODE_PREFIX}-`;
  const rows = await tx.product.findMany({
    where: { brandCode: { startsWith: start } },
    select: { brandCode: true },
  });
  let max = 0;
  const re = new RegExp(`^${BRAND_CODE_PREFIX}-(\\d+)$`);
  for (const { brandCode } of rows) {
    if (!brandCode) continue;
    const m = re.exec(brandCode);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  for (let n = max + 1; n < max + 100_000; n++) {
    const candidate = `${BRAND_CODE_PREFIX}-${String(n).padStart(5, "0")}`;
    const clash = await tx.product.findFirst({
      where: {
        brandCode: { equals: candidate, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  throw new Error("Could not generate a unique brand code");
}
