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

// ── Label detector ────────────────────────────────────────────────────────────

/**
 * Returns true when a cell text looks like a label/header rather than a value slot.
 * Used to prevent the N-cell scan from overwriting label cells.
 *
 * Signals:
 *   1. Ends with ":" — almost always a label ("Professor:", "Carga horária presencial:")
 *   2. ALL-CAPS text longer than 5 chars with no lowercase — table header
 *      ("HABILIDADES", "OBJETO DE CONHECIMENTO", "TRIMESTRE")
 */
function looksLikeLabel(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.endsWith(":")) return true;
  // Strip diacritics for the uppercase test so accented letters (Á, Ã, É…) count
  const stripped = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const hasLowercase = /[a-z]/.test(stripped);
  const hasUppercase = /[A-Z]/.test(stripped);
  if (!hasLowercase && hasUppercase && t.length > 5) return true;
  return false;
}

/**
 * Returns true when a cell's raw XML contains bold formatting.
 * Bold text without ":" or ALL-CAPS is a common label style in some school templates.
 * Used alongside looksLikeLabel to improve label detection coverage.
 */
function hasBoldText(cellXml: string): boolean {
  // Matches <w:b/>, <w:b w:val="true"/>, <w:b> but NOT <w:bCs> (complex script bold)
  return /<w:b(?:\s(?!Cs)[^>]*)?\/>/.test(cellXml) || /<w:b(?:\s(?!Cs)[^>]*)?>/.test(cellXml);
}

/**
 * Returns true when a cell text is a period/trimester marker rather than a content value.
 * Used to prevent period markers ("1º", "2º", "3º") from being misidentified as field values
 * in multi-period tables (annual plans with trimester/bimester columns).
 */
function looksLikePeriodMarker(text: string): boolean {
  const t = text.trim();
  return /^\d[ºoO°]?$/.test(t) ||
    /^\d\.?\s*(°|º|tri|bim|sem)/i.test(t) ||
    /^(primeiro|segundo|terceiro|quarto)\s*(trimestre|bimestre|semestre)/i.test(t);
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

// ── Paragraph helpers ────────────────────────────────────────────────────────

/** Returns the extracted text of each <w:p> element in the given XML node. */
function extractParagraphTexts(xml: string): string[] {
  return [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map((m) => extractText(m[0]));
}

/**
 * Appends " {{fieldKey}}" as a new run to the paragraph in `cellXml` whose
 * normalized text matches `labelNorm`.  Returns the modified cell XML, or the
 * original if no matching paragraph is found or the placeholder is already there.
 */
function appendToParagraph(cellXml: string, labelNorm: string, fieldKey: string): string {
  const placeholder = `{{${fieldKey}}}`;
  const paras = [...cellXml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)];
  for (const paraMatch of paras) {
    const paraXml = paraMatch[0];
    if (normText(extractText(paraXml)) !== labelNorm) continue;
    if (paraXml.includes(placeholder)) return cellXml; // idempotent
    const closeIdx = paraXml.lastIndexOf("</w:p>");
    if (closeIdx === -1) continue;
    const newRun = `<w:r><w:t xml:space="preserve"> ${placeholder}</w:t></w:r>`;
    const newParaXml = paraXml.slice(0, closeIdx) + newRun + paraXml.slice(closeIdx);
    return cellXml.replace(paraXml, newParaXml);
  }
  return cellXml;
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

// ── Remove a single placeholder ─────────────────────────────────────────────

/**
 * Removes all occurrences of {{fieldKey}} from the DOCX by emptying the
 * <w:t> element that contains it.  Leaves all other text and formatting intact.
 */
export function removePlaceholder(docxBuffer: Buffer, fieldKey: string): Buffer {
  const zip = new PizZip(docxBuffer);
  const xmlPath = "word/document.xml";
  if (!zip.files[xmlPath]) return docxBuffer;

  const placeholder = `{{${fieldKey}}}`;
  let xml = zip.files[xmlPath].asText();
  if (!xml.includes(placeholder)) return docxBuffer;

  xml = xml.replace(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g, (match, text: string) =>
    text === placeholder ? "<w:t/>" : match,
  );

  zip.file(xmlPath, xml);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}

// ── Inject at a specific cell (by text fingerprint) ──────────────────────────

/**
 * Finds the `ordinal`-th <w:tc> whose normalized text equals `cellText` and
 * injects {{fieldKey}} into it.  If cellText is empty or no match is found,
 * returns the buffer unchanged so injectPlaceholders() can handle it later.
 */
export function injectAtCell(
  docxBuffer: Buffer,
  cellText: string,
  ordinal: number,
  fieldKey: string,
): Buffer {
  if (!cellText.trim()) return docxBuffer;

  const zip = new PizZip(docxBuffer);
  const xmlPath = "word/document.xml";
  if (!zip.files[xmlPath]) return docxBuffer;

  let xml = zip.files[xmlPath].asText();
  const placeholder = `{{${fieldKey}}}`;

  const tcRegex = /<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g;
  let match: RegExpExecArray | null;
  let hits = 0;

  while ((match = tcRegex.exec(xml)) !== null) {
    const tcXml = match[0];
    const text = extractText(tcXml).trim();

    if (normText(text) === normText(cellText)) {
      if (hits === ordinal) {
        if (tcXml.includes(placeholder)) return docxBuffer; // already there
        const newTc = setCellContent(tcXml, placeholder);
        xml = xml.slice(0, match.index) + newTc + xml.slice(match.index + tcXml.length);
        zip.file(xmlPath, xml);
        return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
      }
      hits++;
    }
  }

  return docxBuffer; // no match — caller falls back to injectPlaceholders
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
  // Only skip injection if ALL schema fields already have placeholders in the document
  if (schema.every((f) => xml.includes(`{{${f.key}}}`))) return docxBuffer;

  // Only strip change tracking, preserve all other formatting
  xml = stripChangeTracking(xml);

  const rows = parseRows(xml);
  const used = new Set<string>();

  // ── Pass 0: Multi-label paragraph injection ─────────────────────────────────
  // Handles cells that contain ≥2 label paragraphs ending with ":" in the same cell.
  // Example: one cell with "Professor(a):\nÁrea/Componente:\nTurma:" — each gets
  // its own inline placeholder appended to that paragraph.
  // This also handles ALL CAPS + colon section headers that share a cell with
  // sub-labels (e.g. "TEMÁTICA ABORDADA:\n- Carga horária prevista:").
  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    let rowXml = row.xml;
    let rowModified = false;

    for (let ci = 0; ci < row.cells.length; ci++) {
      const cellXml = row.cells[ci];
      if (!cellXml) continue;

      const paraTexts = extractParagraphTexts(cellXml).map((t) => t.trim());
      const labelParas = paraTexts.filter((t) => t.endsWith(":") && t.length > 2);
      if (labelParas.length < 2) continue; // single-label cells handled by later passes

      let newCellXml = cellXml;
      for (const pt of labelParas) {
        const field = matchField(pt, schema, used);
        if (!field) continue;
        newCellXml = appendToParagraph(newCellXml, normText(pt), field.key);
        used.add(field.key);
      }

      if (newCellXml !== cellXml) {
        rowXml = replaceFirst(rowXml, cellXml, newCellXml);
        row.cells[ci] = newCellXml;
        row.cellTexts[ci] = extractText(newCellXml);
        rowModified = true;
      }
    }

    if (rowModified) {
      xml = replaceFirst(xml, row.xml, rowXml);
      rows[ri] = { xml: rowXml, cells: row.cells, cellTexts: row.cellTexts };
    }
  }

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
      // Skip multi-label cells — already handled by Pass 0
      const paraTexts = extractParagraphTexts(row.cells[ci] ?? "").map((t) => t.trim());
      const labelParaCount = paraTexts.filter((t) => t.endsWith(":") && t.length > 2).length;
      if (labelParaCount >= 2) continue;

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

    // ── 1-cell row: label → next row content OR same-cell injection ─────────
    if (row.cells.length === 1) {
      const singleCellText = row.cellTexts[0].trim();
      // Skip if already handled by Pass 0 (multi-label cell)
      if (singleCellText.includes("{{")) { continue; }

      const stripped = singleCellText.normalize("NFD").replace(/[̀-ͯ]/g, "");
      const hasMixedCase = /[a-z]/.test(stripped);
      const hasColon = singleCellText.endsWith(":");

      // ALL CAPS + no colon → title/subtitle (new rule: school name, document title, etc.)
      if (!hasMixedCase && !hasColon) { continue; }

      const nextRowText = ri + 1 < rows.length ? (rows[ri + 1].cellTexts[0] ?? "").trim() : "x";
      const hasEmptyBelow = nextRowText === "";
      // Mixed-case + no colon + no adjacent empty → section title (Rule 13)
      const isMixedCaseTitle = hasMixedCase && !hasColon && !hasEmptyBelow;
      if (isMixedCaseTitle) { continue; }

      const field = matchField(singleCellText, schema, used);
      if (!field) { continue; }

      // Determine injection target: if next row is also a label (fill_cell pattern),
      // inject inline in the CURRENT cell. Otherwise inject into the next row (adjacent_below).
      const nextIsLabel = nextRowText !== "" && looksLikeLabel(nextRowText);

      if (nextIsLabel) {
        // Fill-cell: value space is within the current cell → append placeholder inline
        const origCell = row.cells[0];
        let newCell = appendToParagraph(origCell, normText(singleCellText), field.key);
        if (newCell === origCell) {
          // Fallback: replace cell text if no matching paragraph found (e.g. split runs)
          newCell = clearAndSetCellText(origCell, `${singleCellText} {{${field.key}}}`);
        }
        const newRowXml = replaceFirst(row.xml, origCell, newCell);
        xml = replaceFirst(xml, row.xml, newRowXml);
        rows[ri] = { xml: newRowXml, cells: [newCell], cellTexts: [extractText(newCell)] };
        used.add(field.key);
      } else if (ri + 1 < rows.length) {
        // Adjacent-below: inject into next row's first cell
        const nextRow = rows[ri + 1];
        if (nextRow.cells.length >= 1) {
          const origCell = nextRow.cells[0];
          const newCell = setCellContent(origCell, `{{${field.key}}}`);
          const newNextRowXml = replaceFirst(nextRow.xml, origCell, newCell);
          xml = replaceFirst(xml, nextRow.xml, newNextRowXml);
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

      // Reject if the next cell looks like a label — either by structural
      // heuristics (ends with ":", ALL-CAPS header) or by schema matching.
      // This prevents overwriting label cells like "Carga horária presencial:"
      // or column headers like "OBJETO DE CONHECIMENTO".
      if (looksLikeLabel(cellTexts[ci + 1])) continue;
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
        // Only inject into genuinely empty value slots — skip label-looking cells
        // and cells with substantial content (likely a pre-filled value or sub-header)
        const fallbackTarget = nextCellTexts[ci].trim();
        if (looksLikeLabel(fallbackTarget)) continue;
        if (fallbackTarget.length > 10) continue;
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

// ── Cell helpers ─────────────────────────────────────────────────────────────

/** Returns the number of grid columns a cell spans (1 = no merge). */
function getCellGridSpan(cellXml: string): number {
  const m = cellXml.match(/<w:gridSpan\s+w:val="(\d+)"/);
  return m ? parseInt(m[1], 10) : 1;
}

// ── Structural pre-scan ──────────────────────────────────────────────────────

/**
 * Describes a single label→value pair detected in the DOCX structure.
 * Used to pre-populate the AI prompt with accurate field positions before
 * the model has to infer them from raw HTML.
 */
export interface StructuralPair {
  label: string;
  /** First 60 chars of the value cell (blank for empty template cells) */
  valuePreview: string;
  /** Positional relationship between the label cell and its value slot */
  pattern: "adjacent_right" | "adjacent_below" | "column_header" | "inline_colon" | "period_column";
  /** For "period_column" pattern: the trimester/bimester suffix (e.g. "_tr1", "_tr2", "_tr3") */
  periodSuffix?: string;
}

/**
 * Walks every table in the DOCX and returns detected label→value pairs.
 * The result is passed to the AI prompt so the model works from known
 * structure rather than inferring it from raw HTML.
 */
export function scanDocxStructure(docxBuffer: Buffer): StructuralPair[] {
  const zip = new PizZip(docxBuffer);
  const xmlPath = "word/document.xml";
  if (!zip.files[xmlPath]) return [];

  const xml = stripChangeTracking(zip.files[xmlPath].asText());
  const rows = parseRows(xml);
  const pairs: StructuralPair[] = [];
  const seenLabels = new Set<string>();

  function addPair(pair: StructuralPair) {
    // Include periodSuffix in dedup key so _tr1/_tr2/_tr3 variants of the same label are all kept
    const key = normText(pair.label) + (pair.periodSuffix ?? "");
    if (!key || seenLabels.has(key)) return;
    seenLabels.add(key);
    pairs.push(pair);
  }

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];

    // ── Inline "Label: value" within a single cell ────────────────────────
    for (let ci = 0; ci < row.cells.length; ci++) {
      const cellXml = row.cells[ci];
      if (!cellXml) continue;

      // Paragraph-level scan: cells with multiple "label:" paragraphs
      // (e.g. "Professor(a):\nÁrea/Componente:\nTurma:" in one cell).
      const paraTexts = extractParagraphTexts(cellXml).map((t) => t.trim()).filter((t) => t);
      const labelParas = paraTexts.filter((t) => t.endsWith(":") && t.length > 2);
      if (labelParas.length >= 2) {
        for (const pt of labelParas) {
          // ALL CAPS + no colon is never reached here (all end with ":"), but
          // skip ALL CAPS paragraphs that somehow slipped through (safety guard).
          const pHasMixed = /[a-z]/.test(pt.normalize("NFD").replace(/[̀-ͯ]/g, ""));
          if (!pHasMixed && !pt.endsWith(":")) continue; // title paragraph within cell
          const label = pt.replace(/:+$/, "").replace(/^-\s*/, "").trim();
          if (label.length < 2) continue;
          addPair({ label, valuePreview: "", pattern: "inline_colon" });
        }
        continue; // don't also run the concatenated-text scan for this cell
      }

      // Single-label cell: classic "Label: value" in concatenated text
      const t = row.cellTexts[ci].trim();
      const colonIdx = t.indexOf(":");
      if (colonIdx <= 1 || colonIdx >= t.length - 1) continue;
      const label = t.slice(0, colonIdx).trim();
      const value = t.slice(colonIdx + 1).trim();
      if (label.length < 2 || !value || value.length > 300) continue;
      addPair({ label, valuePreview: value.slice(0, 60), pattern: "inline_colon" });
    }

    // ── All-label header row → column_header or period_column ────────────
    const nonEmpty = row.cellTexts.filter((t) => t.trim());
    const allLabels = nonEmpty.length > 0 && nonEmpty.every((t) => looksLikeLabel(t.trim()));
    if (allLabels && ri + 1 < rows.length) {
      const nextRow = rows[ri + 1];

      // Multi-period detection: next row has 2+ period markers (e.g. "1º", "2º", "3º")
      // → annual plan with trimester columns. Emit period_column pairs instead.
      const periodCols = nextRow.cellTexts
        .map((t, ci) => ({ ci, label: t.trim() }))
        .filter(({ label }) => looksLikePeriodMarker(label));

      if (periodCols.length >= 2) {
        const periodColSet = new Set(periodCols.map((p) => p.ci));
        const seenContent = new Set<string>();
        // Content columns: all columns that are NOT period markers (unique by normalized label)
        const contentCols = row.cellTexts
          .map((t, ci) => ({ ci, label: t.replace(/:+$/, "").trim() }))
          .filter(({ ci, label }) => label && !periodColSet.has(ci))
          .filter(({ label }) => {
            const n = normText(label);
            if (seenContent.has(n)) return false;
            seenContent.add(n);
            return true;
          });

        periodCols.forEach((period, idx) => {
          const suffix = `_tr${idx + 1}`;
          for (const { label } of contentCols) {
            addPair({ label, valuePreview: "", pattern: "period_column", periodSuffix: suffix });
          }
          // Period marker cell itself (checkbox/marking per trimester)
          addPair({ label: period.label, valuePreview: period.label, pattern: "period_column", periodSuffix: suffix });
        });
        continue;
      }

      for (let ci = 0; ci < row.cellTexts.length && ci < nextRow.cellTexts.length; ci++) {
        const label = row.cellTexts[ci].trim();
        if (!label) continue;
        const nextText = (nextRow.cellTexts[ci] ?? "").trim();
        if (looksLikeLabel(nextText)) continue;
        if (looksLikePeriodMarker(nextText)) continue;
        addPair({
          label: label.replace(/:+$/, "").trim(),
          valuePreview: nextText.slice(0, 60),
          pattern: "column_header",
        });
      }
      continue; // don't also run adjacent scan for this row
    }

    // ── 1-cell row → adjacent_below OR inline_colon (fill_cell) ──────────
    if (row.cells.length === 1) {
      const t = row.cellTexts[0].trim();
      const tStripped = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
      const hasMixedCase = /[a-z]/.test(tStripped);
      const hasColon = t.endsWith(":");

      // ALL CAPS + no colon → title/subtitle row (school name, document title, etc.), skip
      if (!hasMixedCase && !hasColon) { continue; }

      const nextText = ri + 1 < rows.length ? (rows[ri + 1].cellTexts[0] ?? "").trim() : "";
      const hasEmptyBelow = nextText === "";

      // Classic label heuristic OR mixed-case with empty below (Rule 13)
      const isFieldLabel = looksLikeLabel(t) || (hasMixedCase && !hasColon && hasEmptyBelow);
      if (!isFieldLabel) { continue; }

      if (!looksLikeLabel(nextText)) {
        // adjacent_below: next cell is empty or has content (value slot in next row)
        addPair({
          label: t.replace(/:+$/, "").trim(),
          valuePreview: nextText.slice(0, 60),
          pattern: "adjacent_below",
        });
      } else {
        // fill_cell: next row is ALSO a label → value goes in the same cell as the label.
        // Report as inline_colon so the AI knows the value is in the same cell.
        addPair({
          label: t.replace(/:+$/, "").trim(),
          valuePreview: "",
          pattern: "inline_colon",
        });
      }
      continue;
    }

    // ── N-cell row: left-to-right label | value scan → adjacent_right ─────
    // Compute gridSpan for each cell to detect merged-cell labels that span
    // most of the row width (≥60%) — those need adjacent_below, not adjacent_right.
    const cellSpans = row.cells.map((c) => getCellGridSpan(c ?? ""));
    const totalSpan = cellSpans.reduce((a, b) => a + b, 0);

    let ci = 0;
    while (ci < row.cells.length - 1) {
      const t = row.cellTexts[ci].trim();
      // A cell is a label if it matches textual heuristics (ends with ":", ALL-CAPS)
      // OR if the cell uses bold formatting (common in some school templates)
      const cellIsLabel = looksLikeLabel(t) || (t.length > 1 && hasBoldText(row.cells[ci] ?? ""));
      if (!cellIsLabel) { ci++; continue; }

      // Item 3: if label cell spans ≥60% of the row, it's likely a section header
      // whose value is in the next row (adjacent_below), not the cell to the right.
      const labelSpanRatio = totalSpan > 0 ? (cellSpans[ci] ?? 1) / totalSpan : 0;
      if (labelSpanRatio >= 0.6 && ri + 1 < rows.length) {
        const belowText = (rows[ri + 1].cellTexts[0] ?? "").trim();
        if (!looksLikeLabel(belowText) && !looksLikePeriodMarker(belowText)) {
          addPair({
            label: t.replace(/:+$/, "").trim(),
            valuePreview: belowText.slice(0, 60),
            pattern: "adjacent_below",
          });
        }
        ci++;
        continue;
      }

      const nextText = row.cellTexts[ci + 1].trim();
      if (looksLikeLabel(nextText) || hasBoldText(row.cells[ci + 1] ?? "")) { ci++; continue; }
      // Period markers are column identifiers, not field values — skip
      if (looksLikePeriodMarker(nextText)) { ci++; continue; }
      addPair({
        label: t.replace(/:+$/, "").trim(),
        valuePreview: nextText.slice(0, 60),
        pattern: "adjacent_right",
      });
      ci += 2;
    }
  }

  return pairs;
}

// ── Post-injection validation ────────────────────────────────────────────────

export interface InjectionReport {
  /** Schema keys that successfully received a {{key}} placeholder in the DOCX */
  injected: string[];
  /** Schema keys with no placeholder found — user must place them manually */
  missing: string[];
}

/**
 * After running injectPlaceholders, compares the schema against the
 * placeholders actually present in the DOCX.  Returns which fields were
 * placed automatically and which still need manual positioning.
 */
export function reportInjections(
  docxBuffer: Buffer,
  schema: TemplateFieldSchema[],
): InjectionReport {
  const placed = new Set(scanPlaceholders(docxBuffer));
  return {
    injected: schema.map((f) => f.key).filter((k) => placed.has(k)),
    missing:  schema.map((f) => f.key).filter((k) => !placed.has(k)),
  };
}

// ── Scan existing {{...}} placeholders ──────────────────────────────────────

/**
 * Scans a DOCX for any {{key}} patterns already written in the document.
 * Returns unique keys found. Useful when the user has pre-annotated the Word
 * file locally with {{variable_name}} before uploading.
 */
export function scanPlaceholders(docxBuffer: Buffer): string[] {
  const zip = new PizZip(docxBuffer);
  const xml = zip.files["word/document.xml"]?.asText() ?? "";
  const pattern = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    found.add(match[1].toLowerCase());
  }
  return [...found];
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
