import type { QuotationDetail } from "../api/types";
import {
  INVOICE_AMOUNT_FOR_LABEL,
  INVOICE_BUSINESS_ADDRESS,
  INVOICE_BUSINESS_NAME,
  INVOICE_EMAIL_PLACEHOLDER,
  INVOICE_PHONE,
  INVOICE_PLACE_OF_SUPPLY_STATE,
  INVOICE_SELLER_GSTIN,
  QUOTATION_GST_NOT_INCLUDED_NOTE,
} from "./invoiceBranding";
import { rupeesToWords } from "./rupeesToWords";

function fmtInr(amountStr: string): string {
  const n = Number.parseFloat(amountStr);
  if (!Number.isFinite(n)) return "₹ 0.00";
  return `₹ ${n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatQty(q: string): string {
  const n = Number.parseFloat(q);
  if (!Number.isFinite(n)) return q;
  if (Number.isInteger(n)) return String(n);
  return String(n);
}

type Props = { quotation: QuotationDetail };

export function QuotationDocument({ quotation }: Props) {
  const total = Number.parseFloat(quotation.totalAmount ?? "0");
  const amountWords = rupeesToWords(total);
  const gstIncluded = quotation.includeGst !== false;

  return (
    <div className="tax-invoice-doc quotation-doc">
      <header>
        <h1 className="inv-name">{INVOICE_BUSINESS_NAME}</h1>
        <p className="inv-contact">
          {INVOICE_BUSINESS_ADDRESS}
          <br />
          Phone no: {INVOICE_PHONE} | Email: {INVOICE_EMAIL_PLACEHOLDER}
          <br />
          GSTIN: {INVOICE_SELLER_GSTIN}
        </p>
        <hr className="inv-rule" />
        <p className="inv-title">QUOTATION</p>
      </header>

      <section className="inv-meta-card">
        <div className="inv-two-col">
          <div>
            <p className="inv-col-title">Customer</p>
            <p className="inv-bill-to">{quotation.customerName}</p>
            {quotation.customerContactPerson?.trim() ? (
              <p className="inv-party-gst">
                <strong>Contact:</strong> {quotation.customerContactPerson.trim()}
              </p>
            ) : null}
            {quotation.customerPhone?.trim() ? (
              <p className="inv-party-gst">
                <strong>Phone:</strong> {quotation.customerPhone.trim()}
              </p>
            ) : null}
            {quotation.customerEmail?.trim() ? (
              <p className="inv-party-gst">
                <strong>Email:</strong> {quotation.customerEmail.trim()}
              </p>
            ) : null}
            {quotation.customerAddress?.trim() ? (
              <p className="inv-party-gst">{quotation.customerAddress.trim()}</p>
            ) : null}
            {quotation.customerPartyGstNo?.trim() ? (
              <p className="inv-party-gst">
                <strong>GSTIN:</strong> {quotation.customerPartyGstNo.trim()}
              </p>
            ) : null}
            {quotation.customerPartyState?.trim() ? (
              <p className="inv-party-gst">
                <strong>State:</strong> {quotation.customerPartyState.trim()}
              </p>
            ) : null}
          </div>
          <div className="inv-details-block">
            <p className="inv-col-title inv-details-heading">Quotation Details</p>
            <div>
              <strong>Quotation No:</strong> {quotation.quotationNumber}
            </div>
            <div>
              <strong>Quotation Date:</strong> {quotation.quotationDateLabel}
            </div>
            <div>
              <strong>Valid Until:</strong> {quotation.validUntilLabel}
            </div>
            <div>
              <strong>Place of Supply:</strong> {INVOICE_PLACE_OF_SUPPLY_STATE}
            </div>
            {gstIncluded ? null : (
              <div>
                <strong>GST:</strong> Not included
              </div>
            )}
            <div className="quo-status">
              <strong>Status:</strong> {quotation.status}
            </div>
          </div>
        </div>
      </section>

      <div className="tax-invoice-table-wrap">
        <table className="tax-invoice-table">
          <thead>
            <tr>
              <th className="tax-invoice-accent">#</th>
              <th className="tax-invoice-accent">Product</th>
              <th className="tax-invoice-accent">SKU</th>
              <th className="tax-invoice-accent">HSN</th>
              <th className="tax-invoice-accent num">Qty</th>
              <th className="tax-invoice-accent">Unit</th>
              <th className="tax-invoice-accent num">Rate</th>
              <th className="tax-invoice-accent num">Discount</th>
              <th className="tax-invoice-accent num">Tax</th>
              <th className="tax-invoice-accent num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {quotation.lines.map((line, index) => (
              <tr key={line.id}>
                <td className="num">{index + 1}</td>
                <td>
                  <div className="item-name">{line.productName}</div>
                </td>
                <td>{line.sku}</td>
                <td>{line.hsnCode?.trim() || "—"}</td>
                <td className="num">{formatQty(line.quantity)}</td>
                <td>{line.unitDisplayName || line.unitCode}</td>
                <td className="num">{fmtInr(line.unitPrice)}</td>
                <td className="num">{fmtInr(line.lineDiscount)}</td>
                <td className="num">{fmtInr(line.lineTax)}</td>
                <td className="num">{fmtInr(line.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="tax-invoice-footer-top">
        <div className="tax-invoice-summary-grid">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="tax-invoice-panel">
              <p className="panel-head tax-invoice-accent">Note</p>
              <div className="panel-body">
                {quotation.note?.trim() || "—"}
              </div>
            </div>
            <div className="tax-invoice-panel">
              <p className="panel-head tax-invoice-accent">Validity</p>
              <div className="panel-body">
                Prices and taxes are based on the details shown above and are
                valid until the date specified.
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="tax-invoice-amount-rows">
              <p className="panel-head tax-invoice-accent" style={{ margin: 0 }}>
                Amounts
              </p>
              <div className="amt-row">
                <span>Subtotal</span>
                <span>{fmtInr(quotation.subtotal)}</span>
              </div>
              <div className="amt-row">
                <span>Discount</span>
                <span>{fmtInr(quotation.discountAmount)}</span>
              </div>
              <div className="amt-row">
                <span>Taxable amount</span>
                <span>{fmtInr(quotation.taxableAmount)}</span>
              </div>
              {gstIncluded ? (
                <>
                  <div className="amt-row">
                    <span>CGST</span>
                    <span>{fmtInr(quotation.cgstAmount)}</span>
                  </div>
                  <div className="amt-row">
                    <span>SGST</span>
                    <span>{fmtInr(quotation.sgstAmount)}</span>
                  </div>
                  <div className="amt-row">
                    <span>IGST</span>
                    <span>{fmtInr(quotation.igstAmount)}</span>
                  </div>
                </>
              ) : (
                <p className="quo-no-gst">{QUOTATION_GST_NOT_INCLUDED_NOTE}</p>
              )}
              <div className="amt-row">
                <span>Transport</span>
                <span>{fmtInr(quotation.transportAmount)}</span>
              </div>
              <div className="amt-row amt-row-total">
                <strong>Grand total</strong>
                <strong>{fmtInr(quotation.totalAmount)}</strong>
              </div>
            </div>
            <div className="tax-invoice-panel">
              <p className="panel-head tax-invoice-accent">Amount in words</p>
              <div className="panel-body">{amountWords}</div>
            </div>
            <p className="inv-for-proprietor">{INVOICE_AMOUNT_FOR_LABEL}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
