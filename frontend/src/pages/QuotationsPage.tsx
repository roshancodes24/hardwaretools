import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { api } from "../api/client";
import { isApiError } from "../api/errors";
import type {
  ApiCustomer,
  ApiProduct,
  QuotationDetail,
  QuotationListItem,
  QuotationStatus,
  QuotationUnitOption,
  QuotationWriteBody,
} from "../api/types";
import { Toast } from "../components/Toast";
import { QUOTATION_GST_NOT_INCLUDED_NOTE } from "../invoice/invoiceBranding";
import { QuotationDocument } from "../invoice/QuotationDocument";
import { printElementInBlankFrame } from "../invoice/printInvoiceIframe";
import "../invoice/taxInvoicePrint.css";
import "../invoice/quotationPrint.css";
import { fmt } from "../lib/formatMoney";
import { sanitizeGstinInput } from "../lib/gstinInput";
import { sanitizePhoneDigits } from "../lib/phoneInput";
import { previewQuotationTotals } from "../lib/quotationPreview";
import { inputStyle } from "../styles/formStyles";
import type { ConfirmOptions } from "../useConfirm";

type Mode = "list" | "edit" | "view";
type CustomerMode = "existing" | "new";

type EditorLine = {
  key: string;
  productId: string;
  productName: string;
  sku: string;
  hsnCode: string | null;
  units: QuotationUnitOption[];
  productUnitId: string;
  quantity: string;
  lineDiscount: string;
  sellingPrice: string;
  currentStock: string;
  cgstPercent: number;
  sgstPercent: number;
  igstPercent: number;
};

const card: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const btn: CSSProperties = {
  height: 34,
  padding: "0 12px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
};

const btnPrimary: CSSProperties = {
  ...btn,
  background: "var(--accent)",
  color: "#fff",
  borderColor: "transparent",
};

const field: CSSProperties = {
  ...inputStyle,
  width: "100%",
  boxSizing: "border-box",
};

function dmy(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function num(value: string | number | null | undefined): number {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : 0;
}

function gstLabel(cgst: number, sgst: number, igst: number): string {
  const parts: string[] = [];
  if (cgst) parts.push(`CGST ${cgst}%`);
  if (sgst) parts.push(`SGST ${sgst}%`);
  if (igst) parts.push(`IGST ${igst}%`);
  return parts.length ? parts.join(" + ") : "0%";
}

function selectedUnit(line: EditorLine): QuotationUnitOption | undefined {
  return line.units.find((unit) => unit.id === line.productUnitId) ?? line.units[0];
}

function lineUnitPrice(line: EditorLine): number {
  const conv = num(selectedUnit(line)?.conversionToBase || "1") || 1;
  return num(line.sellingPrice) * conv;
}

function stockInSelectedUnit(line: EditorLine): number {
  const conv = num(selectedUnit(line)?.conversionToBase || "1") || 1;
  return num(line.currentStock) / conv;
}

function statusColor(status: QuotationStatus): string {
  if (status === "ISSUED") return "var(--success-text)";
  if (status === "EXPIRED") return "var(--warning-text, #b45309)";
  if (status === "CONVERTED") return "var(--accent)";
  if (status === "CANCELLED") return "var(--danger-text)";
  return "var(--muted)";
}

function errorText(error: unknown, fallback: string): string {
  if (!isApiError(error)) return fallback;
  const details = error.details?.map((item) => item.message).filter(Boolean);
  if (details?.length) return details.join(" ");
  return error.message || fallback;
}

async function savePdf(id: string, quotationNumber: string): Promise<void> {
  const blob = await api.downloadQuotationPdf(id);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${quotationNumber}.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function lineFromProduct(product: ApiProduct): EditorLine | string {
  if (product.sellingPrice == null || String(product.sellingPrice).trim() === "") {
    return `${product.name} has no selling price and cannot be added to a quotation.`;
  }
  const units = product.units ?? [];
  const base = units.find((unit) => unit.isBaseUnit) ?? units[0];
  if (!base) return `${product.name} has no unit.`;
  return {
    key: `${product.id}-${base.id}-${Date.now()}`,
    productId: product.id,
    productName: product.name,
    sku: product.sku,
    hsnCode: product.hsnCode,
    units,
    productUnitId: base.id,
    quantity: "1",
    lineDiscount: "0",
    sellingPrice: String(product.sellingPrice),
    currentStock: String(product.currentStock),
    cgstPercent: num(product.cgstPercent),
    sgstPercent: num(product.sgstPercent),
    igstPercent: num(product.igstPercent),
  };
}

function lineFromSaved(line: QuotationDetail["lines"][number]): EditorLine {
  const units =
    line.units.length > 0
      ? line.units
      : [
          {
            id: line.productUnitId ?? "base",
            code: line.unitCode,
            displayName: line.unitDisplayName,
            isBaseUnit: true,
            conversionToBase: "1",
            allowsFractionalSale: true,
          },
        ];
  const unit = units.find((row) => row.id === line.productUnitId) ?? units[0];
  const conv = num(unit.conversionToBase) || 1;
  const selling =
    line.currentSellingPrice ??
    String(num(line.unitPrice) / conv);
  return {
    key: line.id,
    productId: line.productId,
    productName: line.productName,
    sku: line.sku,
    hsnCode: line.hsnCode,
    units,
    productUnitId: unit.id,
    quantity: String(num(line.quantity)),
    lineDiscount: String(num(line.lineDiscount)),
    sellingPrice: selling,
    currentStock: line.currentStock,
    cgstPercent: num(line.cgstPercent),
    sgstPercent: num(line.sgstPercent),
    igstPercent: num(line.igstPercent),
  };
}

export function QuotationsPage({
  confirm,
  onConvertToSale,
}: {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  /** Hands an issued (or expired) quotation to the POS to be sold. */
  onConvertToSale: (quotation: QuotationDetail) => void;
}) {
  const [mode, setMode] = useState<Mode>("list");
  const [statusMsg, setStatusMsg] = useState<{
    type: "success" | "error";
    msg: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<QuotationStatus | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [page, setPage] = useState(1);
  const [list, setList] = useState<QuotationListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [customers, setCustomers] = useState<ApiCustomer[]>([]);

  const [quotationId, setQuotationId] = useState<string | null>(null);
  const [quotation, setQuotation] = useState<QuotationDetail | null>(null);
  const [printAfter, setPrintAfter] = useState(false);

  const [customerMode, setCustomerMode] = useState<CustomerMode>("existing");
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [gstin, setGstin] = useState("");
  const [partyState, setPartyState] = useState("");
  const [saveAsCustomer, setSaveAsCustomer] = useState(false);
  const [includeGst, setIncludeGst] = useState(true);
  const [lines, setLines] = useState<EditorLine[]>([]);
  const [discountPercent, setDiscountPercent] = useState("0");
  const [transport, setTransport] = useState("0");
  const [note, setNote] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [productHits, setProductHits] = useState<ApiProduct[]>([]);

  const limit = 20;

  const loadList = async (nextPage = page) => {
    setBusy(true);
    try {
      const result = await api.listQuotations({
        q,
        status: statusFilter,
        from,
        to,
        customerId: customerFilter || undefined,
        page: nextPage,
        limit,
      });
      setList(result.items);
      setTotal(result.total);
      setPage(result.page);
    } catch (error) {
      setStatusMsg({ type: "error", msg: errorText(error, "Could not load quotations") });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void api.getCustomers().then(setCustomers).catch(() => setCustomers([]));
  }, []);

  useEffect(() => {
    if (mode === "list") void loadList(1);
    // Initial list only; Search applies later filter edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (mode !== "view" || !printAfter || !quotation) return;
    const timer = window.setTimeout(() => {
      printElementInBlankFrame("tax-invoice-print-area");
      setPrintAfter(false);
    }, 50);
    return () => window.clearTimeout(timer);
  }, [mode, printAfter, quotation]);

  useEffect(() => {
    if (mode !== "edit") return;
    const term = productQuery.trim();
    if (term.length < 1) {
      setProductHits([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void api
        .listProducts({ q: term, limit: 12 })
        .then((result) => setProductHits(result.items))
        .catch(() => setProductHits([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [productQuery, mode]);

  const customerHits = useMemo(() => {
    const term = customerQuery.trim().toLowerCase();
    if (!term) return customers.slice(0, 8);
    return customers
      .filter((customer) => {
        const blob = `${customer.name} ${customer.phone ?? ""} ${customer.partyGstNo ?? ""}`.toLowerCase();
        return blob.includes(term);
      })
      .slice(0, 8);
  }, [customerQuery, customers]);

  const preview = useMemo(
    () =>
      previewQuotationTotals({
        lines: lines.map((line) => ({
          quantity: num(line.quantity),
          unitPrice: lineUnitPrice(line),
          lineDiscount: num(line.lineDiscount),
          cgstPercent: line.cgstPercent,
          sgstPercent: line.sgstPercent,
          igstPercent: line.igstPercent,
        })),
        discountPercent: num(discountPercent),
        transportAmount: num(transport),
        includeGst,
      }),
    [lines, discountPercent, transport, includeGst]
  );

  const resetEditor = () => {
    setQuotationId(null);
    setQuotation(null);
    setCustomerMode("existing");
    setCustomerQuery("");
    setCustomerId("");
    setCustomerName("");
    setContactPerson("");
    setPhone("");
    setEmail("");
    setAddress("");
    setGstin("");
    setPartyState("");
    setSaveAsCustomer(false);
    setIncludeGst(true);
    setLines([]);
    setDiscountPercent("0");
    setTransport("0");
    setNote("");
    setProductQuery("");
    setProductHits([]);
  };

  const hydrate = (row: QuotationDetail) => {
    setQuotationId(row.id);
    setQuotation(row);
    setCustomerMode(row.customerId ? "existing" : "new");
    setCustomerId(row.customerId ?? "");
    setCustomerName(row.customerName);
    setContactPerson(row.customerContactPerson ?? "");
    setPhone(row.customerPhone ?? "");
    setEmail(row.customerEmail ?? "");
    setAddress(row.customerAddress ?? "");
    setGstin(row.customerPartyGstNo ?? "");
    setPartyState(row.customerPartyState ?? "");
    setSaveAsCustomer(false);
    setIncludeGst(row.includeGst !== false);
    setLines(row.lines.map(lineFromSaved));
    setDiscountPercent("0");
    setTransport(String(num(row.transportAmount)));
    setNote(row.note ?? "");
  };

  const openNew = () => {
    resetEditor();
    setStatusMsg(null);
    setMode("edit");
  };

  const openView = async (id: string, shouldPrint = false) => {
    setBusy(true);
    setStatusMsg(null);
    try {
      const row = await api.getQuotation(id);
      setQuotation(row);
      setPrintAfter(shouldPrint);
      setMode("view");
    } catch (error) {
      setStatusMsg({ type: "error", msg: errorText(error, "Could not open quotation") });
    } finally {
      setBusy(false);
    }
  };

  const openEdit = async (id: string) => {
    setBusy(true);
    setStatusMsg(null);
    try {
      const row = await api.getQuotation(id);
      if (row.status !== "DRAFT") {
        setQuotation(row);
        setMode("view");
        setStatusMsg({ type: "error", msg: "Only draft quotations can be edited." });
        return;
      }
      hydrate(row);
      setMode("edit");
    } catch (error) {
      setStatusMsg({ type: "error", msg: errorText(error, "Could not open quotation") });
    } finally {
      setBusy(false);
    }
  };

  const pickCustomer = (customer: ApiCustomer) => {
    setCustomerId(customer.id);
    setCustomerName(customer.name);
    setPhone(customer.phone ?? "");
    setEmail(customer.email ?? "");
    setAddress(customer.address ?? "");
    setGstin(customer.partyGstNo ?? "");
    setPartyState(customer.partyState ?? "");
    setCustomerQuery("");
  };

  const addProduct = (product: ApiProduct) => {
    const line = lineFromProduct(product);
    if (typeof line === "string") {
      setStatusMsg({ type: "error", msg: line });
      return;
    }
    setLines((current) => [...current, line]);
    setProductQuery("");
    setProductHits([]);
    setStatusMsg(null);
  };

  const buildBody = (): QuotationWriteBody | string => {
    const name = customerName.trim();
    if (customerMode === "existing" && !customerId) {
      return "Select an existing customer.";
    }
    if (!name) return "Customer name is required.";
    if (lines.length === 0) return "Add at least one product.";
    const phoneDigits = sanitizePhoneDigits(phone);
    if (phoneDigits && phoneDigits.length !== 10) {
      return "Phone must be exactly 10 digits.";
    }
    if (saveAsCustomer && customerMode === "new" && phoneDigits.length !== 10) {
      return "Phone number is required to save a customer.";
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return "Enter a valid email or leave it blank.";
    }
    const discount = num(discountPercent);
    if (discount < 0 || discount > 100) return "Order discount must be between 0 and 100.";
    if (num(transport) < 0) return "Transport amount cannot be negative.";

    const payloadLines = [];
    for (const line of lines) {
      if (!line.sellingPrice.trim()) {
        return `${line.productName} has no selling price and cannot be added to a quotation.`;
      }
      const quantity = num(line.quantity);
      if (quantity <= 0) return `Enter a quantity for ${line.productName}.`;
      const unit = selectedUnit(line);
      if (unit && !unit.allowsFractionalSale && !Number.isInteger(quantity)) {
        return `Fractional quantity is not allowed for ${line.productName}.`;
      }
      const discountAmt = num(line.lineDiscount);
      if (discountAmt < 0) return `Discount cannot be negative for ${line.productName}.`;
      if (discountAmt > quantity * lineUnitPrice(line) + 0.0001) {
        return `Line discount cannot exceed the line amount for ${line.productName}.`;
      }
      payloadLines.push({
        productId: line.productId,
        productUnitId: line.productUnitId,
        quantity,
        lineDiscount: discountAmt,
      });
    }

    return {
      ...(customerMode === "existing" && customerId ? { customerId } : {}),
      customerName: name,
      customerContactPerson: contactPerson.trim() || null,
      customerPhone: phoneDigits || null,
      customerEmail: email.trim() || null,
      customerAddress: address.trim() || null,
      customerPartyGstNo: sanitizeGstinInput(gstin, 20) || null,
      customerPartyState: partyState.trim() || null,
      saveAsCustomer: customerMode === "new" && saveAsCustomer,
      includeGst,
      discountPercent: discount,
      transportAmount: num(transport),
      note: note.trim() || undefined,
      lines: payloadLines,
    };
  };

  const persist = async (issue: boolean) => {
    const body = buildBody();
    if (typeof body === "string") {
      setStatusMsg({ type: "error", msg: body });
      return;
    }
    if (issue) {
      const ok = await confirm({
        title: "Issue quotation",
        message:
          "Issue this quotation? Pricing is frozen after issue, and it stays valid for 2 days from today. Stock will not change.",
        confirmLabel: "Issue",
      });
      if (!ok) return;
    }
    setBusy(true);
    setStatusMsg(null);
    try {
      const saved = quotationId
        ? await api.updateQuotation(quotationId, body)
        : await api.createQuotation(body);
      setQuotationId(saved.id);
      setQuotation(saved);
      const finalRow = issue ? await api.issueQuotation(saved.id) : saved;
      if (issue) {
        setQuotation(finalRow);
        setMode("view");
        setStatusMsg({
          type: "success",
          msg: `Issued ${finalRow.quotationNumber}. Valid until ${finalRow.validUntilLabel}.`,
        });
      } else {
        hydrate(finalRow);
        setStatusMsg({
          type: "success",
          msg: `Draft saved — ${finalRow.quotationNumber}`,
        });
      }
      if (finalRow.customerId) {
        const latest = await api.getCustomers();
        setCustomers(latest);
      }
    } catch (error) {
      setStatusMsg({ type: "error", msg: errorText(error, "Could not save quotation") });
    } finally {
      setBusy(false);
    }
  };

  const runIssue = async (id: string) => {
    const ok = await confirm({
      title: "Issue quotation",
      message: "Issue this quotation? It can no longer be edited, and stock will not change.",
      confirmLabel: "Issue",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const row = await api.issueQuotation(id);
      setQuotation(row);
      setMode("view");
      setStatusMsg({
        type: "success",
        msg: `Issued ${row.quotationNumber}. Valid until ${row.validUntilLabel}.`,
      });
    } catch (error) {
      setStatusMsg({ type: "error", msg: errorText(error, "Could not issue quotation") });
    } finally {
      setBusy(false);
    }
  };

  /** Loads the latest quotation, warns if it expired, then opens it in the POS cart. */
  const runConvert = async (id: string) => {
    setBusy(true);
    setStatusMsg(null);
    try {
      const row = await api.getQuotation(id);
      if (row.status === "CONVERTED") {
        setStatusMsg({
          type: "error",
          msg: `${row.quotationNumber} was already converted to ${row.convertedSaleNumber ?? "a sale"}.`,
        });
        if (mode === "list") await loadList(page);
        return;
      }
      if (row.status !== "ISSUED" && row.status !== "EXPIRED") {
        setStatusMsg({ type: "error", msg: "Only issued quotations can be converted to a sale." });
        return;
      }
      if (row.status === "EXPIRED") {
        const ok = await confirm({
          title: "Quotation expired",
          message: `${row.quotationNumber} expired on ${row.validUntilLabel}. You can still convert it, and the quoted prices will be used. Continue?`,
          confirmLabel: "Convert anyway",
          cancelLabel: "Go back",
          variant: "warning",
        });
        if (!ok) return;
      }
      onConvertToSale(row);
    } catch (error) {
      setStatusMsg({ type: "error", msg: errorText(error, "Could not open quotation for conversion") });
    } finally {
      setBusy(false);
    }
  };

  const runCancel = async (id: string) => {
    const ok = await confirm({
      title: "Cancel quotation",
      message: "Cancel this quotation? It will be kept for history and cannot be issued later.",
      confirmLabel: "Cancel quotation",
      variant: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const row = await api.cancelQuotation(id);
      setQuotation(row);
      setStatusMsg({ type: "success", msg: `${row.quotationNumber} cancelled.` });
      if (mode === "list") await loadList(page);
      else setMode("view");
    } catch (error) {
      setStatusMsg({ type: "error", msg: errorText(error, "Could not cancel quotation") });
    } finally {
      setBusy(false);
    }
  };

  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, color: "var(--text)" }}>Quotations</h1>
          <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 13 }}>
            Price from the product selling price. Issuing a quotation does not change stock; convert an
            issued quotation to a sale when the customer buys.
          </p>
        </div>
        {mode === "list" ? (
          <button type="button" style={btnPrimary} onClick={openNew}>
            New quotation
          </button>
        ) : (
          <button
            type="button"
            style={btn}
            onClick={() => {
              setMode("list");
              setStatusMsg(null);
            }}
          >
            Back to list
          </button>
        )}
      </div>
      <Toast status={statusMsg} />

      {mode === "list" ? (
        <section style={card}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 10,
            }}
          >
            <input
              style={field}
              placeholder="Quotation # or customer"
              value={q}
              onChange={(event) => setQ(event.target.value)}
            />
            <select
              style={field}
              value={customerFilter}
              onChange={(event) => setCustomerFilter(event.target.value)}
            >
              <option value="">All customers</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
            <select
              style={field}
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as QuotationStatus | "")}
            >
              <option value="">All statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="ISSUED">Issued</option>
              <option value="EXPIRED">Expired</option>
              <option value="CONVERTED">Converted</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
            <input style={field} type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            <input style={field} type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            <button type="button" style={btnPrimary} disabled={busy} onClick={() => void loadList(1)}>
              Search
            </button>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                  {["Quotation #", "Date", "Customer", "Valid until", "Amount", "Status", "Created by", "Actions"].map(
                    (heading) => (
                      <th key={heading} style={{ padding: "8px 6px", borderBottom: "1px solid var(--border)" }}>
                        {heading}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {list.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: 16, color: "var(--muted)" }}>
                      {busy ? "Loading…" : "No quotations yet."}
                    </td>
                  </tr>
                ) : (
                  list.map((row) => (
                    <tr key={row.id}>
                      <td style={{ padding: "8px 6px" }}>{row.quotationNumber}</td>
                      <td style={{ padding: "8px 6px" }}>{dmy(row.quotationDate)}</td>
                      <td style={{ padding: "8px 6px" }}>{row.customerName}</td>
                      <td style={{ padding: "8px 6px" }}>{dmy(row.validUntil)}</td>
                      <td style={{ padding: "8px 6px" }}>
                        {fmt(num(row.totalAmount))}
                        {row.includeGst === false ? (
                          <div style={{ color: "var(--muted)", fontSize: 11 }}>No GST</div>
                        ) : null}
                      </td>
                      <td style={{ padding: "8px 6px", color: statusColor(row.status), fontWeight: 700 }}>
                        {row.status}
                        {row.status === "CONVERTED" && row.convertedSaleNumber ? (
                          <div style={{ color: "var(--muted)", fontSize: 11, fontWeight: 500 }}>
                            {row.convertedSaleNumber}
                          </div>
                        ) : null}
                      </td>
                      <td style={{ padding: "8px 6px" }}>{row.createdByName}</td>
                      <td style={{ padding: "8px 6px" }}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button type="button" style={btn} onClick={() => void openView(row.id)}>
                            View
                          </button>
                          {row.status === "DRAFT" ? (
                            <button type="button" style={btn} onClick={() => void openEdit(row.id)}>
                              Edit
                            </button>
                          ) : null}
                          {row.status === "DRAFT" ? (
                            <button type="button" style={btn} onClick={() => void runIssue(row.id)}>
                              Issue
                            </button>
                          ) : null}
                          <button
                            type="button"
                            style={btn}
                            onClick={() => void savePdf(row.id, row.quotationNumber).catch((error) =>
                              setStatusMsg({ type: "error", msg: errorText(error, "Could not download PDF") })
                            )}
                          >
                            PDF
                          </button>
                          <button type="button" style={btn} onClick={() => void openView(row.id, true)}>
                            Print
                          </button>
                          {row.status === "ISSUED" || row.status === "EXPIRED" ? (
                            <button
                              type="button"
                              style={btnPrimary}
                              disabled={busy}
                              onClick={() => void runConvert(row.id)}
                            >
                              Convert to sale
                            </button>
                          ) : null}
                          {row.status !== "CANCELLED" && row.status !== "CONVERTED" ? (
                            <button type="button" style={btn} onClick={() => void runCancel(row.id)}>
                              Cancel
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "var(--muted)", fontSize: 12 }}>{total} quotations</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" style={btn} disabled={page <= 1 || busy} onClick={() => void loadList(page - 1)}>
                Previous
              </button>
              <span style={{ fontSize: 13, alignSelf: "center" }}>
                {page} / {pages}
              </span>
              <button
                type="button"
                style={btn}
                disabled={page >= pages || busy}
                onClick={() => void loadList(page + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {mode === "edit" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <section style={card}>
            <strong>Header</strong>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13 }}>
              <span>Number: {quotation?.quotationNumber ?? "Assigned when you save"}</span>
              <span>Date: {quotation?.quotationDateLabel ?? "Today, when saved"}</span>
              <span>Valid until: {quotation?.validUntilLabel ?? "2 days after the quotation date"}</span>
              <span>Status: {quotation?.status ?? "DRAFT"}</span>
            </div>
          </section>

          <section style={card}>
            <strong>Customer</strong>
            <div style={{ display: "flex", gap: 8 }}>
              {(["existing", "new"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  style={{
                    ...btn,
                    borderColor: customerMode === value ? "var(--accent)" : "var(--border)",
                  }}
                  onClick={() => {
                    setCustomerMode(value);
                    if (value === "new") setCustomerId("");
                  }}
                >
                  {value === "existing" ? "Existing customer" : "New customer"}
                </button>
              ))}
            </div>
            {customerMode === "existing" ? (
              <div>
                <input
                  style={field}
                  placeholder="Search customer by name, phone, or GSTIN"
                  value={customerQuery}
                  onChange={(event) => setCustomerQuery(event.target.value)}
                />
                {customerQuery.trim() ? (
                  <div style={{ border: "1px solid var(--border)", borderRadius: 8, marginTop: 6 }}>
                    {customerHits.length === 0 ? (
                      <div style={{ padding: 8, color: "var(--muted)", fontSize: 13 }}>No matching customers.</div>
                    ) : (
                      customerHits.map((customer) => (
                        <button
                          key={customer.id}
                          type="button"
                          onClick={() => pickCustomer(customer)}
                          style={{
                            display: "block",
                            width: "100%",
                            textAlign: "left",
                            padding: "8px 10px",
                            border: "none",
                            background: "transparent",
                            color: "var(--text)",
                            cursor: "pointer",
                          }}
                        >
                          {customer.name}
                          {customer.phone ? ` · ${customer.phone}` : ""}
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
              <label>
                Customer / company name
                <input style={field} value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
              </label>
              <label>
                Contact person
                <input style={field} value={contactPerson} onChange={(event) => setContactPerson(event.target.value)} />
              </label>
              <label>
                Phone
                <input
                  style={field}
                  value={phone}
                  inputMode="numeric"
                  onChange={(event) => setPhone(sanitizePhoneDigits(event.target.value))}
                />
              </label>
              <label>
                Email
                <input style={field} value={email} onChange={(event) => setEmail(event.target.value)} />
              </label>
              <label>
                GSTIN
                <input
                  style={field}
                  value={gstin}
                  onChange={(event) => setGstin(sanitizeGstinInput(event.target.value, 20))}
                />
              </label>
              <label>
                State
                <input style={field} value={partyState} onChange={(event) => setPartyState(event.target.value)} />
              </label>
            </div>
            <label>
              Billing address
              <textarea
                style={{ ...field, height: 72, padding: 10 }}
                value={address}
                onChange={(event) => setAddress(event.target.value)}
              />
            </label>
            {customerMode === "new" ? (
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={saveAsCustomer}
                  onChange={(event) => setSaveAsCustomer(event.target.checked)}
                />
                Save as customer (optional — a phone number is required)
              </label>
            ) : (
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>
                These details are stored on the quotation. Editing them here does not change the customer record.
              </p>
            )}
          </section>

          <section style={card}>
            <strong>Items</strong>
            <div style={{ position: "relative" }}>
              <input
                style={field}
                placeholder="Search products by name, SKU, or barcode"
                value={productQuery}
                onChange={(event) => setProductQuery(event.target.value)}
              />
              {productHits.length > 0 ? (
                <div
                  style={{
                    position: "absolute",
                    zIndex: 2,
                    left: 0,
                    right: 0,
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    maxHeight: 240,
                    overflowY: "auto",
                  }}
                >
                  {productHits
                    .filter((product) => product.status === "ACTIVE")
                    .map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => addProduct(product)}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "8px 10px",
                        border: "none",
                        borderBottom: "1px solid var(--border)",
                        background: "transparent",
                        color: "var(--text)",
                        cursor: "pointer",
                      }}
                    >
                      {product.name} · {product.sku}
                      {product.sellingPrice != null ? ` · ${fmt(num(product.sellingPrice))}` : " · No selling price"}
                      {` · Stock ${product.currentStock}`}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                    {["Product", "SKU", "Unit", "Qty", "Available stock", "Unit price", "Discount", "GST", "Line total", ""].map(
                      (heading) => (
                        <th key={heading || "remove"} style={{ padding: "8px 6px" }}>
                          {heading}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ padding: 12, color: "var(--muted)" }}>
                        Search the catalog and add a product. The selling price cannot be edited.
                      </td>
                    </tr>
                  ) : (
                    lines.map((line, index) => {
                      const unit = selectedUnit(line);
                      const price = lineUnitPrice(line);
                      return (
                        <tr key={line.key}>
                          <td style={{ padding: 6 }}>{line.productName}</td>
                          <td style={{ padding: 6 }}>{line.sku}</td>
                          <td style={{ padding: 6 }}>
                            <select
                              style={{ ...field, width: 120 }}
                              value={line.productUnitId}
                              onChange={(event) =>
                                setLines((current) =>
                                  current.map((row) =>
                                    row.key === line.key
                                      ? { ...row, productUnitId: event.target.value }
                                      : row
                                  )
                                )
                              }
                            >
                              {line.units.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.displayName || option.code}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td style={{ padding: 6 }}>
                            <input
                              style={{ ...field, width: 80 }}
                              value={line.quantity}
                              onChange={(event) =>
                                setLines((current) =>
                                  current.map((row) =>
                                    row.key === line.key ? { ...row, quantity: event.target.value } : row
                                  )
                                )
                              }
                            />
                          </td>
                          <td style={{ padding: 6 }}>
                            {stockInSelectedUnit(line).toLocaleString("en-IN", { maximumFractionDigits: 2 })}{" "}
                            {unit?.code}
                          </td>
                          <td style={{ padding: 6 }}>{fmt(price)}</td>
                          <td style={{ padding: 6 }}>
                            <input
                              style={{ ...field, width: 90 }}
                              value={line.lineDiscount}
                              onChange={(event) =>
                                setLines((current) =>
                                  current.map((row) =>
                                    row.key === line.key
                                      ? { ...row, lineDiscount: event.target.value }
                                      : row
                                  )
                                )
                              }
                            />
                          </td>
                          <td style={{ padding: 6 }}>
                            {gstLabel(line.cgstPercent, line.sgstPercent, line.igstPercent)}
                          </td>
                          <td style={{ padding: 6 }}>{fmt(preview.lineTotals[index] ?? 0)}</td>
                          <td style={{ padding: 6 }}>
                            <button
                              type="button"
                              style={btn}
                              onClick={() =>
                                setLines((current) => current.filter((row) => row.key !== line.key))
                              }
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section style={{ ...card, maxWidth: 420 }}>
            <strong>Totals</strong>
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 14 }}>
              <input
                type="checkbox"
                checked={includeGst}
                onChange={(event) => setIncludeGst(event.target.checked)}
              />
              <span>
                <strong>Include GST</strong>
                <span style={{ display: "block", color: "var(--muted)", fontSize: 12, fontWeight: 400 }}>
                  Turn this off for a quotation without CGST, SGST, or IGST.
                </span>
              </span>
            </label>
            <label>
              Order discount %
              <input
                style={field}
                value={discountPercent}
                onChange={(event) => setDiscountPercent(event.target.value)}
              />
            </label>
            <label>
              Transport
              <input style={field} value={transport} onChange={(event) => setTransport(event.target.value)} />
            </label>
            {(
              [
                ["Subtotal", preview.subtotal],
                ["Discount", preview.discountAmount],
                ["Taxable amount", preview.taxableAmount],
                ["CGST", preview.cgstAmount],
                ["SGST", preview.sgstAmount],
                ["IGST", preview.igstAmount],
                ["Grand total", preview.totalAmount],
              ] as const
            ).map(([label, amount]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span>{label}</span>
                <strong>{fmt(amount)}</strong>
              </div>
            ))}
            {includeGst ? null : (
              <p style={{ margin: 0, fontSize: 13 }}>{QUOTATION_GST_NOT_INCLUDED_NOTE}</p>
            )}
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>
              The server recalculates these amounts from the product selling price when you save.
            </p>
          </section>

          <section style={card}>
            <label>
              Note
              <textarea
                style={{ ...field, height: 72, padding: 10 }}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" style={btn} disabled={busy} onClick={() => void persist(false)}>
                Save draft
              </button>
              <button type="button" style={btnPrimary} disabled={busy} onClick={() => void persist(true)}>
                Issue quotation
              </button>
              <button
                type="button"
                style={btn}
                onClick={() => {
                  resetEditor();
                  setMode("list");
                }}
              >
                Close
              </button>
              <button
                type="button"
                style={btn}
                disabled={!quotationId || busy}
                onClick={() =>
                  quotationId && quotation
                    ? void savePdf(quotationId, quotation.quotationNumber)
                    : undefined
                }
              >
                Download PDF
              </button>
              <button
                type="button"
                style={btn}
                disabled={!quotationId}
                onClick={() => quotationId && void openView(quotationId, true)}
              >
                Print
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {mode === "view" && quotation ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="tax-invoice-modal-toolbar" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {quotation.status === "DRAFT" ? (
              <button type="button" style={btn} onClick={() => void openEdit(quotation.id)}>
                Edit
              </button>
            ) : null}
            {quotation.status === "DRAFT" ? (
              <button type="button" style={btnPrimary} onClick={() => void runIssue(quotation.id)}>
                Issue
              </button>
            ) : null}
            <button
              type="button"
              style={btn}
              onClick={() =>
                void savePdf(quotation.id, quotation.quotationNumber).catch((error) =>
                  setStatusMsg({ type: "error", msg: errorText(error, "Could not download PDF") })
                )
              }
            >
              Download PDF
            </button>
            <button type="button" style={btn} onClick={() => printElementInBlankFrame("tax-invoice-print-area")}>
              Print
            </button>
            {quotation.status === "ISSUED" || quotation.status === "EXPIRED" ? (
              <button
                type="button"
                style={btnPrimary}
                disabled={busy}
                onClick={() => void runConvert(quotation.id)}
              >
                Convert to sale
              </button>
            ) : null}
            {quotation.status !== "CANCELLED" && quotation.status !== "CONVERTED" ? (
              <button type="button" style={btn} onClick={() => void runCancel(quotation.id)}>
                Cancel quotation
              </button>
            ) : null}
            {quotation.status === "CONVERTED" ? (
              <span style={{ alignSelf: "center", fontSize: 13, color: "var(--muted)" }}>
                Converted to {quotation.convertedSaleNumber ?? "a sale"}. Find it under Invoices.
              </span>
            ) : null}
          </div>
          <div id="tax-invoice-print-area" className="tax-invoice-print-shell">
            <QuotationDocument quotation={quotation} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
