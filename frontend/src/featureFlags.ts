// featureFlags.ts
// Set a flag to `true` to show that nav item; `false` to hide it.
// In production you'd drive these from an env var, remote config, or user role.

export const FEATURE_FLAGS = {
  reporting: false,
  catalogBrands: false,
  catalogProductTypes: false,
  catalogPromotions: false,
  catalogPriceBooks: false,
  inventoryOrderStock: false,
  inventoryReceiveStock: false,
  inventorySupplierReturns: false,
  inventoryCounts: false,
} as const;

export type FeatureFlags = typeof FEATURE_FLAGS;
