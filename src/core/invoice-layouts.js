// Layout-specific readers preserve multi-line descriptions before the generic fallback.
const numeric = (value) => Number(String(value).replace(/[$,\s]/g, ""));
const weightHeader =
  /\bitem\b[\s\S]*\bbrand\b[\s\S]*\bqty\b[\s\S]*\b(?:dlv|delivered)\b[\s\S]*\btot(?:al)?\s*w(?:gt|eight)\b[\s\S]*\bprice\b[\s\S]*\btotal\b/i;
const weightRow =
  /^([A-Z0-9][A-Z0-9.-]{2,})\s+(?:(.*?)\s+)?(\d+(?:\.\d{1,3})?)\s+(\d+(?:\.\d{1,3})?)\s+(\d[\d,]*(?:\.\d{1,3})?)\s+\$?(\d[\d,]*\.\d{2,4})\s+\$?(\d[\d,]*\.\d{2})\s*$/i;
const footer =
  /^(?:sub\s*total|total(?:\s|:|$)|sales\s+tax|tax(?:\s|:|$)|amount\s+due|balance\s+due|terms(?:\s|:|$)|page\s+\d|continued|invoice(?:\s|:|$)|customer\s+number|sold\s+to|shipped\s+to|ship\s+to|bill\s+to|thank\s+you|payment|remit|freight|shipping|discount|www\.)/i;
const headerDetail = /^(?:description|catch\s+weight\s+list|product\s+of)\s*$/i;
export function parseWeightTable(lines) {
  const headers = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (!/^item\b/i.test(lines[i])) continue;
    for (let n = 1; n <= 7; n++)
      if (weightHeader.test(lines.slice(i, i + n).join(" "))) {
        for (let j = i; j < i + n; j++) headers.add(j);
        break;
      }
  }
  if (!headers.size) return { items: [], consumed: new Set() };
  const items = [],
    consumed = new Set(headers);
  let inside = false;
  for (let i = 0; i < lines.length; i++) {
    if (headers.has(i)) {
      inside = true;
      continue;
    }
    if (!inside) continue;
    if (footer.test(lines[i])) {
      inside = false;
      continue;
    }
    const match = lines[i].match(weightRow);
    if (!match) continue;
    const [, sku, brand = "", ordered, delivered, weight, price, amount] =
      match;
    const description = [],
      raw = [lines[i]],
      weights = [];
    consumed.add(i);
    let end = i + 1;
    for (; end < lines.length; end++) {
      const line = lines[end];
      if (headers.has(end) || weightRow.test(line) || footer.test(line)) break;
      // Numbers on subsequent rows are individual catch weights, not products or descriptions.
      if (/^[\d\s.,/+-]+$/.test(line)) {
        weights.push(line);
        raw.push(line);
        consumed.add(end);
        continue;
      }
      if (headerDetail.test(line)) {
        consumed.add(end);
        continue;
      }
      if (
        /^(?:phone|fax|route\s*#|driver|customer must|\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4})/i.test(
          line,
        )
      )
        break;
      if (/[A-Za-z]/.test(line)) {
        description.push(line.replace(/\s+/g, " "));
        raw.push(line);
        consumed.add(end);
      }
    }
    const name = description.join(" ").trim();
    const notes = [];
    if (!name)
      notes.push(
        "Description missing: check the original. The brand is not the product name.",
      );
    const w = numeric(weight),
      p = numeric(price),
      a = numeric(amount);
    const matchesWeight =
      Math.abs(Math.round(w * p * 100) - Math.round(a * 100)) <= 1;
    if (!matchesWeight)
      notes.push(
        "Weight × price does not match this line amount. Review the billing quantity.",
      );
    const unitMatch = name.match(/(?:\d\s*|\b)(lbs?|kg|oz)\b/i);
    const unit = matchesWeight
      ? unitMatch?.[1].toLowerCase().replace(/^lbs$/, "lb") || ""
      : "";
    if (!unit)
      notes.push(
        "Confirm the weight unit. Package counts are not the billed weight.",
      );
    items.push({
      description: name,
      quantity: matchesWeight ? String(w) : "",
      unit,
      unit_price: String(p),
      amount: a.toFixed(2),
      track_stock: true,
      product_id: "",
      product_name: name,
      stock_unit: unit,
      stock_quantity: matchesWeight ? String(w) : "",
      sku,
      brand: brand.trim(),
      ordered_quantity: ordered,
      delivered_quantity: delivered,
      total_weight: String(w),
      catch_weights: weights.join("; "),
      reader_notes: notes,
      source: raw.join("\n"),
    });
    i = end - 1;
  }
  return { items, consumed };
}
export function dateNearLabel(lines, pattern) {
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(pattern);
    if (!match) continue;
    const candidates = [
      lines[i].slice(match.index + match[0].length),
      ...lines.slice(i + 1, i + 3),
    ];
    for (const candidate of candidates) {
      const found = candidate.match(
        /\b(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})\b/,
      );
      if (found) return found[0];
    }
  }
  return "";
}
