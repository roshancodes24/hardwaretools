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
