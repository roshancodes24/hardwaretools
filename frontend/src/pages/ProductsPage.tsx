import { useEffect, useMemo, useRef, useState } from "react";
import type { ProductImportPatch } from "../lib/importProducts";
import {
  parseProductImportFile,
  PRODUCT_IMPORT_TEMPLATE_CSV,
} from "../lib/importProducts";
import { api } from "../api/client";
import { isApiError } from "../api/errors";
import type { ApiProduct, UpdateProductBody } from "../api/types";
import {
  PRODUCT_CATEGORIES,
  type ProductCategory,
} from "../productCategories";
import type { ConfirmOptions } from "../useConfirm";

// ── Constants ─────────────────────────────────────────────────────────────────

const UNIT_KINDS = ["PIECE", "WEIGHT", "LENGTH", "VOLUME", "PACK", "OTHER"] as const;
type UnitKindValue = (typeof UNIT_KINDS)[number];

const UNIT_KIND_LABELS: Record<UnitKindValue, string> = {
  PIECE: "Piece",
  WEIGHT: "Weight",
  LENGTH: "Length",
  VOLUME: "Volume",
  PACK: "Pack",
  OTHER: "Other",
};

const COMMON_UNIT_CODES = [
  "pc", "kg", "g", "m", "cm", "L", "mL",
  "box", "roll", "bag", "pair", "set", "sheet", "tin", "drum",
];

/** Rows per page in the main product catalog table */
const PRODUCTS_TABLE_PAGE_SIZE = 50;

/** Max rows per file import (batch create limit safety). */
const MAX_IMPORT_ROWS = 500;

function suggestUnitKind(code: string): UnitKindValue {
  const c = code.toLowerCase();
  if (["kg", "g", "mg"].includes(c)) return "WEIGHT";
  if (["m", "cm", "mm"].includes(c)) return "LENGTH";
  if (["l", "ml", "litre", "liter"].includes(c)) return "VOLUME";
  if (["box", "pack", "roll", "bundle", "bag"].includes(c)) return "PACK";
  return "PIECE";
}

/** Dropdown options; if the product uses a code not in the standard list, keep it selectable. */
function unitCodeSelectOptions(currentCode: string): { value: string; label: string }[] {
  const cur = currentCode.trim();
  const standard = COMMON_UNIT_CODES.map((code) => ({ value: code, label: code }));
  if (cur && !COMMON_UNIT_CODES.includes(cur)) {
    return [{ value: cur, label: `${cur} (current)` }, ...standard];
  }
  return standard;
}

const fmtPrice = (n: number | string | null | undefined) => {
  if (n == null || n === "") return "—";
  return `₹${Number(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

// ── Types ─────────────────────────────────────────────────────────────────────

type ProductStatusUi = "ACTIVE" | "INACTIVE";

type ProductDraft = {
  _id: string;
  /** Create only: optional manual SKU (blank → server assigns). */
  sku: string;
  name: string;
  description: string;
  category: string;
  brand: string;
  brandCode: string;
  color: string;
  baseUnitCode: string;
  unitKind: UnitKindValue;
  allowsFractional: boolean;
  sellingPrice: string;
  costPrice: string;
  percentage: string;
  mrp: string;
  cgstPercent: string;
  sgstPercent: string;
  igstPercent: string;
  currentStock: string;
  reorderLevel: string;
  hsnCode: string;
  status: ProductStatusUi;
};

type RowErrors = Record<string, string>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function newDraft(overrides: Partial<ProductDraft> = {}): ProductDraft {
  return {
    _id: Math.random().toString(36).slice(2),
    sku: "",
    name: "",
    description: "",
    category: "Electrical",
    brand: "",
    brandCode: "",
    color: "",
    baseUnitCode: "pc",
    unitKind: "PIECE",
    allowsFractional: false,
    sellingPrice: "",
    costPrice: "",
    percentage: "",
    mrp: "",
    cgstPercent: "9",
    sgstPercent: "9",
    igstPercent: "",
    currentStock: "0",
    reorderLevel: "",
    hsnCode: "",
    status: "ACTIVE",
    ...overrides,
  };
}

function productToDraft(p: ApiProduct): ProductDraft {
  const cat = PRODUCT_CATEGORIES.includes(p.category as ProductCategory)
    ? (p.category as ProductCategory)
    : "Electrical";
  const uk = UNIT_KINDS.includes(p.unitKind as UnitKindValue)
    ? (p.unitKind as UnitKindValue)
    : "PIECE";
  return {
    _id: p.id,
    sku: "",
    name: p.name,
    description: p.description ?? "",
    category: cat,
    brand: p.brand ?? "",
    brandCode: p.brandCode ?? "",
    color: p.color ?? "",
    baseUnitCode: p.baseUnitCode,
    unitKind: uk,
    allowsFractional: p.allowsFractional,
    sellingPrice: p.sellingPrice != null ? String(p.sellingPrice) : "",
    costPrice: p.costPrice != null ? String(p.costPrice) : "",
    percentage: p.percentage != null ? String(p.percentage) : "",
    mrp: p.mrp != null ? String(p.mrp) : "",
    cgstPercent: p.cgstPercent != null ? String(p.cgstPercent) : "",
    sgstPercent: p.sgstPercent != null ? String(p.sgstPercent) : "",
    igstPercent: p.igstPercent != null ? String(p.igstPercent) : "",
    currentStock: String(p.currentStock),
    reorderLevel: p.reorderLevel != null ? String(p.reorderLevel) : "",
    hsnCode: p.hsnCode?.trim() ?? "",
    status: p.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
  };
}

function draftToUpdateBody(d: ProductDraft): UpdateProductBody {
  const o: UpdateProductBody = {
    name: d.name.trim(),
    category: d.category as ProductCategory,
    allowsFractional: d.allowsFractional,
    status: d.status,
    description: d.description.trim() ? d.description.trim() : null,
    brand: d.brand.trim() || null,
    brandCode: d.brandCode.trim() || null,
    color: d.color.trim() || null,
    hsnCode: d.hsnCode.trim() ? d.hsnCode.trim() : null,
  };
  if (d.sellingPrice !== "") o.sellingPrice = Number(d.sellingPrice);
  if (d.costPrice !== "") o.costPrice = Number(d.costPrice);
  if (d.percentage !== "") o.percentage = Number(d.percentage);
  if (d.mrp !== "") o.mrp = Number(d.mrp);
  if (d.cgstPercent !== "") o.cgstPercent = Number(d.cgstPercent);
  if (d.sgstPercent !== "") o.sgstPercent = Number(d.sgstPercent);
  if (d.igstPercent !== "") o.igstPercent = Number(d.igstPercent);
  if (d.reorderLevel !== "") o.reorderLevel = Number(d.reorderLevel);
  return o;
}

function apiDetailsToRowErrors(
  details: { field: string; message: string }[] | undefined
): RowErrors {
  const e: RowErrors = {};
  for (const d of details ?? []) {
    const m = /^products\.0\.(\w+)$/.exec(d.field);
    const field = m ? m[1] : d.field.replace(/^.*\./, "").replace(/^\[|\]$/g, "") || d.field;
    if (!e[field]) e[field] = d.message;
  }
  return e;
}

function validateDraft(d: ProductDraft): RowErrors {
  const e: RowErrors = {};
  if (!d.name.trim()) e.name = "Required";
  else if (d.name.trim().length > 500) e.name = "Too long";
  if (!d.baseUnitCode.trim()) e.baseUnitCode = "Required";
  const catOk = PRODUCT_CATEGORIES.includes(d.category as ProductCategory);
  if (!catOk) e.category = "Select Electrical, Hardware, or Paint";
  const numFields: [keyof ProductDraft, string][] = [
    ["sellingPrice", "Price"],
    ["costPrice", "Cost"],
    ["percentage", "Percentage"],
    ["mrp", "MRP"],
    ["currentStock", "Stock"],
    ["reorderLevel", "Reorder"],
  ];
  for (const [field, label] of numFields) {
    const val = d[field] as string;
    if (val !== "" && (isNaN(Number(val)) || Number(val) < 0))
      e[field] = `${label} must be ≥ 0`;
  }
  const pctFields: [keyof ProductDraft, string][] = [
    ["cgstPercent", "CGST"],
    ["sgstPercent", "SGST"],
    ["igstPercent", "IGST"],
  ];
  for (const [field, label] of pctFields) {
    const val = d[field] as string;
    if (
      val !== "" &&
      (isNaN(Number(val)) || Number(val) < 0 || Number(val) > 100)
    ) {
      e[field] = `${label} % must be 0–100`;
    }
  }
  if (d.status !== "ACTIVE" && d.status !== "INACTIVE") {
    e.status = "Invalid status";
  }
  if (d.brandCode.trim().length > 100) {
    e.brandCode = "Brand Code is too long (max 100 characters)";
  }
  if (d.color.trim().length > 100) {
    e.color = "Colour is too long (max 100 characters)";
  }
  if (d.hsnCode.trim().length > 16) {
    e.hsnCode = "HSN Code is too long (max 16 characters)";
  }
  const skuT = d.sku.trim();
  if (skuT.length > 0) {
    if (skuT.length > 80) e.sku = "Too long (max 80 characters)";
    else if (!/^[A-Za-z0-9][A-Za-z0-9._\-\/\s]*$/.test(skuT)) {
      e.sku = "Use letters, numbers, spaces, . _ - / only";
    }
  }
  return e;
}

function rowErrorsFromApiDetails(
  details: { field: string; message: string }[] | undefined,
  count: number
): RowErrors[] {
  const result: RowErrors[] = Array.from({ length: count }, () => ({}));
  for (const d of details ?? []) {
    const m = /^products\.(\d+)\.(\w+)$/.exec(d.field);
    if (m) {
      const idx = Number(m[1]);
      const field = m[2];
      if (idx < count && !result[idx][field]) result[idx][field] = d.message;
    }
  }
  return result;
}

function statusOf(p: ApiProduct): "ok" | "low" | "out" {
  const stock = Number(p.currentStock);
  const reorder = p.reorderLevel ? Number(p.reorderLevel) : 0;
  if (stock === 0) return "out";
  if (reorder > 0 && stock <= reorder) return "low";
  return "ok";
}

function patchImportToDraft(patch: ProductImportPatch): ProductDraft {
  const bc = (patch.baseUnitCode ?? "").trim() || "pc";
  const uk =
    patch.unitKind && UNIT_KINDS.includes(patch.unitKind as UnitKindValue)
      ? (patch.unitKind as UnitKindValue)
      : suggestUnitKind(bc);
  const catRaw = (patch.category ?? "").trim();
  const cat = PRODUCT_CATEGORIES.includes(catRaw as ProductCategory)
    ? (catRaw as ProductCategory)
    : "Electrical";
  return newDraft({
    sku: (patch.sku ?? "").trim(),
    name: patch.name.trim(),
    description: (patch.description ?? "").trim(),
    category: cat,
    brand: (patch.brand ?? "").trim(),
    brandCode: (patch.brandCode ?? "").trim(),
    color: (patch.color ?? "").trim(),
    baseUnitCode: bc,
    unitKind: uk,
    allowsFractional: patch.allowsFractional ?? false,
    sellingPrice:
      patch.sellingPrice != null && String(patch.sellingPrice).trim() !== ""
        ? String(patch.sellingPrice).trim()
        : "",
    costPrice:
      patch.costPrice != null && String(patch.costPrice).trim() !== ""
        ? String(patch.costPrice).trim()
        : "",
    percentage:
      patch.percentage != null && String(patch.percentage).trim() !== ""
        ? String(patch.percentage).trim()
        : "",
    mrp:
      patch.mrp != null && String(patch.mrp).trim() !== ""
        ? String(patch.mrp).trim()
        : "",
    cgstPercent:
      patch.cgstPercent != null && String(patch.cgstPercent).trim() !== ""
        ? String(patch.cgstPercent).trim()
        : "9",
    sgstPercent:
      patch.sgstPercent != null && String(patch.sgstPercent).trim() !== ""
        ? String(patch.sgstPercent).trim()
        : "9",
    igstPercent:
      patch.igstPercent != null && String(patch.igstPercent).trim() !== ""
        ? String(patch.igstPercent).trim()
        : "",
    currentStock:
      patch.currentStock != null && String(patch.currentStock).trim() !== ""
        ? String(patch.currentStock).trim()
        : "0",
    reorderLevel:
      patch.reorderLevel != null && String(patch.reorderLevel).trim() !== ""
        ? String(patch.reorderLevel).trim()
        : "",
    hsnCode: (patch.hsnCode ?? "").trim(),
    status: patch.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
  });
}

function computedSellingPriceFromCostAndPercentage(costRaw: string, pctRaw: string): string {
  const cost = Number(costRaw);
  const pct = Number(pctRaw);
  if (!Number.isFinite(cost) || !Number.isFinite(pct) || cost < 0 || pct < 0) return "";
  const selling = cost + (cost * pct) / 100;
  return selling.toFixed(2);
}

function draftToPayloadItem(d: ProductDraft) {
  const skuTrim = d.sku.trim();
  return {
    name: d.name.trim(),
    ...(skuTrim !== "" ? { sku: skuTrim } : {}),
    description: d.description.trim() || undefined,
    category: d.category.trim() as ProductCategory,
    brand: d.brand.trim() || undefined,
    brandCode: d.brandCode.trim() || undefined,
    color: d.color.trim() || undefined,
    baseUnitCode: d.baseUnitCode.trim(),
    unitKind: d.unitKind,
    allowsFractional: d.allowsFractional,
    sellingPrice: d.sellingPrice !== "" ? Number(d.sellingPrice) : undefined,
    costPrice: d.costPrice !== "" ? Number(d.costPrice) : undefined,
    percentage: d.percentage !== "" ? Number(d.percentage) : undefined,
    mrp: d.mrp !== "" ? Number(d.mrp) : undefined,
    cgstPercent: d.cgstPercent !== "" ? Number(d.cgstPercent) : undefined,
    sgstPercent: d.sgstPercent !== "" ? Number(d.sgstPercent) : undefined,
    igstPercent: d.igstPercent !== "" ? Number(d.igstPercent) : undefined,
    currentStock: d.currentStock !== "" ? Number(d.currentStock) : 0,
    reorderLevel: d.reorderLevel !== "" ? Number(d.reorderLevel) : undefined,
    hsnCode: d.hsnCode.trim() || undefined,
  };
}

// ── Small reusable field components ──────────────────────────────────────────

function StatusBadge({ status }: { status: "ok" | "low" | "out" }) {
  const map = {
    ok: { bg: "#dcfce7", color: "#16a34a", label: "In Stock" },
    low: { bg: "#fef3c7", color: "#d97706", label: "Low Stock" },
    out: { bg: "#fee2e2", color: "#dc2626", label: "Out of Stock" },
  };
  const s = map[status];
  return (
    <span
      style={{
        background: s.bg, color: s.color, fontSize: 11, fontWeight: 600,
        padding: "2px 8px", borderRadius: 4, whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────

const mInput: React.CSSProperties = {
  height: 36, padding: "0 10px", width: "100%",
  border: "1px solid #e7e5e4", borderRadius: 8,
  fontSize: 13, outline: "none", background: "#fff", boxSizing: "border-box",
};
const mInputErr: React.CSSProperties = { ...mInput, border: "1px solid #2563eb" };

function MField({
  label, required, error, children,
}: {
  label: string; required?: boolean; error?: string; children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: "#44403c" }}>
        {label}
        {required && <span style={{ color: "#2563eb", marginLeft: 2 }}>*</span>}
      </label>
      {children}
      {error && (
        <span style={{ fontSize: 11, color: "#2563eb", marginTop: -2 }}>{error}</span>
      )}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11, fontWeight: 700, color: "#78716c",
        letterSpacing: "0.07em", textTransform: "uppercase",
        borderBottom: "1px solid #f0efee", paddingBottom: 6, marginBottom: 2,
      }}
    >
      {children}
    </div>
  );
}

function ProductModal({
  open,
  mode,
  skuDisplay,
  readOnlyUnits,
  draft,
  errors,
  saving,
  onClose,
  onChange,
  onSave,
}: {
  open: boolean;
  mode: "add" | "edit";
  skuDisplay?: string;
  readOnlyUnits?: boolean;
  draft: ProductDraft;
  errors: RowErrors;
  saving: boolean;
  onClose: () => void;
  onChange: (field: keyof ProductDraft, value: string | boolean) => void;
  onSave: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);

  const unitCodeOptions = useMemo(
    () => unitCodeSelectOptions(draft.baseUnitCode),
    [draft.baseUnitCode]
  );

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const inp = (
    field: keyof ProductDraft,
    type = "text",
    placeholder = ""
  ) => (
    <input
      value={draft[field] as string}
      onChange={(e) => onChange(field, e.target.value)}
      type={type}
      placeholder={placeholder}
      style={errors[field] ? mInputErr : mInput}
    />
  );

  const two: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 14,
  };

  return (
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000, padding: 24,
      }}
    >
      <div
        style={{
          background: "#fff", borderRadius: 14,
          width: "100%", maxWidth: 620,
          maxHeight: "92vh", overflowY: "auto",
          boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
          display: "flex", flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "18px 24px 14px", borderBottom: "1px solid #f0efee",
            flexShrink: 0,
          }}
        >
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1c1917" }}>
              {mode === "edit" ? "Edit product" : "Add Product"}
            </div>
            <div style={{ fontSize: 12, color: "#78716c", marginTop: 2 }}>
              {mode === "edit" && skuDisplay
                ? `SKU ${skuDisplay} cannot be changed.`
                : "Enter a custom SKU below or leave blank for auto codes (EL-/HW-/PT- by category)."}
            </div>
          </div>
          <button
            type="button" onClick={onClose}
            style={{
              width: 30, height: 30, borderRadius: "50%",
              border: "1px solid #e7e5e4", background: "#fafaf9",
              cursor: "pointer", fontSize: 16, color: "#78716c",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            padding: "20px 24px",
            display: "flex", flexDirection: "column", gap: 20,
            flex: 1, overflowY: "auto",
          }}
        >
          {errors._form ? (
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                background: "rgba(37,99,235,0.08)",
                border: "1px solid rgba(37,99,235,0.25)",
                color: "#1d4ed8",
                fontSize: 13,
              }}
            >
              {errors._form}
            </div>
          ) : null}
          {/* Basic information */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <SectionHeading>Basic Information</SectionHeading>
            <MField label="Product Name" required error={errors.name}>
              {inp("name", "text", "e.g. Copper Wire 1.5mm")}
            </MField>
            {mode === "add" ? (
              <MField label="SKU (optional)" error={errors.sku}>
                <input
                  value={draft.sku}
                  onChange={(e) => onChange("sku", e.target.value)}
                  type="text"
                  placeholder="Your code, or leave blank for auto (e.g. EL-00042)"
                  autoCapitalize="characters"
                  style={errors.sku ? mInputErr : mInput}
                />
              </MField>
            ) : null}
            <div style={two}>
              <MField label="Category" required error={errors.category}>
                <select
                  value={draft.category}
                  onChange={(e) => onChange("category", e.target.value)}
                  style={errors.category ? mInputErr : mInput}
                >
                  {PRODUCT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </MField>
              <MField label="Brand" error={errors.brand}>
                {inp("brand", "text", "e.g. PowerLine")}
              </MField>
            </div>
            <MField label="Brand Code" error={errors.brandCode}>
              {inp("brandCode", "text", "e.g. PL-RED")}
            </MField>
            <div style={two}>
              <MField label="Colour" error={errors.color}>
                {inp("color", "text", "e.g. Red")}
              </MField>
              <MField label="HSN Code" error={errors.hsnCode}>
                {inp("hsnCode", "text", "e.g. 8544 — optional (GST)")}
              </MField>
            </div>
            <MField label="Description" error={errors.description}>
              <textarea
                value={draft.description}
                onChange={(e) => onChange("description", e.target.value)}
                placeholder="Optional notes about this product — size, grade, usage, etc."
                rows={3}
                style={{
                  ...mInput,
                  height: "auto", padding: "8px 10px",
                  resize: "vertical", lineHeight: 1.5,
                  fontFamily: "system-ui, -apple-system, sans-serif",
                  ...(errors.description ? { border: "1px solid #2563eb" } : {}),
                }}
              />
            </MField>
            <div style={two}>
              <MField label="Status" error={errors.status}>
                <select
                  value={draft.status}
                  onChange={(e) =>
                    onChange("status", e.target.value === "INACTIVE" ? "INACTIVE" : "ACTIVE")
                  }
                  style={errors.status ? mInputErr : mInput}
                >
                  <option value="ACTIVE">Active (sellable)</option>
                  <option value="INACTIVE">Inactive (hidden from POS)</option>
                </select>
              </MField>
            </div>
          </div>

          {/* Unit configuration */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <SectionHeading>Unit Configuration</SectionHeading>
            <div style={two}>
              <MField label="Unit Code" required error={errors.baseUnitCode}>
                <select
                  value={draft.baseUnitCode}
                  onChange={(e) => onChange("baseUnitCode", e.target.value)}
                  disabled={readOnlyUnits}
                  style={{
                    ...(errors.baseUnitCode ? mInputErr : mInput),
                    ...(readOnlyUnits ? { opacity: 0.75, cursor: "not-allowed" } : {}),
                  }}
                >
                  {unitCodeOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </MField>
              <MField label="Unit Kind" required error={errors.unitKind}>
                <select
                  value={draft.unitKind}
                  onChange={(e) => onChange("unitKind", e.target.value as UnitKindValue)}
                  disabled={readOnlyUnits}
                  style={{
                    ...(errors.unitKind ? mInputErr : mInput),
                    ...(readOnlyUnits ? { opacity: 0.75, cursor: "not-allowed" } : {}),
                  }}
                >
                  {UNIT_KINDS.map((k) => (
                    <option key={k} value={k}>{UNIT_KIND_LABELS[k]}</option>
                  ))}
                </select>
              </MField>
            </div>
            <label
              style={{
                display: "flex", alignItems: "center", gap: 8,
                fontSize: 13, color: "#44403c", cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={draft.allowsFractional}
                onChange={(e) => onChange("allowsFractional", e.target.checked)}
                style={{ width: 15, height: 15, cursor: "pointer" }}
              />
              Allow fractional quantities (e.g. 0.5 kg, 1.25 m)
            </label>
          </div>

          {/* Pricing & tax */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <SectionHeading>Pricing & Tax</SectionHeading>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
              <MField label="Cost Price (₹)" error={errors.costPrice}>
                {inp("costPrice", "number", "0.00")}
              </MField>
              <MField label="Percentage (%)" error={errors.percentage}>
                {inp("percentage", "number", "e.g. 25")}
              </MField>
              <MField label="Selling Price (₹)" error={errors.sellingPrice}>
                {inp("sellingPrice", "number", "Auto from Cost + %")}
              </MField>
              <MField label="MRP (₹)" error={errors.mrp}>
                {inp("mrp", "number", "0.00")}
              </MField>
              <MField label="CGST@ %" error={errors.cgstPercent}>
                {inp("cgstPercent", "number", "e.g. 9")}
              </MField>
              <MField label="SGST@ %" error={errors.sgstPercent}>
                {inp("sgstPercent", "number", "e.g. 9")}
              </MField>
              <MField label="IGST@ %" error={errors.igstPercent}>
                {inp("igstPercent", "number", "e.g. 18")}
              </MField>
            </div>
          </div>

          {/* Inventory */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <SectionHeading>Inventory</SectionHeading>
            <div style={two}>
              <MField
                label={readOnlyUnits ? "Current stock" : "Opening Stock"}
                error={errors.currentStock}
              >
                <input
                  value={draft.currentStock as string}
                  onChange={(e) => onChange("currentStock", e.target.value)}
                  type="number"
                  placeholder="0"
                  disabled={readOnlyUnits}
                  style={{
                    ...(errors.currentStock ? mInputErr : mInput),
                    ...(readOnlyUnits ? { opacity: 0.75, cursor: "not-allowed" } : {}),
                  }}
                />
                {readOnlyUnits ? (
                  <span style={{ fontSize: 11, color: "#78716c", marginTop: 4, display: "block" }}>
                    Use Stock Adjustments to change on-hand quantity.
                  </span>
                ) : null}
              </MField>
              <MField label="Reorder Level" error={errors.reorderLevel}>
                {inp("reorderLevel", "number", "—")}
              </MField>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex", justifyContent: "flex-end", gap: 10,
            padding: "14px 24px", borderTop: "1px solid #f0efee", flexShrink: 0,
          }}
        >
          <button
            type="button" onClick={onClose} disabled={saving}
            style={{
              height: 38, padding: "0 20px",
              background: "#fff", border: "1px solid #e7e5e4",
              borderRadius: 8, fontSize: 13, color: "#44403c", cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button" onClick={onSave} disabled={saving}
            style={{
              height: 38, padding: "0 22px",
              background: saving ? "#e7e5e4" : "#2563eb",
              color: saving ? "#a8a29e" : "#fff",
              border: "none", borderRadius: 8,
              fontSize: 13, fontWeight: 600,
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "Saving…" : mode === "edit" ? "Save changes" : "Save Product"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Batch-row inline editing ──────────────────────────────────────────────────

const cellInput: React.CSSProperties = {
  height: 30, padding: "0 7px", width: "100%",
  border: "1px solid #e7e5e4", borderRadius: 6,
  fontSize: 12, outline: "none", background: "#fff", boxSizing: "border-box",
};

function BatchCell({
  value, onChange, error, type = "text", placeholder = "",
}: {
  value: string; onChange: (v: string) => void;
  error?: string; type?: string; placeholder?: string;
}) {
  const style = error
    ? { ...cellInput, border: "1px solid #2563eb" }
    : cellInput;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <input
        value={value} onChange={(e) => onChange(e.target.value)}
        type={type} placeholder={placeholder} style={style}
      />
      {error && (
        <span style={{ fontSize: 10, color: "#2563eb", lineHeight: 1.2 }}>{error}</span>
      )}
    </div>
  );
}

function BatchSelectCell({
  value, options, onChange, error,
}: {
  value: string; options: { value: string; label: string }[];
  onChange: (v: string) => void; error?: string;
}) {
  const style = error
    ? { ...cellInput, border: "1px solid #2563eb" }
    : cellInput;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={style}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {error && (
        <span style={{ fontSize: 10, color: "#2563eb", lineHeight: 1.2 }}>{error}</span>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function ProductsPage({
  onProductsCreated,
  allowMutations = true,
  confirm,
}: {
  onProductsCreated: () => Promise<void>;
  /** ADMIN: add/edit/delete/batch. CASHIER: view-only catalog + stock. */
  allowMutations?: boolean;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}) {
  // Existing products
  const [rawProducts, setRawProducts] = useState<ApiProduct[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [search, setSearch] = useState("");

  // Modal (single product)
  const [modalOpen, setModalOpen] = useState(false);
  const [editProductId, setEditProductId] = useState<string | null>(null);
  const [modalDraft, setModalDraft] = useState<ProductDraft>(() => newDraft());
  const [modalErrors, setModalErrors] = useState<RowErrors>({});
  const [modalSaving, setModalSaving] = useState(false);

  // Batch rows (multi-product)
  const [pendingRows, setPendingRows] = useState<ProductDraft[]>([]);
  const [rowErrors, setRowErrors] = useState<RowErrors[]>([]);
  const [batchBannerError, setBatchBannerError] = useState<string | null>(null);
  const [batchSaving, setBatchSaving] = useState(false);

  // Success feedback
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [importBanner, setImportBanner] = useState<string | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  const loadProducts = async () => {
    setLoadingProducts(true);
    setLoadError(null);
    try {
      setRawProducts(await api.getProducts());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load products");
    } finally {
      setLoadingProducts(false);
    }
  };

  useEffect(() => { void loadProducts(); }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return rawProducts;
    return rawProducts.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.category ?? "").toLowerCase().includes(q) ||
        (p.brand ?? "").toLowerCase().includes(q) ||
        (p.brandCode ?? "").toLowerCase().includes(q) ||
        (p.color ?? "").toLowerCase().includes(q) ||
        (p.hsnCode ?? "").toLowerCase().includes(q)
    );
  }, [rawProducts, search]);

  const [listPage, setListPage] = useState(1);
  const listPageCount = Math.max(1, Math.ceil(filtered.length / PRODUCTS_TABLE_PAGE_SIZE));

  useEffect(() => {
    setListPage(1);
  }, [search]);

  useEffect(() => {
    if (listPage > listPageCount) setListPage(listPageCount);
  }, [listPage, listPageCount]);

  const pagedProducts = useMemo(() => {
    const start = (listPage - 1) * PRODUCTS_TABLE_PAGE_SIZE;
    return filtered.slice(start, start + PRODUCTS_TABLE_PAGE_SIZE);
  }, [filtered, listPage]);

  const selectedIdSet = useMemo(() => new Set(selectedProductIds), [selectedProductIds]);
  const filteredProductIds = useMemo(() => filtered.map((p) => p.id), [filtered]);
  const pagedProductIds = useMemo(() => pagedProducts.map((p) => p.id), [pagedProducts]);
  const selectedCountOnPage = useMemo(
    () => pagedProductIds.filter((id) => selectedIdSet.has(id)).length,
    [pagedProductIds, selectedIdSet]
  );
  const allPagedSelected = pagedProductIds.length > 0 && selectedCountOnPage === pagedProductIds.length;
  const allFilteredSelected =
    filteredProductIds.length > 0 && filteredProductIds.every((id) => selectedIdSet.has(id));

  useEffect(() => {
    const valid = new Set(rawProducts.map((p) => p.id));
    setSelectedProductIds((prev) => prev.filter((id) => valid.has(id)));
  }, [rawProducts]);

  const categoryOptions = useMemo(
    () =>
      PRODUCT_CATEGORIES.map((c) => ({
        value: c,
        label: c,
      })),
    []
  );

  // Modal handlers
  const closeModal = () => {
    setModalOpen(false);
    setEditProductId(null);
    setModalErrors({});
  };

  const openModal = () => {
    setEditProductId(null);
    setModalDraft(newDraft());
    setModalErrors({});
    setSavedMsg(null);
    setModalOpen(true);
  };

  const openEditProduct = (p: ApiProduct) => {
    setEditProductId(p.id);
    setModalDraft(productToDraft(p));
    setModalErrors({});
    setSavedMsg(null);
    setModalOpen(true);
  };

  const handleModalChange = (field: keyof ProductDraft, value: string | boolean) => {
    setModalDraft((d) => {
      const updated = { ...d, [field]: value };
      if (field === "baseUnitCode" && typeof value === "string" && !editProductId)
        updated.unitKind = suggestUnitKind(value);
      if (typeof value === "string" && (field === "costPrice" || field === "percentage")) {
        const nextCost = field === "costPrice" ? value : updated.costPrice;
        const nextPct = field === "percentage" ? value : updated.percentage;
        updated.sellingPrice = computedSellingPriceFromCostAndPercentage(nextCost, nextPct);
      }
      return updated;
    });
    setModalErrors((e) => {
      const c = { ...e };
      delete c[field as string];
      return c;
    });
  };

  const deleteProductsByIds = async (ids: string[]) => {
    if (ids.length === 0) return;
    setSavedMsg(null);
    setDeleteError(null);
    let deleted = 0;
    let failed = 0;
    let firstError = "";
    for (const id of ids) {
      try {
        await api.deleteProduct(id);
        deleted++;
      } catch (e) {
        failed++;
        if (!firstError) firstError = isApiError(e) ? e.message : "Could not delete product";
      }
    }
    setSelectedProductIds((prev) => prev.filter((id) => !ids.includes(id)));
    if (deleted > 0) {
      setSavedMsg(
        deleted === 1
          ? "Deleted 1 product."
          : `Deleted ${deleted} products.`
      );
      await loadProducts();
      await onProductsCreated();
    }
    if (failed > 0) {
      setDeleteError(
        failed === ids.length
          ? firstError
          : `${firstError} (${failed} failed)`
      );
    }
  };

  const handleDeleteProduct = async (p: ApiProduct) => {
    const ok = await confirm({
      title: `Delete product ${p.sku} — ${p.name}?`,
      message:
        "This cannot be undone. You can set status to Inactive instead if the product has sales history.",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    await deleteProductsByIds([p.id]);
  };

  const handleDeleteSelectedProducts = async () => {
    if (selectedProductIds.length === 0) return;
    const ok = await confirm({
      title: `Delete ${selectedProductIds.length} selected product${
        selectedProductIds.length === 1 ? "" : "s"
      }?`,
      message:
        "This cannot be undone. You can set status to Inactive instead if a product has sales history.",
      confirmLabel: `Delete ${selectedProductIds.length}`,
      variant: "danger",
    });
    if (!ok) return;
    await deleteProductsByIds(selectedProductIds);
  };

  const toggleProductSelection = (id: string, checked: boolean) => {
    setSelectedProductIds((prev) => {
      if (checked) return prev.includes(id) ? prev : [...prev, id];
      return prev.filter((x) => x !== id);
    });
  };

  const toggleSelectPaged = (checked: boolean) => {
    setSelectedProductIds((prev) => {
      if (checked) return Array.from(new Set([...prev, ...pagedProductIds]));
      const pageSet = new Set(pagedProductIds);
      return prev.filter((id) => !pageSet.has(id));
    });
  };

  const toggleSelectFiltered = (checked: boolean) => {
    setSelectedProductIds((prev) => {
      if (checked) return Array.from(new Set([...prev, ...filteredProductIds]));
      const filteredSet = new Set(filteredProductIds);
      return prev.filter((id) => !filteredSet.has(id));
    });
  };

  const handleModalSave = async () => {
    const errs = validateDraft(modalDraft);
    if (Object.keys(errs).length > 0) {
      setModalErrors(errs);
      return;
    }
    setModalSaving(true);
    try {
      if (editProductId) {
        await api.updateProduct(editProductId, draftToUpdateBody(modalDraft));
        closeModal();
        setSavedMsg("Product updated.");
        await loadProducts();
        await onProductsCreated();
      } else {
        const hadCustomSku = modalDraft.sku.trim() !== "";
        const result = await api.batchCreateProducts({
          products: [draftToPayloadItem(modalDraft)],
        });
        closeModal();
        const sku = result.products[0]?.sku;
        setSavedMsg(
          sku
            ? hadCustomSku
              ? `Product created with SKU ${sku}.`
              : `Product created — assigned SKU ${sku}.`
            : "Product created successfully."
        );
        await loadProducts();
        await onProductsCreated();
      }
    } catch (e) {
      if (isApiError(e) && e.details?.length) {
        setModalErrors(apiDetailsToRowErrors(e.details));
      } else {
        setModalErrors({ _form: e instanceof Error ? e.message : "Failed to save" });
      }
    } finally {
      setModalSaving(false);
    }
  };

  // Batch handlers
  const duplicateBatchRow = (i: number) => {
    const clone = { ...pendingRows[i], _id: Math.random().toString(36).slice(2) };
    const rows = [...pendingRows]; rows.splice(i + 1, 0, clone);
    const errs = [...rowErrors]; errs.splice(i + 1, 0, {});
    setPendingRows(rows);
    setRowErrors(errs);
  };

  const removeBatchRow = (i: number) => {
    setPendingRows((r) => r.filter((_, j) => j !== i));
    setRowErrors((e) => e.filter((_, j) => j !== i));
    if (pendingRows.length === 1) setBatchBannerError(null);
  };

  const updateBatchRow = (i: number, field: keyof ProductDraft, value: string | boolean) => {
    setPendingRows((rows) =>
      rows.map((r, j) => {
        if (j !== i) return r;
        const updated = { ...r, [field]: value };
        if (field === "baseUnitCode" && typeof value === "string")
          updated.unitKind = suggestUnitKind(value);
        if (typeof value === "string" && (field === "costPrice" || field === "percentage")) {
          const nextCost = field === "costPrice" ? value : updated.costPrice;
          const nextPct = field === "percentage" ? value : updated.percentage;
          updated.sellingPrice = computedSellingPriceFromCostAndPercentage(nextCost, nextPct);
        }
        return updated;
      })
    );
    setRowErrors((errs) =>
      errs.map((e, j) => {
        if (j !== i) return e;
        const c = { ...e }; delete c[field as string]; return c;
      })
    );
  };

  const downloadImportTemplate = () => {
    const bom = "\uFEFF";
    const blob = new Blob([bom + PRODUCT_IMPORT_TEMPLATE_CSV], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "product-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFileSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportBanner(null);
    try {
      const { patches, rowErrors, skippedBlankRows, warnings } =
        await parseProductImportFile(file);
      const capped = patches.slice(0, MAX_IMPORT_ROWS);
      const drafts = capped.map(patchImportToDraft);
      const validationIssues: string[] = [];
      drafts.forEach((d, i) => {
        const ve = validateDraft(d);
        const keys = Object.keys(ve);
        if (keys.length) {
          validationIssues.push(
            `Data row ${i + 1}: ${keys.map((k) => ve[k]).join("; ")}`
          );
        }
      });
      if (drafts.length === 0) {
        const msg =
          rowErrors.length > 0
            ? rowErrors.map((r) => `Row ${r.row}: ${r.message}`).join("\n")
            : "No product rows found. Use row 1 for headers (include name) and add data from row 2.";
        window.alert(msg);
        return;
      }
      setPendingRows((prev) => [...prev, ...drafts]);
      const parts = [
        `Imported ${drafts.length} product line(s) into batch entry. Save batch when ready.`,
      ];
      if (patches.length > MAX_IMPORT_ROWS) {
        parts.push(`Only the first ${MAX_IMPORT_ROWS} rows were loaded.`);
      }
      if (skippedBlankRows > 0) {
        parts.push(`${skippedBlankRows} blank row(s) skipped.`);
      }
      if (rowErrors.length > 0) {
        parts.push(
          `Parse notes: ${rowErrors.map((r) => `row ${r.row}: ${r.message}`).join("; ")}`
        );
      }
      if (validationIssues.length > 0) {
        parts.push(`Fix before save: ${validationIssues.join(" | ")}`);
      }
      if (warnings.length > 0) {
        parts.push(warnings.join(" "));
      }
      setImportBanner(parts.join(" "));
      setSavedMsg(null);
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : "Could not read that file."
      );
    }
  };

  const handleBatchSaveAll = async () => {
    setBatchBannerError(null);
    setSavedMsg(null);
    const validatedErrors = pendingRows.map(validateDraft);
    if (validatedErrors.some((e) => Object.keys(e).length > 0)) {
      setRowErrors(validatedErrors);
      setBatchBannerError("Fix the highlighted errors before saving.");
      return;
    }
    setBatchSaving(true);
    try {
      const result = await api.batchCreateProducts({
        products: pendingRows.map(draftToPayloadItem),
      });
      setPendingRows([]);
      setRowErrors([]);
      const skus = result.products.map((p) => p.sku);
      const skuPart =
        skus.length <= 8
          ? skus.join(", ")
          : `${skus.slice(0, 8).join(", ")}… (+${skus.length - 8} more)`;
      setSavedMsg(
        `${result.created} product${result.created !== 1 ? "s" : ""} created — ${skuPart}`
      );
      await loadProducts();
      await onProductsCreated();
    } catch (e) {
      if (isApiError(e) && e.details?.length) {
        const apiErrs = rowErrorsFromApiDetails(e.details, pendingRows.length);
        setRowErrors(apiErrs);
        setBatchBannerError(
          apiErrs.some((r) => Object.keys(r).length > 0)
            ? "Some rows have errors — fix them and try again."
            : (e as Error).message
        );
      } else {
        setBatchBannerError(e instanceof Error ? e.message : "Failed to save");
      }
    } finally {
      setBatchSaving(false);
    }
  };

  const unitKindOptions = UNIT_KINDS.map((k) => ({ value: k, label: UNIT_KIND_LABELS[k] }));

  const thStyle: React.CSSProperties = {
    padding: "9px 10px", textAlign: "left", fontWeight: 600,
    color: "#78716c", fontSize: 11, background: "#fafaf9",
    whiteSpace: "nowrap", borderBottom: "1px solid #e7e5e4",
  };
  const tdStyle: React.CSSProperties = { padding: "7px 10px", verticalAlign: "top" };

  return (
    <>
      {/* ── Modal ── */}
      <ProductModal
        open={modalOpen}
        mode={editProductId ? "edit" : "add"}
        skuDisplay={
          editProductId
            ? rawProducts.find((p) => p.id === editProductId)?.sku
            : undefined
        }
        readOnlyUnits={!!editProductId}
        draft={modalDraft}
        errors={modalErrors}
        saving={modalSaving}
        onClose={closeModal}
        onChange={handleModalChange}
        onSave={handleModalSave}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 16, flex: 1, minHeight: 0 }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1 style={{ fontSize: 18, fontWeight: 600, color: "#1c1917", margin: 0 }}>
              Products
            </h1>
            {!loadingProducts && (
              <span style={{
                fontSize: 12, color: "#78716c", background: "#f5f4f0",
                border: "1px solid #e7e5e4", borderRadius: 12, padding: "1px 8px",
              }}>
                {rawProducts.length}
              </span>
            )}
          </div>
          {allowMutations ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input
                ref={importFileRef}
                type="file"
                accept=".csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                style={{ display: "none" }}
                onChange={(e) => void handleImportFileSelected(e)}
              />
              <button
                type="button"
                onClick={() => importFileRef.current?.click()}
                style={{
                  height: 36,
                  padding: "0 14px",
                  background: "#fff",
                  border: "1px solid #e7e5e4",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#44403c",
                  cursor: "pointer",
                }}
              >
                Import CSV / Excel
              </button>
              <button
                type="button"
                onClick={downloadImportTemplate}
                style={{
                  height: 36,
                  padding: "0 14px",
                  background: "#fafaf9",
                  border: "1px solid #e7e5e4",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#78716c",
                  cursor: "pointer",
                }}
              >
                Download template
              </button>
              <button
                type="button" onClick={openModal}
                style={{
                  height: 36, padding: "0 16px",
                  background: "#2563eb", border: "none",
                  borderRadius: 8, fontSize: 13, fontWeight: 600,
                  color: "#fff", cursor: "pointer",
                }}
              >
                + Add Product
              </button>
            </div>
          ) : null}
        </div>

        {/* Saved / error feedback */}
        {deleteError && (
          <div
            style={{
              background: "rgba(220, 38, 38, 0.12)",
              border: "1px solid rgba(220, 38, 38, 0.35)",
              color: "#b91c1c",
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 13,
            }}
          >
            {deleteError}
          </div>
        )}
        {savedMsg && (
          <div style={{
            background: "rgba(37,99,235,0.10)", color: "#2563eb",
            padding: "10px 14px", borderRadius: 8, fontSize: 13,
          }}>
            {savedMsg}
          </div>
        )}
        {importBanner && (
          <div
            style={{
              background: "#fefce8",
              border: "1px solid #fde047",
              color: "#854d0e",
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 13,
              lineHeight: 1.45,
            }}
          >
            {importBanner}
          </div>
        )}
        {allowMutations && (
          <p style={{ margin: 0, fontSize: 12, color: "#78716c", maxWidth: 720 }}>
            <strong>Import:</strong> First row must be column headers. Required:{" "}
            <code style={{ fontSize: 11 }}>name</code>. Include{" "}
            <code style={{ fontSize: 11 }}>sku</code>,{" "}
            <code style={{ fontSize: 11 }}>item code</code>, or{" "}
            <code style={{ fontSize: 11 }}>product code</code> to keep your SKUs; otherwise the
            system assigns codes (e.g. EL-00001). In Excel, format the SKU column as{" "}
            <strong>Text</strong> so values like <code style={{ fontSize: 11 }}>00123</code> are
            not changed to numbers. Other columns match the batch form (category, brand, brand code, colour, unit,
            GST %, stock, HSN Code, …). Rows are added to <strong>Batch entry</strong> — review
            and click <strong>Save all</strong>.
          </p>
        )}

        {/* ── Batch rows ─────────────────────────────────────────────────── */}
        {allowMutations && pendingRows.length > 0 && (
          <div style={{
            background: "#fff", border: "1px solid #e7e5e4",
            borderRadius: 12, overflow: "hidden",
          }}>
            {/* Batch header */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "12px 16px", borderBottom: "1px solid #e7e5e4", background: "#fafaf9",
              flexWrap: "wrap", gap: 8,
            }}>
              <div>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#1c1917" }}>
                  Batch entry
                </span>
                <span style={{ fontSize: 12, color: "#78716c", marginLeft: 6 }}>
                  {pendingRows.length} row{pendingRows.length !== 1 ? "s" : ""} · leave SKU blank
                  to auto-assign on save
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {batchBannerError && (
                  <span style={{ fontSize: 12, color: "#2563eb" }}>{batchBannerError}</span>
                )}
                <button
                  type="button"
                  onClick={() => { setPendingRows([]); setRowErrors([]); setBatchBannerError(null); }}
                  style={{
                    height: 30, padding: "0 12px", background: "transparent",
                    border: "1px solid #e7e5e4", borderRadius: 6,
                    fontSize: 12, color: "#78716c", cursor: "pointer",
                  }}
                >
                  Clear all
                </button>
                <button
                  type="button" onClick={handleBatchSaveAll} disabled={batchSaving}
                  style={{
                    height: 30, padding: "0 16px",
                    background: batchSaving ? "#e7e5e4" : "#2563eb",
                    color: batchSaving ? "#a8a29e" : "#fff",
                    border: "none", borderRadius: 6,
                    fontSize: 12, fontWeight: 600,
                    cursor: batchSaving ? "not-allowed" : "pointer",
                  }}
                >
                  {batchSaving ? "Saving…" : `Save all (${pendingRows.length})`}
                </button>
              </div>
            </div>

            {/* Scrollable table */}
            <div style={{ overflowX: "auto" }}>
              <table style={{
                borderCollapse: "collapse", fontSize: 12,
                width: "max-content", minWidth: "100%",
              }}>
                <thead>
                  <tr>
                    {([
                      ["Name *", 200],
                      ["SKU", 120],
                      ["Category", 110],
                      ["Brand", 110],
                      ["Brand Code", 98],
                      ["Colour", 92],
                      ["HSN Code", 88],
                      ["Unit *", 104], ["Kind *", 100], ["Frac.", 54],
                      ["Price ₹", 88], ["Cost ₹", 88], ["%", 72], ["MRP ₹", 88],
                      ["Stock", 88], ["", 112],
                    ] as [string, number][]).map(([label, w]) => (
                      <th key={label} style={{ ...thStyle, minWidth: w }}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pendingRows.map((row, i) => {
                    const errs = rowErrors[i] ?? {};
                    return (
                      <tr key={row._id} style={{ borderBottom: "1px solid #f5f4f0" }}>
                        <td style={tdStyle}><BatchCell value={row.name} onChange={(v) => updateBatchRow(i, "name", v)} error={errs.name} placeholder="Product name" /></td>
                        <td style={tdStyle}>
                          <BatchCell
                            value={row.sku}
                            onChange={(v) => updateBatchRow(i, "sku", v)}
                            error={errs.sku}
                            placeholder="Auto"
                          />
                        </td>
                        <td style={tdStyle}>
                          <BatchSelectCell
                            value={row.category}
                              options={categoryOptions}
                            onChange={(v) => updateBatchRow(i, "category", v)}
                            error={errs.category}
                          />
                        </td>
                        <td style={tdStyle}><BatchCell value={row.brand} onChange={(v) => updateBatchRow(i, "brand", v)} placeholder="Brand" /></td>
                        <td style={tdStyle}><BatchCell value={row.brandCode} onChange={(v) => updateBatchRow(i, "brandCode", v)} error={errs.brandCode} placeholder="Code" /></td>
                        <td style={tdStyle}><BatchCell value={row.color} onChange={(v) => updateBatchRow(i, "color", v)} error={errs.color} placeholder="Colour" /></td>
                        <td style={tdStyle}><BatchCell value={row.hsnCode} onChange={(v) => updateBatchRow(i, "hsnCode", v)} error={errs.hsnCode} placeholder="8544" /></td>
                        <td style={tdStyle}>
                          <BatchSelectCell
                            value={row.baseUnitCode}
                            options={unitCodeSelectOptions(row.baseUnitCode)}
                            onChange={(v) => updateBatchRow(i, "baseUnitCode", v)}
                            error={errs.baseUnitCode}
                          />
                        </td>
                        <td style={tdStyle}><BatchSelectCell value={row.unitKind} options={unitKindOptions} onChange={(v) => updateBatchRow(i, "unitKind", v as UnitKindValue)} error={errs.unitKind} /></td>
                        <td style={{ ...tdStyle, textAlign: "center" }}>
                          <input type="checkbox" checked={row.allowsFractional} onChange={(e) => updateBatchRow(i, "allowsFractional", e.target.checked)} style={{ marginTop: 6, cursor: "pointer" }} />
                        </td>
                        <td style={tdStyle}><BatchCell value={row.sellingPrice} onChange={(v) => updateBatchRow(i, "sellingPrice", v)} error={errs.sellingPrice} type="number" placeholder="0.00" /></td>
                        <td style={tdStyle}><BatchCell value={row.costPrice} onChange={(v) => updateBatchRow(i, "costPrice", v)} error={errs.costPrice} type="number" placeholder="0.00" /></td>
                        <td style={tdStyle}><BatchCell value={row.percentage} onChange={(v) => updateBatchRow(i, "percentage", v)} error={errs.percentage} type="number" placeholder="0" /></td>
                        <td style={tdStyle}><BatchCell value={row.mrp} onChange={(v) => updateBatchRow(i, "mrp", v)} error={errs.mrp} type="number" placeholder="0.00" /></td>
                        <td style={tdStyle}><BatchCell value={row.currentStock} onChange={(v) => updateBatchRow(i, "currentStock", v)} error={errs.currentStock} type="number" placeholder="0" /></td>
                        <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                          <div style={{ display: "flex", gap: 5 }}>
                            <button
                              type="button" onClick={() => duplicateBatchRow(i)}
                              title="Duplicate row"
                              style={{
                                height: 28, padding: "0 9px", background: "#f5f4f0",
                                border: "1px solid #e7e5e4", borderRadius: 6,
                                fontSize: 11, cursor: "pointer", color: "#44403c",
                              }}
                            >Dupe</button>
                            <button
                              type="button" onClick={() => removeBatchRow(i)}
                              title="Remove row"
                              style={{
                                height: 28, padding: "0 9px", background: "#f3f4f6",
                                border: "1px solid #d1d5db", borderRadius: 6,
                                fontSize: 11, cursor: "pointer", color: "#111827",
                              }}
                            >✕</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Existing products ──────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1, minHeight: 200 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <input
            placeholder="Search by name, SKU, HSN Code, category, brand, brand code or colour…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                height: 36, padding: "0 12px", border: "1px solid #e7e5e4",
                borderRadius: 8, fontSize: 13, outline: "none",
                background: "#fff", maxWidth: 380, width: "100%",
              }}
            />
            {allowMutations && filtered.length > 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "#78716c" }}>
                  Selected: <strong style={{ color: "#44403c" }}>{selectedProductIds.length}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => toggleSelectPaged(!allPagedSelected)}
                  style={{
                    height: 30,
                    padding: "0 10px",
                    borderRadius: 8,
                    border: "1px solid #e7e5e4",
                    background: "#fff",
                    color: "#44403c",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {allPagedSelected ? "Unselect page" : "Select page"}
                </button>
                <button
                  type="button"
                  onClick={() => toggleSelectFiltered(!allFilteredSelected)}
                  style={{
                    height: 30,
                    padding: "0 10px",
                    borderRadius: 8,
                    border: "1px solid #e7e5e4",
                    background: "#fff",
                    color: "#44403c",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {allFilteredSelected ? "Unselect all" : "Select all"}
                </button>
                <button
                  type="button"
                  disabled={selectedProductIds.length === 0}
                  onClick={() => void handleDeleteSelectedProducts()}
                  style={{
                    height: 30,
                    padding: "0 12px",
                    borderRadius: 8,
                    border: "1px solid #fecaca",
                    background: selectedProductIds.length ? "#fff" : "#f5f4f0",
                    color: selectedProductIds.length ? "#b91c1c" : "#a8a29e",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: selectedProductIds.length ? "pointer" : "not-allowed",
                  }}
                >
                  Delete selected
                </button>
              </div>
            ) : null}
          </div>

          <div style={{
            flex: 1, background: "#fff", borderRadius: 12,
            border: "1px solid #e7e5e4", display: "flex", flexDirection: "column", minHeight: 0,
          }}>
            <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
            {loadError ? (
              <div style={{ padding: "40px 24px", color: "#111827", fontSize: 13, textAlign: "center" }}>
                {loadError}
              </div>
            ) : loadingProducts ? (
              <div style={{ padding: 60, color: "#78716c", fontSize: 13, textAlign: "center" }}>
                Loading…
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: 60, color: "#a8a29e", fontSize: 13, textAlign: "center" }}>
                {search
                  ? "No products match your search."
                  : allowMutations
                    ? "No products yet — click + Add Product to begin."
                    : "No products yet."}
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #e7e5e4" }}>
                    {(allowMutations
                      ? ["", "SKU", "Name", "Category", "Brand", "Brand Code", "Colour", "HSN Code", "Unit", "Price", "Cost", "%", "MRP", "Stock", "Status", "Actions"]
                      : ["SKU", "Name", "Category", "Brand", "Brand Code", "Colour", "HSN Code", "Unit", "Price", "Cost", "%", "MRP", "Stock", "Status"]
                    ).map((h) => (
                      <th key={h} style={{
                        padding: "10px 14px", textAlign: "left", fontWeight: 600,
                        color: "#78716c", fontSize: 12, background: "#fafaf9",
                        whiteSpace: "nowrap", position: "sticky", top: 0,
                      }}>
                        {allowMutations && h === "" ? (
                          <input
                            type="checkbox"
                            aria-label="Select all products on page"
                            checked={allPagedSelected}
                            onChange={(e) => toggleSelectPaged(e.target.checked)}
                            style={{ cursor: "pointer" }}
                          />
                        ) : h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagedProducts.map((p, i) => {
                    const st = statusOf(p);
                    const globalIdx = (listPage - 1) * PRODUCTS_TABLE_PAGE_SIZE + i;
                    return (
                      <tr key={p.id} style={{
                        borderBottom: "1px solid #f5f4f0",
                        background: globalIdx % 2 === 0 ? "#fff" : "#fafaf9",
                      }}>
                        {allowMutations ? (
                          <td style={{ padding: "10px 14px" }}>
                            <input
                              type="checkbox"
                              aria-label={`Select ${p.sku}`}
                              checked={selectedIdSet.has(p.id)}
                              onChange={(e) => toggleProductSelection(p.id, e.target.checked)}
                              style={{ cursor: "pointer" }}
                            />
                          </td>
                        ) : null}
                        <td style={{ padding: "10px 14px", fontFamily: "monospace", color: "#78716c", fontSize: 12, whiteSpace: "nowrap" }}>{p.sku}</td>
                        <td style={{ padding: "10px 14px", fontWeight: 500, color: "#1c1917", maxWidth: 240 }}>{p.name}</td>
                        <td style={{ padding: "10px 14px", color: "#78716c" }}>{p.category ?? "—"}</td>
                        <td style={{ padding: "10px 14px", color: "#78716c" }}>{p.brand ?? "—"}</td>
                        <td style={{ padding: "10px 14px", color: "#78716c", fontFamily: "monospace", fontSize: 12 }}>{p.brandCode ?? "—"}</td>
                        <td style={{ padding: "10px 14px", color: "#78716c" }}>{p.color ?? "—"}</td>
                        <td style={{ padding: "10px 14px", color: "#78716c", fontFamily: "monospace", fontSize: 12 }}>{p.hsnCode?.trim() || "—"}</td>
                        <td style={{ padding: "10px 14px", color: "#78716c", whiteSpace: "nowrap" }}>{p.baseUnitCode}</td>
                        <td style={{ padding: "10px 14px", fontFamily: "monospace", whiteSpace: "nowrap" }}>{fmtPrice(p.sellingPrice)}</td>
                        <td style={{ padding: "10px 14px", fontFamily: "monospace", color: "#78716c", whiteSpace: "nowrap" }}>{fmtPrice(p.costPrice)}</td>
                        <td style={{ padding: "10px 14px", fontFamily: "monospace", color: "#78716c", whiteSpace: "nowrap" }}>{p.percentage != null ? `${Number(p.percentage).toFixed(2)}%` : "—"}</td>
                        <td style={{ padding: "10px 14px", fontFamily: "monospace", color: "#78716c", whiteSpace: "nowrap" }}>{fmtPrice(p.mrp)}</td>
                        <td style={{
                          padding: "10px 14px", fontFamily: "monospace", fontWeight: 700,
                          whiteSpace: "nowrap",
                          color: st === "out" ? "#dc2626" : st === "low" ? "#d97706" : "#1c1917",
                        }}>
                          {Number(p.currentStock).toLocaleString("en-IN")}
                          <span style={{ fontWeight: 400, color: "#a8a29e", fontSize: 11, marginLeft: 3 }}>{p.baseUnitCode}</span>
                        </td>
                        <td style={{ padding: "10px 14px" }}>
                          <StatusBadge status={st} />
                          {p.status === "INACTIVE" ? (
                            <div style={{ fontSize: 10, color: "#a8a29e", marginTop: 4 }}>
                              Inactive listing
                            </div>
                          ) : null}
                        </td>
                        {allowMutations ? (
                          <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
                              <button
                                type="button"
                                onClick={() => openEditProduct(p)}
                                style={{
                                  padding: "6px 12px",
                                  borderRadius: 8,
                                  border: "1px solid #e7e5e4",
                                  background: "#fff",
                                  fontSize: 12,
                                  fontWeight: 600,
                                  color: "#2563eb",
                                  cursor: "pointer",
                                }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeleteProduct(p)}
                                style={{
                                  padding: "6px 12px",
                                  borderRadius: 8,
                                  border: "1px solid #fecaca",
                                  background: "#fff",
                                  fontSize: 12,
                                  fontWeight: 600,
                                  color: "#b91c1c",
                                  cursor: "pointer",
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            </div>
            {!loadError && !loadingProducts && filtered.length > 0 ? (
              <div style={{
                flexShrink: 0,
                borderTop: "1px solid #e7e5e4",
                padding: "10px 14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                flexWrap: "wrap",
                background: "#fafaf9",
              }}>
                <div style={{ fontSize: 12, color: "#78716c" }}>
                  Showing{" "}
                  <strong style={{ color: "#44403c" }}>
                    {(listPage - 1) * PRODUCTS_TABLE_PAGE_SIZE + 1}
                    –
                    {Math.min(listPage * PRODUCTS_TABLE_PAGE_SIZE, filtered.length)}
                  </strong>
                  {" "}of{" "}
                  <strong style={{ color: "#44403c" }}>{filtered.length}</strong>
                  {" "}product{filtered.length !== 1 ? "s" : ""}
                  {" "}· {PRODUCTS_TABLE_PAGE_SIZE} per page
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setListPage((p) => Math.max(1, p - 1))}
                    disabled={listPage <= 1}
                    style={{
                      height: 30,
                      minWidth: 64,
                      padding: "0 10px",
                      borderRadius: 8,
                      border: "1px solid #e7e5e4",
                      background: listPage <= 1 ? "#f5f4f0" : "#fff",
                      color: listPage <= 1 ? "#a8a29e" : "#44403c",
                      fontSize: 12,
                      cursor: listPage <= 1 ? "not-allowed" : "pointer",
                    }}
                  >
                    Prev
                  </button>
                  <span style={{ fontSize: 12, color: "#78716c", minWidth: 72, textAlign: "center" }}>
                    Page {listPage}/{listPageCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => setListPage((p) => Math.min(listPageCount, p + 1))}
                    disabled={listPage >= listPageCount}
                    style={{
                      height: 30,
                      minWidth: 64,
                      padding: "0 10px",
                      borderRadius: 8,
                      border: "1px solid #e7e5e4",
                      background: listPage >= listPageCount ? "#f5f4f0" : "#fff",
                      color: listPage >= listPageCount ? "#a8a29e" : "#44403c",
                      fontSize: 12,
                      cursor: listPage >= listPageCount ? "not-allowed" : "pointer",
                    }}
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
