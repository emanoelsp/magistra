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
    .replace(/\(s\)/g, "s")       // "Habilidade(s)" → "Habilidades"
    .replace(/\(es\)/g, "es")     // "Professor(es)" → "Professores"
    .replace(/n[°º]/g, "numero")  // "Nº" / "N°" → "numero"
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Semantic alias dictionary (Item 2) ──────────────────────────────────────
// Maps normText()-normalized label variants → canonical schema field key.
// Checked as a fallback in matchField when fuzzy scoring is below threshold.
// Extend this list to cover regional or school-specific naming conventions.
const LABEL_ALIASES: Record<string, string> = {
  // Teacher / instructor
  "docente":               "professor",
  "prof":                  "professor",
  "orientador":            "professor",
  "regente":               "professor",
  "ministrante":           "professor",
  "formador":              "professor",
  // Subject / component
  "disciplina":            "area_componente",
  "componente":            "area_componente",
  "componente curricular": "area_componente",
  "materia":               "area_componente",
  // Grade / class
  "ano":                   "turma",
  "serie":                 "turma",
  "classe":                "turma",
  "ano serie":             "turma",
  // Date / period
  "data":                  "data_realizacao",
  "periodo":               "data_realizacao",
  "data inicio":           "data_inicio",
  "data fim":              "data_fim",
  // Workload
  "ch":                    "carga_horaria",
  "horas":                 "carga_horaria",
  "ch prevista":           "carga_horaria",
  "carga horaria prevista":"chprevista",
  // School / institution
  "escola":                "unidade_escolar",
  "colegio":               "unidade_escolar",
  "instituicao":           "unidade_escolar",
};

/**
 * Returns true when a text block is an instructional/observational note rather
 * than a field anchor.  Blocks starting with "Obs:", "Nota:", "Observação:" etc.
 * are business-rule descriptions that must never be treated as labels or injected.
 * Rule 4 / Rule 15 (Imutabilidade Estrita).
 */
function isInstructionalBlock(text: string): boolean {
  return /^\s*(obs[.:\s]|nota[s]?[.:\s]|observa[çc][aã]o[s]?[.:\s]|n\.b[.:\s])/i.test(text);
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

// ── Cell span helpers (Item 1: GridSpan / vMerge Awareness) ─────────────────

/** Returns the number of grid columns a cell spans (1 = no merge). */
function getCellGridSpan(cellXml: string): number {
  const m = cellXml.match(/<w:gridSpan\s+w:val="(\d+)"/);
  return m ? parseInt(m[1], 10) : 1;
}

/**
 * Returns true when a cell is a vertical-merge continuation (not the first
 * cell in the merged group). Continuation cells carry <w:vMerge/> without
 * w:val="restart" — they are visually empty because their content lives in
 * the restart cell above. Skipping them prevents treating the empty XML as a
 * label or value slot during injection.
 */
function isVMergeContinuation(cellXml: string): boolean {
  const m = cellXml.match(/<w:vMerge(?:\s[^>]*)?\/?>/);
  if (!m) return false;
  return !m[0].includes('w:val="restart"');
}

/**
 * Returns the virtual column index for each physical cell in a row.
 * A cell with <w:gridSpan w:val="N"/> advances the column counter by N, so the
 * next cell starts at the correct visual column even if earlier cells are merged.
 * Used to match label cells to value cells across rows when the two rows have
 * different gridSpan layouts.
 */
function computeVirtualColIndices(cells: string[]): number[] {
  const indices: number[] = [];
  let vcol = 0;
  for (const cell of cells) {
    indices.push(vcol);
    vcol += getCellGridSpan(cell);
  }
  return indices;
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
/**
 * Returns true when a cell's XML contains an inline image (drawing).
 * Used to skip image cells so they are never treated as value slots.
 */
function hasImageContent(cellXml: string): boolean {
  return /<wp:inline\b|<wp:anchor\b|<v:imagedata\b/.test(cellXml);
}

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

  // Alias fallback (Item 2): if no field scored above threshold, check the
  // semantic alias dictionary for common label synonyms before giving up.
  if (!best) {
    for (const [alias, targetKey] of Object.entries(LABEL_ALIASES)) {
      const matches =
        needle === alias ||
        (alias.length >= 3 && needle.includes(alias)) ||
        (needle.length >= 3 && alias.includes(needle));
      if (matches) {
        const aliasField = schema.find((f) => !used.has(f.key) && f.key === targetKey);
        if (aliasField) return aliasField;
      }
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
 * Returns a preview of a cell's block content by joining non-empty paragraph
 * texts with newlines (Rule 3: scalar vs. block distinction).
 * Used for adjacent_below valuePreview so the AI receives a multi-line preview
 * instead of the concatenated-without-separators extractText result.
 */
function cellBlockPreview(cellXml: string, maxLen = 120): string {
  const texts = extractParagraphTexts(cellXml).map((t) => t.trim()).filter(Boolean);
  return texts.join("\n").slice(0, maxLen);
}

/**
 * Builds a table-position index so non-table paragraph passes can skip
 * paragraphs that happen to be inside a <w:tbl> element.
 */
function buildTableRanges(xml: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const m of xml.matchAll(/<w:tbl[\s>][\s\S]*?<\/w:tbl>/g)) {
    ranges.push([m.index!, m.index! + m[0].length]);
  }
  return ranges;
}

function inTableRange(pos: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([s, e]) => pos >= s && pos < e);
}

/**
 * Returns visual line texts from a cell, splitting at both </w:p> paragraph
 * boundaries and <w:br/> soft-return elements within paragraphs.
 * Used as a fallback when paragraph-level matching fails (soft-return templates).
 */
function extractLinesFromCell(cellXml: string): string[] {
  const lines: string[] = [];
  for (const paraMatch of cellXml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)) {
    const paraXml = paraMatch[0];
    if (!paraXml.includes("<w:br")) {
      const t = extractText(paraXml).trim();
      if (t) lines.push(t);
      continue;
    }
    // Segment-based split: cut the paragraph XML at every <w:br/> position.
    // Handles Format C (all visual lines in one <w:r> run with alternating
    // <w:t> and <w:br/> elements) without any run-level processing.
    let segStart = 0;
    for (const brMatch of paraXml.matchAll(/<w:br(?:\s[^>]*)?\/?>/g)) {
      const t = extractText(paraXml.slice(segStart, brMatch.index!)).trim();
      if (t) lines.push(t);
      segStart = brMatch.index! + brMatch[0].length;
    }
    const lastT = extractText(paraXml.slice(segStart)).trim();
    if (lastT) lines.push(lastT);
  }
  return lines;
}

/**
 * Finds the normalized text of the specific paragraph (or soft-return line)
 * within a cell that best matches the given field label.
 *
 * Needed when the cell has prefix header content (e.g. "CEDUP HERING" before
 * "Professor(a):") — in that case normText(cellText) is a concatenation that
 * doesn't match any single paragraph, causing appendToParagraph to fail.
 *
 * Returns null when no paragraph/line in the cell matches the field label.
 */
function resolveLabelNormFromCell(
  cellXml: string,
  field: TemplateFieldSchema,
): string | null {
  const hay = normText(field.label);
  if (!hay) return null;

  // Try paragraph-level exact or endsWith match
  const paraTexts = extractParagraphTexts(cellXml).map((t) => t.trim());
  for (const pt of paraTexts) {
    const pnorm = normText(pt);
    if (pnorm === hay || (pnorm.length >= hay.length && pnorm.endsWith(hay))) return pnorm;
  }

  // Try soft-return line matching
  for (const line of extractLinesFromCell(cellXml)) {
    const lnorm = normText(line);
    if (lnorm === hay || (lnorm.length >= hay.length && lnorm.endsWith(hay))) return lnorm;
  }

  return null;
}

/**
 * Appends " {{fieldKey}}" as a new run to the paragraph in `cellXml` whose
 * normalized text matches `labelNorm`.  Returns the modified cell XML, or the
 * original if no matching paragraph is found or the placeholder is already there.
 *
 * Matching rules (in order):
 *   1. Exact match: normText(para) === labelNorm
 *   2. Suffix match: normText(para) ends with labelNorm
 *      (handles cells where the paragraph has brief preceding content)
 *   3. Soft-return line match: tries lines within paragraphs that use <w:br/>
 */
function appendToParagraph(cellXml: string, labelNorm: string, fieldKey: string): string {
  const placeholder = `{{${fieldKey}}}`;
  const paras = [...cellXml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)];

  // First pass: paragraph-level matching (skip paragraphs with soft returns).
  // Paragraphs that contain <w:br/> are handled exclusively by the soft-return
  // pass below so we inject at the correct visual line, not the paragraph end.
  for (const paraMatch of paras) {
    const paraXml = paraMatch[0];
    if (paraXml.includes("<w:br")) continue; // defer to soft-return pass

    const paraNorm = normText(extractText(paraXml));

    // Accept: exact | suffix (header prefix + label) | prefix (label + value)
    const matches =
      paraNorm === labelNorm ||
      (labelNorm.length >= 3 && paraNorm.length >= labelNorm.length && paraNorm.endsWith(labelNorm)) ||
      (labelNorm.length >= 4 && paraNorm.startsWith(labelNorm));

    if (!matches) continue;
    if (paraXml.includes(placeholder)) return cellXml; // idempotent
    const closeIdx = paraXml.lastIndexOf("</w:p>");
    if (closeIdx === -1) continue;
    const newRun = `<w:r><w:t xml:space="preserve"> ${placeholder}</w:t></w:r>`;
    const newParaXml = paraXml.slice(0, closeIdx) + newRun + paraXml.slice(closeIdx);
    return cellXml.replace(paraXml, newParaXml);
  }

  // Soft-return pass: segment-based.
  // Splits the paragraph XML at every <w:br/> position and matches each
  // segment independently.  Handles all DOCX layouts including Format C
  // (all visual lines packed into one <w:r> run with alternating <w:t>
  // and <w:br/> elements) — the run-based approach wrongly concatenated
  // all text and matched the wrong segment.
  //
  // Injection strategy:
  //   • Non-last segment: append placeholder text before the closing </w:t>
  //     in the matched segment (stays inside the existing <w:r> — valid DOCX).
  //   • Last segment: add a new <w:r> run before </w:p>.
  for (const paraMatch of paras) {
    const paraXml = paraMatch[0];
    if (!paraXml.includes("<w:br")) continue;
    if (paraXml.includes(placeholder)) return cellXml; // idempotent

    const segments: Array<{ startInPara: number; endInPara: number; isLast: boolean }> = [];
    let segStart = 0;
    for (const brMatch of paraXml.matchAll(/<w:br(?:\s[^>]*)?\/?>/g)) {
      segments.push({ startInPara: segStart, endInPara: brMatch.index!, isLast: false });
      segStart = brMatch.index! + brMatch[0].length;
    }
    const pCloseIdx = paraXml.lastIndexOf("</w:p>");
    segments.push({
      startInPara: segStart,
      endInPara: pCloseIdx >= 0 ? pCloseIdx : paraXml.length,
      isLast: true,
    });

    for (const seg of segments) {
      const segXml = paraXml.slice(seg.startInPara, seg.endInPara);
      const segNorm = normText(extractText(segXml));

      const matches =
        segNorm === labelNorm ||
        (labelNorm.length >= 3 && segNorm.length >= labelNorm.length && segNorm.endsWith(labelNorm)) ||
        (labelNorm.length >= 4 && segNorm.startsWith(labelNorm));

      if (!matches) continue;

      let newParaXml: string;
      if (!seg.isLast) {
        const lastWtClose = segXml.lastIndexOf("</w:t>");
        if (lastWtClose < 0) continue; // no <w:t> in segment
        const insertPos = seg.startInPara + lastWtClose;
        newParaXml =
          paraXml.slice(0, insertPos) + ` ${placeholder}` + paraXml.slice(insertPos);
      } else {
        const newRun = `<w:r><w:t xml:space="preserve"> ${placeholder}</w:t></w:r>`;
        newParaXml =
          paraXml.slice(0, seg.endInPara) + newRun + paraXml.slice(seg.endInPara);
      }

      return cellXml.replace(paraXml, newParaXml);
    }
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

// ── Remove / rename a single placeholder ─────────────────────────────────────

/**
 * Renames all occurrences of {{oldKey}} to {{newKey}} in the DOCX XML in-place.
 * Used when the user renames a field key while keeping the same label, so the
 * placeholder stays at its existing position instead of being removed and
 * re-injected by label-matching (which may choose the wrong cell).
 */
export function renamePlaceholder(docxBuffer: Buffer, oldKey: string, newKey: string): Buffer {
  const zip = new PizZip(docxBuffer);
  const xmlPath = "word/document.xml";
  if (!zip.files[xmlPath]) return docxBuffer;
  let xml = zip.files[xmlPath].asText();
  const oldPh = `{{${oldKey}}}`;
  const newPh = `{{${newKey}}}`;
  if (!xml.includes(oldPh)) return docxBuffer;
  xml = xml.split(oldPh).join(newPh);
  zip.file(xmlPath, xml);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}

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
 * Finds the target <w:tc> and injects {{fieldKey}} into it.
 *
 * Two modes depending on cellText:
 *   • Non-empty cellText: find the `ordinal`-th <w:tc> whose normalized text
 *     matches cellText (original text-fingerprint mode).
 *   • Empty cellText:     use `ordinal` as a global <w:tc> index (0-based),
 *     which is set by the client when the user typed into an empty cell.
 *     This avoids falling back to injectPlaceholders() which uses label
 *     matching and may place the variable in the wrong cell.
 *
 * Returns the buffer unchanged only when no matching cell is found.
 */
export function injectAtCell(
  docxBuffer: Buffer,
  cellText: string,
  ordinal: number,
  fieldKey: string,
): Buffer {
  const zip = new PizZip(docxBuffer);
  const xmlPath = "word/document.xml";
  if (!zip.files[xmlPath]) return docxBuffer;

  let xml = zip.files[xmlPath].asText();
  const placeholder = `{{${fieldKey}}}`;

  const tcRegex = /<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g;
  let match: RegExpExecArray | null;

  if (!cellText.trim()) {
    // Empty-cell mode: ordinal is the global <w:tc> index sent by the client
    let cellCount = 0;
    while ((match = tcRegex.exec(xml)) !== null) {
      if (cellCount === ordinal) {
        const tcXml = match[0];
        if (tcXml.includes(placeholder)) return docxBuffer; // idempotent
        const newTc = setCellContent(tcXml, placeholder);
        xml = xml.slice(0, match.index) + newTc + xml.slice(match.index + tcXml.length);
        zip.file(xmlPath, xml);
        return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
      }
      cellCount++;
    }
    return docxBuffer;
  }

  // Text-fingerprint mode: find ordinal-th cell matching cellText
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
  // Idempotency check via projected plain text — immune to OOXML run fragmentation.
  // xml.includes("{{key}}") fails when Word splits the token across multiple <w:r> nodes;
  // extractText joins all <w:t> content across run boundaries before checking.
  const projectedText = extractText(xml);
  if (schema.every((f) => projectedText.includes(`{{${f.key}}}`))) return docxBuffer;

  // Only strip change tracking, preserve all other formatting
  xml = stripChangeTracking(xml);

  const rows = parseRows(xml);
  // Pre-populate `used` with fields already present in the document so
  // injectPlaceholders never overwrites cells that were placed by injectAtCell.
  // Uses projected text for the same fragmentation-safety reason.
  const used = new Set<string>(schema.map((f) => f.key).filter((k) => projectedText.includes(`{{${k}}}`)));

  // ── Pass 0: Paragraph-level inline injection ────────────────────────────────
  // For 1-cell rows: processes ANY cell with ≥1 label paragraph ending with ":"
  //   (handles "Professor(a):", "HABILIDADES:", "AVALIAÇÃO:" and sub-items)
  // For N-cell rows: processes only cells with ≥2 label paragraphs
  //   (single-label cells in multi-column rows use N-cell adjacent scan in Pass 2)
  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    const is1CellRow = row.cells.length === 1;
    let rowXml = row.xml;
    let rowModified = false;

    for (let ci = 0; ci < row.cells.length; ci++) {
      const cellXml = row.cells[ci];
      if (!cellXml) continue;

      const paraTexts = extractParagraphTexts(cellXml).map((t) => t.trim());
      const labelParas = paraTexts.filter((t) => t.endsWith(":") && t.length > 2);
      // 1-cell rows: inject inline for any label paragraph (threshold = 1)
      // N-cell rows: only multi-label cells (threshold = 2); single-label → Pass 2
      const threshold = is1CellRow ? 1 : 2;
      if (labelParas.length < threshold) continue;

      // ALL CAPS + single-label in 1-cell row → defer to Pass 2 (adjacent_below).
      // Section headers like "HABILIDADES:" or "OBJETIVOS:" have their content area
      // in the next row; injecting inline would break that layout.
      // Mixed-case single labels ("Professor(a):", "Turma:") are always inline.
      if (is1CellRow && labelParas.length === 1) {
        const p = labelParas[0];
        const pStripped = p.normalize("NFD").replace(/[̀-ͯ]/g, "");
        if (!/[a-z]/.test(pStripped)) continue; // ALL CAPS → Pass 2
      }

      let newCellXml = cellXml;
      for (const pt of labelParas) {
        const field = matchField(pt, schema, used);
        if (!field) continue;
        const before = newCellXml;
        newCellXml = appendToParagraph(newCellXml, normText(pt), field.key);
        if (newCellXml !== before) {
          used.add(field.key);
        }
        // If appendToParagraph didn't find the paragraph (split runs, unusual XML),
        // do NOT add to used — Pass 1/2 will still attempt injection as fallback.
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

  // Build set of still-missing keys for targeted logging
  const missingAfterPass0 = new Set(schema.filter((f) => !extractText(xml).includes(`{{${f.key}}}`)).map((f) => f.key));
  if (missingAfterPass0.size > 0) {
    console.info(`[inject pass0→1] still missing: ${[...missingAfterPass0].join(", ")}`);
  }

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
      // Skip cells where the value portion itself contains sub-labels (additional colons).
      // clearAndSetCellText would destroy those sub-items; last-resort handles them.
      if (valueAfterColon.includes(":")) continue;

      const field = matchField(potentialLabel, schema, used);
      if (!field) {
        // Log only for still-missing fields that have a colon-pattern match
        const potNorm = normText(potentialLabel);
        for (const f of schema) {
          if (!missingAfterPass0.has(f.key)) continue;
          if (used.has(f.key)) continue;
          const fn = normText(f.label);
          if (fn.length >= 3 && (potNorm.includes(fn) || fn.includes(potNorm))) {
            console.info(`[inject pass1 NO-MATCH] key=${f.key} label="${f.label}" potentialLabel="${potentialLabel}" cellText="${cellText.slice(0, 80)}" row${ri}c${ci}`);
          }
        }
        continue;
      }

      // Preserve the label prefix and inject placeholder as value
      const labelPrefix = cellText.slice(0, colonIdx + 1); // "Professor(a):"
      const newContent = `${labelPrefix} {{${field.key}}}`;
      const origCell = row.cells[ci];
      const newCell = clearAndSetCellText(origCell, newContent);
      console.info(`[inject pass1 OK] ${field.key} row${ri}c${ci} "${cellText.slice(0, 60)}" → "${newContent.slice(0, 60)}"`);
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

      // Compute next-row text early — needed for both ALL-CAPS and mixed-case checks.
      const nextRowText = ri + 1 < rows.length ? (rows[ri + 1].cellTexts[0] ?? "").trim() : "x";
      const hasEmptyBelow = nextRowText === "";

      // ALL CAPS + no colon: title by default, BUT if the next row is empty it is a
      // section field anchor (Rule 3 — e.g. "PROJETOS INTEGRADORES").
      // ALL CAPS + empty below falls through to the adjacent_below injection path below.
      if (!hasMixedCase && !hasColon && !hasEmptyBelow) { continue; }

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
        const labelNorm = resolveLabelNormFromCell(origCell, field) ?? normText(singleCellText);
        let newCell = appendToParagraph(origCell, labelNorm, field.key);
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

    for (let ci = 0; ci < cells.length; ci++) {
      // Item 1: skip vertical-merge continuation cells — they have no content
      // and no label; treating them as value slots corrupts column alignment.
      if (isVMergeContinuation(cells[ci] ?? "")) continue;

      // Primary match: try the full cell text
      let field = matchField(cellTexts[ci], schema, used);

      // Fallback: try each paragraph individually.
      // Handles cells that combine header text with a label (e.g. "CEDUP HERING\nProfessor(a):")
      // where the concatenated cell text gives a low match score.
      if (!field) {
        const paraTexts = extractParagraphTexts(cells[ci]).map((t) => t.trim()).filter((t) => t.length > 1);
        for (const pt of paraTexts) {
          field = matchField(pt, schema, used);
          if (field) break;
        }
      }

      // Soft-return fallback: paragraph uses <w:br/> to separate visual lines
      if (!field && cells[ci].includes("<w:br")) {
        for (const line of extractLinesFromCell(cells[ci])) {
          field = matchField(line, schema, used);
          if (field) break;
        }
      }

      if (!field) continue;

      const hasNextCell = ci + 1 < cells.length;

      // When next cell is also a label (structural or schema match), or there is
      // no next cell at all, inject the placeholder inline in the current cell.
      // This handles rows like [Professor(a): | Área/Componente: | Turma:] where
      // every cell is a label with the value expected after the colon in the same cell.
      if (!hasNextCell || looksLikeLabel(cellTexts[ci + 1])) {
        const origCell = cells[ci];
        // Resolve the precise paragraph/line norm so appendToParagraph finds the right spot
        // (avoids the bug where normText(cellText) = "cedup heringprofessor a" but no
        //  individual paragraph has that exact normalization)
        const labelNorm = resolveLabelNormFromCell(origCell, field) ?? normText(cellTexts[ci]);
        const newCell = appendToParagraph(origCell, labelNorm, field.key);
        if (newCell !== origCell) {
          rowXml = replaceFirst(rowXml, origCell, newCell);
          cells[ci] = newCell;
          cellTexts[ci] = extractText(newCell);
          used.add(field.key);
          rowModified = true;
        }
        continue;
      }

      const excluded = new Set([...used, field.key]);
      const nextAlsoLabel = !!matchField(cellTexts[ci + 1], schema, excluded);
      if (nextAlsoLabel) {
        // Next cell matches a schema field — inject inline rather than overwriting it
        const origCell = cells[ci];
        const labelNorm = resolveLabelNormFromCell(origCell, field) ?? normText(cellTexts[ci]);
        const newCell = appendToParagraph(origCell, labelNorm, field.key);
        if (newCell !== origCell) {
          rowXml = replaceFirst(rowXml, origCell, newCell);
          cells[ci] = newCell;
          cellTexts[ci] = extractText(newCell);
          used.add(field.key);
          rowModified = true;
        }
        continue;
      }

      // Standard case: inject into cell[ci + 1]
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

      // Item 1 (GridSpan Awareness): compute virtual column indices for both
      // rows so a label at grid column V is paired with the value cell also at
      // virtual column V, regardless of how many merged cells exist in either row.
      const labelVCols = computeVirtualColIndices(cells);
      const nextVCols  = computeVirtualColIndices(nextRow.cells);
      // Build reverse map: virtual column → first physical cell index in next row
      const vColToNextIdx = new Map<number, number>();
      for (let i = 0; i < nextVCols.length; i++) {
        if (!vColToNextIdx.has(nextVCols[i])) vColToNextIdx.set(nextVCols[i], i);
      }

      for (let ci = 0; ci < cells.length; ci++) {
        // Skip vMerge continuation cells — they carry no label text
        if (isVMergeContinuation(cells[ci] ?? "")) continue;

        let field = matchField(cellTexts[ci], schema, used);

        // Rule 2 (Sparse Matrix): period markers "1º" / "2º" / "3º" may score below
        // the 0.4 threshold against labels like "1º Trimestre". Fall back to
        // ordinal position among period columns: 1st → tr1, 2nd → tr2, 3rd → tr3.
        // vMerge continuations are excluded from the ordinal count.
        if (!field && looksLikePeriodMarker(cellTexts[ci].trim())) {
          const periodPosition = cells
            .slice(0, ci + 1)
            .filter((_, idx) =>
              !isVMergeContinuation(cells[idx] ?? "") &&
              looksLikePeriodMarker(cellTexts[idx].trim()),
            )
            .length - 1; // 0-based: 0 → tr1, 1 → tr2, 2 → tr3
          const trNum = periodPosition + 1;
          field = schema.find(
            (f) => !used.has(f.key) && (f.key === `tr${trNum}` || f.key.endsWith(`_tr${trNum}`))
          ) ?? null;
        }

        if (!field) continue;

        // Find the value cell by virtual column (handles mismatched gridSpan layouts)
        const targetVCol = labelVCols[ci] ?? ci;
        const valueIdx   = vColToNextIdx.get(targetVCol) ?? ci;
        if (valueIdx >= nextCells.length) continue;

        // Only inject into genuinely empty value slots — skip label-looking cells
        // and cells with substantial content (likely a pre-filled value or sub-header)
        const fallbackTarget = nextCellTexts[valueIdx].trim();
        if (looksLikeLabel(fallbackTarget)) continue;
        if (fallbackTarget.length > 10) continue;
        const origCell = nextCells[valueIdx];
        const newCell = setCellContent(origCell, `{{${field.key}}}`);
        nextRowXml = replaceFirst(nextRowXml, origCell, newCell);
        nextCells[valueIdx] = newCell;
        nextCellTexts[valueIdx] = `{{${field.key}}}`;
        used.add(field.key);
        nextModified = true;
      }

      if (nextModified) {
        xml = replaceFirst(xml, nextRow.xml, nextRowXml);
        rows[ri + 1] = { xml: nextRowXml, cells: nextCells, cellTexts: nextCellTexts };
      }
    }
  }

  // ── Pass 3: Non-table paragraph injection (Rule 1) ───────────────────────────
  // Handles "Label: value" and "Label:" patterns in standalone paragraphs outside
  // tables. Covers templates that use flowing text rather than table grids.
  {
    const tblRanges = buildTableRanges(xml);
    const paraMatches = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)];
    for (let i = 0; i < paraMatches.length; i++) {
      const pm = paraMatches[i];
      if (inTableRange(pm.index!, tblRanges)) continue;
      const paraXml = pm[0];
      const text = extractText(paraXml).trim();
      if (!text || text.length < 3) continue;
      // Rule 15: skip instructional/observational blocks — never inject into "Obs:", "Nota:", etc.
      if (isInstructionalBlock(text)) continue;
      const colonIdx = text.indexOf(":");
      if (colonIdx <= 1) continue;
      const potentialLabel = text.slice(0, colonIdx).replace(/^[-\s]+/, "").trim();
      if (potentialLabel.length < 2) continue;
      const field = matchField(potentialLabel, schema, used);
      if (!field) continue;
      if (extractText(xml).includes(`{{${field.key}}}`)) { used.add(field.key); continue; }
      const value = text.slice(colonIdx + 1).trim();
      let newParaXml: string;
      if (value) {
        const labelPrefix = text.slice(0, colonIdx + 1);
        newParaXml = clearAndSetCellText(paraXml, `${labelPrefix} {{${field.key}}}`);
      } else {
        const closeIdx = paraXml.lastIndexOf("</w:p>");
        if (closeIdx < 0) continue;
        const newRun = `<w:r><w:t xml:space="preserve"> {{${field.key}}}</w:t></w:r>`;
        newParaXml = paraXml.slice(0, closeIdx) + newRun + paraXml.slice(closeIdx);
      }
      if (newParaXml !== paraXml) {
        xml = replaceFirst(xml, paraXml, newParaXml);
        used.add(field.key);
        console.info(`[inject pass3] ${field.key} standalone para "${text.slice(0, 60)}"`);
      }
    }
  }

  // ── Last-resort pass: field-scan for any still-missing fields ────────────────
  // Tries each still-missing field against every cell using fNorm (field label
  // norm) as labelNorm.  This routes appendToParagraph to the soft-return line
  // matching branch for <w:br/> paragraphs so it injects at the correct visual
  // line rather than the paragraph end.  All fields are tried per cell before
  // moving on, so multi-field cells (e.g. CEDUP header) are fully resolved in
  // one pass.
  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    let rowXml = row.xml;
    let rowModified = false;

    for (let ci = 0; ci < row.cells.length; ci++) {
      let cellXml = row.cells[ci];
      const origCellXml = cellXml;
      let cellModified = false;

      for (const f of schema) {
        if (used.has(f.key)) continue;
        if (extractText(xml).includes(`{{${f.key}}}`)) { used.add(f.key); continue; }

        const fNorm = normText(f.label);
        if (!fNorm || fNorm.length < 2) continue;

        // Pre-filter: skip cells with no text resembling this field label
        const cellNorm = normText(extractText(cellXml));
        const isRelated =
          cellNorm === fNorm ||
          cellNorm.endsWith(fNorm) ||
          cellNorm.startsWith(fNorm) ||
          (fNorm.length >= 4 && cellNorm.includes(fNorm));

        if (!isRelated) continue;

        const newCell = appendToParagraph(cellXml, fNorm, f.key);
        if (newCell !== cellXml) {
          console.info(`[inject last-resort] ${f.key} fNorm="${fNorm}" row${ri} cell${ci}`);
          cellXml = newCell;
          used.add(f.key);
          cellModified = true;
        } else {
          console.info(`[inject last-resort FAIL] ${f.key} fNorm="${fNorm}" row${ri} cell${ci}`);
        }
      }

      if (cellModified) {
        rowXml = replaceFirst(rowXml, origCellXml, cellXml);
        row.cells[ci] = cellXml;
        row.cellTexts[ci] = extractText(cellXml);
        rowModified = true;
      }
    }

    if (rowModified) {
      xml = replaceFirst(xml, row.xml, rowXml);
      rows[ri] = { xml: rowXml, cells: row.cells, cellTexts: row.cellTexts };
    }
  }

  // Diagnostic: log any fields that still have no placeholder after all passes
  const finalProjected = extractText(xml);
  const stillMissing = schema.filter((f) => !finalProjected.includes(`{{${f.key}}}`));
  if (stillMissing.length > 0) {
    console.info(`[injectPlaceholders] STILL MISSING after last-resort: ${stillMissing.map((f) => f.key).join(", ")}`);
    for (const f of stillMissing) {
      const labelNorm = normText(f.label);
      for (let ri = 0; ri < rows.length; ri++) {
        for (let ci = 0; ci < rows[ri].cellTexts.length; ci++) {
          const ct = rows[ri].cellTexts[ci];
          const ctnorm = normText(ct);
          const shortHay = labelNorm.slice(0, Math.min(6, labelNorm.length));
          if (shortHay && (ctnorm.includes(shortHay) || ct.toLowerCase().includes(f.label.slice(0, 6).toLowerCase()))) {
            console.info(`  → ${f.key} label="${f.label}" norm="${labelNorm}" | row${ri} cell${ci}: "${ct.slice(0, 80)}" (norm: "${ctnorm.slice(0, 80)}")`);
          }
        }
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

  // Pre-split Format C runs (single <w:r> containing multiple visual lines separated
  // by <w:br/>) into per-line runs. Without this, the mixed-text colorization would
  // move the colored {{key}} token outside all the line-break separators.
  xml = xml.replace(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g, (runXml) => {
    if (!runXml.includes("<w:br")) return runXml;
    const rOpenMatch = runXml.match(/^<w:r(\s[^>]*)?>/);
    const rAttrs = rOpenMatch?.[1] ?? "";
    const rPr = runXml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? "";
    const openTagLen = rOpenMatch?.[0].length ?? 4;
    const innerEnd = runXml.lastIndexOf("</w:r>");
    const inner = runXml.slice(openTagLen, innerEnd);
    const innerContent = rPr ? inner.replace(rPr, "") : inner;

    const chunks: string[] = [];
    let pos = 0;
    for (const brM of [...innerContent.matchAll(/<w:br(?:\s[^>]*)?\/?>/g)]) {
      chunks.push(innerContent.slice(pos, brM.index! + brM[0].length));
      pos = brM.index! + brM[0].length;
    }
    if (pos < innerContent.length) chunks.push(innerContent.slice(pos));

    const openTag = `<w:r${rAttrs}>`;
    return chunks
      .filter((c) => c.includes("<w:t") || c.includes("<w:br"))
      .map((c) => `${openTag}${rPr}${c}</w:r>`)
      .join("");
  });

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
      // Split into: label run | colored {{key}} run | optional tail run
      const pIdx = tText.indexOf(placeholder);
      const before = tText.slice(0, pIdx);
      const after = tText.slice(pIdx + placeholder.length);
      const origRPr = runXml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? "";

      const beforeT = before
        ? `<w:t xml:space="preserve">${before}</w:t>`
        : `<w:t/>`;

      // If the run still has <w:br/> (post-split residual), remove it and re-add
      // AFTER the colored token so the line break falls after {{key}}, not before.
      const brElements = runXml.match(/<w:br(?:\s[^>]*)?\/?>/g);
      const runBase = brElements
        ? runXml.replace(/<w:br(?:\s[^>]*)?\/?>/g, "")
        : runXml;

      let result = runBase.replace(tMatch[0], beforeT);
      result += `<w:r><w:rPr><w:color w:val="${color}"/></w:rPr><w:t xml:space="preserve">${placeholder}</w:t></w:r>`;
      if (after) {
        result += `<w:r>${origRPr}<w:t xml:space="preserve">${after}</w:t></w:r>`;
      }
      if (brElements) {
        result += `<w:r>${origRPr}${brElements.join("")}</w:r>`;
      }

      return result;
    }
    return runXml;
  });

  zip.file(xmlPath, xml);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
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
      // Rule 15: skip instructional cells ("Obs:", "Nota:", etc.) inside tables too
      if (isInstructionalBlock(t)) continue;
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

    // ── 1-cell row → paragraph-level scan (all label paragraphs → inline_colon) ──
    // Pass 0 now injects inline for all 1-cell rows with label paragraphs, so we
    // report inline_colon here for any paragraph ending with ":" (not adjacent_below).
    if (row.cells.length === 1) {
      const cellXml = row.cells[0] ?? "";
      const paraTexts = extractParagraphTexts(cellXml).map((t) => t.trim()).filter((t) => t);
      const labelParas = paraTexts.filter((t) => t.endsWith(":") && t.length > 2);

      if (labelParas.length >= 1) {
        for (const pt of labelParas) {
          const label = pt.replace(/:+$/, "").replace(/^-\s*/, "").trim();
          if (label.length < 2) continue;
          addPair({ label, valuePreview: "", pattern: "inline_colon" });
        }
        continue;
      }

      // No ":" paragraphs — fall back to mixed-case + empty-below rule (Rule 13 / Rule 3)
      const t = row.cellTexts[0].trim();
      const tStripped = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
      const hasMixedCase = /[a-z]/.test(tStripped);
      const hasColon = t.endsWith(":");

      const nextText = ri + 1 < rows.length ? (rows[ri + 1].cellTexts[0] ?? "").trim() : "sentinel";
      const hasEmptyBelow = nextText === "";

      // ALL CAPS + no colon: title unless followed by empty row.
      // Empty below signals a section field anchor (Rule 3 — e.g. "PROJETOS INTEGRADORES").
      if (!hasMixedCase && !hasColon) {
        if (!hasEmptyBelow) continue;
        // ALL CAPS + empty below → adjacent_below field anchor
        addPair({
          label: t.trim(),
          valuePreview: cellBlockPreview(rows[ri + 1]?.cells[0] ?? "", 120),
          pattern: "adjacent_below",
        });
        continue;
      }

      const isFieldLabel = hasMixedCase && !hasColon && hasEmptyBelow;
      if (!isFieldLabel) { continue; }

      addPair({
        label: t.trim(),
        valuePreview: cellBlockPreview(rows[ri + 1]?.cells[0] ?? "", 120),
        pattern: "adjacent_below",
      });
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
        const belowCellXml = rows[ri + 1].cells[0] ?? "";
        if (!looksLikeLabel(belowText) && !looksLikePeriodMarker(belowText) && !hasImageContent(belowCellXml)) {
          addPair({
            label: t.replace(/:+$/, "").trim(),
            // Rule 3: capture multi-paragraph block preview for textarea fields
            valuePreview: cellBlockPreview(belowCellXml, 120),
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
      // Image cells are not fillable value slots — skip (prevents header logo detection)
      if (hasImageContent(row.cells[ci + 1] ?? "") || hasImageContent(row.cells[ci] ?? "")) { ci++; continue; }
      addPair({
        label: t.replace(/:+$/, "").trim(),
        valuePreview: nextText.slice(0, 60),
        pattern: "adjacent_right",
      });
      ci += 2;
    }
  }

  // ── Rule 1: Standalone paragraphs outside tables ──────────────────────────
  // Scans <w:p> elements that are NOT inside any <w:tbl>. Only word/document.xml
  // is processed here — header/footer XML files are separate and never read,
  // satisfying Rule 5 (immutable header/footer isolation) by structural exclusion.
  {
    const tblRanges = buildTableRanges(xml);
    const paraMatches = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)];
    for (let i = 0; i < paraMatches.length; i++) {
      const pm = paraMatches[i];
      if (inTableRange(pm.index!, tblRanges)) continue;

      const text = extractText(pm[0]).trim();
      if (!text || text.length < 3) continue;

      // Rule 15: Instructional/observational blocks ("Obs:", "Nota:") → skip entirely
      if (isInstructionalBlock(text)) continue;

      // ALL-CAPS without colon → section title (Rule 13B), skip
      const stripped = text.normalize("NFD").replace(/[̀-ͯ]/g, "");
      if (!/[a-z]/.test(stripped) && !text.endsWith(":")) continue;

      const colonIdx = text.indexOf(":");
      if (colonIdx <= 1) continue;

      const label = text.slice(0, colonIdx).replace(/^[-\s]+/, "").trim();
      if (label.length < 2) continue;

      const value = text.slice(colonIdx + 1).trim();
      if (value) {
        // "Label: current value" → inline_colon with value as preview
        addPair({ label, valuePreview: value.slice(0, 60), pattern: "inline_colon" });
      } else {
        // "Label:" alone → look ahead for a non-empty, non-label paragraph
        let nextPreview = "";
        for (let j = i + 1; j < paraMatches.length && j <= i + 3; j++) {
          if (inTableRange(paraMatches[j].index!, tblRanges)) break;
          const t = extractText(paraMatches[j][0]).trim();
          if (t) { nextPreview = t; break; }
        }
        if (!looksLikeLabel(nextPreview)) {
          addPair({ label, valuePreview: nextPreview.slice(0, 60), pattern: "adjacent_below" });
        }
      }
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
    parser: (tag: string) => ({
      get: (scope: Record<string, unknown>) => {
        const value = scope[tag];
        // Item 3: boolean values must pass through as-is for {#has_X}/{^has_X} blocks
        if (typeof value === "boolean") return value;
        return typeof value === "string" ? value : "";
      },
    }),
  });

  const data: Record<string, string | boolean> = {};
  for (const field of schema) {
    data[field.key] = (values[field.key] ?? "").trim();
  }

  // Rule 4 — Temporal Middleware: auto-populate reserved system keys at generation time.
  // These are filled only when NOT already provided by the user (user value takes precedence).
  const now = new Date();
  const SYSTEM_VARS: Record<string, string> = {
    data_atual:  now.toLocaleDateString("pt-BR"),
    data_gerado: now.toLocaleDateString("pt-BR"),
    ano_letivo:  String(now.getFullYear()),
    ano_atual:   String(now.getFullYear()),
  };
  for (const [sysKey, sysVal] of Object.entries(SYSTEM_VARS)) {
    if (!data[sysKey]) data[sysKey] = sysVal;
  }

  // Item 3 — Boolean flags for conditional blocks (orphan node elimination).
  // For every schema field X, auto-generates has_X = true/false based on whether
  // the field has content. Use {{#has_X}}...{{/has_X}} in the Word template to
  // conditionally show/hide entire sections (e.g. a heading + its value block),
  // and {{^has_X}}...{{/has_X}} for the empty case. This prevents orphaned
  // section headings when the field is not filled in.
  //
  // Example Word markup:
  //   {{#has_adaptacao}}
  //   Adaptações necessárias: {{adaptacao}}
  //   {{/has_adaptacao}}
  for (const field of schema) {
    const val = data[field.key];
    data[`has_${field.key}`] = typeof val === "string" ? val.trim().length > 0 : !!val;
  }

  doc.render(data);
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}
