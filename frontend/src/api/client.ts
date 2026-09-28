import { parseErrorResponse } from "./errors";
import type {
  ApiCustomer,
  ApiProduct,
  ProductsListParams,
  ProductsListResponse,
  UpdateProductBody,
  ApiPromotion,
  ApiSupplier,
  BatchCreateProductsBody,
  BatchCreateProductsResult,
  CreateCustomerBody,
  CreatePromotionBody,
  CreatePurchaseBody,
  CreateSaleBody,
  CreateStockAdjustmentBody,
  CreateSupplierBody,
  OutstandingSaleSummary,
  ProductRecord,
  PurchaseDetail,
  PurchasesListResponse,
  RecordPurchasePaymentBody,
  RecordSalePaymentBody,
  SaleDetail,
  SaleSearchResult,
  SessionResponse,
  LoginResponse,
  UpdatePromotionBody,
  SalesSummaryReport,
  SalesByCustomerReport,
  SalesByProductReport,
  SupplierPaymentsReport,
  PurchasesReport,
  GrossMarginReport,
  DashboardTimeSeriesResponse,
  SalesRevenueGranularity,
  SalesRevenueSeriesResponse,
  RecentActivityResponse,
  TaxInvoiceSalesReport,
  ScheduledReportConfig,
  ReportRunsListResponse,
  SavedReportRunDetail,
  QuotationDetail,
  QuotationListParams,
  QuotationListResponse,
  QuotationWriteBody,
} from "./types";

function normalizeApiBase(raw: string | undefined): string {
  const t = (raw ?? "").trim();
  if (!t) return "";
  return t.replace(/\/+$/, "");
}

const API_BASE = normalizeApiBase(import.meta.env.VITE_API_URL);

const AUTH_TOKEN_STORAGE_KEY = "inventoryAccessToken";
const ACTING_USER_STORAGE_KEY = "inventoryActingUserId";
let authTokenMem: string | null = null;
let actingUserIdMem: string | null = null;

/** JWT from POST /api/login — sent as `Authorization: Bearer …` on API calls. */
export function setAuthToken(token: string | null): void {
  authTokenMem = token;
  if (typeof localStorage === "undefined") return;
  if (token) localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  else localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
}

export function clearAuthToken(): void {
  setAuthToken(null);
}

export function getAuthToken(): string | null {
  if (authTokenMem) return authTokenMem;
  if (typeof localStorage === "undefined") return null;
  authTokenMem = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  return authTokenMem;
}

/** Clear JWT and optional acting-user header state (logout). */
export function logoutAuth(): void {
  clearAuthToken();
  setActingUserId(null);
}

/** Admin switcher: `X-Acting-User-Id` when JWT user is admin/manager. */
export function setActingUserId(id: string | null): void {
  actingUserIdMem = id;
  if (typeof localStorage === "undefined") return;
  if (id) localStorage.setItem(ACTING_USER_STORAGE_KEY, id);
  else localStorage.removeItem(ACTING_USER_STORAGE_KEY);
}

function getActingUserIdForRequest(): string | null {
  if (actingUserIdMem) return actingUserIdMem;
  if (typeof localStorage === "undefined") return null;
  actingUserIdMem = localStorage.getItem(ACTING_USER_STORAGE_KEY);
  return actingUserIdMem;
}

async function parseResponse<T>(r: Response): Promise<T> {
  const text = await r.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = { error: text || "Invalid JSON response" };
  }

  if (!r.ok) {
    throw parseErrorResponse(r.status, body, text || r.statusText);
  }

  return body as T;
}

async function requestBlob(path: string): Promise<Blob> {
  const url = `${API_BASE}${path}`;
  const token = getAuthToken();
  const acting = getActingUserIdForRequest();
  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(acting ? { "X-Acting-User-Id": acting } : {}),
  };
  const r = await fetch(url, { headers });
  if (!r.ok) {
    const text = await r.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = { error: text || "Invalid response" };
    }
    throw parseErrorResponse(r.status, body, text || r.statusText);
  }
  return r.blob();
}

/** Unauthenticated POST (login only). */
async function requestPublic<T>(path: string, init: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const r = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  return parseResponse<T>(r);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const rest = init ?? {};
  const token = getAuthToken();
  const acting = getActingUserIdForRequest();
  const headers: Record<string, string> = {
    ...(rest.body ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(acting ? { "X-Acting-User-Id": acting } : {}),
    ...((rest.headers as Record<string, string>) ?? {}),
  };
  const r = await fetch(url, {
    ...rest,
    headers,
  });

  return parseResponse<T>(r);
}

export const api = {
  login(body: { username: string; password: string }): Promise<LoginResponse> {
    return requestPublic<LoginResponse>("/api/login", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  getSession(): Promise<SessionResponse> {
    return request<SessionResponse>("/api/session");
  },

  getSuppliers(): Promise<ApiSupplier[]> {
    return request<ApiSupplier[]>("/api/suppliers");
  },

  getCustomers(): Promise<ApiCustomer[]> {
    return request<ApiCustomer[]>("/api/customers");
  },

  getCustomer(id: string): Promise<ApiCustomer> {
    return request<ApiCustomer>(`/api/customers/${encodeURIComponent(id)}`);
  },

  createCustomer(payload: CreateCustomerBody): Promise<ApiCustomer> {
    return request<ApiCustomer>("/api/customers", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  createSupplier(payload: CreateSupplierBody): Promise<ApiSupplier> {
    return request<ApiSupplier>("/api/suppliers", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getPromotions(): Promise<ApiPromotion[]> {
    return request<ApiPromotion[]>("/api/promotions");
  },

  createPromotion(payload: CreatePromotionBody): Promise<ApiPromotion> {
    return request<ApiPromotion>("/api/promotions", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  updatePromotion(id: string, payload: UpdatePromotionBody): Promise<ApiPromotion> {
    return request<ApiPromotion>(`/api/promotions/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },

  deletePromotion(id: string): Promise<void> {
    return request<void>(`/api/promotions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  getProducts(): Promise<ApiProduct[]> {
    return request<ApiProduct[]>("/api/products");
  },

  listProducts(params: ProductsListParams = {}): Promise<ProductsListResponse> {
    const q = new URLSearchParams();
    if (params.page != null) q.set("page", String(params.page));
    if (params.limit != null) q.set("limit", String(params.limit));
    if (params.q?.trim()) q.set("q", params.q.trim());
    if (params.priceReviewOnly) q.set("priceReviewOnly", "1");
    const qs = q.toString();
    return request<ProductsListResponse>(
      qs ? `/api/products?${qs}` : "/api/products?page=1"
    );
  },

  updateProduct(id: string, payload: UpdateProductBody): Promise<ApiProduct> {
    return request<ApiProduct>(`/api/products/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },

  deleteProduct(id: string): Promise<void> {
    return request<void>(`/api/products/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  /** Approve the suggested markdown for a product with a pending price review. */
  applyPriceReview(id: string): Promise<ApiProduct> {
    return request<ApiProduct>(
      `/api/products/${encodeURIComponent(id)}/price-review/apply`,
      { method: "POST" }
    );
  },

  /** Keep the current price and clear a product's pending price review. */
  dismissPriceReview(id: string): Promise<ApiProduct> {
    return request<ApiProduct>(
      `/api/products/${encodeURIComponent(id)}/price-review/dismiss`,
      { method: "POST" }
    );
  },

  /** Bulk approve suggested markdowns and clear reviews (all flagged, or the given ids). */
  applyAllPriceReviews(ids?: string[]): Promise<{ updated: number }> {
    return request<{ updated: number }>(
      "/api/products/price-review/apply-all",
      {
        method: "POST",
        body: JSON.stringify(ids && ids.length > 0 ? { ids } : {}),
      }
    );
  },

  /** Bulk keep current prices and clear reviews (all flagged, or the given ids). */
  dismissAllPriceReviews(ids?: string[]): Promise<{ updated: number }> {
    return request<{ updated: number }>(
      "/api/products/price-review/dismiss-all",
      {
        method: "POST",
        body: JSON.stringify(ids && ids.length > 0 ? { ids } : {}),
      }
    );
  },

  createSale(payload: CreateSaleBody): Promise<SaleDetail> {
    return request<SaleDetail>("/api/sales", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getSale(id: string): Promise<SaleDetail> {
    return request<SaleDetail>(`/api/sales/${encodeURIComponent(id)}`);
  },

  getSaleByNumber(saleNumber: string): Promise<SaleDetail> {
    return request<SaleDetail>(
      `/api/sales/by-number/${encodeURIComponent(saleNumber.trim())}`
    );
  },

  listRecentSales(limit = 10): Promise<SaleSearchResult[]> {
    const take = Math.max(10, limit);
    return request<SaleSearchResult[]>(`/api/sales/recent?limit=${take}`);
  },

  searchSales(params: {
    q: string;
    limit?: number;
    from?: string;
    to?: string;
  }): Promise<SaleSearchResult[]> {
    const sp = new URLSearchParams();
    sp.set("q", params.q.trim());
    if (params.limit != null) sp.set("limit", String(params.limit));
    if (params.from) sp.set("from", params.from);
    if (params.to) sp.set("to", params.to);
    return request<SaleSearchResult[]>(`/api/sales/search?${sp.toString()}`);
  },

  getOutstandingSales(): Promise<OutstandingSaleSummary[]> {
    return request<OutstandingSaleSummary[]>("/api/sales/outstanding");
  },

  recordSalePayment(
    saleId: string,
    payload: RecordSalePaymentBody
  ): Promise<SaleDetail> {
    return request<SaleDetail>(
      `/api/sales/${encodeURIComponent(saleId)}/payments`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
  },

  cancelSale(id: string): Promise<SaleDetail> {
    return request<SaleDetail>(
      `/api/sales/${encodeURIComponent(id)}/cancel`,
      { method: "POST" }
    );
  },

  createPurchase(payload: CreatePurchaseBody): Promise<PurchaseDetail> {
    return request<PurchaseDetail>("/api/purchases", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getPurchases(params?: {
    owingOnly?: boolean;
    limit?: number;
  }): Promise<PurchasesListResponse> {
    const q = new URLSearchParams();
    if (params?.owingOnly) q.set("owingOnly", "1");
    if (params?.limit != null) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<PurchasesListResponse>(
      `/api/purchases${qs ? `?${qs}` : ""}`
    );
  },

  getPurchase(id: string): Promise<PurchaseDetail> {
    return request<PurchaseDetail>(
      `/api/purchases/${encodeURIComponent(id)}`
    );
  },

  recordPurchasePayment(
    purchaseId: string,
    payload: RecordPurchasePaymentBody
  ): Promise<PurchaseDetail> {
    return request<PurchaseDetail>(
      `/api/purchases/${encodeURIComponent(purchaseId)}/payments`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
  },

  createStockAdjustment(
    payload: CreateStockAdjustmentBody
  ): Promise<ProductRecord> {
    return request<ProductRecord>("/api/stock-adjustments", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  batchCreateProducts(
    payload: BatchCreateProductsBody
  ): Promise<BatchCreateProductsResult> {
    return request<BatchCreateProductsResult>("/api/products/batch", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getReportSalesSummary(
    from: string,
    to: string
  ): Promise<SalesSummaryReport> {
    const q = new URLSearchParams({ from, to });
    return request<SalesSummaryReport>(
      `/api/reports/sales-summary?${q.toString()}`
    );
  },

  getReportSalesByProduct(
    from: string,
    to: string
  ): Promise<SalesByProductReport> {
    const q = new URLSearchParams({ from, to });
    return request<SalesByProductReport>(
      `/api/reports/sales-by-product?${q.toString()}`
    );
  },

  getReportSalesByCustomer(
    from: string,
    to: string
  ): Promise<SalesByCustomerReport> {
    const q = new URLSearchParams({ from, to });
    return request<SalesByCustomerReport>(
      `/api/reports/sales-by-customer?${q.toString()}`
    );
  },

  getReportSupplierPayments(
    from: string,
    to: string
  ): Promise<SupplierPaymentsReport> {
    const q = new URLSearchParams({ from, to });
    return request<SupplierPaymentsReport>(
      `/api/reports/supplier-payments?${q.toString()}`
    );
  },

  getReportPurchases(from: string, to: string): Promise<PurchasesReport> {
    const q = new URLSearchParams({ from, to });
    return request<PurchasesReport>(`/api/reports/purchases?${q.toString()}`);
  },

  getReportGrossMargin(from: string, to: string): Promise<GrossMarginReport> {
    const q = new URLSearchParams({ from, to });
    return request<GrossMarginReport>(
      `/api/reports/gross-margin?${q.toString()}`
    );
  },

  getReportTaxInvoiceSales(
    from: string,
    to: string
  ): Promise<TaxInvoiceSalesReport> {
    const q = new URLSearchParams({ from, to });
    return request<TaxInvoiceSalesReport>(
      `/api/reports/tax-invoice-sales?${q.toString()}`
    );
  },

  getDashboardTimeSeries(
    days?: number
  ): Promise<DashboardTimeSeriesResponse> {
    const q = new URLSearchParams();
    if (days != null) q.set("days", String(days));
    const qs = q.toString();
    return request<DashboardTimeSeriesResponse>(
      `/api/reports/dashboard-timeseries${qs ? `?${qs}` : ""}`
    );
  },

  getSalesRevenueSeries(
    granularity: SalesRevenueGranularity,
    buckets?: number
  ): Promise<SalesRevenueSeriesResponse> {
    const q = new URLSearchParams({ granularity });
    if (buckets != null) q.set("buckets", String(buckets));
    return request<SalesRevenueSeriesResponse>(
      `/api/reports/sales-revenue-series?${q.toString()}`
    );
  },

  getRecentActivity(limit?: number): Promise<RecentActivityResponse> {
    const q = new URLSearchParams();
    if (limit != null) q.set("limit", String(limit));
    const qs = q.toString();
    return request<RecentActivityResponse>(
      `/api/sales/recent-activity${qs ? `?${qs}` : ""}`
    );
  },

  getScheduledReportConfig(): Promise<ScheduledReportConfig> {
    return request<ScheduledReportConfig>("/api/scheduled-reports/config");
  },

  updateScheduledReportConfig(
    body: ScheduledReportConfig
  ): Promise<ScheduledReportConfig> {
    return request<ScheduledReportConfig>("/api/scheduled-reports/config", {
      method: "PUT",
      body: JSON.stringify(body),
    });
  },

  listScheduledReportRuns(limit?: number): Promise<ReportRunsListResponse> {
    const q = new URLSearchParams();
    if (limit != null) q.set("limit", String(limit));
    const qs = q.toString();
    return request<ReportRunsListResponse>(
      `/api/scheduled-reports/runs${qs ? `?${qs}` : ""}`
    );
  },

  getScheduledReportRun(id: string): Promise<SavedReportRunDetail> {
    return request<SavedReportRunDetail>(`/api/scheduled-reports/runs/${id}`);
  },

  listQuotations(params: QuotationListParams = {}): Promise<QuotationListResponse> {
    const q = new URLSearchParams();
    if (params.q?.trim()) q.set("q", params.q.trim());
    if (params.customerId) q.set("customerId", params.customerId);
    if (params.status) q.set("status", params.status);
    if (params.from) q.set("from", params.from);
    if (params.to) q.set("to", params.to);
    if (params.page != null) q.set("page", String(params.page));
    if (params.limit != null) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<QuotationListResponse>(`/api/quotations${qs ? `?${qs}` : ""}`);
  },

  getQuotation(id: string): Promise<QuotationDetail> {
    return request<QuotationDetail>(`/api/quotations/${encodeURIComponent(id)}`);
  },

  createQuotation(body: QuotationWriteBody): Promise<QuotationDetail> {
    return request<QuotationDetail>("/api/quotations", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  updateQuotation(id: string, body: QuotationWriteBody): Promise<QuotationDetail> {
    return request<QuotationDetail>(`/api/quotations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  issueQuotation(id: string): Promise<QuotationDetail> {
    return request<QuotationDetail>(
      `/api/quotations/${encodeURIComponent(id)}/issue`,
      { method: "POST" }
    );
  },

  cancelQuotation(id: string): Promise<QuotationDetail> {
    return request<QuotationDetail>(
      `/api/quotations/${encodeURIComponent(id)}/cancel`,
      { method: "POST" }
    );
  },

  downloadQuotationPdf(id: string): Promise<Blob> {
    return requestBlob(`/api/quotations/${encodeURIComponent(id)}/pdf`);
  },
};
