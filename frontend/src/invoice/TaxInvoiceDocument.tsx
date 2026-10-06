import type { SaleDetail } from "../api/types";
import {
  INVOICE_AMOUNT_FOR_LABEL,
  INVOICE_BANK_ACCOUNT_NO,
  INVOICE_BANK_BRANCH,
  INVOICE_BANK_IFSC,
  INVOICE_BANK_NAME,
  INVOICE_BUSINESS_ADDRESS,
  INVOICE_BUSINESS_NAME,
  INVOICE_COPY_LABEL,
  INVOICE_EMAIL_PLACEHOLDER,
  INVOICE_PHONE,
  INVOICE_PLACE_OF_SUPPLY_STATE,
  INVOICE_SELLER_GSTIN,
  INVOICE_SELLER_MSME_REG,
  INVOICE_SIGNATORY_LABEL,
  INVOICE_TERMS,
} from "./invoiceBranding";
import {
  commonRate,
  hsnTaxSummary,
  lineDiscountPercent,
  lineGstBreakdown,
  lineNetUnitPrice,
  lineTaxableBase,
  saleGstTotals,
  saleTaxableTotal,
} from "./invoiceGst";
import { rupeesToWords } from "./rupeesToWords";
import "./gstInvoice.css";

const EPS = 0.005;

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtQty(q: string | number): string {
  const n = typeof q === "number" ? q : Number.parseFloat(q);
  if (!Number.isFinite(n)) return String(q);
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

function formatInvoiceDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}-${get("month")}-${get("year")}`;
}

function billToLabel(sale: SaleDetail): string {
  const label = sale.customerNameSnapshot?.trim() || sale.customerName?.trim();
  return label || "Walk-in customer";
}

/** "Maharashtra (27)" for same-state sales; the buyer's state as typed otherwise. */
function placeOfSupply(sale: SaleDetail): string {
  const sellerCode = INVOICE_SELLER_GSTIN.slice(0, 2);
  const party = sale.customerPartyState?.trim();
  if (!party || party.toLowerCase() === INVOICE_PLACE_OF_SUPPLY_STATE.toLowerCase()) {
    return `${INVOICE_PLACE_OF_SUPPLY_STATE} (${sellerCode})`;
  }
  return party;
}

function KV({
  label,
  value,
  party = false,
}: {
  label: string;
  value: string;
  party?: boolean;
}) {
  return (
    <div className={party ? "gst-inv-kv gst-inv-kv--party" : "gst-inv-kv"}>
      <span>{label}</span>
      <span>:</span>
      <span>{value}</span>
    </div>
  );
}

type Props = { sale: SaleDetail };

export function TaxInvoiceDocument({ sale }: Props) {
  const total = Number.parseFloat(sale.totalAmount ?? "0");
  const received = Number.parseFloat(sale.paidAmount ?? "0");
  const balance = Number.parseFloat(sale.balanceAmount ?? "0");
  const transport = Number.parseFloat(sale.transportAmount ?? "0");

  const gst = saleGstTotals(sale.lines);
  const taxable = saleTaxableTotal(sale.lines);
  const hsnRows = hsnTaxSummary(sale.lines);

  const breakdowns = sale.lines.map(lineGstBreakdown);
  const cgstRate = commonRate(breakdowns.map((b) => b.cgstRate));
  const sgstRate = commonRate(breakdowns.map((b) => b.sgstRate));
  const igstRate = commonRate(breakdowns.map((b) => b.igstRate));

  const showCgst = gst.cgst > EPS;
  const showSgst = gst.sgst > EPS;
  const showIgst = gst.igst > EPS;
  const hsnShowCgstSgst = hsnRows.some((r) => r.cgst > EPS || r.sgst > EPS) || !showIgst;
  const hsnShowIgst = hsnRows.some((r) => r.igst > EPS);

  // Total quantity per unit, e.g. "12.00 Pcs., 5.00 Kg"
  const qtyByUnit = new Map<string, number>();
  for (const l of sale.lines) {
    const unit = l.unitDisplayName || l.unitCode;
    qtyByUnit.set(unit, (qtyByUnit.get(unit) ?? 0) + (Number.parseFloat(l.quantity) || 0));
  }
  const qtySummary = [...qtyByUnit.entries()]
    .map(([unit, q]) => `${fmtQty(q)} ${unit}`)
    .join(", ");

  const rateLabel = (r: number | null) => (r == null ? "" : `@ ${r.toFixed(2)} %`);
  const partyAddress = sale.customerAddress?.trim();

  return (
    <div className="gst-inv">
      <div className="gst-inv-box">
        <div className="gst-inv-head">
          <div className="gst-inv-head-top">
            <div>
              <p>GSTIN : {INVOICE_SELLER_GSTIN}</p>
              <p>MSME REG No : {INVOICE_SELLER_MSME_REG}</p>
            </div>
            <p className="gst-inv-title">Tax Invoice</p>
            <p className="gst-inv-copy">{INVOICE_COPY_LABEL}</p>
          </div>
          <h1 className="gst-inv-name">{INVOICE_BUSINESS_NAME}</h1>
          <p className="gst-inv-addr">
            {INVOICE_BUSINESS_ADDRESS}
            <br />
            Tel. : {INVOICE_PHONE} &nbsp; email : {INVOICE_EMAIL_PLACEHOLDER}
          </p>
          {sale.status === "CANCELLED" ? (
            <p className="gst-inv-cancelled" role="status">
              Cancelled
            </p>
          ) : null}
        </div>

        <div className="gst-inv-parties">
          <div>
            <p className="gst-inv-party-title">Party Details :</p>
            <p>{billToLabel(sale)}</p>
            {partyAddress ? <p>{partyAddress}</p> : null}
            {sale.customerPartyState?.trim() ? <p>{sale.customerPartyState.trim()}</p> : null}
            <div className="gst-inv-party-gap" />
            {sale.customerPhone?.trim() ? (
              <KV party label="Mobile No" value={sale.customerPhone.trim()} />
            ) : null}
            {sale.customerPartyGstNo?.trim() ? (
              <KV party label="GSTIN / UIN" value={sale.customerPartyGstNo.trim()} />
            ) : null}
          </div>
          <div>
            <KV label="Invoice No." value={sale.saleNumber} />
            <KV label="Dated" value={formatInvoiceDate(sale.createdAt)} />
            <KV label="Place of Supply" value={placeOfSupply(sale)} />
            <KV label="Salesman Name" value="" />
          </div>
        </div>

        <table className="gst-inv-items">
          <colgroup>
            <col style={{ width: "4%" }} />
            <col style={{ width: "31%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "12%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>S.N.</th>
              <th>Description of Goods</th>
              <th>HSN Code</th>
              <th>Qty.</th>
              <th>Unit</th>
              <th>List Price</th>
              <th>Dis %</th>
              <th>Price</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {sale.lines.map((line, i) => (
              <tr key={line.id}>
                <td className="gi-c">{i + 1}.</td>
                <td className="gi-desc">{line.productName}</td>
                <td className="gi-c">{line.productHsnCode?.trim() || "—"}</td>
                <td className="gi-r">{fmtQty(line.quantity)}</td>
                <td className="gi-c">{line.unitDisplayName || line.unitCode}</td>
                <td className="gi-r">{fmt(Number.parseFloat(line.unitPrice))}</td>
                <td className="gi-r">{lineDiscountPercent(line).toFixed(2)} %</td>
                <td className="gi-r">{fmt(lineNetUnitPrice(line))}</td>
                <td className="gi-r">{fmt(lineTaxableBase(line))}</td>
              </tr>
            ))}
            <tr className="gst-inv-fill" aria-hidden="true">
              {Array.from({ length: 9 }, (_, i) => (
                <td key={i} />
              ))}
            </tr>
          </tbody>
        </table>

        <div className="gst-inv-totals">
          <div className="gst-inv-totals-row">
            <span />
            <span>TOTAL</span>
            <span>{fmt(taxable)}</span>
          </div>
          {showCgst ? (
            <div className="gst-inv-totals-row">
              <span>Add : CGST</span>
              <span>{rateLabel(cgstRate)}</span>
              <span>{fmt(gst.cgst)}</span>
            </div>
          ) : null}
          {showSgst ? (
            <div className="gst-inv-totals-row">
              <span>Add : SGST</span>
              <span>{rateLabel(sgstRate)}</span>
              <span>{fmt(gst.sgst)}</span>
            </div>
          ) : null}
          {showIgst ? (
            <div className="gst-inv-totals-row">
              <span>Add : IGST</span>
              <span>{rateLabel(igstRate)}</span>
              <span>{fmt(gst.igst)}</span>
            </div>
          ) : null}
          {transport > EPS ? (
            <div className="gst-inv-totals-row">
              <span>Add : Transport</span>
              <span />
              <span>{fmt(transport)}</span>
            </div>
          ) : null}
          <div className="gst-inv-grand">
            <span>
              Grand Total <span className="gst-inv-qty">{qtySummary}</span>
            </span>
            <span>₹ {fmt(total)}</span>
          </div>
          {balance > EPS ? (
            <>
              <div className="gst-inv-totals-row gst-inv-totals-row--label">
                <span>Received</span>
                <span>{fmt(received)}</span>
              </div>
              <div className="gst-inv-totals-row gst-inv-totals-row--label">
                <span>Balance Due</span>
                <span>{fmt(balance)}</span>
              </div>
            </>
          ) : null}
        </div>

        <div className="gst-inv-hsn">
          <table>
            <thead>
              <tr>
                <th>HSN/SAC</th>
                <th>Tax Rate</th>
                <th className="gi-r">Taxable Amt.</th>
                {hsnShowCgstSgst ? <th className="gi-r">CGST Amt.</th> : null}
                {hsnShowCgstSgst ? <th className="gi-r">SGST Amt.</th> : null}
                {hsnShowIgst ? <th className="gi-r">IGST Amt.</th> : null}
                <th className="gi-r">Total Tax</th>
              </tr>
            </thead>
            <tbody>
              {hsnRows.map((r) => (
                <tr key={`${r.hsn}|${r.ratePct}`}>
                  <td>{r.hsn || "—"}</td>
                  <td>{r.ratePct}%</td>
                  <td className="gi-r">{fmt(r.taxable)}</td>
                  {hsnShowCgstSgst ? <td className="gi-r">{fmt(r.cgst)}</td> : null}
                  {hsnShowCgstSgst ? <td className="gi-r">{fmt(r.sgst)}</td> : null}
                  {hsnShowIgst ? <td className="gi-r">{fmt(r.igst)}</td> : null}
                  <td className="gi-r">{fmt(r.totalTax)}</td>
                </tr>
              ))}
              {hsnRows.length > 1 ? (
                <tr className="gi-sum">
                  <td>Total</td>
                  <td />
                  <td className="gi-r">{fmt(taxable)}</td>
                  {hsnShowCgstSgst ? <td className="gi-r">{fmt(gst.cgst)}</td> : null}
                  {hsnShowCgstSgst ? <td className="gi-r">{fmt(gst.sgst)}</td> : null}
                  {hsnShowIgst ? <td className="gi-r">{fmt(gst.igst)}</td> : null}
                  <td className="gi-r">{fmt(gst.sum)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
          <p className="gst-inv-words">{rupeesToWords(total)}</p>
        </div>

        <div className="gst-inv-foot">
          <div>
            <p>E.&amp; O.E.</p>
            <ol>
              {INVOICE_TERMS.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ol>
            <p className="gst-inv-thanks">Thanks for doing business with us!</p>
          </div>
          <div>
            <div className="gst-inv-bank">
              <span>Bank Name</span>
              <span>:</span>
              <span>{INVOICE_BANK_NAME}</span>
            </div>
            <div className="gst-inv-bank">
              <span>A/C No</span>
              <span>:</span>
              <span>{INVOICE_BANK_ACCOUNT_NO}</span>
            </div>
            <div className="gst-inv-bank">
              <span>Branch</span>
              <span>:</span>
              <span>{INVOICE_BANK_BRANCH}</span>
            </div>
            <div className="gst-inv-bank">
              <span>IFSC Code</span>
              <span>:</span>
              <span>{INVOICE_BANK_IFSC}</span>
            </div>
          </div>
          <div className="gst-inv-sign">
            <p>{INVOICE_AMOUNT_FOR_LABEL}</p>
            <p>{INVOICE_SIGNATORY_LABEL}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
