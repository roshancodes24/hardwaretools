import { useEffect } from "react";
import type { SaleDetail } from "../api/types";
import { TaxInvoiceDocument } from "./TaxInvoiceDocument";
import "./taxInvoicePrint.css";

type Props = {
  sale: SaleDetail;
  onClose: () => void;
};

export function TaxInvoiceModal({ sale, onClose }: Props) {
  useEffect(() => {
    const clear = () => document.documentElement.classList.remove("print-tax-invoice");
    window.addEventListener("afterprint", clear);
    return () => window.removeEventListener("afterprint", clear);
  }, []);

  const handlePrint = () => {
    document.documentElement.classList.add("print-tax-invoice");
    requestAnimationFrame(() => {
      window.print();
    });
  };

  return (
    <div
      className="tax-invoice-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tax-invoice-title"
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
            gap: 10,
            justifyContent: "flex-end",
            marginBottom: 10,
            flexWrap: "wrap",
          }}
        >
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

        <div id="tax-invoice-print-area" className="tax-invoice-print-shell">
          <h2 id="tax-invoice-title" className="visually-hidden-for-print">
            Tax invoice {sale.saleNumber}
          </h2>
          <TaxInvoiceDocument sale={sale} />
        </div>
      </div>
      <style>{`
        .visually-hidden-for-print {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        }
        @media print {
          .visually-hidden-for-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}
