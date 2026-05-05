import "server-only";

import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import pdf from "pdf-parse";

import { getAdminDb } from "../../../../../lib/firebase/admin";
import { downloadFile } from "../../../../../lib/storage/blob";
import { injectPlaceholders, fillDocx } from "../../../../../lib/utils/docx-filler";
import type { PlanoRecord, TemplateFieldSchema, TemplateRecord } from "../../../../../lib/types/firestore";

function htmlToPlainText(html: string): string {
  if (!html || !html.trim().startsWith("<")) return html;
  return html
    .replace(/<li>/gi, "• ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeConteudo(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") {
      out[k] = htmlToPlainText(v);
    }
  }
  return out;
}

interface TextItem {
  str: string;
  x: number;
  y: number;
  page: number;
  width: number;
}

async function extractTextItems(buffer: Buffer): Promise<TextItem[]> {
  const items: TextItem[] = [];
  let pageNum = 0;

  type PageRenderFn = (pageData: unknown) => Promise<string>;
  const opts: { pagerender: PageRenderFn } = {
    pagerender: async (pageData: unknown) => {
      pageNum++;
      const pg = pageData as { getTextContent: () => Promise<{ items: unknown[] }> };
      try {
        const content = await pg.getTextContent();
        for (const raw of content.items) {
          const it = raw as { str?: string; transform?: number[]; width?: number };
          if (typeof it.str === "string" && it.str.trim() && Array.isArray(it.transform)) {
            items.push({
              str: it.str,
              x: it.transform[4] ?? 0,
              y: it.transform[5] ?? 0,
              page: pageNum,
              width: typeof it.width === "number" ? it.width : 0,
            });
          }
        }
      } catch {
        /* per-page errors are non-fatal */
      }
      return "";
    },
  };

  await pdf(buffer, opts as unknown as Parameters<typeof pdf>[1]);

  return items;
}

function findLabel(items: TextItem[], label: string): TextItem | null {
  const needle = label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();

  let best: TextItem | null = null;
  let bestScore = 0;

  for (const item of items) {
    const hay = item.str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9\s]/g, "")
      .trim();

    if (!hay) continue;

    const overlap =
      hay.includes(needle) || needle.includes(hay)
        ? Math.min(needle.length, hay.length) / Math.max(needle.length, hay.length)
        : 0;

    if (overlap > bestScore && overlap >= 0.55) {
      bestScore = overlap;
      best = item;
    }
  }

  return best;
}

function wrapLines(text: string, charsPerLine: number): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    if (raw.length <= charsPerLine) {
      out.push(raw);
    } else {
      const words = raw.split(" ");
      let line = "";
      for (const word of words) {
        if ((line + " " + word).trim().length > charsPerLine) {
          if (line) out.push(line.trim());
          line = word;
        } else {
          line = line ? line + " " + word : word;
        }
      }
      if (line) out.push(line.trim());
    }
  }
  return out;
}

async function overlayValuesOnPdf(
  originalBuffer: Buffer,
  schema: TemplateFieldSchema[],
  values: Record<string, string>,
): Promise<Uint8Array> {
  const textItems = await extractTextItems(originalBuffer);

  const pdfDoc = await PDFDocument.load(originalBuffer, { ignoreEncryption: true });
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  for (const field of schema) {
    const value = values[field.key]?.trim();
    if (!value) continue;

    const labelItem = findLabel(textItems, field.label);
    if (!labelItem) continue;

    const pageIndex = labelItem.page - 1;
    if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) continue;

    const page = pdfDoc.getPage(pageIndex);
    const { width: pageWidth } = page.getSize();

    // Place value below the label with a small gap
    const startX = labelItem.x;
    const startY = labelItem.y - 13;
    const maxChars = Math.max(20, Math.floor((pageWidth - startX - 40) / 5.5));

    const lines = wrapLines(value, maxChars).slice(0, 8);

    for (let i = 0; i < lines.length; i++) {
      const lineY = startY - i * 12;
      if (lineY < 30) break;
      page.drawText(lines[i], {
        x: startX,
        y: lineY,
        size: 9,
        font,
        color: rgb(0.05, 0.2, 0.55),
      });
    }
  }

  return pdfDoc.save();
}

function buildFallbackPdf(
  templateNome: string,
  schema: TemplateFieldSchema[],
  values: Record<string, string>,
): Promise<Uint8Array> {
  return PDFDocument.create().then(async (doc) => {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);

    let page = doc.addPage([595, 842]);
    const { width, height } = page.getSize();
    const margin = 50;
    let y = height - margin;

    page.drawText(templateNome, { x: margin, y, size: 14, font: bold, color: rgb(0.05, 0.05, 0.05) });
    y -= 24;
    page.drawText(`Gerado em ${new Date().toLocaleDateString("pt-BR")}`, {
      x: margin, y, size: 9, font, color: rgb(0.4, 0.4, 0.4),
    });
    y -= 24;

    for (const field of schema) {
      const value = values[field.key]?.trim() || "—";
      const labelTxt = `${field.label}:`;
      const lines = wrapLines(value, 90);
      const blockH = 14 + lines.length * 13 + 10;

      if (y < margin + blockH) {
        page = doc.addPage([595, 842]);
        y = height - margin;
      }

      page.drawText(labelTxt, { x: margin, y, size: 9, font: bold, color: rgb(0.1, 0.1, 0.1) });
      y -= 13;
      for (const line of lines) {
        page.drawText(line, { x: margin + 4, y, size: 9, font, color: rgb(0.2, 0.2, 0.2) });
        y -= 12;
      }
      y -= 6;
    }

    return doc.save();
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "ID do plano é obrigatório." }, { status: 400 });
    }

    const db = getAdminDb();
    const planoSnap = await db.collection("planos").doc(id).get();

    if (!planoSnap.exists) {
      return NextResponse.json({ error: "Plano não encontrado." }, { status: 404 });
    }

    const planoData = planoSnap.data() as PlanoRecord;
    const conteudo = normalizeConteudo(planoData.conteudo_gerado ?? {});

    const templateSnap = await db.collection("templates").doc(planoData.template_id).get();
    const template = templateSnap.exists ? (templateSnap.data() as TemplateRecord) : null;
    const templateNome = template?.nome ?? "Plano";
    const schema: TemplateFieldSchema[] = Array.isArray(template?.schema_campos)
      ? template.schema_campos
      : [];

    // Determine file type from stored path
    const arquivoUrl = template?.arquivo_url ?? "";
    const ext = arquivoUrl.split(".").pop()?.toLowerCase() ?? "pdf";
    const isDocx = ext === "docx" || ext === "doc";

    if (isDocx && arquivoUrl) {
      try {
        const fillableUrl = template?.arquivo_fillable_url ?? "";
        let docxBuffer: Buffer;

        if (fillableUrl) {
          const fillableBuf = await downloadFile(fillableUrl);
          const zip = new (await import("pizzip")).default(fillableBuf);
          const xmlSample = zip.files["word/document.xml"]?.asText() ?? "";
          const isManuallyPrepared = xmlSample.includes("{{");

          if (isManuallyPrepared) {
            docxBuffer = fillableBuf;
          } else {
            const origRaw = await downloadFile(arquivoUrl);
            docxBuffer = injectPlaceholders(origRaw, schema);
          }
        } else {
          const origRaw = await downloadFile(arquivoUrl);
          docxBuffer = injectPlaceholders(origRaw, schema);
        }

        const filledBuffer = fillDocx(docxBuffer, schema, conteudo);
        const mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        const filledBlob = new Blob([new Uint8Array(filledBuffer)], { type: mimeType });

        return new NextResponse(filledBlob, {
          headers: {
            "Content-Type": mimeType,
            "Content-Disposition": `attachment; filename="plano-${id.slice(0, 8)}.docx"`,
            "Content-Length": String(filledBuffer.length),
          },
        });
      } catch (docxErr) {
        console.warn("[PlanoMagistra/download] Falha no DOCX, fallback para PDF:", docxErr);
      }
    }

    // PDF path: overlay values on original PDF
    let pdfBytes: Uint8Array;

    if (arquivoUrl && !isDocx) {
      try {
        const originalBuffer = await downloadFile(arquivoUrl);
        pdfBytes = await overlayValuesOnPdf(originalBuffer, schema, conteudo);
      } catch (storageErr) {
        console.warn("[PlanoMagistra/download] Storage indisponível, usando PDF gerado:", storageErr);
        pdfBytes = await buildFallbackPdf(templateNome, schema, conteudo);
      }
    } else {
      pdfBytes = await buildFallbackPdf(templateNome, schema, conteudo);
    }

    const pdfBuffer = Buffer.from(pdfBytes);
    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="plano-${id.slice(0, 8)}.pdf"`,
        "Content-Length": String(pdfBuffer.length),
      },
    });
  } catch (error) {
    console.error("[PlanoMagistra/download] Erro:", error);
    return NextResponse.json({ error: "Falha ao gerar PDF." }, { status: 500 });
  }
}
