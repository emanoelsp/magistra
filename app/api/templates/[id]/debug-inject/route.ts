import "server-only";

import { NextResponse } from "next/server";
import PizZip from "pizzip";

import { getAdminDb } from "../../../../../lib/firebase/admin";
import { downloadFile } from "../../../../../lib/storage/blob";
import { requireCurrentUserProfile } from "../../../../../lib/auth/session";
import type { TemplateFieldSchema, TemplateRecord } from "../../../../../lib/types/firestore";

// Inline helpers (mirrors docx-filler internals for debugging)
function extractText(xml: string): string {
  return (xml.match(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g) ?? [])
    .map((m) => m.replace(/<[^>]+>/g, ""))
    .join("")
    .trim();
}

function normText(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function extractParagraphTexts(xml: string): string[] {
  return [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map((m) => extractText(m[0]));
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

function looksLikeLabel(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.endsWith(":")) return true;
  const stripped = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const hasLowercase = /[a-z]/.test(stripped);
  const hasUppercase = /[A-Z]/.test(stripped);
  if (!hasLowercase && hasUppercase && t.length > 5) return true;
  return false;
}

interface RowDebug {
  rowIndex: number;
  cellCount: number;
  cells: {
    cellIndex: number;
    cellText: string;
    paragraphs: string[];
    labelParas: string[];
    isLabel: boolean;
  }[];
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireCurrentUserProfile();
    const { id } = await params;

    const db = getAdminDb();
    const snap = await db.collection("magis_templates").doc(id).get();
    if (!snap.exists) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const data = snap.data() as TemplateRecord;
    const arquivoUrl = data.arquivo_url ?? "";
    if (!arquivoUrl || !/\.docx?($|\?)/i.test(arquivoUrl)) {
      return NextResponse.json({ error: "not_docx" });
    }

    const buffer = await downloadFile(arquivoUrl);
    const zip = new PizZip(buffer);
    const xmlRaw = zip.files["word/document.xml"]?.asText() ?? "";
    if (!xmlRaw) return NextResponse.json({ error: "no_xml" });

    const xml = stripChangeTracking(xmlRaw);
    const schema: TemplateFieldSchema[] = Array.isArray(data.schema_campos) ? data.schema_campos : [];

    // Parse rows
    const rowMatches = [...xml.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)];
    const rowsDebug: RowDebug[] = rowMatches.map((rowMatch, rowIndex) => {
      const rowXml = rowMatch[0];
      const cellMatches = [...rowXml.matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)];
      return {
        rowIndex,
        cellCount: cellMatches.length,
        cells: cellMatches.map((cellMatch, cellIndex) => {
          const cellXml = cellMatch[0];
          const cellText = extractText(cellXml);
          const paragraphs = extractParagraphTexts(cellXml).map((t) => t.trim()).filter((t) => t);
          const labelParas = paragraphs.filter((t) => t.endsWith(":") && t.length > 2);
          return {
            cellIndex,
            cellText: cellText.slice(0, 120),
            paragraphs: paragraphs.slice(0, 10),
            labelParas,
            isLabel: looksLikeLabel(cellText),
          };
        }),
      };
    });

    // Find rows that contain schema field labels
    const schemaMatches: {
      fieldKey: string;
      fieldLabel: string;
      rowIndex: number;
      cellIndex: number;
      matchText: string;
      normMatch: string;
      normLabel: string;
    }[] = [];

    for (const row of rowsDebug) {
      for (const cell of row.cells) {
        const cellNorm = normText(cell.cellText);
        for (const f of schema) {
          const hay = normText(f.label);
          if (hay.length < 2) continue;
          if (cellNorm.includes(hay) || hay.includes(cellNorm.slice(0, Math.min(cellNorm.length, hay.length + 5)))) {
            schemaMatches.push({
              fieldKey: f.key,
              fieldLabel: f.label,
              rowIndex: row.rowIndex,
              cellIndex: cell.cellIndex,
              matchText: cell.cellText.slice(0, 80),
              normMatch: cellNorm.slice(0, 80),
              normLabel: hay,
            });
          }
        }
      }
    }

    // Rows containing fields of interest (by schema key)
    const relevantRows = rowsDebug.filter((row) =>
      row.cells.some((cell) =>
        schema.some((f) => {
          const hay = normText(f.label);
          return normText(cell.cellText).includes(hay);
        })
      )
    ).slice(0, 20);

    return NextResponse.json({
      templateId: id,
      schemaCampos: schema.map((f) => ({ key: f.key, label: f.label })),
      totalRows: rowsDebug.length,
      relevantRows,
      schemaMatches: schemaMatches.slice(0, 50),
    });
  } catch (err) {
    console.error("[debug-inject]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
