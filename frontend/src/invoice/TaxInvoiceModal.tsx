import { useId } from "react";
import { createPortal } from "react-dom";
import type { SaleDetail } from "../api/types";
import { NormalInvoiceDocument } from "./NormalInvoiceDocument";
import { printElementInBlankFrame } from "./printInvoiceIframe";
import { TaxInvoiceDocument } from "./TaxInvoiceDocument";
import "./taxInvoicePrint.css";

export type InvoiceModalVariant = "tax" | "normal";

type Props = {
  sale: SaleDetail;
  onClose: () => void;
  /** Locked at POS before Confirm Sale, or inferred when reprinting. Not changeable here. */
  variant: InvoiceModalVariant;
};

export function TaxInvoiceModal({
  sale,
  onClose,
  variant,
}: Props) {
  const headingId = useId();
  const isTax = variant === "tax";

  const handlePrint = () => {
    printElementInBlankFrame("tax-invoice-print-area");
  };

  const docTitle = isTax ? `Tax invoice ${sale.saleNumber}` : `Bill ${sale.saleNumber}`;

  const modal = (
    <div
      className="tax-invoice-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      onClick={() => onClose()}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        style={{ width: "100%", maxWidth: 760 }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div
          className="tax-invoice-modal-toolbar"
          style={{
            display: "flex",
            gap: 12,
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 10,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--muted)",
              userSelect: "none",
            }}
          >
            {isTax ? "Tax invoice (CGST / SGST / IGST)" : "Bill"}
          </span>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              className="tax-invoice-btn-primary"
              onClick={handlePrint}
            >
              Print
            </button>
            <button type="button" className="tax-invoice-btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div id="tax-invoice-print-area" className="tax-invoice-print-shell">
          <h2 id={headingId} className="visually-hidden-for-print">
            {docTitle}
          </h2>
          {isTax ? (
            <TaxInvoiceDocument sale={sale} />
          ) : (
            <NormalInvoiceDocument sale={sale} />
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
