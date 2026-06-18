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

interface ImageDimension {
  widthPx: number;
  heightPx: number;
}

interface DocxLayout {
  gridWidths: number[][];
  cellAligns: string[];
  cellStyles: CellStyle[];
  rowStyles: RowStyle[];
  tableInfos: TableInfo[];
  imageDims: ImageDimension[];
}

function emptyLayout(): DocxLayout {
  return { gridWidths: [], cellAligns: [], cellStyles: [], rowStyles: [], tableInfos: [], imageDims: [] };
}

// 1 EMU = 1/914400 inch; at 96 DPI → px = EMU / 9525
function emuToPx(emu: number): number {
  return Math.round(emu / 9525);
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

    // 5. Image dimensions — one entry per <w:drawing> in document order
    // Each <wp:extent cx="..." cy="..."/> gives the image size in EMU.
    // This lets us inject width/height onto <img> tags so table columns
    // don't collapse when images have no intrinsic HTML size.
    const imageDims: ImageDimension[] = [];
    const drawingRe = /<w:drawing\b[^>]*>([\s\S]*?)<\/w:drawing>/g;
    let dm: RegExpExecArray | null;
    while ((dm = drawingRe.exec(xmlContent)) !== null) {
      const extentMatch = dm[1].match(/wp:extent\b[^/]*cx="(\d+)"[^/]*cy="(\d+)"/);
      if (extentMatch) {
        imageDims.push({
          widthPx: emuToPx(Number(extentMatch[1])),
          heightPx: emuToPx(Number(extentMatch[2])),
        });
      }
    }

    return { gridWidths, cellAligns, cellStyles, rowStyles, tableInfos, imageDims };
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

// Applies explicit width/height to every <img> in document order using the
// dimensions extracted from <wp:extent> in the DOCX XML.
// Without this, browsers can't determine column widths for tables containing
// images, causing the layout to collapse (header logos moving to wrong position).
function injectImageSizes(html: string, dims: ImageDimension[]): string {
  if (dims.length === 0) return html;
  // Cap at 400px so oversized images don't overflow the preview panel
  const MAX_W = 400;
  let i = 0;
  return html.replace(/<img([^>]*?)(\s*\/?>)/g, (match, attrs, close) => {
    const dim = dims[i++];
    if (!dim) return match;
    const scale = dim.widthPx > MAX_W ? MAX_W / dim.widthPx : 1;
    const w = Math.round(dim.widthPx * scale);
    const h = Math.round(dim.heightPx * scale);
    // Only inject if not already present
    if (/\bwidth=/i.test(attrs)) return match;
    return `<img${attrs} width="${w}" height="${h}" style="display:block;max-width:100%"${close}`;
  });
}

// Forces all tables to fixed layout so <colgroup> percentages are respected.
// Without this, browsers auto-size columns by content and ignore column widths.
function injectTableFixed(html: string): string {
  return html.replace(/<table([^>]*)>/g, (match, attrs) => {
    const style = "table-layout:fixed;width:100%;border-collapse:collapse";
    if (/\bstyle="/.test(attrs)) {
      return `<table${attrs.replace(/\bstyle="([^"]*)"/, `style="$1;${style}"`)}>`;
    }
    return `<table${attrs} style="${style}">`;
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

    // Phase A: prefer empty value cells (template uses placeholders)
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

    // Phase B: fallback — accept non-empty cells when the DOCX is already filled.
    // DocView will clear ia_sugerida cells; manual cells show their defaultValue.
    if (!found) {
      for (let vi = bestIdx + 1; vi < searchEnd; vi++) {
        if (valueMap.has(vi) || usedAsLabel.has(vi)) continue;
        const text = tds[vi].text;
        if (text.length > 300) continue; // skip cells that are clearly not value cells
        // Skip if this cell itself looks like another field label
        const mightBeLabel = schema.some((sf) => {
          if (sf.key === field.key) return false;
          const ln = normText(sf.label);
          const lw = ln.split(/\s+/).filter((w) => w.length > 2);
          return lw.length > 0 && lw.filter((w) => text.includes(w)).length / lw.length >= 0.6;
        });
        if (!mightBeLabel) {
          valueMap.set(vi, field);
          found = true;
          break;
        }
      }
    }

    // If still not found, remember for second pass (row-separated layout)
    if (!found) unpaired.set(bestIdx, field);
  }

  // Second pass: for unpaired labels, look for tds after the label block
  // (handles [Label A | Label B] / [val A | val B] layout).
  if (unpaired.size > 0) {
    const labelIdxs = [...unpaired.keys()].sort((a, b) => a - b);
    const lastUnpairedIdx = Math.max(...labelIdxs);
    const pass2End = Math.min(tds.length, lastUnpairedIdx + 15);

    for (const labelIdx of labelIdxs) {
      const field = unpaired.get(labelIdx)!;

      // Phase A: empty cells preferred
      let found2 = false;
      for (let vi = lastUnpairedIdx + 1; vi < pass2End; vi++) {
        if (valueMap.has(vi) || usedAsLabel.has(vi)) continue;
        if (tds[vi].text.length === 0) {
          valueMap.set(vi, field);
          found2 = true;
          break;
        }
      }

      // Phase B: non-empty cells as fallback
      if (!found2) {
        for (let vi = lastUnpairedIdx + 1; vi < pass2End; vi++) {
          if (valueMap.has(vi) || usedAsLabel.has(vi)) continue;
          if (tds[vi].text.length > 300) continue;
          const text = tds[vi].text;
          const mightBeLabel = schema.some((sf) => {
            if (sf.key === field.key) return false;
            const ln = normText(sf.label);
            const lw = ln.split(/\s+/).filter((w) => w.length > 2);
            return lw.length > 0 && lw.filter((w) => text.includes(w)).length / lw.length >= 0.6;
          });
          if (!mightBeLabel) {
            valueMap.set(vi, field);
            break;
          }
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

// ─── Header extraction ───────────────────────────────────────────────────────
//
// DOCX headers live in separate XML files (word/header1.xml etc.) that mammoth
// ignores. We extract the default header, splice its content into a synthetic
// body, run mammoth + layout post-processing on that sub-document, and prepend
// the resulting HTML to the body HTML.
//
// Image relationship IDs in the header file are scoped to the header's own
// word/_rels/header1.xml.rels — NOT to word/_rels/document.xml.rels. We remap
// them to new IDs (hdr_rId1, hdr_rId2 …) and merge them into the document rels
// so mammoth can resolve them when processing the synthetic DOCX.

type MammothOptions = Parameters<typeof mammoth.convertToHtml>[1];

async function extractHeaderHtml(buf: Buffer, opts: MammothOptions): Promise<string> {
  try {
    const zip = await JSZip.loadAsync(buf);

    // 1. Locate the default header file via document relationships
    const docRelsText = await zip.file("word/_rels/document.xml.rels")?.async("string") ?? "";
    const docText     = await zip.file("word/document.xml")?.async("string") ?? "";
    if (!docText) return "";

    const relMap = new Map<string, string>();
    for (const m of docRelsText.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
      relMap.set(m[1], m[2]);
    }

    // Prefer w:type="default"; fall back to first headerReference found
    const headerId =
      docText.match(/<w:headerReference[^>]*w:type="default"[^>]*r:id="([^"]+)"/)?.[1]
      ?? docText.match(/<w:headerReference[^>]*r:id="([^"]+)"/)?.[1];
    if (!headerId) return "";

    const headerTarget = relMap.get(headerId); // e.g. "header1.xml"
    if (!headerTarget) return "";

    const headerText = await zip.file(`word/${headerTarget}`)?.async("string") ?? "";
    // Extract everything between <w:hdr …> … </w:hdr>
    let hdrInner = headerText.match(/<w:hdr\b[^>]*>([\s\S]*)<\/w:hdr>/)?.[1] ?? "";
    if (!hdrInner.trim()) return "";

    // 2. Remap header image rIds so they don't collide with document rIds
    const hdrRelsText = await zip.file(`word/_rels/${headerTarget}.rels`)?.async("string") ?? "";
    let mergedRels = docRelsText.replace("</Relationships>", "");
    if (hdrRelsText) {
      for (const m of hdrRelsText.matchAll(/<Relationship([^>]*?)Id="([^"]+)"([^>]*?)\s*\/>/g)) {
        const before = m[1];
        const origId = m[2];
        const after  = m[3];
        const newId  = `hdr_${origId}`;
        hdrInner = hdrInner.replace(new RegExp(`r:id="${origId}"`, "g"), `r:id="${newId}"`);
        mergedRels += `\n  <Relationship${before}Id="${newId}"${after}/>`;
      }
    }
    mergedRels += "\n</Relationships>";

    // 3. Build synthetic document.xml from the header inner XML
    const docNs = docText.match(/<w:document(\s[^>]*)?>/)?.[1]
      ?? ' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const syntheticDoc =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document${docNs}><w:body>${hdrInner}<w:sectPr/></w:body></w:document>`;

    // 4. Clone zip, replacing document.xml and its rels
    const newZip = new JSZip();
    for (const [path, file] of Object.entries(zip.files)) {
      if (file.dir) { newZip.folder(path.replace(/\/$/, "")); continue; }
      if (path === "word/document.xml") {
        newZip.file(path, syntheticDoc);
      } else if (path === "word/_rels/document.xml.rels") {
        newZip.file(path, mergedRels);
      } else {
        newZip.file(path, await file.async("nodebuffer"));
      }
    }

    const syntheticBuf = Buffer.from(await newZip.generateAsync({ type: "nodebuffer" }));

    // 5. Run the full mammoth + layout pipeline on the header sub-document
    const [{ value: hdrRaw }, hdrLayout] = await Promise.all([
      mammoth.convertToHtml({ buffer: syntheticBuf }, opts),
      extractDocxLayout(syntheticBuf),
    ]);

    if (!hdrRaw.trim()) return "";

    let h = injectColgroups(hdrRaw, hdrLayout.gridWidths);
    h = injectTableFixed(h);
    h = injectCellAlignments(h, hdrLayout.cellAligns);
    h = injectCellStyles(h, hdrLayout.cellStyles);
    h = injectRowStyles(h, hdrLayout.rowStyles);
    h = injectImageSizes(h, hdrLayout.imageDims);

    return `<div class="docx-header-region" style="border-bottom:2px solid #e2e8f0;margin-bottom:8px;padding-bottom:8px;">${h}</div>`;
  } catch (e) {
    console.error("[editor-html] extractHeaderHtml failed:", e);
    return "";
  }
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

    const mammothOpts: MammothOptions = {
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
    };

    // Convert DOCX body + extract header + extract layout — all in parallel
    const [{ value: rawHtml }, layout, headerHtml] = await Promise.all([
      mammoth.convertToHtml({ buffer: buf }, mammothOpts),
      extractDocxLayout(buf),
      extractHeaderHtml(buf, mammothOpts),
    ]);

    // Apply layout and styling, then annotate interactive fields
    const withColWidths = injectColgroups(rawHtml, layout.gridWidths);
    const withFixed = injectTableFixed(withColWidths);
    const withAlignments = injectCellAlignments(withFixed, layout.cellAligns);
    const withCellStyles = injectCellStyles(withAlignments, layout.cellStyles);
    const withRowStyles = injectRowStyles(withCellStyles, layout.rowStyles);
    const withImageSizes = injectImageSizes(withRowStyles, layout.imageDims);
    const annotated = annotateFields(withImageSizes, schema);

    // Prepend header region (non-interactive, read-only) before body
    const fullHtml = headerHtml ? headerHtml + annotated : annotated;

    return NextResponse.json({ html: fullHtml });
  } catch (err) {
    console.error("[PlanoMagistra/editor-html]", err);
    return NextResponse.json({ html: null, reason: "error" }, { status: 500 });
  }
}
