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

export type UpdateProductBody = {
  name?: string;
  description?: string | null;
  category?: "Electrical" | "Hardware" | "Paint";
  brand?: string | null;
  sellingPrice?: number;
  costPrice?: number;
  taxRate?: number;
  reorderLevel?: number;
  allowsFractional?: boolean;
  status?: "ACTIVE" | "INACTIVE";
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

export type ApiCustomer = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
};

export type CreateCustomerBody = {
  name: string;
  phone: string;
  email?: string;
  address?: string;
};

export type PromotionScope = "CART" | "PRODUCT" | "CATEGORY";

export type ApiPromotion = {
  id: string;
  name: string;
  code?: string | null;
  scope: PromotionScope;
  category?: "Electrical" | "Hardware" | "Paint" | null;
  percentage: string;
  isActive: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  note?: string | null;
  productIds: string[];
};

export type CreatePromotionBody = {
  name: string;
  code?: string;
  scope: PromotionScope;
  percentage: number | string;
  category?: "Electrical" | "Hardware" | "Paint";
  productIds?: string[];
  isActive?: boolean;
  startsAt?: string;
  endsAt?: string;
  note?: string;
};
export type UpdatePromotionBody = CreatePromotionBody;

/** Active users for role switcher (ADMIN / MANAGER / CASHIER). */
export type SessionUserRow = {
  id: string;
  fullName: string;
  role: "ADMIN" | "CASHIER" | "MANAGER";
};

/** Current JWT user (who logged in). */
export type SessionUserSelf = {
  id: string;
  name: string;
  role: "ADMIN" | "CASHIER" | "MANAGER";
};

export type SessionResponse = {
  user: SessionUserSelf;
  adminUserId: string;
  cashierUserId: string;
  users: SessionUserRow[];
};

export type LoginResponse = {
  token: string;
  user: SessionUserSelf;
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
  customerId?: string;
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
  status?: string;
  customerId?: string | null;
  customerName?: string | null;
  customerNameSnapshot?: string | null;
  customerPhone?: string | null;
  totalAmount?: string;
  paidAmount?: string;
  balanceAmount?: string;
  subtotal?: string;
  discountAmount?: string;
  taxAmount?: string;
  note?: string | null;
  createdAt?: string;
  createdById?: string;
};

export type OutstandingSaleSummary = {
  id: string;
  saleNumber: string;
  createdAt: string;
  totalAmount: string;
  paidAmount: string;
  balanceAmount: string;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  lineCount: number;
};

export type SalePaymentRecord = {
  id: string;
  amount: string;
  note: string | null;
  createdAt: string;
  createdById: string;
};

/** Line item as returned by `GET /api/sales/:id` and `POST /api/sales`. */
export type SaleLineDetail = {
  id: string;
  productId: string;
  productUnitId: string;
  quantity: string;
  quantityInBase: string;
  unitPrice: string;
  lineDiscount: string;
  lineTax: string;
  lineTotal: string;
  productName: string;
  productSku: string;
  unitCode: string;
  unitDisplayName: string;
};

/** Full sale payload from the API (create, get, payment). */
export type SaleDetail = {
  id: string;
  saleNumber: string;
  status: string;
  customerId: string | null;
  customerName: string | null;
  customerNameSnapshot: string | null;
  customerPhone: string | null;
  note: string | null;
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  totalAmount: string;
  paidAmount: string;
  balanceAmount: string;
  createdAt: string;
  createdById: string;
  lines: SaleLineDetail[];
  payments: SalePaymentRecord[];
};

/** Row from `GET /api/sales/search` for picking a sale to reprint. */
export type SaleSearchResult = {
  id: string;
  saleNumber: string;
  createdAt: string;
  totalAmount: string;
  paidAmount: string;
  balanceAmount: string;
  customerLabel: string;
};

export type RecordSalePaymentBody = {
  amount: number;
  createdById: string;
  note?: string;
};

export type PurchaseRecord = {
  id: string;
  purchaseNumber: string;
};

export type ProductRecord = {
  id: string;
  currentStock: string;
};

export type SalesSummaryReport = {
  summary: {
    saleCount: number;
    subtotal: string;
    discountAmount: string;
    taxAmount: string;
    totalAmount: string;
    paidAmount: string;
    balanceAmount: string;
    averageTicket: string;
  };
  sales: Array<{
    id: string;
    saleNumber: string;
    createdAt: string;
    subtotal: string;
    discountAmount: string;
    taxAmount: string;
    totalAmount: string;
    paidAmount: string;
    balanceAmount: string;
    customerLabel: string;
    cashierName: string;
  }>;
};

export type SalesByProductReport = {
  products: Array<{
    productId: string;
    sku: string;
    name: string;
    category: string;
    brand: string;
    lineCount: number;
    quantityInBase: string;
    revenue: string;
  }>;
};

export type PurchasesReport = {
  summary: {
    purchaseCount: number;
    subtotal: string;
    taxAmount: string;
    totalAmount: string;
  };
  bySupplier: Array<{
    supplierId: string;
    supplierName: string;
    purchaseCount: number;
    totalAmount: string;
  }>;
  purchases: Array<{
    id: string;
    purchaseNumber: string;
    createdAt: string;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    subtotal: string;
    taxAmount: string;
    totalAmount: string;
    supplierName: string;
    createdByName: string;
  }>;
};

export type GrossMarginReport = {
  disclaimer: string;
  lineCount: number;
  linesMissingCost: number;
  revenue: string;
  estimatedCost: string;
  grossMargin: string;
  marginPercent: string;
};

export type DashboardDayPoint = {
  date: string;
  salesTotal: string;
  salesCount: number;
  purchasesTotal: string;
  purchasesCount: number;
};

export type DashboardTimeSeriesResponse = {
  days: number;
  series: DashboardDayPoint[];
};

export type SalesRevenueGranularity = "day" | "week" | "month";

export type SalesRevenueBucket = {
  key: string;
  label: string;
  total: string;
  count: number;
};

export type SalesRevenueSeriesResponse = {
  granularity: SalesRevenueGranularity;
  buckets: number;
  series: SalesRevenueBucket[];
};
