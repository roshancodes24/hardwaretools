const BELOW_TWENTY = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];

const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
];

function twoDigitsUnderHundred(n: number): string {
  if (n < 20) return BELOW_TWENTY[n] ?? "";
  const t = Math.floor(n / 10);
  const u = n % 10;
  const ten = TENS[t] ?? "";
  if (!u) return ten;
  return `${ten} ${BELOW_TWENTY[u]}`;
}

function threeDigitsWords(n: number): string {
  if (n <= 0) return "";
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${BELOW_TWENTY[h]} Hundred`);
  if (rest) {
    const t = twoDigitsUnderHundred(rest);
    if (t) parts.push(t);
  }
  return parts.join(" ");
}

function rupeesIntegerWords(rupees: number): string {
  if (rupees === 0) return "Zero";
  if (rupees < 0) return `Negative ${rupeesIntegerWords(-rupees)}`;

  const crore = Math.floor(rupees / 10000000);
  let rem = rupees % 10000000;
  const lakh = Math.floor(rem / 100000);
  rem %= 100000;
  const thousand = Math.floor(rem / 1000);
  const last = rem % 1000;

  const chunks: string[] = [];
  if (crore) chunks.push(`${threeDigitsWords(crore)} Crore`);
  if (lakh) chunks.push(`${twoDigitsUnderHundred(lakh)} Lakh`);
  if (thousand) chunks.push(`${twoDigitsUnderHundred(thousand)} Thousand`);
  if (last) {
    const w = threeDigitsWords(last);
    if (w) chunks.push(w);
  }
  return chunks.join(" ").replace(/\s+/g, " ").trim();
}

/** Same wording as the invoice helper in `frontend/src/invoice/rupeesToWords.ts`. */
export function rupeesToWords(amount: number): string {
  if (!Number.isFinite(amount)) return "Zero Rupees only";

  const rounded = Math.round(amount * 100) / 100;
  const rupees = Math.floor(rounded);
  const paise = Math.round((rounded - rupees) * 100);
  const rupeePart = `${rupeesIntegerWords(rupees)} Rupee${rupees === 1 ? "" : "s"}`;
  if (paise <= 0) return `${rupeePart} only`;
  const pWords = paise === 1 ? "One Paisa" : `${rupeesIntegerWords(paise)} Paise`;
  return `${rupeePart} and ${pWords} only`;
}
