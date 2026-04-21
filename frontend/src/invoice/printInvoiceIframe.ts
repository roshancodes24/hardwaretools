/** Opens a minimal document in a hidden iframe and prints it (cleaner PDF headers than window.print on the SPA). */
export function printElementInBlankFrame(elementId: string): void {
  const source = document.getElementById(elementId);
  if (!source) return;

  /** Dialog SR-only title is not printed; iframe omits modal inline styles so it would otherwise show as “Bill SAL-…”. */
  const clone = source.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".visually-hidden-for-print").forEach((el) => el.remove());

  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "Invoice print");
  Object.assign(iframe.style, {
    position: "fixed",
    right: "0",
    bottom: "0",
    width: "0",
    height: "0",
    border: "0",
    visibility: "hidden",
  });
  document.body.appendChild(iframe);

  const idoc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!idoc || !win) {
    iframe.remove();
    return;
  }

  const parentHtml = document.documentElement;
  const themeAttr =
    parentHtml.getAttribute("data-theme") != null
      ? ` data-theme="${parentHtml.getAttribute("data-theme")}"`
      : "";

  const baseHref = window.location.href.replace(/#.*$/, "");

  idoc.open();
  idoc.write("<!DOCTYPE html>");
  idoc.write(
    `<html lang="en" class="print-tax-invoice"${themeAttr}><head><meta charset="utf-8"/>`,
  );
  idoc.write(`<base href="${baseHref}" />`);
  idoc.write("<title></title>");

  document.querySelectorAll('link[rel="stylesheet"]').forEach((node) => {
    idoc.write(node.outerHTML);
  });
  document.querySelectorAll("head style").forEach((node) => {
    idoc.write(node.outerHTML);
  });

  /* Last in head so it wins over Vite chunks that still target Inter */
  idoc.write(`<style>
@media print {
  html.print-tax-invoice #tax-invoice-print-area,
  html.print-tax-invoice #tax-invoice-print-area * {
    font-family: "Segoe UI", "Segoe UI Symbol", Arial, "Helvetica Neue", sans-serif !important;
    font-variant-ligatures: none !important;
    font-feature-settings: "liga" 0, "calt" 0 !important;
  }
}
</style>`);

  idoc.write("</head><body>");
  idoc.write(clone.outerHTML);
  idoc.write("</body></html>");
  idoc.close();

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    win.removeEventListener("afterprint", cleanup);
    iframe.remove();
  };

  const runPrint = () => {
    win.focus();
    win.print();
    win.addEventListener("afterprint", cleanup);
    window.setTimeout(cleanup, 8_000);
  };

  window.setTimeout(runPrint, 150);
}
