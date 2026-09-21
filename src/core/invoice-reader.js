// Invoice data stays in the browser. Extraction is a suggestion, never a posting instruction.
export const normalize = (value) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const num = (value) => Number(String(value).replace(/[$,\s]/g, ""));
export function invoiceDate(value) {
  const m = String(value || "").match(
    /\b(?:(\d{4})[-/](\d{1,2})[-/](\d{1,2})|(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}))\b/,
  );
  if (!m) return "";
  const year = m[1] || (m[6].length === 2 ? "20" + m[6] : m[6]),
    month = m[2] || m[4],
    day = m[3] || m[5];
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const d = new Date(iso + "T12:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === iso
    ? iso
    : "";
}
export function rowsFromPdf(items) {
  const rows = [];
  for (const item of items) {
    if (!item.str?.trim()) continue;
    const y = item.transform[5],
      x = item.transform[4];
    let row = rows.find((r) => Math.abs(r.y - y) < 3);
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push({ x, text: item.str });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((r) =>
      r.items
        .sort((a, b) => a.x - b.x)
        .map((i) => i.text)
        .join("  "),
    )
    .join("\n");
}
const amountRegex = /\$?\s*\d[\d,]*\.\d{2}(?!\d)/g;
function labeledAmount(lines, pattern) {
  const matches = lines.filter((l) => pattern.test(l));
  for (const line of matches.reverse()) {
    const tail = line.replace(pattern, "");
    const vals = tail.match(amountRegex);
    if (vals?.length) return num(vals.at(-1)).toFixed(2);
  }
  return "";
}
export function parseInvoice(text, state = {}) {
  const lines = text
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  const header = lines.slice(0, 25).join("\n");
  const suppliers = state.suppliers || [];
  const supplier = suppliers
    .filter((s) => s.status === "Active")
    .find((s) => normalize(header).includes(normalize(s.business_name)));
  const numberMatch =
    text.match(
      /(?:invoice\s*(?:number|no\.?|#)|factura\s*(?:n[oúu]m(?:ero)?\.?|no\.?|#))\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9/-]*)/i,
    ) || text.match(/^\s*invoice\s*[:#]\s*([A-Za-z0-9][A-Za-z0-9/-]*)/im);
  const dateLine = lines.find(
    (l) =>
      /(invoice\s*date|fecha\s*(?:de\s*)?factura|date\s*:)/i.test(l) &&
      !/(due|venc)/i.test(l),
  );
  const dueLine = lines.find((l) => /(due\s*date|vencimiento)/i.test(l));
  const total =
    labeledAmount(
      lines,
      /\b(?:grand\s+total|invoice\s+total|total\s+invoice|amount\s+due|balance\s+due|total\s+a\s+pagar|total\s+due)\b\s*[:$]?/i,
    ) || labeledAmount(lines, /^total\s*[:$]?/i);
  const subtotal = labeledAmount(lines, /\bsub\s*total\b\s*[:$]?/i);
  const tax = labeledAmount(
    lines,
    /\b(?:sales\s+tax|tax\s+total|tax|impuesto|itbis)\b\s*[:$]?/i,
  );
  const shipping = labeledAmount(
    lines,
    /\b(?:shipping|freight|delivery\s+charge|flete)\b\s*[:$]?/i,
  );
  const discount = labeledAmount(lines, /\b(?:discount|descuento)\b\s*[:$]?/i);
  const items = [];
  for (const raw of lines) {
    if (
      /(?:sub\s*total|\btotal\b|\btax\b|balance|amount\s+due|shipping|freight|discount|payment|\bdate\b|invoice\s*(?:#|no)|phone|fax)/i.test(
        raw,
      )
    )
      continue;
    const amounts = [...raw.matchAll(/\$?\d[\d,]*\.\d{2,4}(?!\d)/g)];
    if (amounts.length < 2) continue;
    const priceToken = amounts.at(-2),
      amountToken = amounts.at(-1);
    if (
      raw
        .slice(amountToken.index + amountToken[0].length)
        .trim()
        .replace(/[|]/g, "")
    )
      continue;
    let before = raw.slice(0, priceToken.index).trim();
    if (!/[A-Za-z]{2}/.test(before)) continue;
    const leading = before.match(/^(\d+(?:\.\d{1,3})?)\s+/),
      trailing = before.match(
        /\s+(\d+(?:\.\d{1,3})?)\s*(lb|lbs|kg|ea|each|cs|case|box|bag|oz|gal)?\s*$/i,
      );
    const unitMatch = before.match(
      /\b(lb|lbs|kg|ea|each|cs|case|box|bag|oz|gal)\b/i,
    );
    const unit = unitMatch
      ? { lbs: "lb", each: "ea", cs: "case" }[unitMatch[1].toLowerCase()] ||
        unitMatch[1].toLowerCase()
      : "";
    let quantity = trailing?.[1] || leading?.[1] || "";
    const unitPrice = num(priceToken[0]),
      amount = num(amountToken[0]);
    if (!Number.isFinite(unitPrice) || !Number.isFinite(amount) || amount < 0)
      continue;
    // Never silently infer quantities from the charge; catch-weight and pack conversions need review.
    if (leading) before = before.slice(leading[0].length);
    if (trailing)
      before = before.replace(
        /\s+\d+(?:\.\d{1,3})?\s*(?:lb|lbs|kg|ea|each|cs|case|box|bag|oz|gal)?\s*$/i,
        "",
      );
    before = before
      .replace(/\b(lb|lbs|kg|ea|each|cs|case|box|bag|oz|gal)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!before) continue;
    const product = (state.products || []).find(
      (p) =>
        p.active && normalize(p.name) === normalize(before) && p.unit === unit,
    );
    items.push({
      description: before,
      quantity,
      unit,
      unit_price: String(unitPrice),
      amount: amount.toFixed(2),
      track_stock: true,
      product_id: product?.id || "",
      product_name: before,
      stock_unit: product?.unit || unit,
      stock_quantity: quantity,
      sku: "",
      source: raw,
    });
  }
  const warnings = [
    "Check every product, unit, quantity, date and amount against the original. Automatic reading can miss rows or confuse pack sizes with weights.",
  ];
  if (!numberMatch) warnings.push("Invoice number was not detected.");
  if (!dateLine || !invoiceDate(dateLine))
    warnings.push("Invoice date was not detected.");
  if (!total)
    warnings.push("Invoice total was not detected. Enter the printed total.");
  if (!items.length)
    warnings.push("Product rows were not recognized. Add them before posting.");
  const supplierBlock = header.split(
    /bill\s*to|ship\s*to|sold\s*to|facturar\s*a|entregar\s*a/i,
  )[0];
  const supplier_email =
    supplierBlock.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
  const supplier_phone =
    supplierBlock.match(/(?:\+1[ -]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}/)?.[0] ||
    "";
  const supplier_address =
    supplierBlock
      .split("\n")
      .find((l) =>
        /^\d+\s+.*\b(street|st|avenue|ave|road|rd|drive|dr|blvd|highway|hwy)\b/i.test(
          l,
        ),
      ) || "";
  const supplierName =
    supplier?.business_name ||
    lines.find(
      (l) =>
        /[a-z]{3}/i.test(l) && !/(invoice|bill to|ship to|factura)/i.test(l),
    ) ||
    "";
  return {
    supplier_email,
    supplier_phone,
    supplier_address,
    supplier_id: supplier?.id || "",
    supplier_name: supplierName,
    number: numberMatch?.[1] || "",
    issue_date: invoiceDate(dateLine),
    due_date: invoiceDate(dueLine),
    subtotal,
    tax: tax || "0.00",
    shipping: shipping || "0.00",
    discount: discount || "0.00",
    total,
    lines: items,
    warnings,
  };
}
export async function fileHash(file) {
  const bytes = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export function validateInvoiceFile(file) {
  if (
    !file ||
    !["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(
      file.type,
    ) ||
    file.size <= 0 ||
    file.size > 10485760
  )
    throw new Error("Choose a PDF, JPG, PNG or WEBP up to 10 MB.");
}
export async function readInvoice(file, progress = () => {}) {
  validateInvoiceFile(file);
  let worker;
  const base = new URL("./invoice-reader/", window.location.href.split("#")[0]);
  async function recognize(image) {
    if (!worker) {
      const { createWorker } = await import("tesseract.js");
      worker = await createWorker(["eng", "spa"], 1, {
        workerPath: new URL("worker.min.js", base).href,
        corePath: new URL("core", base).href,
        langPath: base.href.replace(/\/$/, ""),
        workerBlobURL: false,
        logger: (m) =>
          progress(
            m.status +
              (m.progress ? " " + Math.round(m.progress * 100) + "%" : ""),
          ),
      });
      await worker.setParameters({ preserve_interword_spaces: "1" });
    }
    const { data } = await worker.recognize(image);
    return data.text;
  }
  let pdf, loadingTask;
  try {
    if (file.type !== "application/pdf") {
      progress("Reading image…");
      return await recognize(file);
    }
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdf.worker.min.mjs",
      base,
    ).href;
    loadingTask = pdfjs.getDocument({
      data: await file.arrayBuffer(),
      isEvalSupported: false,
      useSystemFonts: true,
    });
    pdf = await loadingTask.promise;
    if (pdf.numPages > 12)
      throw new Error(
        "Use one invoice with at most 12 pages. Split longer files before importing.",
      );
    const pages = [];
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      progress(`Reading page ${pageNo} of ${pdf.numPages}…`);
      const page = await pdf.getPage(pageNo);
      let text = rowsFromPdf((await page.getTextContent()).items);
      if (text.replace(/\s/g, "").length < 60) {
        const raw = page.getViewport({ scale: 2 });
        const scale = Math.min(
          2,
          2600 / Math.max(raw.width / 2, raw.height / 2),
        );
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext("2d"), viewport })
          .promise;
        text = await recognize(canvas);
        canvas.width = canvas.height = 0;
      }
      pages.push(text);
      page.cleanup();
    }
    return pages.join("\n\n");
  } finally {
    await worker?.terminate();
    await loadingTask?.destroy();
  }
}
