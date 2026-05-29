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

// ─── DOCX formatting types ────────────────────────────────────────────────────

interface BorderStyle {
  val: string;
  sz?: number;  // eighths of a point
  color?: string; // hex without #
}

interface CellStyle {
  bgColor?: string;    // hex without #
  textColor?: string;  // hex without #
  vAlign?: string;     // top | center | bottom
  fontSize?: number;   // half-points
  borders?: Partial<Record<"top" | "bottom" | "left" | "right", BorderStyle | null>>;
}

interface RowStyle {
  height?: number; // twips
}

interface TableInfo {
  borders?: Partial<Record<"top" | "bottom" | "left" | "right" | "insideH" | "insideV", BorderStyle>>;
}

interface DocxLayout {
  gridWidths: number[][];
  cellAligns: string[];
  cellStyles: CellStyle[];
  rowStyles: RowStyle[];
  tableInfos: TableInfo[];
}

function emptyLayout(): DocxLayout {
  return { gridWidths: [], cellAligns: [], cellStyles: [], rowStyles: [], tableInfos: [] };
}

// ─── Border helpers ───────────────────────────────────────────────────────────

function parseBorderEl(xml: string): BorderStyle | null {
  const val = xml.match(/\bw:val="([^"]+)"/)?.[1];
  if (!val || val === "none" || val === "nil") return null;
  const sz = xml.match(/\bw:sz="(\d+)"/)?.[1];
  const color = xml.match(/\bw:color="([^"]+)"/)?.[1];
  return {
    val,
    sz: sz ? Number(sz) : undefined,
    color: color && color !== "auto" ? color : undefined,
  };
}

function parseBordersBlock(
  xml: string,
  sides: string[],
): Record<string, BorderStyle | null> {
  const result: Record<string, BorderStyle | null> = {};
  for (const side of sides) {
    const re = new RegExp(`<w:${side}\\b[^>]*/>`);
    const m = xml.match(re);
    if (m) result[side] = parseBorderEl(m[0]);
  }
  return result;
}

function borderToCss(b: BorderStyle): string {
  const styleMap: Record<string, string> = {
    single: "solid",
    double: "double",
    dashed: "dashed",
    dotted: "dotted",
    dashSmallGap: "dashed",
    dotDash: "dashed",
    dotDotDash: "dashed",
    thick: "solid",
    thinThickSmallGap: "solid",
    thickThinSmallGap: "solid",
  };
  const cssStyle = styleMap[b.val] ?? "solid";
  // sz is in eighths of a point; 1pt ≈ 1.333px
  const px = b.sz ? Math.max(1, Math.round((b.sz / 8) * 1.333)) : 1;
  const color = b.color ? `#${b.color}` : "#000";
  return `${px}px ${cssStyle} ${color}`;
}

// ─── DOCX layout extraction ───────────────────────────────────────────────────

async function extractDocxLayout(buffer: Buffer): Promise<DocxLayout> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const xmlContent = await zip.file("word/document.xml")?.async("string");
    if (!xmlContent) return emptyLayout();

    // 1. Grid widths — one array per table, document order
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

    // 2. Table borders — one entry per table, document order
    const tableInfos: TableInfo[] = [];
    const tblRe = /<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/g;
    let tblm: RegExpExecArray | null;
    while ((tblm = tblRe.exec(xmlContent)) !== null) {
      const tblContent = tblm[1];
      const info: TableInfo = {};
      const tblPrMatch = tblContent.match(/<w:tblPr\b[^>]*>([\s\S]*?)<\/w:tblPr>/);
      if (tblPrMatch) {
        const bordersMatch = tblPrMatch[1].match(
          /<w:tblBorders\b[^>]*>([\s\S]*?)<\/w:tblBorders>/,
        );
        if (bordersMatch) {
          info.borders = parseBordersBlock(bordersMatch[1], [
            "top",
            "bottom",
            "left",
            "right",
            "insideH",
            "insideV",
          ]) as TableInfo["borders"];
        }
      }
      tableInfos.push(info);
    }

    // 3. Row heights — one entry per row, document order
    const rowStyles: RowStyle[] = [];
    const trRe = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g;
    let trm: RegExpExecArray | null;
    while ((trm = trRe.exec(xmlContent)) !== null) {
      const trPrMatch = trm[1].match(/<w:trPr\b[^>]*>([\s\S]*?)<\/w:trPr>/);
      const rowStyle: RowStyle = {};
      if (trPrMatch) {
        const hMatch = trPrMatch[1].match(/w:trHeight[^>]*\bw:val="(\d+)"/);
        if (hMatch) rowStyle.height = Number(hMatch[1]);
      }
      rowStyles.push(rowStyle);
    }

    // 4. Cell aligns + cell styles — one entry per cell, document order
    const cellAligns: string[] = [];
    const cellStyles: CellStyle[] = [];
    const cellRe = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g;
    let tm: RegExpExecArray | null;
    while ((tm = cellRe.exec(xmlContent)) !== null) {
      const inner = tm[1];
      // Restrict alignment + run-level lookups to content before any nested table
      const nestedAt = inner.indexOf("<w:tbl");
      const zone = nestedAt >= 0 ? inner.slice(0, nestedAt) : inner;

      // Paragraph alignment
      const jc = zone.match(/<w:jc\b[^>]*w:val="([^"]+)"/);
      cellAligns.push(jc ? jc[1] : "");

      // Cell style from tcPr
      const style: CellStyle = {};
      const tcPrMatch = inner.match(/<w:tcPr\b[^>]*>([\s\S]*?)<\/w:tcPr>/);
      if (tcPrMatch) {
        const tcPr = tcPrMatch[1];

        // Background fill — w:shd w:fill (hex or "auto")
        const shdFill = tcPr.match(/w:shd\b[^>]+\bw:fill="([^"]+)"/)?.[1];
        if (shdFill && shdFill.toLowerCase() !== "auto") {
          style.bgColor = shdFill;
        }

        // Vertical alignment
        const vAlignVal = tcPr.match(/w:vAlign\b[^>]*\bw:val="([^"]+)"/)?.[1];
        if (vAlignVal) style.vAlign = vAlignVal;

        // Cell borders (override table-level borders)
        const tcBordersMatch = tcPr.match(
          /<w:tcBorders\b[^>]*>([\s\S]*?)<\/w:tcBorders>/,
        );
        if (tcBordersMatch) {
          const parsed = parseBordersBlock(tcBordersMatch[1], [
            "top",
            "bottom",
            "left",
            "right",
          ]);
          if (Object.keys(parsed).length > 0) {
            style.borders = parsed as CellStyle["borders"];
          }
        }
      }

      // Font size — first w:sz in non-nested zone (half-points)
      const szVal = zone.match(/<w:sz\b[^>]+\bw:val="(\d+)"/)?.[1];
      if (szVal) style.fontSize = Number(szVal);

      // Text color — first explicit w:color (not theme-based)
      const colorVal = zone.match(/<w:color\b[^>]+\bw:val="([0-9A-Fa-f]{6})"/)?.[1];
      if (colorVal) style.textColor = colorVal;

      cellStyles.push(style);
    }

    return { gridWidths, cellAligns, cellStyles, rowStyles, tableInfos };
  } catch {
    return emptyLayout();
  }
}

// ─── HTML post-processing ────────────────────────────────────────────────────

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

function injectCellAlignments(html: string, cellAligns: string[]): string {
  let cellIdx = 0;
  return html.replace(/<td([^>]*)>/g, (match, attrs) => {
    const raw = cellAligns[cellIdx++] ?? "";
    if (!raw || raw === "left") return match;
    const align = raw === "both" ? "justify" : raw;
    if (/\bstyle="/.test(attrs)) {
      return `<td${attrs.replace(/\bstyle="([^"]*)"/, `style="$1;text-align:${align}"`)}>`;
    }
    return `<td${attrs} style="text-align:${align}">`;
  });
}

function injectCellStyles(html: string, styles: CellStyle[]): string {
  let i = 0;
  return html.replace(/<td([^>]*)>/g, (match, attrs) => {
    const s = styles[i++];
    if (!s) return match;

    const parts: string[] = [];

    if (s.bgColor) {
      parts.push(`background-color:#${s.bgColor}`);
    }

    if (s.textColor) {
      parts.push(`color:#${s.textColor}`);
    }

    if (s.vAlign) {
      const vMap: Record<string, string> = {
        top: "top",
        center: "middle",
        bottom: "bottom",
        both: "middle",
      };
      parts.push(`vertical-align:${vMap[s.vAlign] ?? s.vAlign}`);
    }

    if (s.fontSize) {
      // half-points → px (1pt ≈ 1.333px)
      const px = Math.round((s.fontSize / 2) * 1.333);
      parts.push(`font-size:${px}px`);
    }

    if (s.borders) {
      for (const side of ["top", "bottom", "left", "right"] as const) {
        if (!(side in s.borders)) continue;
        const b = s.borders[side];
        parts.push(b ? `border-${side}:${borderToCss(b)}` : `border-${side}:none`);
      }
    }

    if (parts.length === 0) return match;
    const newStyle = parts.join(";");

    if (/\bstyle="/.test(attrs)) {
      return `<td${attrs.replace(/\bstyle="([^"]*)"/, `style="$1;${newStyle}`)}>`;
    }
    return `<td${attrs} style="${newStyle}">`;
  });
}

function injectRowStyles(html: string, styles: RowStyle[]): string {
  let i = 0;
  return html.replace(/<tr([^>]*)>/g, (match, attrs) => {
    const s = styles[i++];
    if (!s?.height) return match;
    // twips → px (1 twip = 1/20 pt, 1pt ≈ 1.333px)
    const px = Math.round((s.height / 20) * 1.333);
    const newStyle = `height:${px}px`;
    if (/\bstyle="/.test(attrs)) {
      return `<tr${attrs.replace(/\bstyle="([^"]*)"/, `style="$1;${newStyle}`)}>`;
    }
    return `<tr${attrs} style="${newStyle}">`;
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
  // Track labels that couldn't be paired inline (next cell was also a label)
  const unpaired = new Map<number, TemplateFieldSchema>(); // labelIdx → field

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

    // Try to find an empty value cell after the label
    let found = false;
    const searchEnd = Math.min(tds.length, bestIdx + 10);
    for (let vi = bestIdx + 1; vi < searchEnd; vi++) {
      if (valueMap.has(vi) || usedAsLabel.has(vi)) continue;
      if (tds[vi].text.length === 0) {
        valueMap.set(vi, field);
        found = true;
        break;
      }
    }
    // If no value cell was found nearby, remember this label for the next pass
    if (!found) unpaired.set(bestIdx, field);
  }

  // Second pass: for unpaired labels, look for empty tds at the same column
  // position in the next "row" of tds (handles [Label A | Label B] / [val A | val B]).
  if (unpaired.size > 0) {
    const labelIdxs = [...unpaired.keys()].sort((a, b) => a - b);
    for (const labelIdx of labelIdxs) {
      const field = unpaired.get(labelIdx)!;
      // Search for the first empty td that comes after ALL the unpaired labels
      const lastUnpairedIdx = Math.max(...labelIdxs);
      for (let vi = lastUnpairedIdx + 1; vi < Math.min(tds.length, lastUnpairedIdx + 15); vi++) {
        if (valueMap.has(vi) || usedAsLabel.has(vi)) continue;
        if (tds[vi].text.length === 0) {
          valueMap.set(vi, field);
          break;
        }
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
    const snap = await db.collection("magis_templates").doc(id).get();
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

    // Convert DOCX to HTML and extract layout in parallel
    const [{ value: rawHtml }, layout] = await Promise.all([
      mammoth.convertToHtml(
        { buffer: buf },
        {
          // Embed images as base64 data URIs (e.g. school logos)
          convertImage: mammoth.images.imgElement(async (image) => {
            const base64 = await image.readAsBase64String();
            return { src: `data:${image.contentType};base64,${base64}` };
          }),
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

    // Apply layout and styling, then annotate interactive fields
    const withColWidths = injectColgroups(rawHtml, layout.gridWidths);
    const withAlignments = injectCellAlignments(withColWidths, layout.cellAligns);
    const withCellStyles = injectCellStyles(withAlignments, layout.cellStyles);
    const withRowStyles = injectRowStyles(withCellStyles, layout.rowStyles);
    const annotated = annotateFields(withRowStyles, schema);

    return NextResponse.json({ html: annotated });
  } catch (err) {
    console.error("[PlanoMagistra/editor-html]", err);
    return NextResponse.json({ html: null, reason: "error" }, { status: 500 });
  }
}
