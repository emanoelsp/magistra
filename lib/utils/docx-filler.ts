/**
 * docx-filler — PlanoMagistra
 *
 * Label-based injection: no span/shading requirements.
 * For each table row we scan cells left-to-right:
 *   • 1-cell row  → if the cell's text matches a field label, the NEXT ROW's first cell receives the placeholder.
 *   • N-cell row  → cell[i] matches a label  ⟹  cell[i+1] receives the placeholder
 *                   (unless cell[i+1] also matches another label, in which case skip).
 */
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

import type { TemplateFieldSchema } from "../types/firestore";

// ── XML helpers ─────────────────────────────────────────────────────────────

function extractText(xml: string): string {
  return (xml.match(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g) ?? [])
    .map((m) => m.replace(/<[^>]+>/g, ""))
    .join("")
    .trim();
}

function normText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function replaceFirst(haystack: string, needle: string, replacement: string): string {
  const idx = haystack.indexOf(needle);
  if (idx === -1) return haystack;
  return haystack.slice(0, idx) + replacement + haystack.slice(idx + needle.length);
}

function stripChangeTracking(xml: string): string {
  return xml
    .replace(/<w:tblPrChange\b[^>]*>[\s\S]*?<\/w:tblPrChange>/g, "")
    .replace(/<w:tblGridChange\b[^>]*>[\s\S]*?<\/w:tblGridChange>/g, "")
    .replace(/<w:trPrChange\b[^>]*>[\s\S]*?<\/w:trPrChange>/g, "")
    .replace(/<w:tcPrChange\b[^>]*>[\s\S]*?<\/w:tcPrChange>/g, "")
    .replace(/<w:rPrChange\b[^>]*>[\s\S]*?<\/w:rPrChange>/g, "")
    .replace(/<w:pPrChange\b[^>]*>[\s\S]*?<\/w:pPrChange>/g, "");
}

// ── Row / cell parser ────────────────────────────────────────────────────────

interface Row {
  xml: string;
  cells: string[];
  cellTexts: string[];
}

function parseRows(xml: string): Row[] {
  return [...xml.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)].map((m) => {
    const rowXml = m[0];
    // Match cells with or without attributes (e.g. <w:tc> or <w:tc w:val="...">)
    const cells = [...rowXml.matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)].map((c) => c[0]);
    return { xml: rowXml, cells, cellTexts: cells.map(extractText) };
  });
}

// ── Field matcher ────────────────────────────────────────────────────────────

function matchField(
  labelText: string,
  schema: TemplateFieldSchema[],
  used: Set<string>,
): TemplateFieldSchema | null {
  const needle = normText(labelText);
  if (!needle || needle.length < 2) return null;

  let best: TemplateFieldSchema | null = null;
  let bestScore = 0;

  for (const field of schema) {
    if (used.has(field.key)) continue;
    const hay = normText(field.label);
    if (!hay) continue;

    let score = 0;
    const minL = Math.min(needle.length, hay.length);
    const maxL = Math.max(needle.length, hay.length);

    if (needle.includes(hay) || hay.includes(needle)) {
      score = minL / maxL;
    } else {
      const stem = (w: string) => w.slice(0, 6);
      const nw = needle.split(" ").filter((w) => w.length > 2);
      const hw = hay.split(" ").filter((w) => w.length > 2);
      const nStems = new Set(nw.map(stem));
      const overlap = hw.filter((w) => nStems.has(stem(w))).length;
      if (overlap > 0) score = (overlap / Math.max(nw.length, hw.length)) * 0.8;
    }

    if (score > bestScore && score >= 0.4) {
      bestScore = score;
      best = field;
    }
  }

  return best;
}

// ── Cell content writer ──────────────────────────────────────────────────────

/**
 * Replaces ALL <w:t> text in a cell with `content`.
 * Sets the first <w:t> to the new content and empties every subsequent one.
 * Used for inline "Label: value" cells where we must erase the original value.
 */
function clearAndSetCellText(cellXml: string, content: string): string {
  let first = true;
  return cellXml.replace(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g, (match) => {
    if (first) {
      first = false;
      return `<w:t xml:space="preserve">${content}</w:t>`;
    }
    return "<w:t/>";
  });
}

/**
 * Replaces only the text content inside the first <w:t> element with `content`,
 * preserving all paragraph (pPr), run (rPr), and cell (tcPr) formatting intact.
 * If no <w:t> exists, creates a minimal run inside the first paragraph.
 */
function setCellContent(cellXml: string, content: string): string {
  // Try to find and replace just the first <w:t> content, preserving everything else
  const wtMatch = cellXml.match(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/);
  if (wtMatch) {
    // Replace only the text inside the first <w:t>, keeping all formatting
    const idx = cellXml.indexOf(wtMatch[0]);
    const preserveSpace = wtMatch[0].includes('xml:space="preserve"') 
      ? '<w:t xml:space="preserve">' 
      : '<w:t>';
    const newWt = `${preserveSpace}${content}</w:t>`;
    return cellXml.slice(0, idx) + newWt + cellXml.slice(idx + wtMatch[0].length);
  }

  // No <w:t> found - find first paragraph and add a run with the content
  const paraMatch = cellXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/);
  if (!paraMatch) return cellXml;

  const firstPara = paraMatch[0];
  const openTag = firstPara.match(/^(<w:p(?:\s[^>]*)?>)/)?.[1] ?? "<w:p>";
  const pPr = firstPara.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? "";
  
  // Extract run properties from any existing run, or use empty
  const firstRun = firstPara.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/)?.[0] ?? "";
  const rPr = firstRun.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? "";

  const newPara = `${openTag}${pPr}<w:r>${rPr}<w:t xml:space="preserve">${content}</w:t></w:r></w:p>`;
  
  return cellXml.replace(firstPara, newPara);
}

// ── Main: inject placeholders ────────────────────────────────────────────────

/**
 * Walks every table row in the DOCX and injects {{field.key}} placeholders.
 *
 * Strategy (no span/shading requirements):
 *   • 1-cell row  → label match  ⟹  next row's first cell gets the placeholder
 *   • N-cell row  → left-to-right scan: cell[i] matches label  ⟹  cell[i+1] gets placeholder
 *                   (skip if cell[i+1] ALSO matches another label — both are labels, not a pair)
 *
 * Returns the buffer unchanged if {{}} is already present (idempotent).
 * 
 * IMPORTANT: This function preserves all document formatting by only modifying
 * the text content inside <w:t> elements, keeping all styling intact.
 */
export function injectPlaceholders(docxBuffer: Buffer, schema: TemplateFieldSchema[]): Buffer {
  if (schema.length === 0) return docxBuffer;

  const zip = new PizZip(docxBuffer);
  const xmlPath = "word/document.xml";
  if (!zip.files[xmlPath]) throw new Error("DOCX inválido: word/document.xml não encontrado.");

  let xml = zip.files[xmlPath].asText();
  if (xml.includes("{{")) return docxBuffer; // already prepared

  // Only strip change tracking, preserve all other formatting
  xml = stripChangeTracking(xml);

  const rows = parseRows(xml);
  const used = new Set<string>();

  // ── Pass 1: Inline "Label: value" cells ─────────────────────────────────────
  // Handles filled templates where label and value share a single cell:
  //   "Professor(a): Luiz Carlos Covre"  →  "Professor(a): {{professor}}"
  // Only applies when there is actual content after the colon (skips section
  // headers like "TEMÁTICA ABORDADA:" where nothing follows the colon in the cell).
  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    let rowXml = row.xml;
    let rowModified = false;

    for (let ci = 0; ci < row.cells.length; ci++) {
      const cellText = row.cellTexts[ci];
      const colonIdx = cellText.indexOf(":");
      if (colonIdx <= 1) continue;

      const potentialLabel = cellText.slice(0, colonIdx).trim();
      if (potentialLabel.length < 2) continue;

      const valueAfterColon = cellText.slice(colonIdx + 1).trim();
      // Skip if nothing follows the colon (standalone header like "TEMÁTICA ABORDADA:")
      // or if the value is suspiciously long (multi-paragraph content block)
      if (!valueAfterColon || valueAfterColon.length > 300) continue;

      const field = matchField(potentialLabel, schema, used);
      if (!field) continue;

      // Preserve the label prefix and inject placeholder as value
      const labelPrefix = cellText.slice(0, colonIdx + 1); // "Professor(a):"
      const newContent = `${labelPrefix} {{${field.key}}}`;
      const origCell = row.cells[ci];
      const newCell = clearAndSetCellText(origCell, newContent);
      rowXml = replaceFirst(rowXml, origCell, newCell);
      row.cells[ci] = newCell;
      row.cellTexts[ci] = newContent;
      used.add(field.key);
      rowModified = true;
    }

    if (rowModified) {
      xml = replaceFirst(xml, row.xml, rowXml);
      rows[ri] = { xml: rowXml, cells: row.cells, cellTexts: row.cellTexts };
    }
  }

  // ── Pass 2: Structural table patterns ───────────────────────────────────────

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    if (row.cells.length === 0) continue;

    // ── 1-cell row: label → next row content ──────────────────────────────
    if (row.cells.length === 1) {
      const field = matchField(row.cellTexts[0], schema, used);
      if (field && ri + 1 < rows.length) {
        const nextRow = rows[ri + 1];
        if (nextRow.cells.length >= 1) {
          const origCell = nextRow.cells[0];
          const newCell = setCellContent(origCell, `{{${field.key}}}`);
          const newNextRowXml = replaceFirst(nextRow.xml, origCell, newCell);
          xml = replaceFirst(xml, nextRow.xml, newNextRowXml);
          // Reflect change so future iterations see updated row
          rows[ri + 1] = {
            xml: newNextRowXml,
            cells: [newCell, ...nextRow.cells.slice(1)],
            cellTexts: [`{{${field.key}}}`, ...nextRow.cellTexts.slice(1)],
          };
          used.add(field.key);
        }
      }
      continue;
    }

    // ── N-cell row: left-to-right label → value scan ──────────────────────
    // Work on mutable copies so each replaceFirst sees the running row XML
    const cells = [...row.cells];
    const cellTexts = [...row.cellTexts];
    let rowXml = row.xml;
    let rowModified = false;

    for (let ci = 0; ci < cells.length - 1; ci++) {
      const field = matchField(cellTexts[ci], schema, used);
      if (!field) continue;

      // Reject if the NEXT cell also matches a different field label —
      // that means both cells are labels and there's no value cell between them.
      const excluded = new Set([...used, field.key]);
      const nextAlsoLabel = !!matchField(cellTexts[ci + 1], schema, excluded);
      if (nextAlsoLabel) continue;

      // Inject into cell[ci + 1]
      const origValueCell = cells[ci + 1];
      const newCell = setCellContent(origValueCell, `{{${field.key}}}`);
      // replaceFirst on the *running* rowXml: replaces the first (leftmost) occurrence
      // of origValueCell, which is correct when scanning left-to-right because
      // previously replaced cells now have different XML and won't be matched again.
      rowXml = replaceFirst(rowXml, origValueCell, newCell);
      cells[ci + 1] = newCell;
      cellTexts[ci + 1] = `{{${field.key}}}`;
      used.add(field.key);
      rowModified = true;
      ci++; // advance past the value cell we just filled
    }

    if (rowModified) {
      xml = replaceFirst(xml, row.xml, rowXml);
      rows[ri] = { xml: rowXml, cells, cellTexts };
    }

    // ── Fallback: all-label row → inject into next row's cells ─────────────
    // Handles the pattern: [Label A | Label B] followed by [value A | value B]
    // (e.g. "Experiências de ensino" | "Recursos necessários" header row).
    if (!rowModified && ri + 1 < rows.length) {
      const nextRow = rows[ri + 1];
      let nextRowXml = nextRow.xml;
      const nextCells = [...nextRow.cells];
      const nextCellTexts = [...nextRow.cellTexts];
      let nextModified = false;

      for (let ci = 0; ci < cells.length && ci < nextCells.length; ci++) {
        const field = matchField(cellTexts[ci], schema, used);
        if (!field) continue;
        // Only inject when the target cell is genuinely empty (value slot)
        if (nextCellTexts[ci].trim().length > 10) continue;
        const origCell = nextCells[ci];
        const newCell = setCellContent(origCell, `{{${field.key}}}`);
        nextRowXml = replaceFirst(nextRowXml, origCell, newCell);
        nextCells[ci] = newCell;
        nextCellTexts[ci] = `{{${field.key}}}`;
        used.add(field.key);
        nextModified = true;
      }

      if (nextModified) {
        xml = replaceFirst(xml, nextRow.xml, nextRowXml);
        rows[ri + 1] = { xml: nextRowXml, cells: nextCells, cellTexts: nextCellTexts };
      }
    }
  }

  zip.file(xmlPath, xml);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}

// ── Inject placeholders with color highlights ────────────────────────────────

/**
 * Same as injectPlaceholders but colorizes each {{key}} run in the DOCX XML:
 *   • manual / fixed fields → amber  #B45309
 *   • ia_sugerida fields    → violet #6D28D9
 *
 * Used for the "visualizar template" preview so field positions are visible
 * inside the Office Online embed without needing a separate overlay layer.
 */
export function injectColoredPlaceholders(
  docxBuffer: Buffer,
  schema: TemplateFieldSchema[],
): Buffer {
  if (schema.length === 0) return docxBuffer;

  // Ensure {{key}} placeholders are in the right cells (idempotent if already present)
  const withPlaceholders = injectPlaceholders(docxBuffer, schema);

  const colorMap: Record<string, string> = {};
  for (const field of schema) {
    colorMap[field.key] = field.role === "ia_sugerida" ? "6D28D9" : "B45309";
  }

  const zip = new PizZip(withPlaceholders);
  const xmlPath = "word/document.xml";
  if (!zip.files[xmlPath]) return withPlaceholders;

  let xml = zip.files[xmlPath].asText();

  // Walk each <w:r> element (runs don't nest in DOCX)
  xml = xml.replace(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g, (runXml) => {
    for (const field of schema) {
      const placeholder = `{{${field.key}}}`;
      if (!runXml.includes(placeholder)) continue;

      const color = colorMap[field.key];

      // Find the <w:t> that actually holds the placeholder
      const tRegex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
      let tMatch: RegExpExecArray | null;
      while ((tMatch = tRegex.exec(runXml)) !== null) {
        if (tMatch[1].includes(placeholder)) break;
      }
      if (!tMatch) continue;

      const tText = tMatch[1];

      if (tText.trim() === placeholder) {
        // Entire run text is the placeholder — colorize the run
        if (runXml.includes("<w:color ")) {
          return runXml.replace(/<w:color[^/]*\/>/g, `<w:color w:val="${color}"/>`);
        }
        if (runXml.includes("<w:rPr>")) {
          return runXml.replace("<w:rPr>", `<w:rPr><w:color w:val="${color}"/>`);
        }
        // No rPr — insert one before the first <w:t>
        return runXml.replace(/<w:t(?=\s|>)/, `<w:rPr><w:color w:val="${color}"/></w:rPr><w:t`);
      }

      // Mixed text e.g. "Professor(a): {{professor}}"
      // Split into: label run (unchanged) | colored {{key}} run | optional tail run
      const pIdx = tText.indexOf(placeholder);
      const before = tText.slice(0, pIdx);
      const after = tText.slice(pIdx + placeholder.length);
      const origRPr = runXml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? "";

      // Keep original run but replace its <w:t> with the "before" text only
      const beforeT = before
        ? `<w:t xml:space="preserve">${before}</w:t>`
        : `<w:t/>`;
      let result = runXml.replace(tMatch[0], beforeT);

      // Colored run for the placeholder
      result += `<w:r><w:rPr><w:color w:val="${color}"/></w:rPr><w:t xml:space="preserve">${placeholder}</w:t></w:r>`;

      // Tail run for any text after the placeholder
      if (after) {
        result += `<w:r>${origRPr}<w:t xml:space="preserve">${after}</w:t></w:r>`;
      }

      return result;
    }
    return runXml;
  });

  zip.file(xmlPath, xml);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}

// ── Fill with docxtemplater ──────────────────────────────────────────────────

/**
 * Fills all {{key}} placeholders in a prepared DOCX using docxtemplater.
 * Multi-line values: \n → <w:br/> via linebreaks: true.
 * 
 * The document formatting is preserved as docxtemplater only replaces
 * the placeholder text while keeping all surrounding XML structure intact.
 */
export function fillDocx(
  docxBuffer: Buffer,
  schema: TemplateFieldSchema[],
  values: Record<string, string>,
): Buffer {
  const zip = new PizZip(docxBuffer);

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "{{", end: "}}" },
    nullGetter: () => "",
    // Preserve document structure by not parsing as XML
    parser: (tag: string) => ({
      get: (scope: Record<string, unknown>) => {
        const value = scope[tag];
        return typeof value === "string" ? value : "";
      },
    }),
  });

  const data: Record<string, string> = {};
  for (const field of schema) {
    data[field.key] = (values[field.key] ?? "").trim();
  }

  doc.render(data);
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}
