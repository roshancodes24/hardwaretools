import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { api, getAuthToken, logoutAuth, setActingUserId } from "./api/client";
import { isApiError } from "./api/errors";
import type {
  ApiCustomer,
  ApiProduct,
  ApiPromotion,
  ApiSupplier,
  CreateSaleBody,
  PurchaseListRow,
  QuotationDetail,
  SaleDetail,
  SessionUserRow,
} from "./api/types";
import { TaxInvoiceModal } from "./invoice/TaxInvoiceModal";
import {
  lineErrorsFromDetails,
  recordFieldErrors,
} from "./lib/formErrors";
import {
  formatIndiaDateLong,
  formatIndiaDateTime,
  ymdInIndia,
} from "./lib/indiaTime";
import {
  parsePurchaseLinesImportFile,
  PURCHASE_IMPORT_TEMPLATE_CSV,
  resolvePurchaseImportPatchesAsync,
} from "./lib/importPurchaseLines";
import { mapApiProduct, type UiProduct } from "./lib/mapProduct";
import { fmt, parseMoneyField } from "./lib/formatMoney";
import { computePosTotals } from "./lib/posCartTotals";
import {
  buildConversionCart,
  cartLineKey,
  stockShortfalls,
  type CartLine,
} from "./lib/quotationConversion";
import { resolveSplitPayment } from "./lib/splitPayment";
import { stockStatus } from "./lib/inventoryTable";
import { inputStyle } from "./styles/formStyles";
import { AdjustmentView } from "./views/AdjustmentView";
import { InventoryView } from "./views/InventoryView";
import { OutstandingView } from "./views/OutstandingView";
import { sanitizeGstinInput } from "./lib/gstinInput";
import { sanitizePhoneDigits } from "./lib/phoneInput";
import { COMPANY_NAME } from "./lib/branding";
import { HomeView } from "./HomeView";
import { ConfirmModal } from "./ConfirmModal";
import { BusyOverlay, paintBeforeWork } from "./components/BusyOverlay";
import { StockBadge } from "./components/StockBadge";
import { Toast } from "./components/Toast";
import { PromotionsPage } from "./pages/PromotionsPage";
import { LoginPage } from "./pages/LoginPage";
import { ProductsPage } from "./pages/ProductsPage";
import { ReportingPage } from "./pages/ReportingPage";
import { ReprintInvoicePage } from "./pages/ReprintInvoicePage";
import { QuotationsPage } from "./pages/QuotationsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { FEATURE_FLAGS } from "./featureFlags";
import { Sidebar, type Tab } from "./Sidebar";
import { useConfirm } from "./useConfirm";
import type { ConfirmOptions } from "./useConfirm";

/** POS "Tax invoice" checkbox starts checked, and returns to checked after each sale / Clear all. */
const POS_TAX_INVOICE_DEFAULT = true;

// ═══════════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════════════

function FormErrorBanner({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div
      style={{
        background: "var(--danger-soft-solid)",
        color: "var(--danger-text)",
        padding: "8px 10px",
        borderRadius: 8,
        fontSize: 12,
        lineHeight: 1.45,
        border: "1px solid var(--danger-border-solid)",
      }}
    >
      {text}
    </div>
  );
}

function FieldWrap({
  label,
  children,
  error,
  errorId,
}: {
  label: string;
  children: ReactNode;
  error?: string;
  errorId?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 13, fontWeight: 500, color: "var(--text-strong)" }}>
        {label}
      </label>
      {children}
      {error ? (
        <span id={errorId} style={{ fontSize: 12, color: "var(--danger-text)" }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}


/** A quotation being converted in the POS (cart lines carry the quoted price, discount and tax). */
type ConvertingQuotation = {
  id: string;
  number: string;
  validUntilLabel: string;
  expired: boolean;
};

// ═══════════════════════════════════════════════════════════════════
// POS VIEW
// ═══════════════════════════════════════════════════════════════════
function POSView({
  products,
  promotions,
  actingUserId,
  customers,
  refreshCustomers,
  onSaleComplete,
  confirm,
  quotationToConvert,
  onQuotationConsumed,
}: {
  products: UiProduct[];
  promotions: ApiPromotion[];
  actingUserId: string;
  customers: ApiCustomer[];
  refreshCustomers: () => Promise<void>;
  onSaleComplete: () => Promise<void>;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  /** Issued quotation handed over from the Quotations page; loaded into the cart once. */
  quotationToConvert: QuotationDetail | null;
  onQuotationConsumed: () => void;
}) {
  const promotionsUi = FEATURE_FLAGS.catalogPromotions;
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [page, setPage] = useState(1);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState(0);
  const [promotionCode, setPromotionCode] = useState("");
  const [status, setStatus] = useState<{
    type: "success" | "error";
    msg: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [lineErrors, setLineErrors] = useState<
    Map<number, Record<string, string>>
  >(() => new Map());

  /** Empty = walk-in / typing; set when cashier picks typeahead or saves a new customer */
  const [posCustomerId, setPosCustomerId] = useState("");
  /** Single field: search existing or type walk-in name */
  const [customerQuery, setCustomerQuery] = useState("");
  /** Optional phone for walk-in; cleared when a registered customer is selected */
  const [walkInPhone, setWalkInPhone] = useState("");
  /** Optional Party GST No for walk-in / save-customer; cleared with phone on pick/clear */
  const [walkInPartyGstNo, setWalkInPartyGstNo] = useState("");
  /** Optional State (tax invoice); cleared when picking a registered customer */
  const [walkInPartyState, setWalkInPartyState] = useState("");
  const [customerPhoneError, setCustomerPhoneError] = useState<string | null>(null);
  const [customerSuggestOpen, setCustomerSuggestOpen] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [amountPaidStr, setAmountPaidStr] = useState("");
  const [posSplitPayment, setPosSplitPayment] = useState(false);
  const [posCashStr, setPosCashStr] = useState("");
  const [posOnlineStr, setPosOnlineStr] = useState("");
  const [posPaymentMethod, setPosPaymentMethod] = useState<
    "cash" | "online_banking"
  >("cash");
  /** Freight / transport (added to charged total). */
  const [transportStr, setTransportStr] = useState("");
  const [taxInvoiceSale, setTaxInvoiceSale] = useState<SaleDetail | null>(null);
  /** Tax invoice checkbox on POS (document kind sent to API). Post-sale modal uses the saved sale. */
  const [posTaxInvoice, setPosTaxInvoice] = useState(POS_TAX_INVOICE_DEFAULT);
  /** Set while the cart was filled from a quotation; sale is then sent with `quotationId`. */
  const [convertingQuotation, setConvertingQuotation] =
    useState<ConvertingQuotation | null>(null);
  /** Quotation lines that could not be put in the cart (product removed, unit removed). */
  const [conversionSkipped, setConversionSkipped] = useState<string[]>([]);

  useEffect(() => {
    setFieldErrors({});
    setLineErrors(new Map());
  }, [cart, discount]);

  useEffect(() => {
    if (!quotationToConvert) return;
    const q = quotationToConvert;
    const { lines, skipped } = buildConversionCart(q, products);
    setCart(lines);
    setConversionSkipped(skipped);
    setDiscount(0);
    setPromotionCode("");
    const transport = Number.parseFloat(q.transportAmount);
    setTransportStr(Number.isFinite(transport) && transport > 0 ? String(transport) : "");
    setPosTaxInvoice(q.includeGst);
    setPosSplitPayment(false);
    setPosCashStr("");
    setPosOnlineStr("");
    setAmountPaidStr("");
    setCustomerPhoneError(null);

    const registered = q.customerId
      ? customers.find((c) => c.id === q.customerId)
      : undefined;
    if (registered) {
      setPosCustomerId(registered.id);
      setCustomerQuery("");
      setWalkInPhone("");
      setWalkInPartyGstNo("");
      setWalkInPartyState("");
    } else {
      const digits = (q.customerPhone ?? "").replace(/\D/g, "");
      setPosCustomerId("");
      setCustomerQuery(q.customerName);
      setWalkInPhone(digits.length > 10 ? digits.slice(-10) : digits);
      setWalkInPartyGstNo(sanitizeGstinInput(q.customerPartyGstNo ?? "", 20));
      setWalkInPartyState(q.customerPartyState ?? "");
    }

    setConvertingQuotation({
      id: q.id,
      number: q.quotationNumber,
      validUntilLabel: q.validUntilLabel,
      expired: q.status === "EXPIRED",
    });
    setStatus(null);
    onQuotationConsumed();
    // Runs once per hand-over; products/customers are the lists at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotationToConvert]);

  const shortfalls = useMemo(
    () => (convertingQuotation ? stockShortfalls(cart) : []),
    [convertingQuotation, cart]
  );

  const categories = useMemo(
    () => ["All", ...new Set(products.map((p) => p.category))],
    [products]
  );

  const filtered = useMemo(
    () =>
      products.filter((p) => {
        const q = search.toLowerCase();
        return (
          (category === "All" || p.category === category) &&
          (p.name.toLowerCase().includes(q) ||
            p.sku.toLowerCase().includes(q))
        );
      }),
    [products, search, category]
  );

  const pageSize = 9;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));

  useEffect(() => {
    setPage(1);
  }, [search, category, products]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const pagedProducts = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page]);

  const typeaheadMatches = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    if (!q) return [];
    const qDigits = q.replace(/\D/g, "");
    return customers
      .filter((c) => {
        if (c.name.toLowerCase().includes(q)) return true;
        if ((c.email ?? "").toLowerCase().includes(q)) return true;
        const phone = (c.phone ?? "").replace(/\D/g, "");
        if (qDigits.length >= 2 && phone.includes(qDigits)) return true;
        if (q.length >= 2 && (c.phone ?? "").toLowerCase().includes(q))
          return true;
        return false;
      })
      .slice(0, 8);
  }, [customers, customerQuery]);

  const activePromotions = useMemo(() => {
    const now = new Date();
    return promotions.filter((p) => {
      if (!p.isActive) return false;
      const startsAt = p.startsAt ? new Date(p.startsAt) : null;
      const endsAt = p.endsAt ? new Date(p.endsAt) : null;
      if (startsAt && startsAt > now) return false;
      if (endsAt && endsAt < now) return false;
      return true;
    });
  }, [promotions]);

  const cartPromotion = useMemo(() => {
    const code = promotionCode.trim().toUpperCase();
    if (!code) return undefined;
    return activePromotions.find(
      (p) => p.scope === "CART" && (p.code ?? "").toUpperCase() === code
    );
  }, [activePromotions, promotionCode]);

  const productPromotionPctById = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of activePromotions) {
      if (p.scope !== "PRODUCT") continue;
      const pct = Number(p.percentage);
      for (const productId of p.productIds) {
        map.set(productId, Math.max(map.get(productId) ?? 0, pct));
      }
    }
    return map;
  }, [activePromotions]);

  const categoryPromotionPctByName = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of activePromotions) {
      if (p.scope !== "CATEGORY" || !p.category) continue;
      const pct = Number(p.percentage);
      map.set(p.category, Math.max(map.get(p.category) ?? 0, pct));
    }
    return map;
  }, [activePromotions]);

  const addToCart = (p: UiProduct) => {
    if (p.stock === 0) return;
    if (convertingQuotation) {
      setStatus({
        type: "error",
        msg: `Converting ${convertingQuotation.number}: only its lines can be sold. Finish or clear this sale to add other items.`,
      });
      setTimeout(() => setStatus(null), 4000);
      return;
    }
    setCart((c) => {
      const existing = c.find((x) => x.id === p.id);
      return existing
        ? c.map((x) => (x.id === p.id ? { ...x, qty: x.qty + 1 } : x))
        : [...c, { ...p, qty: 1 }];
    });
  };

  /** `key` is the row key (see `cartLineKey`): product id, or the quotation line when converting. */
  const updateQty = (key: string, qtyVal: number) => {
    const line = cart.find((x) => cartLineKey(x) === key);
    if (!line) return;
    if (qtyVal <= 0) {
      setCart((c) => c.filter((x) => cartLineKey(x) !== key));
      return;
    }
    if (!line.allowsFractionalSale && !Number.isInteger(qtyVal)) {
      setStatus({
        type: "error",
        msg: `Fractional quantity not allowed for ${line.name}.`,
      });
      setTimeout(() => setStatus(null), 4000);
      return;
    }
    if (line.quote && qtyVal > line.quote.quotedQty) {
      setStatus({
        type: "error",
        msg: `Quoted quantity for ${line.name} is ${line.quote.quotedQty} ${line.unit}.`,
      });
      setTimeout(() => setStatus(null), 4000);
      return;
    }
    // Lowering a line that is already over stock (quotation lines) is always allowed.
    if (qtyVal > line.stock && qtyVal > line.qty) {
      setStatus({
        type: "error",
        msg: `Max available: ${Number(line.stock.toFixed(4))} ${line.unit}.`,
      });
      setTimeout(() => setStatus(null), 4000);
      return;
    }
    setCart((c) =>
      c.map((x) => (cartLineKey(x) === key ? { ...x, qty: qtyVal } : x))
    );
  };

  const transportAmount = useMemo(() => {
    const t = Number.parseFloat(String(transportStr).replace(/,/g, "").trim());
    if (!Number.isFinite(t) || t < 0) return 0;
    return Math.round(t * 100) / 100;
  }, [transportStr]);

  const cartPromoPercent = cartPromotion ? Number(cartPromotion.percentage) : 0;

  const {
    subtotal,
    productCategoryPromoAmt,
    discountAmt,
    cartPromoAmt,
    lineDiscountsForPos,
    quoteDiscountAmt,
    lineTaxesForPos,
    grandTotal,
  } = useMemo(
    () =>
      computePosTotals({
        cart: cart.map((line) => ({
          id: line.id,
          price: line.price,
          qty: line.qty,
          category: line.category,
          cgstPercent: line.cgstPercent ?? undefined,
          sgstPercent: line.sgstPercent ?? undefined,
          igstPercent: line.igstPercent ?? undefined,
          quote: line.quote,
        })),
        // A quotation keeps its own discount per line; no extra discount or promotion on top.
        discountPercent: convertingQuotation ? 0 : discount,
        cartPromoPercent: convertingQuotation ? 0 : cartPromoPercent,
        productPromotionPctById,
        categoryPromotionPctByName,
        posTaxInvoice,
        transportAmount,
      }),
    [
      cart,
      convertingQuotation,
      discount,
      cartPromoPercent,
      productPromotionPctById,
      categoryPromotionPctByName,
      posTaxInvoice,
      transportAmount,
    ]
  );

  const posGstTotals = useMemo(() => {
    if (!posTaxInvoice || cart.length === 0) return null;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    for (let i = 0; i < cart.length; i++) {
      const line = cart[i];
      const disc = lineDiscountsForPos[i] ?? 0;
      const taxable = Math.max(0, line.price * line.qty - disc);
      const c = line.cgstPercent ?? 0;
      const s = line.sgstPercent ?? 0;
      const ig = line.igstPercent ?? 0;
      cgst += (taxable * c) / 100;
      sgst += (taxable * s) / 100;
      igst += (taxable * ig) / 100;
    }
    return {
      cgst: Math.round(cgst * 100) / 100,
      sgst: Math.round(sgst * 100) / 100,
      igst: Math.round(igst * 100) / 100,
    };
  }, [posTaxInvoice, cart, lineDiscountsForPos]);

  const hasPosSaleDraft = useMemo(
    () =>
      cart.length > 0 ||
      Boolean(posCustomerId) ||
      Boolean(customerQuery.trim()) ||
      Boolean(walkInPhone.trim()) ||
      Boolean(walkInPartyGstNo.trim()) ||
      Boolean(walkInPartyState.trim()) ||
      discount > 0 ||
      Boolean(promotionCode.trim()) ||
      Boolean(transportStr.trim()) ||
      convertingQuotation != null ||
      posTaxInvoice !== POS_TAX_INVOICE_DEFAULT,
    [
      cart.length,
      posCustomerId,
      customerQuery,
      walkInPhone,
      walkInPartyGstNo,
      walkInPartyState,
      discount,
      promotionCode,
      transportStr,
      convertingQuotation,
      posTaxInvoice,
    ],
  );

  useEffect(() => {
    if (!posSplitPayment) {
      setAmountPaidStr(grandTotal > 0 ? grandTotal.toFixed(2) : "0.00");
    }
  }, [grandTotal, posSplitPayment]);

  const pickRegisteredCustomer = (c: ApiCustomer) => {
    setPosCustomerId(c.id);
    setCustomerQuery("");
    setWalkInPhone("");
    setWalkInPartyGstNo("");
    setWalkInPartyState("");
    setCustomerPhoneError(null);
    setCustomerSuggestOpen(false);
  };

  const clearRegisteredCustomer = () => {
    setPosCustomerId("");
    setCustomerPhoneError(null);
    setCustomerSuggestOpen(false);
  };

  /** Reset cart + customer + discounts + transport + tax toggle + validation. */
    const resetPosSaleForm = useCallback((clearStatus: boolean) => {
    setCart([]);
    setDiscount(0);
    setPromotionCode("");
    setPosCustomerId("");
    setCustomerQuery("");
    setWalkInPhone("");
    setWalkInPartyGstNo("");
    setWalkInPartyState("");
    setTransportStr("");
    setPosTaxInvoice(POS_TAX_INVOICE_DEFAULT);
    setConvertingQuotation(null);
    setConversionSkipped([]);
    setPosSplitPayment(false);
    setPosCashStr("");
    setPosOnlineStr("");
    setPosPaymentMethod("cash");
    setAmountPaidStr("");
    setCustomerPhoneError(null);
    setCustomerSuggestOpen(false);
    setFieldErrors({});
    setLineErrors(new Map());
    if (clearStatus) setStatus(null);
  }, []);

  /** Registers typed walk-in as a customer only when cashier clicks Save — not on checkout */
  const saveCustomerFromWalkIn = async () => {
    const name = customerQuery.trim();
    const phone = sanitizePhoneDigits(walkInPhone);
    if (!name || posCustomerId || savingCustomer) return;
    if (!phone) {
      setCustomerPhoneError("Phone number is required to save a customer.");
      return;
    }
    if (phone.length !== 10) {
      setCustomerPhoneError("Phone must be exactly 10 digits.");
      return;
    }
    setCustomerPhoneError(null);
    setSavingCustomer(true);
    setStatus(null);
    try {
      const c = await api.createCustomer({
        name,
        phone,
        partyGstNo:
          posTaxInvoice && sanitizeGstinInput(walkInPartyGstNo, 20)
            ? sanitizeGstinInput(walkInPartyGstNo, 20)
            : undefined,
        partyState:
          posTaxInvoice && walkInPartyState.trim()
            ? walkInPartyState.trim()
            : undefined,
      });
      await refreshCustomers();
      setPosCustomerId(c.id);
      setCustomerQuery("");
      setWalkInPhone("");
      setWalkInPartyGstNo("");
      setWalkInPartyState("");
      setCustomerPhoneError(null);
      setCustomerSuggestOpen(false);
      setStatus({ type: "success", msg: `Customer saved — ${c.name}` });
      setTimeout(() => setStatus(null), 3000);
    } catch (e) {
      setStatus({
        type: "error",
        msg: isApiError(e) ? e.message : "Could not save customer",
      });
      setTimeout(() => setStatus(null), 5000);
    } finally {
      setSavingCustomer(false);
    }
  };

    const handleCheckout = async () => {
    if (!cart.length || loading) return;
    setLoading(true);
    setStatus(null);
    setFieldErrors({});
    setLineErrors(new Map());
    try {
      if (
        promotionsUi &&
        promotionCode.trim() &&
        !cartPromotion
      ) {
        setStatus({ type: "error", msg: "Promotion code is not valid or inactive." });
        return;
      }
      if (convertingQuotation && shortfalls.length > 0) {
        setStatus({
          type: "error",
          msg: `Not enough stock: ${shortfalls.join("; ")}. Reduce or remove these lines to continue.`,
        });
        return;
      }
      const lineDiscounts = lineDiscountsForPos;

      let clampedPaid: number;
      let initialPayments:
        | Array<{ method: "cash" | "online_banking"; amount: number }>
        | undefined;

      if (posSplitPayment) {
        const split = resolveSplitPayment(posCashStr, posOnlineStr, grandTotal);
        if (!split.ok) {
          setStatus({ type: "error", msg: split.error });
          return;
        }
        clampedPaid = split.clampedPaid;
        initialPayments = split.initialPayments;
      } else {
        const parsedPaid = parseMoneyField(amountPaidStr);
        if (parsedPaid == null || parsedPaid < 0) {
          setStatus({
            type: "error",
            msg: "Enter a valid amount received.",
          });
          return;
        }
        clampedPaid =
          Math.round(Math.min(grandTotal, Math.max(0, parsedPaid)) * 100) / 100;
      }

      const hasBalance = grandTotal - clampedPaid > 0.005;
      const walkPhoneDigits = sanitizePhoneDigits(walkInPhone);
      if (
        walkPhoneDigits.length > 0 &&
        walkPhoneDigits.length !== 10
      ) {
        setStatus({
          type: "error",
          msg: "Walk-in phone must be exactly 10 digits.",
        });
        return;
      }
      if (hasBalance) {
        if (!posCustomerId) {
          const nameOk = customerQuery.trim().length > 0;
          const phoneOk = walkPhoneDigits.length === 10;
          if (!nameOk || !phoneOk) {
            setStatus({
              type: "error",
              msg: "Balance due requires a registered customer, or walk-in name and a 10-digit phone number.",
            });
            return;
          }
        }
      } else if (!posCustomerId && !customerQuery.trim()) {
        setStatus({
          type: "error",
          msg: "Walk-in name is required when paying in full (phone optional).",
        });
        return;
      }

      const saleBody: CreateSaleBody = {
        createdById: actingUserId,
        documentKind: posTaxInvoice ? "tax_invoice" : "bill",
        note: [
          discount > 0 ? `POS discount ${discount}%` : "",
          cartPromotion ? `Cart promo ${cartPromotion.code}` : "",
          posTaxInvoice ? "Tax invoice" : "",
        ]
          .filter(Boolean)
          .join(" | ") || undefined,
        paidAmount: clampedPaid,
        ...(posSplitPayment && initialPayments?.length
          ? { initialPayments }
          : { paymentMethod: posPaymentMethod }),
        transportAmount,
        ...(convertingQuotation ? { quotationId: convertingQuotation.id } : {}),
        lines: cart.map((x, i) => ({
          productId: x.id,
          productUnitId: x.baseUnitId,
          quantity: x.qty,
          unitPrice: x.price,
          lineDiscount: lineDiscounts[i] ?? 0,
          lineTax: lineTaxesForPos[i] ?? 0,
          ...(x.quote ? { quotationLineId: x.quote.lineId } : {}),
        })),
      };
      if (posCustomerId) {
        saleBody.customerId = posCustomerId;
      } else {
        if (customerQuery.trim()) {
          saleBody.customerName = customerQuery.trim();
        }
        if (walkPhoneDigits.length === 10) {
          saleBody.customerPhone = walkPhoneDigits;
        }
      }
      if (posTaxInvoice) {
        const gstFromCustomer = posCustomerId
          ? sanitizeGstinInput(
              customers.find((c) => c.id === posCustomerId)?.partyGstNo ?? "",
              20,
            )
          : "";
        const gstWalk = sanitizeGstinInput(walkInPartyGstNo, 20);
        const gst = gstFromCustomer || gstWalk;
        if (gst) {
          saleBody.customerPartyGstNo = gst;
        }
        const stateFromCustomer = posCustomerId
          ? customers.find((c) => c.id === posCustomerId)?.partyState?.trim()
          : undefined;
        const stateWalk = walkInPartyState.trim();
        const st = stateFromCustomer ?? stateWalk;
        if (st) {
          saleBody.customerPartyState = st;
        }
      }

      // Warn (but allow) when any line sells below its average cost.
      const belowCost = cart.filter(
        (x) => x.avgCost != null && x.avgCost > 0 && x.price < x.avgCost
      );
      if (belowCost.length > 0) {
        const lines = belowCost
          .map(
            (x) =>
              `• ${x.name}: selling ${fmt(x.price)} vs avg cost ${fmt(
                x.avgCost ?? 0
              )}`
          )
          .join("\n");
        const proceed = await confirm({
          title: "Selling below cost",
          message: `${belowCost.length} item${
            belowCost.length === 1 ? "" : "s"
          } priced below average cost:\n\n${lines}\n\nComplete this sale anyway?`,
          confirmLabel: "Sell anyway",
          cancelLabel: "Go back",
          variant: "warning",
        });
        if (!proceed) {
          return;
        }
      }

      const sale = await api.createSale(saleBody);

      const bal = Number(sale.balanceAmount ?? 0);
      const snap =
        (sale.customerNameSnapshot ?? sale.customerName)?.trim() ?? "";
      const msg =
        bal > 0.005
          ? snap
            ? `Sale recorded — ${sale.saleNumber} · ${snap} · balance ${fmt(bal)}`
            : `Sale recorded — ${sale.saleNumber} · balance ${fmt(bal)}`
          : snap
            ? `Sale complete — ${sale.saleNumber} · ${snap}`
            : `Sale complete — ${sale.saleNumber}`;
      setStatus({
        type: "success",
        msg,
      });
      setTaxInvoiceSale(sale);
      resetPosSaleForm(false);
      await onSaleComplete();
      setTimeout(() => setStatus(null), 4000);
    } catch (e) {
      if (isApiError(e)) {
        setFieldErrors(recordFieldErrors(e.details));
        setLineErrors(lineErrorsFromDetails(e.details));
        setStatus({ type: "error", msg: e.message });
      } else {
        setStatus({
          type: "error",
          msg: e instanceof Error ? e.message : "Sale failed",
        });
      }
      setTimeout(() => setStatus(null), 6000);
    } finally {
      setLoading(false);
    }
  };


  const lineErrDetail = (index: number, key: string) =>
    lineErrors.get(index)?.[key];

  const saleFormBanner = useMemo(() => {
    const entries = Object.entries(fieldErrors).filter(
      ([k]) => k !== "paidAmount"
    );
    if (entries.length === 0) return undefined;
    return entries.map(([k, v]) => `${k}: ${v}`).join(" · ");
  }, [fieldErrors]);

  return (
    <>
      {taxInvoiceSale ? (
        <TaxInvoiceModal
          sale={taxInvoiceSale}
          onClose={() => setTaxInvoiceSale(null)}
        />
      ) : null}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: 12,
          flex: 1,
          minHeight: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            minHeight: 0,
          }}
        >
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            placeholder="Search by name or SKU..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle, flex: 1 }}
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{ ...inputStyle, minWidth: 140, padding: "0 10px", cursor: "pointer" }}
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))",
            gap: 8,
            alignContent: "start",
          }}
        >
          {pagedProducts.map((p) => {
            const st = stockStatus(p);
            const inCart = cart.find((x) => x.id === p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => addToCart(p)}
                disabled={st === "out"}
                style={{
                  background: "var(--surface)",
                  textAlign: "left",
                  padding: "10px 10px 9px",
                  borderRadius: 10,
                  cursor: st === "out" ? "not-allowed" : "pointer",
                  opacity: st === "out" ? 0.5 : 1,
                  position: "relative",
                  border: inCart
                    ? "2px solid var(--accent)"
                    : "1px solid var(--border)",
                  transition: "border-color 0.1s",
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--muted)",
                    marginBottom: 3,
                  }}
                >
                  {p.sku}
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "var(--text)",
                    lineHeight: 1.3,
                    marginBottom: 6,
                  }}
                >
                  {p.name}
                </div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    fontFamily: "monospace",
                    color: "var(--text)",
                  }}
                >
                  {fmt(p.price)}
                </div>
                <div
                  style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}
                >
                  /{p.unit}
                </div>
                <StockBadge status={st} />
                {inCart && (
                  <div
                    style={{
                      position: "absolute",
                      top: 8,
                      right: 8,
                      background: "var(--accent)",
                      color: "var(--on-accent)",
                      width: 17,
                      height: 17,
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    {inCart.qty}
                  </div>
                )}
              </button>
            );
          })}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
            Showing{" "}
            <strong style={{ color: "var(--text)" }}>{pagedProducts.length}</strong>{" "}
            of <strong style={{ color: "var(--text)" }}>{filtered.length}</strong>{" "}
            products
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              style={{
                height: 30,
                minWidth: 64,
                padding: "0 10px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: page <= 1 ? "var(--surface-subtle)" : "var(--surface)",
                color: page <= 1 ? "var(--muted)" : "var(--text)",
                fontSize: 11.5,
                cursor: page <= 1 ? "not-allowed" : "pointer",
              }}
            >
              Prev
            </button>
            <span
              style={{
                fontSize: 11.5,
                color: "var(--muted)",
                minWidth: 64,
                textAlign: "center",
              }}
            >
              Page {page}/{pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={page >= pageCount}
              style={{
                height: 30,
                minWidth: 64,
                padding: "0 10px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: page >= pageCount ? "var(--surface-subtle)" : "var(--surface)",
                color: page >= pageCount ? "var(--muted)" : "var(--text)",
                fontSize: 11.5,
                cursor: page >= pageCount ? "not-allowed" : "pointer",
              }}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <div
        style={{
          background: "var(--surface)",
          borderRadius: 10,
          border: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "10px 12px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>Current Sale</span>
          {hasPosSaleDraft && (
            <button
              type="button"
              onClick={() => resetPosSaleForm(true)}
              style={{
                fontSize: 12,
                color: "var(--danger)",
                background: "none",
                border: "none",
                cursor: "pointer",
              }}
            >
              Clear all
            </button>
          )}
        </div>

        {convertingQuotation ? (
          <div
            style={{
              padding: "8px 12px",
              background: "var(--surface-subtle)",
              borderBottom: "1px solid var(--border)",
              fontSize: 12,
              lineHeight: 1.45,
              color: "var(--text)",
              display: "flex",
              flexDirection: "column",
              gap: 3,
            }}
          >
            <div style={{ fontWeight: 700 }}>
              Converting quotation {convertingQuotation.number}
            </div>
            <div style={{ color: "var(--muted)" }}>
              Quoted prices, discount and GST are kept. Lower a quantity or remove a line to sell
              only part of it; items left out cannot be converted later.
            </div>
            {convertingQuotation.expired ? (
              <div style={{ color: "var(--warning-text, #b45309)", fontWeight: 600 }}>
                This quotation expired on {convertingQuotation.validUntilLabel}. Quoted prices
                still apply.
              </div>
            ) : null}
            {conversionSkipped.length > 0 ? (
              <div style={{ color: "var(--danger-text)" }}>
                Not added: {conversionSkipped.join("; ")}
              </div>
            ) : null}
            {shortfalls.length > 0 ? (
              <div style={{ color: "var(--danger-text)", fontWeight: 600 }}>
                Not enough stock, reduce or remove: {shortfalls.join("; ")}
              </div>
            ) : null}
          </div>
        ) : null}

        <div style={{ flex: 1, overflowY: "auto" }}>
          {cart.length === 0 ? (
            <div
              style={{
                padding: "34px 12px",
                textAlign: "center",
                color: "var(--muted)",
                fontSize: 12,
              }}
            >
              No items — tap a product to add
            </div>
          ) : (
            cart.map((item, lineIndex) => {
              const le = lineErrors.get(lineIndex);
              const lineMsg = le
                ? ["quantity", "unitPrice", "productId", "productUnitId", "lineDiscount", "lineTax"]
                    .map((k) => le[k])
                    .filter(Boolean)
                    .join(" ")
                : "";
              return (
                <div
                  key={cartLineKey(item)}
                  style={{ borderBottom: "1px solid var(--surface-subtle)" }}
                >
                  <div
                    style={{
                      padding: "8px 10px",
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 12.5,
                          fontWeight: 500,
                          color: "var(--text)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {item.name}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>
                        {fmt(item.price)}/{item.unit}
                        {item.quote ? ` · quoted ${item.quote.quotedQty}` : ""}
                      </div>
                      {item.quote && item.qty > item.stock + 1e-9 ? (
                        <div style={{ fontSize: 11, color: "var(--danger-text)" }}>
                          Only {Number(item.stock.toFixed(4))} {item.unit} in stock
                        </div>
                      ) : null}
                      {item.avgCost != null &&
                        item.avgCost > 0 &&
                        item.price < item.avgCost && (
                          <div className="pos-cart-line__warn">
                            Below cost ({fmt(item.avgCost)})
                          </div>
                        )}
                    </div>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 5 }}
                    >
                      <button
                        type="button"
                        onClick={() => updateQty(cartLineKey(item), item.qty - 1)}
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 6,
                          border: "1px solid var(--border)",
                          background: "var(--surface-subtle)",
                          cursor: "pointer",
                          fontSize: 13,
                          fontWeight: 700,
                          color: "var(--text)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min={item.allowsFractionalSale ? 0.0001 : 1}
                        step={item.allowsFractionalSale ? "any" : 1}
                        value={item.qty}
                        onChange={(e) =>
                          updateQty(cartLineKey(item), Number(e.target.value))
                        }
                        style={{
                          width: 44,
                          height: 22,
                          textAlign: "center",
                          border: lineErrDetail(lineIndex, "quantity")
                            ? "1px solid var(--input-error-border)"
                            : "1px solid var(--border)",
                          borderRadius: 6,
                          fontSize: 12,
                          outline: "none",
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => updateQty(cartLineKey(item), item.qty + 1)}
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 6,
                          border: "1px solid var(--border)",
                          background: "var(--surface-subtle)",
                          cursor: "pointer",
                          fontSize: 13,
                          fontWeight: 700,
                          color: "var(--text)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        +
                      </button>
                    </div>
                    <div
                      style={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        fontFamily: "monospace",
                        minWidth: 66,
                        textAlign: "right",
                      }}
                    >
                      {fmt(item.price * item.qty)}
                    </div>
                  </div>
                  {lineMsg ? (
                    <div
                      style={{
                        padding: "0 14px 8px",
                        fontSize: 11,
                        color: "var(--danger)",
                      }}
                    >
                      {lineMsg}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        <div
          style={{
            borderTop: "1px solid var(--border)",
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                color: "var(--muted)",
                marginBottom: 6,
              }}
            >
              Customer
            </div>
            {posCustomerId ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "10px 12px",
                  background: "var(--surface-subtle)",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  marginBottom: 8,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: "var(--text)",
                      lineHeight: 1.3,
                    }}
                  >
                    {customers.find((x) => x.id === posCustomerId)?.name ??
                      "Customer"}
                  </div>
                  {(() => {
                    const sel = customers.find((x) => x.id === posCustomerId);
                    const ph = sel?.phone;
                    const gst = sel?.partyGstNo?.trim();
                    const pst = sel?.partyState?.trim();
                    return (
                      <>
                        {ph ? (
                          <div
                            style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}
                          >
                            {ph}
                          </div>
                        ) : null}
                        {posTaxInvoice && gst ? (
                          <div
                            style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}
                          >
                            Party GST No: {gst}
                          </div>
                        ) : null}
                        {posTaxInvoice && pst ? (
                          <div
                            style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}
                          >
                            State: {pst}
                          </div>
                        ) : null}
                      </>
                    );
                  })()}
                </div>
                <button
                  type="button"
                  onClick={() => clearRegisteredCustomer()}
                  style={{
                    flexShrink: 0,
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--accent)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: "4px 0",
                  }}
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <div style={{ position: "relative", marginBottom: 8 }}>
                  <input
                    placeholder="Search by name or phone, or enter walk-in name"
                    value={customerQuery}
                    onChange={(e) => {
                      setCustomerQuery(e.target.value);
                      setCustomerSuggestOpen(true);
                    }}
                    onFocus={() => setCustomerSuggestOpen(true)}
                    onBlur={() => {
                      window.setTimeout(
                        () => setCustomerSuggestOpen(false),
                        200
                      );
                    }}
                    autoComplete="off"
                    style={{
                      ...inputStyle,
                      width: "100%",
                      boxSizing: "border-box",
                      fontSize: 12,
                      height: 36,
                    }}
                  />
                  {customerSuggestOpen &&
                  customerQuery.trim() &&
                  typeaheadMatches.length > 0 ? (
                    <div
                      style={{
                        position: "absolute",
                        top: "100%",
                        left: 0,
                        right: 0,
                        marginTop: 4,
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
                        maxHeight: 220,
                        overflowY: "auto",
                        zIndex: 30,
                      }}
                    >
                      {typeaheadMatches.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => pickRegisteredCustomer(c)}
                          style={{
                            display: "block",
                            width: "100%",
                            textAlign: "left",
                            padding: "10px 12px",
                            border: "none",
                            borderBottom: "1px solid var(--surface-subtle)",
                            background: "var(--surface)",
                            cursor: "pointer",
                            fontSize: 13,
                          }}
                        >
                          <div style={{ fontWeight: 600, color: "var(--text)" }}>
                            {c.name}
                          </div>
                          {c.phone ? (
                            <div style={{ fontSize: 11, color: "var(--muted)" }}>
                              {c.phone}
                            </div>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="tel"
                  maxLength={10}
                  placeholder="10-digit mobile (optional if paying in full; required if balance due)"
                  value={walkInPhone}
                  onChange={(e) => {
                    setWalkInPhone(sanitizePhoneDigits(e.target.value));
                    if (customerPhoneError) setCustomerPhoneError(null);
                  }}
                  style={{
                    ...inputStyle,
                    width: "100%",
                    boxSizing: "border-box",
                    fontSize: 12,
                    height: 32,
                    marginBottom: 8,
                  }}
                />
                {posTaxInvoice ? (
                  <>
                    <label
                      style={{
                        display: "block",
                        fontSize: 11,
                        color: "var(--muted)",
                        marginBottom: 4,
                      }}
                    >
                      Party GST No
                    </label>
                    <input
                      type="text"
                      autoComplete="off"
                      placeholder="Letters and digits only (optional)"
                      maxLength={20}
                      value={walkInPartyGstNo}
                      onChange={(e) =>
                        setWalkInPartyGstNo(sanitizeGstinInput(e.target.value, 20))
                      }
                      style={{
                        ...inputStyle,
                        width: "100%",
                        boxSizing: "border-box",
                        fontSize: 12,
                        height: 32,
                        marginBottom: 8,
                      }}
                    />
                    <label
                      style={{
                        display: "block",
                        fontSize: 11,
                        color: "var(--muted)",
                        marginBottom: 4,
                      }}
                    >
                      State
                    </label>
                    <input
                      placeholder="Optional"
                      value={walkInPartyState}
                      onChange={(e) => setWalkInPartyState(e.target.value)}
                      style={{
                        ...inputStyle,
                        width: "100%",
                        boxSizing: "border-box",
                        fontSize: 12,
                        height: 32,
                        marginBottom: 8,
                      }}
                    />
                  </>
                ) : null}
                {customerPhoneError ? (
                  <div style={{ fontSize: 12, color: "var(--danger)", marginBottom: 8 }}>
                    {customerPhoneError}
                  </div>
                ) : null}
                {customerQuery.trim() ? (
                  <button
                    type="button"
                    onClick={() => void saveCustomerFromWalkIn()}
                    disabled={savingCustomer}
                    style={{
                      width: "100%",
                      height: 36,
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: savingCustomer ? "not-allowed" : "pointer",
                      background: savingCustomer ? "var(--input-disabled)" : "var(--surface-subtle)",
                      color: savingCustomer ? "var(--text-faint)" : "var(--text-strong)",
                    }}
                  >
                    {savingCustomer ? "Saving…" : "Save customer"}
                  </button>
                ) : null}
              </>
            )}
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 13,
              color: "var(--muted)",
            }}
          >
            <span>Subtotal</span>
            <span style={{ fontFamily: "monospace" }}>{fmt(subtotal)}</span>
          </div>
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              cursor: loading ? "not-allowed" : "pointer",
              userSelect: "none",
              fontSize: 12,
              color: "var(--text)",
              lineHeight: 1.35,
              opacity: loading ? 0.7 : 1,
            }}
          >
            <input
              type="checkbox"
              checked={posTaxInvoice}
              disabled={loading || convertingQuotation != null}
              onChange={(e) => setPosTaxInvoice(e.target.checked)}
              style={{
                width: 16,
                height: 16,
                marginTop: 2,
                cursor: loading || convertingQuotation ? "not-allowed" : "pointer",
                flexShrink: 0,
              }}
            />
            <span>
              Tax invoice
              {convertingQuotation
                ? posTaxInvoice
                  ? " (set by the quotation: GST included)"
                  : " (set by the quotation: no GST, so a plain bill)"
                : ""}
            </span>
          </label>
          {convertingQuotation ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, color: "var(--muted)", flex: 1 }}>
                Quotation discount
              </span>
              <span
                style={{
                  fontSize: 13,
                  color: "var(--danger)",
                  fontFamily: "monospace",
                  minWidth: 64,
                  textAlign: "right",
                }}
              >
                −{fmt(quoteDiscountAmt)}
              </span>
            </div>
          ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 13, color: "var(--muted)", flex: 1 }}>
              Discount %
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={discount === 0 ? "" : discount}
              onFocus={(e) => e.currentTarget.select()}
              onClick={(e) => e.currentTarget.select()}
              onChange={(e) =>
                setDiscount(
                  e.target.value.trim() === ""
                    ? 0
                    : Math.max(0, Math.min(100, Number(e.target.value)))
                )
              }
              placeholder="0"
              style={{
                width: 58,
                height: 30,
                textAlign: "center",
                border: "1px solid var(--border)",
                borderRadius: 6,
                fontSize: 13,
                outline: "none",
              }}
            />
            <span
              style={{
                fontSize: 13,
                color: "var(--danger)",
                fontFamily: "monospace",
                minWidth: 64,
                textAlign: "right",
              }}
            >
              −{fmt(discountAmt)}
            </span>
          </div>
          )}
          {promotionsUi && !convertingQuotation ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label style={{ fontSize: 13, color: "var(--muted)", flex: 1 }}>
                  Promotion code
                </label>
                <input
                  placeholder="e.g. NEW10"
                  value={promotionCode}
                  onChange={(e) => setPromotionCode(e.target.value.toUpperCase())}
                  style={{
                    width: 120,
                    height: 30,
                    textAlign: "center",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    fontSize: 12,
                    outline: "none",
                  }}
                />
                <span
                  style={{
                    fontSize: 13,
                    color: "var(--danger)",
                    fontFamily: "monospace",
                    minWidth: 64,
                    textAlign: "right",
                  }}
                >
                  −{fmt(cartPromoAmt)}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 12,
                  color: "var(--muted)",
                }}
              >
                <span>Product/category promotions</span>
                <span style={{ fontFamily: "monospace", color: "var(--danger)" }}>
                  −{fmt(productCategoryPromoAmt)}
                </span>
              </div>
            </>
          ) : null}
          {posTaxInvoice && posGstTotals ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                padding: "8px 0",
                borderTop: "1px dashed var(--border)",
                borderBottom: "1px dashed var(--border)",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "var(--muted)",
                }}
              >
                GST
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 13,
                  color: "var(--text)",
                }}
              >
                <span>CGST@ %</span>
                <span style={{ fontFamily: "monospace" }}>{fmt(posGstTotals.cgst)}</span>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 13,
                  color: "var(--text)",
                }}
              >
                <span>SGST@ %</span>
                <span style={{ fontFamily: "monospace" }}>{fmt(posGstTotals.sgst)}</span>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 13,
                  color: "var(--text)",
                }}
              >
                <span>IGST@ %</span>
                <span style={{ fontFamily: "monospace" }}>{fmt(posGstTotals.igst)}</span>
              </div>
            </div>
          ) : null}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 13, color: "var(--muted)", flex: 1 }}>
              Transport (₹)
            </label>
            <input
              type="number"
              min={0}
              step={0.01}
              value={transportStr}
              onChange={(e) => setTransportStr(e.target.value)}
              placeholder="0"
              disabled={loading}
              style={{
                width: 100,
                height: 32,
                textAlign: "right",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 13,
                outline: "none",
                background: "var(--surface)",
                color: "var(--text)",
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 18,
              fontWeight: 700,
            }}
          >
            <span>Total</span>
            <span style={{ fontFamily: "monospace", color: "var(--accent)" }}>
              {fmt(grandTotal)}
            </span>
          </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>
              Payment method
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              {(
                [
                  ["cash", "Cash"],
                  ["online_banking", "Online banking"],
                ] as const
              ).map(([value, label]) => {
                const selected = posPaymentMethod === value;
                return (
                  <button
                    key={value}
                    type="button"
                    disabled={loading}
                    onClick={() => setPosPaymentMethod(value)}
                    style={{
                      flex: 1,
                      height: 38,
                      borderRadius: 8,
                      border: selected
                        ? "1px solid var(--accent)"
                        : "1px solid var(--border)",
                      background: selected ? "var(--accent)" : "var(--surface)",
                      color: selected ? "var(--surface)" : "var(--text-strong)",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: loading ? "not-allowed" : "pointer",
                      opacity: loading ? 0.7 : 1,
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              cursor: loading ? "not-allowed" : "pointer",
              userSelect: "none",
              fontSize: 12,
              color: "var(--text)",
              lineHeight: 1.35,
              opacity: loading ? 0.7 : 1,
            }}
          >
            <input
              type="checkbox"
              checked={posSplitPayment}
              disabled={loading}
              onChange={(e) => {
                const on = e.target.checked;
                if (on) {
                  const received = parseMoneyField(amountPaidStr);
                  if (received != null && received > 0) {
                    if (posPaymentMethod === "cash") {
                      setPosCashStr(received.toFixed(2));
                      setPosOnlineStr("");
                    } else {
                      setPosCashStr("");
                      setPosOnlineStr(received.toFixed(2));
                    }
                  } else {
                    setPosCashStr("");
                    setPosOnlineStr("");
                  }
                } else {
                  const cash = parseMoneyField(posCashStr) ?? 0;
                  const online = parseMoneyField(posOnlineStr) ?? 0;
                  const sum = Math.max(0, cash) + Math.max(0, online);
                  setAmountPaidStr(
                    sum > 0 ? sum.toFixed(2) : grandTotal > 0 ? grandTotal.toFixed(2) : "0.00"
                  );
                }
                setPosSplitPayment(on);
              }}
              style={{
                width: 16,
                height: 16,
                marginTop: 2,
                cursor: loading ? "not-allowed" : "pointer",
                flexShrink: 0,
              }}
            />
            <span>Split payment (cash + online banking)</span>
          </label>
          {posSplitPayment ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", lineHeight: 1.4 }}>
                Enter only what is collected now. Any shortfall stays as balance due.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>Cash (₹)</label>
                <input type="number" min={0} step={0.01} value={posCashStr} onChange={(e) => setPosCashStr(e.target.value)} placeholder="0" disabled={loading} style={{ ...inputStyle, width: "100%", boxSizing: "border-box", fontSize: 14, height: 40 }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>Online banking (₹)</label>
                <input type="number" min={0} step={0.01} value={posOnlineStr} onChange={(e) => setPosOnlineStr(e.target.value)} placeholder="0" disabled={loading} style={{ ...inputStyle, width: "100%", boxSizing: "border-box", fontSize: 14, height: 40 }} />
              </div>
              {(() => {
                const cash = parseMoneyField(posCashStr);
                const online = parseMoneyField(posOnlineStr);
                if (cash == null || online == null || cash < 0 || online < 0) return null;
                const received = Math.round((Math.max(0, cash) + Math.max(0, online)) * 100) / 100;
                const due = Math.max(0, grandTotal - received);
                return (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--muted)" }}>
                      <span>Total received</span>
                      <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{fmt(received)}</span>
                    </div>
                    {due >= 0.005 ? (
                      <div style={{ fontSize: 13, color: "var(--accent)", fontWeight: 600 }}>Balance due: {fmt(due)}</div>
                    ) : null}
                  </>
                );
              })()}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>Amount received</label>
              <input type="number" min={0} step={0.01} value={amountPaidStr} onChange={(e) => setAmountPaidStr(e.target.value)} style={{ ...inputStyle, width: "100%", boxSizing: "border-box", fontSize: 14, height: 40 }} />
              {(() => {
                const p = parseMoneyField(amountPaidStr);
                if (p == null || p < 0) return null;
                const due = Math.max(0, grandTotal - Math.min(grandTotal, p));
                if (due < 0.005) return null;
                return (
                  <div style={{ fontSize: 13, color: "var(--accent)", fontWeight: 600 }}>Balance due: {fmt(due)}</div>
                );
              })()}
            </div>
          )}
          {fieldErrors.paidAmount ? (
            <div style={{ fontSize: 12, color: "var(--danger)" }}>
              paidAmount: {fieldErrors.paidAmount}
            </div>
          ) : null}

          <FormErrorBanner text={saleFormBanner} />
          <Toast status={status} />

          <button
            type="button"
            onClick={handleCheckout}
            disabled={!cart.length || loading}
            style={{
              height: 44,
              borderRadius: 10,
              border: "none",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
              background: cart.length ? "var(--accent)" : "var(--border)",
              color: cart.length ? "var(--surface)" : "var(--text-faint)",
              transition: "background 0.15s",
            }}
          >
            {loading ? "Processing..." : "Confirm Sale"}
          </button>
        </div>
      </div>
    </div>
    </>
  );
}


const PURCHASE_INLINE_ERROR_KEYS = new Set([
  "supplierId",
  "invoiceDate",
  "note",
]);

/** Max purchase lines from one CSV/Excel file (matches batch safety). */
const MAX_PURCHASE_IMPORT_ROWS = 1500;
/** Above this count, show a summary instead of one form row per line (keeps the tab responsive). */
const PURCHASE_LINE_UI_CAP = 40;

function newPurchaseLineRow(): {
  key: string;
  productId: string;
  quantity: string;
  unitCost: string;
  lineNote: string;
} {
  return {
    key:
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `pl-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    productId: "",
    quantity: "",
    unitCost: "",
    lineNote: "",
  };
}


// ═══════════════════════════════════════════════════════════════════
// PURCHASE VIEW
// ═══════════════════════════════════════════════════════════════════
function PurchaseView({
  products,
  suppliers,
  actingUserId,
  onPurchaseComplete,
  refreshSuppliers,
  isAdminUser = false,
}: {
  products: UiProduct[];
  suppliers: ApiSupplier[];
  actingUserId: string;
  onPurchaseComplete: () => Promise<void>;
  refreshSuppliers: () => Promise<void>;
  /** Admin / manager: supplier payment register */
  isAdminUser?: boolean;
}) {
  const [form, setForm] = useState(() => ({
    supplierId: "",
    lines: [newPurchaseLineRow()],
    purchaseDate: ymdInIndia(),
    notes: "",
  }));
  const [status, setStatus] = useState<{
    type: "success" | "error";
    msg: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [lineFieldErrors, setLineFieldErrors] = useState<
    Map<number, Record<string, string>>
  >(() => new Map());
  const purchaseImportRef = useRef<HTMLInputElement>(null);
  const [importBanner, setImportBanner] = useState<string | null>(null);
  const [purchaseImportBusy, setPurchaseImportBusy] = useState(false);
  const [purchaseImportProgress, setPurchaseImportProgress] = useState<string | null>(
    null
  );

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
  );
  const isBulkPurchaseImport = form.lines.length > PURCHASE_LINE_UI_CAP;

  const newSupplierEmpty = useMemo(
    () => ({
      name: "",
      contactPerson: "",
      phone: "",
      email: "",
      address: "",
      gstNumber: "",
      note: "",
    }),
    []
  );
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [newSupplier, setNewSupplier] = useState(newSupplierEmpty);
  const [creatingSupplier, setCreatingSupplier] = useState(false);
  const [newSupplierErrors, setNewSupplierErrors] = useState<
    Record<string, string>
  >({});
  const [supplierPanelMsg, setSupplierPanelMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const [payRows, setPayRows] = useState<PurchaseListRow[]>([]);
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<PurchaseListRow | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payNote, setPayNote] = useState("");
  const [payPaidAt, setPayPaidAt] = useState("");
  const [payLoadingSubmit, setPayLoadingSubmit] = useState(false);
  const [payMsg, setPayMsg] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);

  const loadPayables = useCallback(async () => {
    if (!isAdminUser) return;
    setPayLoading(true);
    setPayError(null);
    try {
      const data = await api.getPurchases({ owingOnly: true, limit: 200 });
      setPayRows(data.purchases);
    } catch (e) {
      setPayError(isApiError(e) ? e.message : "Failed to load supplier payables");
      setPayRows([]);
    } finally {
      setPayLoading(false);
    }
  }, [isAdminUser]);

  useEffect(() => {
    void loadPayables();
  }, [loadPayables]);

  useEffect(() => {
    if (payFor) {
      setPayAmount(Number(payFor.balanceAmount).toFixed(2));
      setPayNote("");
      setPayPaidAt(ymdInIndia());
      setPayMsg(null);
    }
  }, [payFor]);

  useEffect(() => {
    setFieldErrors({});
    setLineFieldErrors(new Map());
  }, [form.supplierId, form.purchaseDate, form.notes, form.lines]);

  useEffect(() => {
    setNewSupplierErrors({});
  }, [newSupplier]);

  const purchaseFormBanner = useMemo(() => {
    const extra = Object.entries(fieldErrors).filter(
      ([k]) => !PURCHASE_INLINE_ERROR_KEYS.has(k)
    );
    if (extra.length === 0) return undefined;
    return extra.map(([k, v]) => `${k}: ${v}`).join(" · ");
  }, [fieldErrors]);

  const setLine = (
    index: number,
    patch: Partial<{
      productId: string;
      quantity: string;
      unitCost: string;
      lineNote: string;
    }>
  ) => {
    setForm((f) => ({
      ...f,
      lines: f.lines.map((ln, i) => (i === index ? { ...ln, ...patch } : ln)),
    }));
  };

  const addPurchaseLine = () => {
    setForm((f) => ({ ...f, lines: [...f.lines, newPurchaseLineRow()] }));
  };

  const removePurchaseLine = (index: number) => {
    setForm((f) => {
      if (f.lines.length <= 1) {
        return { ...f, lines: [newPurchaseLineRow()] };
      }
      return { ...f, lines: f.lines.filter((_, i) => i !== index) };
    });
  };

  const clearBulkPurchaseLines = () => {
    setForm((f) => ({
      ...f,
      lines: [newPurchaseLineRow()],
    }));
    setImportBanner(null);
    setLineFieldErrors(new Map());
  };

  const downloadPurchaseImportTemplate = () => {
    const bom = "\uFEFF";
    const blob = new Blob([bom + PURCHASE_IMPORT_TEMPLATE_CSV], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "purchase-lines-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePurchaseImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportBanner(null);
    setPurchaseImportBusy(true);
    setPurchaseImportProgress(null);
    try {
      await paintBeforeWork();
      const {
        patches,
        patchSourceRows,
        rowErrors,
        skippedBlankRows,
        hasSupplierColumn,
      } = await parsePurchaseLinesImportFile(file);
      const capped = patches.slice(0, MAX_PURCHASE_IMPORT_ROWS);
      const cappedRows = patchSourceRows.slice(0, MAX_PURCHASE_IMPORT_ROWS);
      setPurchaseImportProgress(
        capped.length > 0
          ? `Matching ${capped.length} row${capped.length !== 1 ? "s" : ""} to your catalog…`
          : null
      );
      await paintBeforeWork();
      const {
        lines: importedLines,
        unresolved,
        supplierUnresolved,
        resolvedSupplierId,
      } = await resolvePurchaseImportPatchesAsync(
        capped,
        products,
        cappedRows,
        {
          suppliers,
          hasSupplierColumn,
          defaultSupplierId: form.supplierId || null,
        },
        (done, total) => {
          setPurchaseImportProgress(`Matched ${done} of ${total} rows…`);
        }
      );
      if (importedLines.length === 0) {
        const msg =
          supplierUnresolved.length > 0
            ? supplierUnresolved.map((u) => `Row ${u.row}: ${u.message}`).join("\n")
            : unresolved.length > 0
              ? unresolved.map((u) => `Row ${u.row}: ${u.message}`).join("\n")
              : rowErrors.length > 0
                ? rowErrors.map((r) => `Row ${r.row}: ${r.message}`).join("\n")
                : "No valid lines. Check headers: brand code and/or product name, quantity, unit cost.";
        window.alert(msg);
        return;
      }
      setForm((f) => {
        const sole = f.lines.length === 1;
        const emptyRow =
          sole &&
          !f.lines[0].productId &&
          !String(f.lines[0].quantity).trim() &&
          !String(f.lines[0].unitCost).trim();
        const nextLines = emptyRow ? importedLines : [...f.lines, ...importedLines];
        return {
          ...f,
          lines: nextLines,
          supplierId: resolvedSupplierId ?? f.supplierId,
          purchaseDate: ymdInIndia(),
        };
      });
      const parts = [
        `Imported ${importedLines.length} line(s). Review and record purchase when ready.`,
      ];
      if (resolvedSupplierId) {
        const sn = suppliers.find((s) => s.id === resolvedSupplierId)?.name;
        if (sn) {
          parts.push(`Supplier set to “${sn}”.`);
        }
      }
      if (patches.length > MAX_PURCHASE_IMPORT_ROWS) {
        parts.push(`Only the first ${MAX_PURCHASE_IMPORT_ROWS} data rows were loaded.`);
      }
      if (skippedBlankRows > 0) {
        parts.push(`${skippedBlankRows} blank row(s) skipped.`);
      }
      if (rowErrors.length > 0) {
        parts.push(
          `Notes: ${rowErrors.map((r) => `row ${r.row}: ${r.message}`).join("; ")}`
        );
      }
      if (unresolved.length > 0) {
        const shown = unresolved
          .slice(0, 5)
          .map((u) => `row ${u.row}: ${u.message}`)
          .join("; ");
        const more =
          unresolved.length > 5 ? ` (+${unresolved.length - 5} more not imported)` : "";
        parts.push(`Not imported: ${shown}${more}`);
      }
      setImportBanner(parts.join(" "));
      setStatus(null);
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : "Could not read that file."
      );
    } finally {
      setPurchaseImportBusy(false);
      setPurchaseImportProgress(null);
    }
  };

  const duplicateSupplierMsg =
    "This supplier already exists. Select it from the dropdown or enter a different name.";
  const normalizedNewSupplierName = newSupplier.name.trim().toLocaleLowerCase();
  const matchingSupplier = useMemo(() => {
    if (!normalizedNewSupplierName) return undefined;
    return suppliers.find(
      (s) => s.name.trim().toLocaleLowerCase() === normalizedNewSupplierName
    );
  }, [normalizedNewSupplierName, suppliers]);

  const setNewSupplierField = (
    k: keyof typeof newSupplierEmpty,
    v: string
  ) => {
    const next =
      k === "phone"
        ? sanitizePhoneDigits(v)
        : k === "gstNumber"
          ? sanitizeGstinInput(v, 50)
          : v;
    setNewSupplier((s) => ({ ...s, [k]: next }));
    if (k === "name") {
      setForm((f) => {
        if (!f.supplierId) return f;
        const selected = suppliers.find((s) => s.id === f.supplierId);
        if (!selected) return f;
        const selectedName = selected.name.trim().toLocaleLowerCase();
        if (selectedName !== v.trim().toLocaleLowerCase()) return f;
        return { ...f, supplierId: "" };
      });
    }
    setSupplierPanelMsg(null);
  };

  const handleCreateSupplier = async () => {
    if (creatingSupplier) return;
    const trimmedName = newSupplier.name.trim();
    if (!trimmedName) {
      setNewSupplierErrors({ name: "Name is required" });
      return;
    }
    if (matchingSupplier) {
      setNewSupplierErrors({ name: duplicateSupplierMsg });
      setForm((f) => ({ ...f, supplierId: matchingSupplier.id }));
      return;
    }
    const supplierPhoneDigits = sanitizePhoneDigits(newSupplier.phone);
    if (supplierPhoneDigits.length > 0 && supplierPhoneDigits.length !== 10) {
      setNewSupplierErrors({ phone: "Phone must be exactly 10 digits." });
      return;
    }
    setCreatingSupplier(true);
    setNewSupplierErrors({});
    setSupplierPanelMsg(null);
    try {
      const s = await api.createSupplier({
        name: trimmedName,
        contactPerson: newSupplier.contactPerson.trim() || undefined,
        phone: supplierPhoneDigits.length === 10 ? supplierPhoneDigits : undefined,
        email: newSupplier.email.trim() || undefined,
        address: newSupplier.address.trim() || undefined,
        gstNumber: sanitizeGstinInput(newSupplier.gstNumber, 50) || undefined,
        note: newSupplier.note.trim() || undefined,
      });
      await refreshSuppliers();
      setForm((f) => ({ ...f, supplierId: s.id }));
      setNewSupplier({ ...newSupplierEmpty });
      setShowAddSupplier(false);
      setSupplierPanelMsg({
        type: "success",
        text: `“${s.name}” added and selected.`,
      });
    } catch (e) {
      if (isApiError(e)) {
        if (
          e.status === 409 &&
          (e.code === "SUPPLIER_ALREADY_EXISTS" || e.field === "supplierName")
        ) {
          setNewSupplierErrors({ name: duplicateSupplierMsg });
          const conflictMatch = suppliers.find(
            (s) => s.name.trim().toLocaleLowerCase() === trimmedName.toLocaleLowerCase()
          );
          if (conflictMatch) {
            setForm((f) => ({ ...f, supplierId: conflictMatch.id }));
          }
          return;
        }
        const fe: Record<string, string> = {};
        for (const d of e.details ?? []) {
          if (!fe[d.field]) fe[d.field] = d.message;
        }
        setNewSupplierErrors(fe);
        setSupplierPanelMsg({ type: "error", text: e.message });
      } else {
        setSupplierPanelMsg({
          type: "error",
          text: e instanceof Error ? e.message : "Could not create supplier",
        });
      }
    } finally {
      setCreatingSupplier(false);
    }
  };

  const totalCost = useMemo(() => {
    return form.lines.reduce((sum, ln) => {
      const q = Number(ln.quantity) || 0;
      const c = Number(ln.unitCost) || 0;
      return sum + q * c;
    }, 0);
  }, [form.lines]);

  const handleSubmit = async () => {
    if (loading) return;
    setLoading(true);
    setStatus(null);
    setFieldErrors({});
    setLineFieldErrors(new Map());
    try {
      await paintBeforeWork();
      const linesPayload = form.lines.map((ln) => {
        const p = products.find((x) => x.id === ln.productId);
        return {
          productId: ln.productId,
          productUnitId: p?.baseUnitId ?? "",
          quantity: Number(ln.quantity),
          unitCost: Number(ln.unitCost),
        };
      });
      const headerNote = form.notes.trim();
      const lineNoteParts = form.lines
        .map((ln, i) => {
          const t = ln.lineNote.trim();
          if (!t) return null;
          const p = products.find((x) => x.id === ln.productId);
          return `${i + 1}. ${p?.name ?? "Line"}: ${t}`;
        })
        .filter((x): x is string => x != null);
      let combinedNote: string | undefined;
      if (headerNote && lineNoteParts.length > 0) {
        combinedNote = `${headerNote}\n\n— Line notes —\n${lineNoteParts.join("\n")}`;
      } else if (headerNote) {
        combinedNote = headerNote;
      } else if (lineNoteParts.length > 0) {
        combinedNote = `— Line notes —\n${lineNoteParts.join("\n")}`;
      } else {
        combinedNote = undefined;
      }
      const NOTE_MAX = 5000;
      if (combinedNote && combinedNote.length > NOTE_MAX) {
        combinedNote = `${combinedNote.slice(0, NOTE_MAX - 20)}\n… (truncated)`;
      }
      const purchase = await api.createPurchase({
        supplierId: form.supplierId,
        createdById: actingUserId,
        invoiceDate: form.purchaseDate || undefined,
        note: combinedNote,
        lines: linesPayload,
      });
      setStatus({
        type: "success",
        msg: `Purchase recorded — ${purchase.purchaseNumber}`,
      });
      setForm({
        supplierId: "",
        lines: [newPurchaseLineRow()],
        purchaseDate: ymdInIndia(),
        notes: "",
      });
      setImportBanner(null);
      await onPurchaseComplete();
      if (isAdminUser) void loadPayables();
      setTimeout(() => setStatus(null), 4000);
    } catch (e) {
      if (isApiError(e)) {
        setFieldErrors(recordFieldErrors(e.details));
        setLineFieldErrors(lineErrorsFromDetails(e.details));
        setStatus({ type: "error", msg: e.message });
      } else {
        setStatus({
          type: "error",
          msg: e instanceof Error ? e.message : "Purchase failed",
        });
      }
      setTimeout(() => setStatus(null), 6000);
    } finally {
      setLoading(false);
    }
  };

  const submitSupplierPayment = async () => {
    if (!payFor || !actingUserId) return;
    const amt = Number.parseFloat(payAmount.replace(/,/g, ""));
    if (!Number.isFinite(amt) || amt <= 0) {
      setPayMsg({ type: "err", text: "Enter a valid payment amount." });
      return;
    }
    const maxBal = Number(payFor.balanceAmount);
    if (amt > maxBal + 1e-6) {
      setPayMsg({
        type: "err",
        text: "Amount cannot exceed balance owed to supplier.",
      });
      return;
    }
    setPayLoadingSubmit(true);
    setPayMsg(null);
    try {
      await api.recordPurchasePayment(payFor.id, {
        amount: amt,
        createdById: actingUserId,
        note: payNote.trim() || undefined,
        paidAt: payPaidAt.trim()
          ? new Date(`${payPaidAt.trim()}T12:00:00`).toISOString()
          : undefined,
      });
      setPayFor(null);
      await loadPayables();
    } catch (e) {
      setPayMsg({
        type: "err",
        text: isApiError(e) ? e.message : "Payment failed",
      });
    } finally {
      setPayLoadingSubmit(false);
    }
  };

  return (
  <>
    <BusyOverlay
      open={purchaseImportBusy}
      title="Reading import file…"
      subtitle={
        purchaseImportProgress ??
        "Matching products and suppliers from your spreadsheet."
      }
    />
    <BusyOverlay
      open={loading}
      title="Recording purchase…"
      subtitle={
        form.lines.length > 0
          ? `Saving ${form.lines.length} line${form.lines.length !== 1 ? "s" : ""} — please keep this tab open.`
          : "Please keep this tab open."
      }
    />
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 28,
        maxWidth: 960,
        width: "100%",
      }}
    >
    <div style={{ maxWidth: 560 }}>
      <div
        style={{
          background: "var(--surface)",
          borderRadius: 12,
          border: "1px solid var(--border)",
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            borderBottom: "1px solid var(--border)",
            paddingBottom: 14,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 16 }}>New Purchase Entry</div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              alignItems: "center",
            }}
          >
            <input
              ref={purchaseImportRef}
              type="file"
              accept=".csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
              style={{ display: "none" }}
              onChange={(e) => void handlePurchaseImportFile(e)}
            />
            <button
              type="button"
              onClick={() => purchaseImportRef.current?.click()}
              disabled={purchaseImportBusy || loading}
              style={{
                height: 34,
                padding: "0 12px",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                color: purchaseImportBusy || loading ? "var(--text-faint)" : "var(--text-strong)",
                cursor: purchaseImportBusy || loading ? "not-allowed" : "pointer",
              }}
            >
              {purchaseImportBusy ? "Importing…" : "Import CSV / Excel"}
            </button>
            <button
              type="button"
              onClick={downloadPurchaseImportTemplate}
              style={{
                height: 34,
                padding: "0 12px",
                background: "var(--surface-subtle)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                color: "var(--muted)",
                cursor: "pointer",
              }}
            >
              Download template
            </button>
          </div>
        </div>

        <FieldWrap label="Supplier *" error={fieldErrors.supplierId}>
          <select
            value={form.supplierId}
            onChange={(e) => {
              setForm((f) => ({ ...f, supplierId: e.target.value }));
              if (e.target.value) {
                setNewSupplierErrors((prev) => {
                  if (!prev.name) return prev;
                  const next = { ...prev };
                  delete next.name;
                  return next;
                });
              }
            }}
            style={{ ...inputStyle, padding: "0 10px", cursor: "pointer" }}
          >
            <option value="">— Select supplier —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {matchingSupplier?.id === s.id
                  ? `${s.name} (matches new supplier name)`
                  : s.name}
              </option>
            ))}
          </select>
        </FieldWrap>

        {supplierPanelMsg && (
          <div
            style={{
              fontSize: 13,
              color:
                supplierPanelMsg.type === "success" ? "var(--accent)" : "var(--danger)",
            }}
          >
            {supplierPanelMsg.text}
          </div>
        )}

        <div>
          <button
            type="button"
            onClick={() => {
              setShowAddSupplier((v) => !v);
              setSupplierPanelMsg(null);
            }}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              fontSize: 13,
              fontWeight: 600,
              color: "var(--accent)",
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            {showAddSupplier ? "Hide new supplier form" : "+ Add new supplier"}
          </button>
        </div>

        {showAddSupplier && (
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: 16,
              background: "var(--surface-subtle)",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text-strong)",
              }}
            >
              New supplier
            </div>
            <FieldWrap
              label="Name *"
              error={newSupplierErrors.name}
              errorId="new-supplier-name-error"
            >
              <input
                value={newSupplier.name}
                onBlur={() => {
                  if (matchingSupplier) {
                    setNewSupplierErrors({ name: duplicateSupplierMsg });
                  }
                }}
                onChange={(e) =>
                  setNewSupplierField("name", e.target.value)
                }
                placeholder="Supplier name"
                aria-invalid={Boolean(newSupplierErrors.name)}
                aria-describedby={
                  newSupplierErrors.name ? "new-supplier-name-error" : undefined
                }
                style={{
                  ...inputStyle,
                  borderColor: newSupplierErrors.name ? "var(--input-error-border)" : "var(--border)",
                }}
              />
            </FieldWrap>
            {matchingSupplier && !newSupplierErrors.name && (
              <div
                style={{
                  background: "var(--stock-low-bg)",
                  color: "var(--caution-text)",
                  borderRadius: 8,
                  padding: "8px 10px",
                  fontSize: 12,
                }}
              >
                Similar existing supplier found: <strong>{matchingSupplier.name}</strong>
                . You can select it from the dropdown.
              </div>
            )}
            <FieldWrap
              label="Contact person"
              error={newSupplierErrors.contactPerson}
            >
              <input
                value={newSupplier.contactPerson}
                onChange={(e) =>
                  setNewSupplierField("contactPerson", e.target.value)
                }
                style={{
                  ...inputStyle,
                  borderColor: newSupplierErrors.contactPerson
                    ? "var(--input-error-border)"
                    : "var(--border)",
                }}
              />
            </FieldWrap>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <FieldWrap label="Phone" error={newSupplierErrors.phone}>
                  <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="tel"
                  maxLength={10}
                  placeholder="10-digit mobile (optional)"
                  value={newSupplier.phone}
                  onChange={(e) =>
                    setNewSupplierField("phone", e.target.value)
                  }
                  style={{
                    ...inputStyle,
                    borderColor: newSupplierErrors.phone ? "var(--input-error-border)" : "var(--border)",
                  }}
                />
              </FieldWrap>
              <FieldWrap label="Email" error={newSupplierErrors.email}>
                <input
                  type="email"
                  value={newSupplier.email}
                  onChange={(e) =>
                    setNewSupplierField("email", e.target.value)
                  }
                  style={{
                    ...inputStyle,
                    borderColor: newSupplierErrors.email ? "var(--input-error-border)" : "var(--border)",
                  }}
                />
              </FieldWrap>
            </div>
            <FieldWrap label="Address" error={newSupplierErrors.address}>
              <input
                value={newSupplier.address}
                onChange={(e) =>
                  setNewSupplierField("address", e.target.value)
                }
                style={{
                  ...inputStyle,
                  borderColor: newSupplierErrors.address ? "var(--input-error-border)" : "var(--border)",
                }}
              />
            </FieldWrap>
            <FieldWrap label="GST number" error={newSupplierErrors.gstNumber}>
                <input
                type="text"
                autoComplete="off"
                placeholder="Letters and digits only (optional)"
                maxLength={50}
                value={newSupplier.gstNumber}
                onChange={(e) =>
                  setNewSupplierField("gstNumber", e.target.value)
                }
                style={{
                  ...inputStyle,
                  borderColor: newSupplierErrors.gstNumber
                    ? "var(--input-error-border)"
                    : "var(--border)",
                }}
              />
            </FieldWrap>
            <FieldWrap label="Note" error={newSupplierErrors.note}>
              <textarea
                value={newSupplier.note}
                onChange={(e) =>
                  setNewSupplierField("note", e.target.value)
                }
                rows={2}
                style={{
                  padding: "8px 12px",
                  border: `1px solid ${newSupplierErrors.note ? "var(--input-error-border)" : "var(--border)"}`,
                  borderRadius: 8,
                  fontSize: 14,
                  resize: "vertical",
                  outline: "none",
                  fontFamily: "inherit",
                }}
              />
            </FieldWrap>
            <button
              type="button"
              onClick={handleCreateSupplier}
              disabled={creatingSupplier}
              style={{
                height: 40,
                background: "var(--muted)",
                color: "var(--on-accent)",
                border: "none",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                cursor: creatingSupplier ? "wait" : "pointer",
              }}
            >
              {creatingSupplier ? "Saving…" : "Save supplier"}
            </button>
          </div>
        )}

        <div
          style={{
            fontWeight: 600,
            fontSize: 14,
            color: "var(--text-strong)",
            borderBottom: "1px solid var(--border)",
            paddingBottom: 10,
          }}
        >
          Line items
        </div>

        <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
          Row 1 = headers. Required:{" "}
          <code style={{ fontSize: 11 }}>quantity</code>,{" "}
          <code style={{ fontSize: 11 }}>unit cost</code> (or rate / purchase price), and{" "}
          <code style={{ fontSize: 11 }}>brand code</code> and/or{" "}
          <code style={{ fontSize: 11 }}>product name</code> to match your catalog. When you
          record the purchase, catalog <strong>cost</strong> is set from unit cost and{" "}
          <strong>selling price</strong> is recalculated from the product&apos;s percentage markup
          (same rule as Products). Optional:{" "}
          <code style={{ fontSize: 11 }}>supplier</code> / <code style={{ fontSize: 11 }}>vendor</code>{" "}
          (name or GST); all rows must be the same supplier. Leave a cell blank only if you
          already selected that supplier above. Optional:{" "}
          <code style={{ fontSize: 11 }}>notes</code> (or <code style={{ fontSize: 11 }}>note</code>) per
          line — saved with the purchase. Imported rows become line items you can edit before
          recording. Purchase date is set to today when you import (you can change it).
        </p>

        {importBanner ? (
          <div
            style={{
              background: "var(--caution-soft)",
              border: "1px solid var(--caution-border)",
              color: "var(--caution-text)",
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 13,
              lineHeight: 1.45,
            }}
          >
            {importBanner}
          </div>
        ) : null}

        {isBulkPurchaseImport ? (
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: 16,
              background: "var(--surface-subtle)",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 15, color: "var(--text)" }}>
              {form.lines.length} line items loaded from import
            </div>
            <div style={{ fontSize: 14, color: "var(--text-strong)" }}>
              Estimated total: <strong>{fmt(totalCost)}</strong>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
              Large imports use a summary view so this page stays responsive. Review the
              banner above, then record the purchase — or clear the import to edit lines one
              at a time.
            </p>
            <div
              style={{
                fontSize: 12,
                color: "var(--muted)",
                borderTop: "1px solid var(--border)",
                paddingTop: 10,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              {form.lines.slice(0, 5).map((line, idx) => {
                const p = productById.get(line.productId);
                return (
                  <div key={line.key}>
                    {idx + 1}. {p?.name ?? "Product"} × {line.quantity} @{" "}
                    {fmt(Number(line.unitCost) || 0)}
                  </div>
                );
              })}
              {form.lines.length > 5 ? (
                <div style={{ color: "var(--muted)", marginTop: 4 }}>
                  … and {form.lines.length - 5} more lines
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={clearBulkPurchaseLines}
              style={{
                alignSelf: "flex-start",
                height: 34,
                padding: "0 12px",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                color: "var(--muted)",
                cursor: "pointer",
              }}
            >
              Clear import
            </button>
          </div>
        ) : (
          form.lines.map((line, idx) => {
            const rowErr = lineFieldErrors.get(idx);
            const prodErr = rowErr?.productId ?? rowErr?.productUnitId;
            const qtyErr = rowErr?.quantity;
            const costErr = rowErr?.unitCost;
            const sel = productById.get(line.productId);
            return (
              <div
                key={line.key}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: 14,
                  background: "var(--surface-subtle)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>
                    Line {idx + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removePurchaseLine(idx)}
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--muted)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      textDecoration: "underline",
                    }}
                  >
                    Remove
                  </button>
                </div>
                <FieldWrap label="Product *" error={prodErr}>
                  <select
                    value={line.productId}
                    onChange={(e) => setLine(idx, { productId: e.target.value })}
                    style={{ ...inputStyle, padding: "0 10px", cursor: "pointer" }}
                  >
                    <option value="">— Select product —</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.sku})
                      </option>
                    ))}
                  </select>
                </FieldWrap>
                {sel ? (
                  <div
                    style={{
                      background: "var(--caution-panel)",
                      borderRadius: 8,
                      padding: "8px 12px",
                      fontSize: 12,
                      color: "var(--muted)",
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 16,
                    }}
                  >
                    <span>
                      Stock:{" "}
                      <strong style={{ color: "var(--text)" }}>
                        {sel.stock} {sel.unit}
                      </strong>
                    </span>
                    <span>
                      Sale:{" "}
                      <strong style={{ color: "var(--text)" }}>{fmt(sel.price)}</strong>
                    </span>
                  </div>
                ) : null}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 14,
                  }}
                >
                  <FieldWrap label="Quantity *" error={qtyErr}>
                    <input
                      type="number"
                      min={0.0001}
                      step="any"
                      placeholder="0"
                      value={line.quantity}
                      onChange={(e) => setLine(idx, { quantity: e.target.value })}
                      style={{
                        ...inputStyle,
                        borderColor: qtyErr ? "var(--input-error-border)" : "var(--border)",
                      }}
                    />
                  </FieldWrap>
                  <FieldWrap label="Unit Cost (₹) *" error={costErr}>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      placeholder="0.00"
                      value={line.unitCost}
                      onChange={(e) => setLine(idx, { unitCost: e.target.value })}
                      style={{
                        ...inputStyle,
                        borderColor: costErr ? "var(--input-error-border)" : "var(--border)",
                      }}
                    />
                  </FieldWrap>
                </div>
                <FieldWrap label="Line note (optional)">
                  <input
                    type="text"
                    placeholder="e.g. batch, shelf, supplier remarks"
                    value={line.lineNote}
                    onChange={(e) => setLine(idx, { lineNote: e.target.value })}
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
                  />
                </FieldWrap>
              </div>
            );
          })
        )}

        {!isBulkPurchaseImport ? (
        <button
          type="button"
          onClick={addPurchaseLine}
          style={{
            alignSelf: "flex-start",
            height: 36,
            padding: "0 14px",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-strong)",
            cursor: "pointer",
          }}
        >
          + Add line
        </button>
        ) : null}

        {totalCost > 0 && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              background: "var(--input-disabled)",
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 14,
            }}
          >
            <span style={{ color: "var(--muted)" }}>Total Purchase Cost</span>
            <strong style={{ fontFamily: "monospace" }}>{fmt(totalCost)}</strong>
          </div>
        )}

        <FieldWrap label="Purchase Date" error={fieldErrors.invoiceDate}>
          <input
            type="date"
            value={form.purchaseDate}
            onChange={(e) =>
              setForm((f) => ({ ...f, purchaseDate: e.target.value }))
            }
            style={{
              ...inputStyle,
              borderColor: fieldErrors.invoiceDate ? "var(--input-error-border)" : "var(--border)",
            }}
          />
        </FieldWrap>

        <FieldWrap label="Notes (optional)" error={fieldErrors.note}>
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            rows={3}
            placeholder="Any additional notes..."
            style={{
              padding: "8px 12px",
              border: `1px solid ${fieldErrors.note ? "var(--input-error-border)" : "var(--border)"}`,
              borderRadius: 8,
              fontSize: 14,
              resize: "vertical",
              outline: "none",
              fontFamily: "inherit",
            }}
          />
        </FieldWrap>

        <FormErrorBanner text={purchaseFormBanner} />
        <Toast status={status} />

        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading || purchaseImportBusy}
          style={{
            height: 44,
            background: loading ? "var(--border)" : "var(--accent)",
            color: loading ? "var(--text-faint)" : "var(--on-accent)",
            border: "none",
            borderRadius: 10,
            fontSize: 15,
            fontWeight: 600,
            cursor: loading || purchaseImportBusy ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Recording..." : "Record Purchase"}
        </button>
      </div>
    </div>

      {isAdminUser ? (
        <div
          style={{
            background: "var(--surface)",
            borderRadius: 12,
            border: "1px solid var(--border)",
            padding: 24,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div>
            <div
              style={{
                fontWeight: 600,
                fontSize: 16,
                borderBottom: "1px solid var(--border)",
                paddingBottom: 10,
                color: "var(--text)",
              }}
            >
              Supplier payments
            </div>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--muted)" }}>
              Purchases still owed to suppliers. Record partial payments; each entry
              is stored with date and who recorded it.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => void loadPayables()}
              disabled={payLoading}
              style={{
                height: 36,
                padding: "0 14px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--surface-subtle)",
                color: "var(--text-strong)",
                fontSize: 13,
                fontWeight: 600,
                cursor: payLoading ? "not-allowed" : "pointer",
              }}
            >
              Refresh
            </button>
            {payLoading ? (
              <span style={{ fontSize: 13, color: "var(--muted)" }}>Loading…</span>
            ) : null}
          </div>
          {payError ? (
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                background: "var(--danger-soft-solid)",
                color: "var(--danger-text)",
                fontSize: 13,
              }}
            >
              {payError}
            </div>
          ) : null}
          {!payLoading && !payError && payRows.length === 0 ? (
            <div style={{ fontSize: 14, color: "var(--muted)" }}>
              No outstanding supplier balances.
            </div>
          ) : null}
          {!payLoading && payRows.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr style={{ background: "var(--surface-subtle)", color: "var(--muted)" }}>
                    <th style={{ textAlign: "left", padding: "10px 12px" }}>
                      Purchase
                    </th>
                    <th style={{ textAlign: "left", padding: "10px 12px" }}>
                      Date
                    </th>
                    <th style={{ textAlign: "left", padding: "10px 12px" }}>
                      Supplier
                    </th>
                    <th style={{ textAlign: "right", padding: "10px 12px" }}>
                      Total
                    </th>
                    <th style={{ textAlign: "right", padding: "10px 12px" }}>
                      Paid
                    </th>
                    <th style={{ textAlign: "right", padding: "10px 12px" }}>
                      Owed
                    </th>
                    <th style={{ textAlign: "right", padding: "10px 12px" }} />
                  </tr>
                </thead>
                <tbody>
                  {payRows.map((r) => {
                    const dt = new Date(r.createdAt);
                    return (
                      <tr
                        key={r.id}
                        style={{ borderTop: "1px solid var(--border)" }}
                      >
                        <td style={{ padding: "10px 12px", fontWeight: 600 }}>
                          {r.purchaseNumber}
                        </td>
                        <td style={{ padding: "10px 12px", color: "var(--muted)" }}>
                          {Number.isNaN(dt.getTime())
                            ? r.createdAt
                            : formatIndiaDateTime(dt)}
                        </td>
                        <td style={{ padding: "10px 12px" }}>{r.supplierName}</td>
                        <td
                          style={{
                            padding: "10px 12px",
                            textAlign: "right",
                            fontFamily: "monospace",
                          }}
                        >
                          {fmt(Number(r.totalAmount))}
                        </td>
                        <td
                          style={{
                            padding: "10px 12px",
                            textAlign: "right",
                            fontFamily: "monospace",
                            color: "var(--muted)",
                          }}
                        >
                          {fmt(Number(r.paidAmount))}
                        </td>
                        <td
                          style={{
                            padding: "10px 12px",
                            textAlign: "right",
                            fontFamily: "monospace",
                            fontWeight: 600,
                            color: "var(--accent)",
                          }}
                        >
                          {fmt(Number(r.balanceAmount))}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>
                          <button
                            type="button"
                            onClick={() => setPayFor(r)}
                            style={{
                              height: 32,
                              padding: "0 12px",
                              borderRadius: 8,
                              border: "none",
                              background: "var(--accent)",
                              color: "var(--on-accent)",
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: "pointer",
                            }}
                          >
                            Pay supplier
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      {payFor ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="supplier-pay-title"
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--overlay-scrim)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => !payLoadingSubmit && setPayFor(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !payLoadingSubmit) setPayFor(null);
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 420,
              background: "var(--surface)",
              borderRadius: 12,
              border: "1px solid var(--border)",
              padding: 20,
              boxShadow: "0 20px 50px var(--shadow-color)",
            }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <h3
              id="supplier-pay-title"
              style={{ margin: "0 0 4px", fontSize: 17, color: "var(--text)" }}
            >
              Pay supplier
            </h3>
            <p style={{ margin: "0 0 16px", fontSize: 12, color: "var(--muted)" }}>
              {payFor.purchaseNumber} · {payFor.supplierName} · Balance{" "}
              {fmt(Number(payFor.balanceAmount))}
            </p>
            <label
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--muted)",
                marginBottom: 6,
              }}
            >
              Amount (₹)
            </label>
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              style={{
                ...inputStyle,
                width: "100%",
                boxSizing: "border-box",
                marginBottom: 12,
              }}
            />
            <label
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--muted)",
                marginBottom: 6,
              }}
            >
              Payment date
            </label>
            <input
              type="date"
              value={payPaidAt}
              onChange={(e) => setPayPaidAt(e.target.value)}
              style={{
                ...inputStyle,
                width: "100%",
                boxSizing: "border-box",
                marginBottom: 12,
              }}
            />
            <label
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--muted)",
                marginBottom: 6,
              }}
            >
              Note (optional)
            </label>
            <input
              type="text"
              value={payNote}
              onChange={(e) => setPayNote(e.target.value)}
              placeholder="e.g. NEFT ref, UTR"
              style={{
                ...inputStyle,
                width: "100%",
                boxSizing: "border-box",
                marginBottom: 12,
              }}
            />
            {payMsg ? (
              <div
                style={{
                  fontSize: 13,
                  marginBottom: 10,
                  color: payMsg.type === "err" ? "var(--danger)" : "var(--accent)",
                }}
              >
                {payMsg.text}
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                disabled={payLoadingSubmit}
                onClick={() => setPayFor(null)}
                style={{
                  height: 38,
                  padding: "0 16px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  cursor: payLoadingSubmit ? "not-allowed" : "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={payLoadingSubmit}
                onClick={() => void submitSupplierPayment()}
                style={{
                  height: 38,
                  padding: "0 18px",
                  borderRadius: 8,
                  border: "none",
                  background: "var(--accent)",
                  color: "var(--on-accent)",
                  fontWeight: 600,
                  cursor: payLoadingSubmit ? "wait" : "pointer",
                }}
              >
                {payLoadingSubmit ? "Saving…" : "Record payment"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  </>
  );
}


// ═══════════════════════════════════════════════════════════════════
// APP ROOT
// ═══════════════════════════════════════════════════════════════════

export default function App() {
  const { confirmProps, confirm } = useConfirm();
  const [authPhase, setAuthPhase] = useState<"anon" | "validating" | "ready">(
    () =>
      typeof window !== "undefined" && getAuthToken() ? "validating" : "anon"
  );
  const [viewportWidth, setViewportWidth] = useState(
    typeof window === "undefined" ? 1280 : window.innerWidth
  );
  const [tab, setTab] = useState<Tab>("home");
  /** Issued quotation chosen on the Quotations page; the POS loads it into the cart once. */
  const [quotationToConvert, setQuotationToConvert] =
    useState<QuotationDetail | null>(null);
  const [pendingReportRunId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("reportRun");
  });
  const [rawProducts, setRawProducts] = useState<ApiProduct[]>([]);
  const [products, setProducts] = useState<UiProduct[]>([]);
  const [promotions, setPromotions] = useState<ApiPromotion[]>([]);
  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [customers, setCustomers] = useState<ApiCustomer[]>([]);
  const [sessionUsers, setSessionUsers] = useState<SessionUserRow[]>([]);
  const [actingUserId, setActingUserIdState] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sidebarExpanded, setSidebarExpanded] = useState(
    typeof window === "undefined" ? true : window.innerWidth >= 1024
  );

  const refreshProducts = useCallback(async () => {
    const raw = await api.getProducts();
    setRawProducts(raw);
    setProducts(
      raw.filter((p) => p.status === "ACTIVE").map(mapApiProduct)
    );
  }, []);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const isSmallScreen = viewportWidth < 1024;
  const isNarrow = viewportWidth < 1200;

  useEffect(() => {
    setSidebarExpanded(!isSmallScreen);
  }, [isSmallScreen]);

  useEffect(() => {
    if (authPhase !== "validating") return;
    let cancelled = false;
    void (async () => {
      try {
        await api.getSession();
        if (!cancelled) setAuthPhase("ready");
      } catch {
        if (!cancelled) {
          logoutAuth();
          setAuthPhase("anon");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authPhase]);

  const refreshSuppliers = useCallback(async () => {
    try {
      const sups = await api.getSuppliers();
      setSuppliers(sups);
    } catch {
      setSuppliers([]);
    }
  }, []);

  const actingUser = useMemo(
    () => sessionUsers.find((u) => u.id === actingUserId),
    [sessionUsers, actingUserId]
  );
  const isAdminUser =
    actingUser?.role === "ADMIN" || actingUser?.role === "MANAGER";

  const handleActingUserChange = useCallback(
    (id: string) => {
      setActingUserIdState(id);
      setActingUserId(id);
      const u = sessionUsers.find((x) => x.id === id);
      const admin = u?.role === "ADMIN" || u?.role === "MANAGER";
      if (
        !admin &&
        ["reporting", "promotion", "purchase", "adjustment", "quotations"].includes(tab)
      ) {
        setTab("home");
      }
      void (async () => {
        try {
          const [raw, sups] = await Promise.all([
            api.getProducts(),
            api.getSuppliers().catch(() => [] as ApiSupplier[]),
          ]);
          setRawProducts(raw);
          setProducts(
            raw.filter((p) => p.status === "ACTIVE").map(mapApiProduct)
          );
          setSuppliers(Array.isArray(sups) ? sups : []);
          if (FEATURE_FLAGS.catalogPromotions) {
            try {
              setPromotions(await api.getPromotions());
            } catch {
              setPromotions([]);
            }
          } else {
            setPromotions([]);
          }
        } catch {
          /* ignore */
        }
      })();
    },
    [sessionUsers, tab]
  );

  const refreshCustomers = useCallback(async () => {
    try {
      const rows = await api.getCustomers();
      setCustomers(rows);
    } catch {
      setCustomers([]);
    }
  }, []);

  const refreshPromotions = useCallback(async () => {
    if (!FEATURE_FLAGS.catalogPromotions) {
      setPromotions([]);
      return;
    }
    try {
      const rows = await api.getPromotions();
      setPromotions(rows);
    } catch {
      setPromotions([]);
    }
  }, []);

  useEffect(() => {
    if (authPhase !== "ready") return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const session = await api.getSession();
        if (cancelled) return;
        setSessionUsers(session.users ?? []);
        const stored =
          typeof localStorage !== "undefined"
            ? localStorage.getItem("inventoryActingUserId")
            : null;
        const ok =
          stored && session.users?.some((u: SessionUserRow) => u.id === stored);
        const pick = ok ? stored! : session.user.id;
        setActingUserIdState(pick);
        setActingUserId(pick);

        const [rawProducts, sups] = await Promise.all([
          api.getProducts(),
          api.getSuppliers().catch(() => [] as ApiSupplier[]),
        ]);
        if (cancelled) return;
        setRawProducts(rawProducts);
        setProducts(
          rawProducts.filter((p) => p.status === "ACTIVE").map(mapApiProduct)
        );
        setSuppliers(Array.isArray(sups) ? sups : []);
        try {
          const custs = await api.getCustomers();
          if (!cancelled) setCustomers(custs);
        } catch {
          if (!cancelled) setCustomers([]);
        }
        if (FEATURE_FLAGS.catalogPromotions) {
          try {
            const promoRows = await api.getPromotions();
            if (!cancelled) setPromotions(promoRows);
          } catch {
            if (!cancelled) setPromotions([]);
          }
        } else if (!cancelled) {
          setPromotions([]);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load data");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authPhase]);

  useEffect(() => {
    if (!FEATURE_FLAGS.catalogPromotions && tab === "promotion") {
      setTab("home");
      return;
    }
    if (!FEATURE_FLAGS.reporting && tab === "reporting") {
      setTab("home");
      return;
    }
    if (
      !isAdminUser &&
      ["reporting", "promotion", "purchase", "adjustment", "quotations"].includes(tab)
    ) {
      setTab("home");
    }
  }, [isAdminUser, tab]);

  useEffect(() => {
    if (authPhase !== "ready" || !isAdminUser || !FEATURE_FLAGS.reporting) {
      return;
    }
    if (!pendingReportRunId) return;
    setTab("reporting");
    const url = new URL(window.location.href);
    url.searchParams.delete("reportRun");
    const next =
      url.pathname + (url.search ? url.search : "") + (url.hash ? url.hash : "");
    window.history.replaceState({}, "", next);
  }, [authPhase, isAdminUser, pendingReportRunId]);

  if (authPhase === "anon") {
    return (
      <LoginPage
        onLoggedIn={() => {
          setAuthPhase("ready");
          setTab("pos");
        }}
      />
    );
  }

  if (authPhase === "validating") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg)",
          color: "var(--muted)",
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: 14,
          gap: 12,
        }}
      >
        <span
          style={{
            width: 22,
            height: 22,
            border: "2px solid var(--border)",
            borderTopColor: "var(--accent)",
            borderRadius: "50%",
            display: "inline-block",
            animation: "app-auth-spin 0.75s linear infinite",
          }}
        />
        Signing in…
        <style>{`@keyframes app-auth-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <>
      <div
      style={{
        display: "flex",
        flexDirection: "row",
        height: "100vh",
        fontFamily: "Inter, system-ui, -apple-system, sans-serif",
        background: "var(--bg)",
        overflow: "hidden",
      }}
    >
      <Sidebar
        activeTab={tab}
        onTabChange={setTab}
        isAdmin={isAdminUser}
        mobile={isSmallScreen}
        iconOnly={isSmallScreen && !sidebarExpanded}
        onToggleExpand={
          isSmallScreen ? () => setSidebarExpanded((v) => !v) : undefined
        }
      />

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        <div
          style={{
            background: "var(--surface)",
            borderBottom: "1px solid var(--border)",
            height: 56,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: isSmallScreen ? "0 14px" : "0 24px",
            gap: 16,
            flexShrink: 0,
          }}
        >
          <span style={{ color: "var(--text)", fontSize: 14, fontWeight: 600 }}>
            {COMPANY_NAME}
          </span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
            {!loading && sessionUsers.length > 1 && isAdminUser ? (
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  color: "var(--muted)",
                }}
              >
                <span style={{ whiteSpace: "nowrap" }}>Acting as</span>
                <select
                  value={actingUserId}
                  onChange={(e) => handleActingUserChange(e.target.value)}
                  style={{
                    height: 32,
                    padding: "0 10px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--surface)",
                    color: "var(--text)",
                    fontSize: 12,
                    maxWidth: isSmallScreen ? 160 : 260,
                  }}
                >
                  {sessionUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}
                      {u.role === "CASHIER"
                        ? " (Cashier)"
                        : u.role === "MANAGER"
                          ? " (Manager)"
                          : " (Admin)"}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <span style={{ color: "var(--muted)", fontSize: 13, whiteSpace: "nowrap" }}>
              {formatIndiaDateLong()}
            </span>
            <button
              type="button"
              onClick={() => {
                logoutAuth();
                setAuthPhase("anon");
                setTab("home");
              }}
              style={{
                height: 32,
                padding: "0 12px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--surface-subtle)",
                color: "var(--text)",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Log out
            </button>
          </div>
        </div>

        <main
          style={{
            flex: 1,
            background: "var(--bg)",
            overflowY: "auto",
            minHeight: 0,
          }}
        >
          <div
            style={{
              padding: isSmallScreen ? "12px" : isNarrow ? "16px" : "24px",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              boxSizing: "border-box",
              maxWidth: 1400,
              margin: "0 auto",
              width: "100%",
            }}
          >
            {loading && (
              <div
                style={{
                  textAlign: "center",
                  padding: 80,
                  color: "var(--muted)",
                  fontSize: 14,
                }}
              >
                Loading products…
              </div>
            )}
            {error && (
              <div
                style={{
                  background: "var(--surface)",
                  color: "var(--danger)",
                  padding: "14px 18px",
                  borderRadius: 10,
                  fontSize: 14,
                }}
              >
                Error: {error}
              </div>
            )}
            {!loading && !error && (
              <>
                {tab === "home" && (
                  <HomeView
                    onTabChange={setTab}
                    isAdmin={isAdminUser}
                    products={products}
                  />
                )}
                {tab === "products" && (
                  <ProductsPage
                    onProductsCreated={refreshProducts}
                    allowMutations={isAdminUser}
                    confirm={confirm}
                  />
                )}
                {FEATURE_FLAGS.catalogPromotions && tab === "promotion" && (
                  <PromotionsPage
                    products={rawProducts}
                    promotions={promotions}
                    onPromotionCreated={refreshPromotions}
                    confirm={confirm}
                  />
                )}
                {tab === "pos" && (
                  <POSView
                    products={products}
                    promotions={promotions}
                    actingUserId={actingUserId}
                    customers={customers}
                    refreshCustomers={refreshCustomers}
                    onSaleComplete={refreshProducts}
                    confirm={confirm}
                    quotationToConvert={quotationToConvert}
                    onQuotationConsumed={() => setQuotationToConvert(null)}
                  />
                )}
                {tab === "outstanding" && (
                  <OutstandingView actingUserId={actingUserId} />
                )}
                {tab === "invoices" && (
                  <ReprintInvoicePage
                    confirm={confirm}
                    canCancel={isAdminUser}
                    onInventoryRestored={refreshProducts}
                  />
                )}
                {tab === "quotations" && (
                  <QuotationsPage
                    confirm={confirm}
                    onConvertToSale={(quotation) => {
                      setQuotationToConvert(quotation);
                      setTab("pos");
                    }}
                  />
                )}
                {tab === "inventory" && (
                  <InventoryView products={products} />
                )}
                {tab === "purchase" && (
                  <PurchaseView
                    products={products}
                    suppliers={suppliers}
                    actingUserId={actingUserId}
                    onPurchaseComplete={refreshProducts}
                    refreshSuppliers={refreshSuppliers}
                    isAdminUser={isAdminUser}
                  />
                )}
                {tab === "adjustment" && (
                  <AdjustmentView
                    products={products}
                    actingUserId={actingUserId}
                    onAdjustmentComplete={refreshProducts}
                  />
                )}
                {FEATURE_FLAGS.reporting && tab === "reporting" && (
                  <ReportingPage initialReportRunId={pendingReportRunId} />
                )}
                {tab === "settings" && <SettingsPage />}
              </>
            )}
          </div>
        </main>
      </div>
      </div>
      <ConfirmModal {...confirmProps} />
    </>
  );
}
