import PDFDocument from "pdfkit";
import {
  INVOICE_AMOUNT_FOR_LABEL,
  INVOICE_BUSINESS_ADDRESS,
  INVOICE_BUSINESS_NAME,
  INVOICE_EMAIL,
  INVOICE_PHONE,
  INVOICE_PLACE_OF_SUPPLY_STATE,
  INVOICE_SELLER_GSTIN,
  QUOTATION_GST_NOT_INCLUDED_NOTE,
  QUOTATION_VALIDITY_NOTE,
} from "../lib/invoiceLetterhead";
import { rupeesToWords } from "../lib/rupeesToWords";
import type { QuotationDetailDto } from "./quotations";

const NAVY = "#1e3a5f";
const RULE = "#d6d3d1";
const MUTED = "#57534e";
const ROW = "#f5f5f4";

function inr(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "Rs. 0.00";
  return `Rs. ${n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function qtyLabel(quantity: string): string {
  const n = Number(quantity);
  if (!Number.isFinite(n)) return quantity;
  if (Number.isInteger(n)) return String(n);
  return String(n);
}

type Col = { label: string; width: number; align?: "left" | "right" };

const COLS: Col[] = [
  { label: "#", width: 22, align: "right" },
  { label: "Product", width: 118 },
  { label: "SKU", width: 62 },
  { label: "HSN", width: 46 },
  { label: "Qty", width: 36, align: "right" },
  { label: "Unit", width: 42 },
  { label: "Rate", width: 52, align: "right" },
  { label: "Discount", width: 52, align: "right" },
  { label: "Tax", width: 46, align: "right" },
  { label: "Amount", width: 56, align: "right" },
];

function drawHeader(doc: PDFKit.PDFDocument): number {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(16)
    .text(INVOICE_BUSINESS_NAME, left, 36, { width, align: "center" });
  doc
    .fillColor(MUTED)
    .font("Helvetica")
    .fontSize(8)
    .text(INVOICE_BUSINESS_ADDRESS, left, doc.y + 2, { width, align: "center" });
  doc.text(`Phone: ${INVOICE_PHONE}    Email: ${INVOICE_EMAIL}`, {
    width,
    align: "center",
  });
  doc.text(`GSTIN: ${INVOICE_SELLER_GSTIN}`, { width, align: "center" });
  const ruleY = doc.y + 8;
  doc
    .moveTo(left, ruleY)
    .lineTo(left + width, ruleY)
    .strokeColor(NAVY)
    .lineWidth(1.2)
    .stroke();
  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(14)
    .text("QUOTATION", left, ruleY + 8, { width, align: "center" });
  return doc.y + 6;
}

function customerLines(quotation: QuotationDetailDto): string[] {
  const lines = [quotation.customerName];
  if (quotation.customerContactPerson) {
    lines.push(`Contact: ${quotation.customerContactPerson}`);
  }
  if (quotation.customerPhone) lines.push(`Phone: ${quotation.customerPhone}`);
  if (quotation.customerEmail) lines.push(`Email: ${quotation.customerEmail}`);
  if (quotation.customerAddress) lines.push(quotation.customerAddress);
  if (quotation.customerPartyGstNo) {
    lines.push(`GSTIN: ${quotation.customerPartyGstNo}`);
  }
  if (quotation.customerPartyState) {
    lines.push(`State: ${quotation.customerPartyState}`);
  }
  return lines;
}

export function renderQuotationPdf(
  quotation: QuotationDetailDto
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 36,
      compress: false,
      info: {
        Title: `Quotation ${quotation.quotationNumber}`,
        Author: INVOICE_BUSINESS_NAME,
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    let y = drawHeader(doc);

    const half = width / 2 - 8;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(NAVY);
    doc.text("Customer", left, y, { width: half });
    doc.text("Quotation details", left + half + 16, y, { width: half });
    y = doc.y + 4;

    doc.font("Helvetica").fontSize(9).fillColor("#1c1917");
    const party = customerLines(quotation);
    let partyY = y;
    for (const line of party) {
      doc.text(line, left, partyY, { width: half });
      partyY = doc.y + 1;
    }

    const meta: Array<[string, string]> = [
      ["Quotation No", quotation.quotationNumber],
      ["Quotation Date", quotation.quotationDateLabel],
      ["Valid Until", quotation.validUntilLabel],
      ["Place of Supply", INVOICE_PLACE_OF_SUPPLY_STATE],
      ["Status", quotation.status],
    ];
    let metaY = y;
    for (const [label, value] of meta) {
      doc.font("Helvetica").fillColor(MUTED).text(label, left + half + 16, metaY, {
        width: 90,
        continued: false,
      });
      doc
        .font("Helvetica-Bold")
        .fillColor("#1c1917")
        .text(value, left + half + 108, metaY, { width: half - 92 });
      metaY = Math.max(doc.y, metaY + 12);
    }

    y = Math.max(partyY, metaY) + 8;
    doc
      .moveTo(left, y)
      .lineTo(left + width, y)
      .strokeColor(RULE)
      .lineWidth(0.6)
      .stroke();
    y += 10;

    const drawTableHead = (top: number) => {
      doc.rect(left, top, width, 16).fill(NAVY);
      let x = left;
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(7.5);
      for (const col of COLS) {
        doc.text(col.label, x + 2, top + 4, {
          width: col.width - 4,
          align: col.align ?? "left",
        });
        x += col.width;
      }
      return top + 16;
    };

    y = drawTableHead(y);
    quotation.lines.forEach((line, index) => {
      const values = [
        String(index + 1),
        line.productName,
        line.sku,
        line.hsnCode?.trim() || "—",
        qtyLabel(line.quantity),
        line.unitDisplayName || line.unitCode,
        inr(line.unitPrice),
        inr(line.lineDiscount),
        inr(line.lineTax),
        inr(line.lineTotal),
      ];
      const rowHeight = Math.max(
        16,
        doc.heightOfString(line.productName, { width: COLS[1].width - 4 }) + 6
      );
      if (y + rowHeight > doc.page.height - 80) {
        doc.addPage();
        y = drawTableHead(36);
      }
      if (index % 2 === 1) {
        doc.rect(left, y, width, rowHeight).fill(ROW);
      }
      let x = left;
      doc.fillColor("#1c1917").font("Helvetica").fontSize(7.5);
      values.forEach((value, colIndex) => {
        const col = COLS[colIndex];
        doc.text(value, x + 2, y + 4, {
          width: col.width - 4,
          align: col.align ?? "left",
        });
        x += col.width;
      });
      y += rowHeight;
    });

    y += 12;
    if (y > doc.page.height - 220) {
      doc.addPage();
      y = 36;
    }

    const totalsX = left + width - 230;
    const gstIncluded = quotation.includeGst !== false;
    const rows: Array<[string, string, boolean]> = [
      ["Subtotal", inr(quotation.subtotal), false],
      ["Discount", inr(quotation.discountAmount), false],
      ["Taxable amount", inr(quotation.taxableAmount), false],
    ];
    if (gstIncluded) {
      rows.push(
        ["CGST", inr(quotation.cgstAmount), false],
        ["SGST", inr(quotation.sgstAmount), false],
        ["IGST", inr(quotation.igstAmount), false]
      );
    }
    rows.push(
      ["Transport", inr(quotation.transportAmount), false],
      ["Grand total", inr(quotation.totalAmount), true]
    );
    for (const [label, value, strong] of rows) {
      doc
        .font(strong ? "Helvetica-Bold" : "Helvetica")
        .fontSize(strong ? 10 : 9)
        .fillColor(strong ? NAVY : "#1c1917")
        .text(label, totalsX, y, { width: 110 });
      doc.text(value, totalsX + 110, y, { width: 120, align: "right" });
      y += strong ? 16 : 13;
    }

    if (!gstIncluded) {
      y += 4;
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor("#1c1917")
        .text(QUOTATION_GST_NOT_INCLUDED_NOTE, left, y, { width });
      y = doc.y;
    }

    const words = rupeesToWords(Number(quotation.totalAmount));
    y += 6;
    doc.font("Helvetica").fontSize(8).fillColor(MUTED).text("Amount in words", left, y, {
      width: 220,
    });
    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor("#1c1917")
      .text(words, left, doc.y + 2, { width: 280 });

    if (quotation.note?.trim()) {
      y = doc.y + 12;
      doc.font("Helvetica-Bold").fontSize(8).fillColor(NAVY).text("Note", left, y);
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor("#1c1917")
        .text(quotation.note.trim(), left, doc.y + 2, { width: 280 });
    }

    y = Math.max(doc.y + 18, y + 18);
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(MUTED)
      .text(QUOTATION_VALIDITY_NOTE, left, y, { width });
    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor(NAVY)
      .text(INVOICE_AMOUNT_FOR_LABEL, left, doc.y + 16, { width, align: "right" });

    doc.end();
  });
}
