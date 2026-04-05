import { parseErrorResponse } from "./errors";
import type {
  ApiProduct,
  ApiSupplier,
  CreatePurchaseBody,
  CreateSaleBody,
  CreateStockAdjustmentBody,
  ProductRecord,
  PurchaseRecord,
  SaleRecord,
  SessionResponse,
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
};

export { ApiError } from "./errors";
export type { FieldDetail } from "./errors";
