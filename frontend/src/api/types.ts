export type ApiProductUnit = {
  id: string;
  productId: string;
  code: string;
  displayName: string;
  isBaseUnit: boolean;
  conversionToBase: string;
  allowsFractionalSale: boolean;
};

export type ApiBarcode = {
  id: string;
  code: string;
  type: string;
  productId: string;
  productUnitId: string | null;
  note: string | null;
};

export type ApiProduct = {
  id: string;
  sku: string;
  name: string;
  slug: string | null;
  description: string | null;
  category: string | null;
  brand: string | null;
  status: string;
  baseUnitCode: string;
  unitKind: string;
  allowsFractional: boolean;
  costPrice: string | null;
  sellingPrice: string | null;
  taxRate: string | null;
  reorderLevel: string | null;
  currentStock: string;
  units: ApiProductUnit[];
  barcodes: ApiBarcode[];
};

export type ApiSupplier = {
  id: string;
  name: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  gstNumber?: string | null;
  note?: string | null;
};

export type CreateSupplierBody = {
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  gstNumber?: string;
  note?: string;
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

export type ProductCreateItem = {
  name: string;
  description?: string;
  category: "Electrical" | "Hardware" | "Paint";
  brand?: string;
  baseUnitCode: string;
  unitKind: string;
  allowsFractional?: boolean;
  sellingPrice?: number | string;
  costPrice?: number | string;
  taxRate?: number | string;
  currentStock?: number | string;
  reorderLevel?: number | string;
};

export type BatchCreateProductsBody = {
  products: ProductCreateItem[];
};

export type BatchCreateProductsResult = {
  created: number;
  products: ApiProduct[];
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
