import type { Prisma } from "@prisma/client";

const SALE_NUMBER_RETRY = 200;

/** Next unique sale number: BIL-1000, BIL-1001, … or INV-1000, … */
export async function allocateSaleNumber(
  tx: Prisma.TransactionClient,
  kind: "bill" | "tax_invoice",
  billStart: number,
  taxStart: number
): Promise<string> {
  const prefix = kind === "tax_invoice" ? "INV" : "BIL";
  const start = kind === "tax_invoice" ? taxStart : billStart;
  if (!Number.isFinite(start) || start < 0) {
    throw new Error("Invalid sale number series start (check env vars).");
  }

  const pattern = `^${prefix}-[0-9]+$`;
  const rows = await tx.$queryRaw<Array<{ max: number | null }>>`
    SELECT MAX(
      NULLIF(regexp_replace("saleNumber", ${`^${prefix}-`}, ''), '')::integer
    ) AS max
    FROM "Sale"
    WHERE "saleNumber" ~ ${pattern}
  `;

  const maxExisting = rows[0]?.max;
  let next =
    maxExisting != null && Number.isFinite(maxExisting)
      ? Math.max(maxExisting, start - 1) + 1
      : start;

  for (let guard = 0; guard < SALE_NUMBER_RETRY; guard++) {
    const candidate = `${prefix}-${next}`;
    const clash = await tx.sale.findUnique({
      where: { saleNumber: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
    next++;
  }
  throw new Error("Could not allocate a unique sale number.");
}

/** Allocate a purchase number with retry on unique constraint races. */
export function nextPurchaseNumber(): string {
  return `PUR-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "P2002"
  );
}
