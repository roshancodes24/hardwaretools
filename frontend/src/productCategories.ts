/** Fixed retail departments — must stay in sync with API validation. */
export const PRODUCT_CATEGORIES = ["Electrical", "Hardware", "Paint"] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
