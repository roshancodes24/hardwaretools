import type { Prisma } from "@prisma/client";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export type ProductListQuery = {
  page?: number;
  limit?: number;
  q?: string;
  priceReviewOnly?: boolean;
};

export function parseProductListQuery(query: Record<string, unknown>): ProductListQuery {
  const pageRaw = Number.parseInt(String(query.page ?? ""), 10);
  const limitRaw = Number.parseInt(String(query.limit ?? ""), 10);
  const q = typeof query.q === "string" ? query.q.trim() : "";
  const priceReviewOnly =
    query.priceReviewOnly === "1" ||
    query.priceReviewOnly === "true" ||
    query.priceReview === "1" ||
    query.priceReview === "true";

  const parsed: ProductListQuery = {};
  if (Number.isFinite(pageRaw) && pageRaw >= 1) parsed.page = pageRaw;
  if (Number.isFinite(limitRaw) && limitRaw >= 1) {
    parsed.limit = Math.min(MAX_PAGE_SIZE, limitRaw);
  }
  if (q) parsed.q = q;
  if (priceReviewOnly) parsed.priceReviewOnly = true;
  return parsed;
}

/** True when the client wants a paginated envelope instead of a bare array. */
export function wantsPaginatedProductList(query: ProductListQuery): boolean {
  return (
    query.page != null ||
    query.priceReviewOnly === true ||
    Boolean(query.q && query.q.length > 0)
  );
}

export function productSearchWhere(q: string | undefined): Prisma.ProductWhereInput {
  const term = q?.trim();
  if (!term) return {};
  return {
    OR: [
      { name: { contains: term, mode: "insensitive" } },
      { sku: { contains: term, mode: "insensitive" } },
      { category: { contains: term, mode: "insensitive" } },
      { brand: { contains: term, mode: "insensitive" } },
      { brandCode: { contains: term, mode: "insensitive" } },
      { color: { contains: term, mode: "insensitive" } },
      { size: { contains: term, mode: "insensitive" } },
      { hsnCode: { contains: term, mode: "insensitive" } },
      { barcodes: { some: { code: { contains: term, mode: "insensitive" } } } },
    ],
  };
}

export function resolveProductListPaging(query: ProductListQuery): {
  page: number;
  limit: number;
  skip: number;
} {
  const page = query.page ?? 1;
  const limit = query.limit ?? DEFAULT_PAGE_SIZE;
  return { page, limit, skip: (page - 1) * limit };
}

export const PRODUCT_LIST_DEFAULT_LIMIT = DEFAULT_PAGE_SIZE;
