import { parseErrorResponse } from "./errors";
import type {
  ApiCustomer,
  ApiProduct,
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
  ProductRecord,
  PurchaseRecord,
  SaleRecord,
  SessionResponse,
  UpdatePromotionBody,
} from "./types";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const r = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });

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

export const api = {
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

  createSale(payload: CreateSaleBody): Promise<SaleRecord> {
    return request<SaleRecord>("/api/sales", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  createPurchase(payload: CreatePurchaseBody): Promise<PurchaseRecord> {
    return request<PurchaseRecord>("/api/purchases", {
      method: "POST",
      body: JSON.stringify(payload),
    });
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
};
