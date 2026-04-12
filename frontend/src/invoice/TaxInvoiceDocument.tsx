import type { SaleDetail } from "../api/types";
import {
  INVOICE_BUSINESS_NAME,
  INVOICE_EMAIL_PLACEHOLDER,
  INVOICE_PHONE,
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

/** DD-MM-YYYY in Asia/Kolkata */
function formatInvoiceDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(d);
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const year = parts.find((p) => p.type === "year")?.value ?? "";
  return `${day}-${month}-${year}`;
}

function billToLabel(sale: SaleDetail): string {
  const snap = sale.customerNameSnapshot?.trim();
  const name = sale.customerName?.trim();
  const label = snap || name;
  if (label) return label;
  return "Walk-in customer";
}

type Props = { sale: SaleDetail };

export function TaxInvoiceDocument({ sale }: Props) {
  const disc = Number.parseFloat(sale.discountAmount ?? "0");
  const tax = Number.parseFloat(sale.taxAmount ?? "0");
  const total = Number.parseFloat(sale.totalAmount ?? "0");
  const balanceDue = Number.parseFloat(sale.balanceAmount ?? "0");
  const amountWords = rupeesToWords(total);

  return (
    <div className="tax-invoice-doc">
      <header>
        <h1 className="inv-name">{INVOICE_BUSINESS_NAME}</h1>
        <p className="inv-contact">
          Phone no.: {INVOICE_PHONE}
          <br />
          Email: {INVOICE_EMAIL_PLACEHOLDER}
        </p>
        <hr className="inv-rule" />
        <p className="inv-title">Tax Invoice</p>
      </header>

      <section className="inv-meta-card">
        <div className="inv-two-col">
          <div>
            <p className="inv-col-title">Bill To</p>
            <p className="inv-bill-to">{billToLabel(sale)}</p>
          </div>
          <div className="inv-details-block">
            <p className="inv-col-title inv-details-heading">Invoice Details</p>
            <div>
              <strong>Invoice No. :</strong> {sale.saleNumber}
            </div>
            <div>
              <strong>Date :</strong> {formatInvoiceDate(sale.createdAt)}
            </div>
          </div>
        </div>
      </section>

      <div className="tax-invoice-table-wrap">
        <table className="tax-invoice-table">
          <thead>
            <tr>
              <th className="tax-invoice-accent">#</th>
              <th className="tax-invoice-accent">Item name</th>
              <th className="tax-invoice-accent">Quantity</th>
              <th className="tax-invoice-accent">Unit</th>
              <th className="tax-invoice-accent">Price/ Unit</th>
              <th className="tax-invoice-accent">Amount</th>
            </tr>
          </thead>
          <tbody>
            {sale.lines.map((line, i) => (
              <tr key={line.id}>
                <td>{i + 1}</td>
                <td>
                  <div className="item-name">{line.productName}</div>
                  {line.productSku?.trim() ? (
                    <div className="item-model">Model No.: {line.productSku}</div>
                  ) : null}
                </td>
                <td>{formatQty(line.quantity)}</td>
                <td>{line.unitDisplayName || line.unitCode}</td>
                <td>{fmtInr(line.unitPrice)}</td>
                <td>{fmtInr(line.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="tax-invoice-footer-top">
        <div className="tax-invoice-summary-grid">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="tax-invoice-panel">
              <p className="panel-head tax-invoice-accent">Invoice Amount In Words</p>
              <div className="panel-body">{amountWords}</div>
            </div>
            <div className="tax-invoice-panel">
              <p className="panel-head tax-invoice-accent">Terms and Conditions</p>
              <div className="panel-body inv-terms-body">
                <ol className="inv-terms-list">
                  <li>We are not responsible for any loss or damage in transit.</li>
                  <li>Our responsibility ceases as soon as goods leave our premises.</li>
                  <li>Interest will be charged if the payment is not made on time.</li>
                </ol>
                <p className="inv-terms-thanks">Thanks for doing business with us!</p>
              </div>
            </div>
          </div>

          <div className="tax-invoice-amount-rows">
            <p className="panel-head tax-invoice-accent" style={{ margin: 0 }}>
              Amounts
            </p>
            <div className="amt-row">
              <span>Sub Total</span>
              <span>{fmtInr(sale.subtotal)}</span>
            </div>
            {disc > 0.005 ? (
              <div className="amt-row">
                <span>Discount</span>
                <span>− {fmtInr(sale.discountAmount)}</span>
              </div>
            ) : null}
            {tax > 0.005 ? (
              <div className="amt-row">
                <span>Tax</span>
                <span>{fmtInr(sale.taxAmount)}</span>
              </div>
            ) : null}
            <div className="amt-row amt-row-total">
              <strong>Total</strong>
              <strong>{fmtInr(sale.totalAmount)}</strong>
            </div>
            <div className="amt-row">
              <span>Received</span>
              <span>{fmtInr(sale.paidAmount)}</span>
            </div>
            {balanceDue > 0.005 ? (
              <div className="amt-row">
                <span>Balance</span>
                <span>{fmtInr(sale.balanceAmount)}</span>
              </div>
            ) : null}
          </div>
        </div>
      </footer>
    </div>
  );
}
