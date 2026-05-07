import "server-only";

import { NextResponse } from "next/server";
import mammoth from "mammoth";
import JSZip from "jszip";

import { getAdminDb } from "../../../../../lib/firebase/admin";
import { downloadFile } from "../../../../../lib/storage/blob";
import type { TemplateFieldSchema, TemplateRecord } from "../../../../../lib/types/firestore";

function normText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textFromHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// ─── DOCX layout extraction ───────────────────────────────────────────────────

interface DocxLayout {
  gridWidths: number[][];  // per-table column widths in twips (document order)
  cellAligns: string[];    // per-cell paragraph alignment in document order
}

async function extractDocxLayout(buffer: Buffer): Promise<DocxLayout> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const xmlContent = await zip.file("word/document.xml")?.async("string");
    if (!xmlContent) return { gridWidths: [], cellAligns: [] };

    // 1. Extract tblGrid column widths per table (in document order)
    const gridWidths: number[][] = [];
    const tblGridRe = /<w:tblGrid\b[^>]*>([\s\S]*?)<\/w:tblGrid>/g;
    let gm: RegExpExecArray | null;
    while ((gm = tblGridRe.exec(xmlContent)) !== null) {
      const ws: number[] = [];
      const colRe = /w:w="(\d+)"/g;
      let cm: RegExpExecArray | null;
      while ((cm = colRe.exec(gm[1])) !== null) ws.push(Number(cm[1]));
      if (ws.length > 0) gridWidths.push(ws);
    }

    // 2. Extract first-paragraph alignment for each cell (in document order).
    //    Cells inside nested tables are handled by inspecting only the content
    //    before the first nested <w:tbl> so inner-table cells are counted separately.
    const cellAligns: string[] = [];
    const cellRe = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g;
    let tm: RegExpExecArray | null;
    while ((tm = cellRe.exec(xmlContent)) !== null) {
      const inner = tm[1];
      // Look for alignment only in the cell's own content (before any nested table)
      const nestedAt = inner.indexOf("<w:tbl");
      const zone = nestedAt >= 0 ? inner.slice(0, nestedAt) : inner;
      const jc = zone.match(/<w:jc\b[^>]*w:val="([^"]+)"/);
      cellAligns.push(jc ? jc[1] : "");
    }

    return { gridWidths, cellAligns };
  } catch {
    return { gridWidths: [], cellAligns: [] };
  }
}

// ─── HTML post-processing ────────────────────────────────────────────────────

/**
 * Inject <colgroup> into each HTML <table> using DOCX grid widths (as % of table width).
 * Tables are matched in document order.
 */
function injectColgroups(html: string, gridWidths: number[][]): string {
  let tblIdx = 0;
  return html.replace(/<table([^>]*)>/g, (match, attrs) => {
    const grid = gridWidths[tblIdx++];
    if (!grid || grid.length === 0) return match;
    const total = grid.reduce((s, w) => s + w, 0);
    if (total === 0) return match;
    const cols = grid
      .map((w) => `<col style="width:${((w / total) * 100).toFixed(2)}%">`)
      .join("");
    return `<table${attrs}><colgroup>${cols}</colgroup>`;
  });
}

/**
 * Add text-align inline style to each <td> based on extracted cell alignments.
 * Cells are matched in document order (same order as mammoth output).
 * Left alignment is the browser default — only inject for center/right/justify.
 */
function injectCellAlignments(html: string, cellAligns: string[]): string {
  let cellIdx = 0;
  return html.replace(/<td([^>]*)>/g, (match, attrs) => {
    const raw = cellAligns[cellIdx++] ?? "";
    if (!raw || raw === "left") return match;
    const align = raw === "both" ? "justify" : raw;
    if (/style="/.test(attrs)) {
      return `<td${attrs.replace(/style="([^"]*)"/, `style="$1;text-align:${align}"`)}>`;
    }
    return `<td${attrs} style="text-align:${align}">`;
  });
}

// ─── Field annotation ─────────────────────────────────────────────────────────

function annotateFields(html: string, schema: TemplateFieldSchema[]): string {
  const tdRegex = /<td([^>]*)>([\s\S]*?)<\/td>/gi;
  const tds: {
    fullMatch: string;
    index: number;
    attrs: string;
    inner: string;
    text: string;
  }[] = [];

  let m: RegExpExecArray | null;
  tdRegex.lastIndex = 0;
  while ((m = tdRegex.exec(html)) !== null) {
    tds.push({
      fullMatch: m[0],
      index: m.index,
      attrs: m[1],
      inner: m[2],
      text: normText(textFromHtml(m[2])),
    });
  }

  const valueMap = new Map<number, TemplateFieldSchema>();
  const usedAsLabel = new Set<number>();

  for (const field of schema) {
    const labelNorm = normText(field.label);
    if (!labelNorm || labelNorm.length < 2) continue;
    const labelWords = labelNorm.split(/\s+/).filter((w) => w.length > 2);
    if (labelWords.length === 0) continue;

    let bestIdx = -1;
    let bestScore = 0;

    for (let i = 0; i < tds.length; i++) {
      if (usedAsLabel.has(i)) continue;
      const td = tds[i];
      if (td.text.length > 90) continue;
      if (!td.text) continue;

      const matched = labelWords.filter((w) => td.text.includes(w)).length;
      const score = matched / labelWords.length;
      if (score > bestScore && score >= 0.5) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx < 0) continue;
    usedAsLabel.add(bestIdx);

    // Find the value cell: first empty cell after the label (within a reasonable window).
    // Handles "label | value" (adjacent) and "label above | value below" layouts where
    // the adjacent cell is another header rather than an empty value cell.
    const searchEnd = Math.min(tds.length, bestIdx + 10);
    for (let vi = bestIdx + 1; vi < searchEnd; vi++) {
      if (valueMap.has(vi) || usedAsLabel.has(vi)) continue;
      if (tds[vi].text.length === 0) {
        valueMap.set(vi, field);
        break;
      }
    }
  }

  const replacements = [...valueMap.entries()]
    .map(([idx, field]) => ({
      index: tds[idx].index,
      len: tds[idx].fullMatch.length,
      replacement: `<td${tds[idx].attrs} data-field-key="${field.key}" data-field-label="${field.label}" data-field-role="${field.role ?? ""}">${tds[idx].inner}</td>`,
    }))
    .sort((a, b) => b.index - a.index);

  let result = html;
  for (const { index, len, replacement } of replacements) {
    result = result.slice(0, index) + replacement + result.slice(index + len);
  }

  return result;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const db = getAdminDb();
    const snap = await db.collection("templates").doc(id).get();
    if (!snap.exists) {
      return NextResponse.json({ html: null, reason: "not_found" }, { status: 404 });
    }

    const template = snap.data() as TemplateRecord;
    const arquivoUrl = template.arquivo_url ?? "";
    const ext = arquivoUrl.split(".").pop()?.toLowerCase() ?? "";

    if ((ext !== "docx" && ext !== "doc") || !arquivoUrl) {
      return NextResponse.json({ html: null, reason: "not_docx" });
    }

    const schema: TemplateFieldSchema[] = Array.isArray(template.schema_campos)
      ? template.schema_campos
      : [];

    const buf = await downloadFile(arquivoUrl);

    // Run mammoth conversion and DOCX layout extraction in parallel
    const [{ value: rawHtml }, layout] = await Promise.all([
      mammoth.convertToHtml(
        { buffer: buf },
        {
          styleMap: [
            "b => strong",
            "i => em",
            "u => u",
            "strike => s",
            "p[style-name='Heading 1'] => h1:fresh",
            "p[style-name='Heading 2'] => h2:fresh",
            "p[style-name='Heading 3'] => h3:fresh",
            "p[style-name='Title'] => h1:fresh",
            "p[style-name='Subtitle'] => h2:fresh",
            "p[style-name='Normal'] => p:fresh",
          ],
          includeDefaultStyleMap: true,
        },
      ),
      extractDocxLayout(buf),
    ]);

    // Apply DOCX layout (column widths + cell alignments) then annotate fields
    const withColWidths = injectColgroups(rawHtml, layout.gridWidths);
    const withAlignments = injectCellAlignments(withColWidths, layout.cellAligns);
    const annotated = annotateFields(withAlignments, schema);

    return NextResponse.json({ html: annotated });
  } catch (err) {
    console.error("[PlanoMagistra/editor-html]", err);
    return NextResponse.json({ html: null, reason: "error" }, { status: 500 });
  }
}
