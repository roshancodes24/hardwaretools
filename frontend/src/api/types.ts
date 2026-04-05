export type ApiProductUnit = {
  id: string;
  productId: string;
  code: string;
  displayName: string;
  isBaseUnit: boolean;
  conversionToBase: string;
  allowsFractionalSale: boolean;
};

export type ApiProduct = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  sellingPrice: string | null;
  reorderLevel: string | null;
  currentStock: string;
  baseUnitCode: string;
  units: ApiProductUnit[];
};

export type ApiSupplier = {
  id: string;
  name: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type SessionResponse = {
  adminUserId: string;
  cashierUserId: string;
};

export type SaleLineBody = {
  productId: string;
  productUnitId: string;
  quantity: string | number;
  unitPrice: string | number;
  lineDiscount?: string | number;
  lineTax?: string | number;
};

export type CreateSaleBody = {
  createdById: string;
  customerName?: string;
  customerPhone?: string;
  note?: string;
  paidAmount: string | number;
  lines: SaleLineBody[];
};

export type PurchaseLineBody = {
  productId: string;
  productUnitId: string;
  quantity: string | number;
  unitCost: string | number;
  lineDiscount?: string | number;
  lineTax?: string | number;
};

export type CreatePurchaseBody = {
  supplierId: string;
  createdById: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  note?: string;
  lines: PurchaseLineBody[];
};

export type CreateStockAdjustmentBody = {
  productId: string;
  adjustedById: string;
  quantityAfter: string | number;
  reason: string;
  note?: string;
};

export type SaleRecord = {
  id: string;
  saleNumber: string;
};

export type PurchaseRecord = {
  id: string;
  purchaseNumber: string;
};

export type ProductRecord = {
  id: string;
  currentStock: string;
};
