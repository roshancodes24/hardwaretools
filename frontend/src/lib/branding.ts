/** Shop identity for the santosh branch. Keep these values when merging main. */
const DEFAULT_COMPANY_NAME = "Santosh Electricals Works";

export const COMPANY_NAME =
  import.meta.env.VITE_COMPANY_NAME?.trim() || DEFAULT_COMPANY_NAME;

export const COMPANY_SHORT_NAME =
  import.meta.env.VITE_COMPANY_SHORT_NAME?.trim() || "SEW";

export const APP_TITLE = `${COMPANY_NAME} — POS & Inventory`;
