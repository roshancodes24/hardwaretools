import { parseErrorResponse } from "./errors";
import type {
  ApiCustomer,
  ApiProduct,
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
};
