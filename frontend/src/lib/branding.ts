const DEFAULT_COMPANY_NAME = "Raj Hardware";

export const COMPANY_NAME =
  import.meta.env.VITE_COMPANY_NAME?.trim() || DEFAULT_COMPANY_NAME;

export const COMPANY_SHORT_NAME =
  import.meta.env.VITE_COMPANY_SHORT_NAME?.trim() || "RAJ";

export const APP_TITLE = `${COMPANY_NAME} — POS & Inventory`;
