import "server-only";

import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import pdf from "pdf-parse";
import { FieldValue } from "firebase-admin/firestore";

import { getAdminDb } from "../../../../../lib/firebase/admin";
import { downloadFile } from "../../../../../lib/storage/blob";
import { injectPlaceholders, fillDocx } from "../../../../../lib/utils/docx-filler";
import { getCurrentUserProfile } from "../../../../../lib/auth/session";
import { PLAN_LIMITS } from "../../../../../lib/services/limits";
import type { PlanoRecord, TemplateFieldSchema, TemplateRecord } from "../../../../../lib/types/firestore";

function sanitizeFilename(name: string, ext: string): string {
  const safe = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9\s\-_()]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return (safe || "plano") + "." + ext;
}

function escapeTemplateDelimiters(value: string): string {
  return value.replace(/\{\{/g, "{ {").replace(/\}\}/g, "} }");
}

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

    const lines = wrapLines(safePdfText(value), maxChars).slice(0, 8);

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

// pdf-lib StandardFonts use WinAnsi — normalize to composed form and strip anything outside Latin-1
function safePdfText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[^\x00-\xFF]/g, (ch) => {
      const base = ch.normalize("NFD").charAt(0);
      return base.charCodeAt(0) <= 0xff ? base : "?";
    });
}

const PDF_GROUP_LABELS: Record<string, string> = {
  dados_turma:  "Dados da turma",
  objetivos:    "Objetivos",
  competencias: "Competências",
  habilidades:  "Habilidades",
  conteudos:    "Conteúdos",
  avaliacao:    "Avaliação",
  outros:       "Outros",
};
const PDF_GROUP_ORDER = ["dados_turma", "objetivos", "competencias", "habilidades", "conteudos", "avaliacao", "outros"];

async function buildFallbackPdf(
  titulo: string,
  schema: TemplateFieldSchema[],
  values: Record<string, string>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const PAGE_W = 595;
  const PAGE_H = 842;
  const MARGIN = 50;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  function newPage() {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  }

  function ensureSpace(needed: number) {
    if (y < MARGIN + needed) newPage();
  }

  // ── Header ──────────────────────────────────────────────────────────────────
  const titleLines = wrapLines(safePdfText(titulo), 60);
  ensureSpace(titleLines.length * 20 + 36);

  for (const line of titleLines) {
    page.drawText(line, { x: MARGIN, y, size: 15, font: bold, color: rgb(0.05, 0.05, 0.05) });
    y -= 20;
  }

  const dateStr = safePdfText(
    `Gerado em ${new Date().toLocaleDateString("pt-BR", { dateStyle: "long" })} — PlanoMagistra`,
  );
  page.drawText(dateStr, { x: MARGIN, y, size: 8, font, color: rgb(0.55, 0.55, 0.55) });
  y -= 10;

  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: MARGIN + CONTENT_W, y },
    thickness: 1,
    color: rgb(0.82, 0.82, 0.82),
  });
  y -= 18;

  // ── Group and render fields ──────────────────────────────────────────────────
  const groups = new Map<string, TemplateFieldSchema[]>();
  for (const field of schema) {
    const g = field.group ?? (field.role === "manual" ? "dados_turma" : "outros");
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(field);
  }

  const orderedGroups: Array<[string, TemplateFieldSchema[]]> = [
    ...PDF_GROUP_ORDER.filter((g) => groups.has(g)).map((g) => [g, groups.get(g)!] as [string, TemplateFieldSchema[]]),
    ...[...groups.entries()].filter(([g]) => !PDF_GROUP_ORDER.includes(g)),
  ];

  for (const [groupKey, fields] of orderedGroups) {
    const filledFields = fields.filter((f) => values[f.key]?.trim());
    if (filledFields.length === 0) continue;

    const groupLabel = safePdfText((PDF_GROUP_LABELS[groupKey] ?? groupKey).toUpperCase());

    ensureSpace(30);
    page.drawText(groupLabel, { x: MARGIN, y, size: 7.5, font: bold, color: rgb(0.38, 0.38, 0.65) });
    y -= 5;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: MARGIN + CONTENT_W, y },
      thickness: 0.4,
      color: rgb(0.82, 0.82, 0.9),
    });
    y -= 12;

    for (const field of filledFields) {
      const raw = values[field.key]!.trim();
      const labelTxt = safePdfText(`${field.label}:`);
      const lines = wrapLines(safePdfText(raw), 88);
      const blockH = 12 + lines.length * 12 + 8;

      ensureSpace(blockH);

      page.drawText(labelTxt, { x: MARGIN, y, size: 8, font: bold, color: rgb(0.15, 0.15, 0.15) });
      y -= 12;
      for (const line of lines) {
        ensureSpace(14);
        page.drawText(line, { x: MARGIN + 10, y, size: 9, font, color: rgb(0.08, 0.08, 0.08) });
        y -= 12;
      }
      y -= 6;
    }

    y -= 8;
  }

  return doc.save();
}

export const maxDuration = 60;

// ── Gotenberg: DOCX → PDF (self-hosted, LibreOffice) ────────────────────────
// Resposta síncrona — sem polling. Muito mais simples que CloudConvert.

async function convertDocxToPdfGotenberg(
  docxBuffer: Buffer,
  filename: string,
): Promise<Buffer> {
  const baseUrl = process.env.GOTENBERG_URL?.replace(/\/$/, "");
  const apiKey  = process.env.GOTENBERG_API_KEY;
  if (!baseUrl) throw new Error("GOTENBERG_URL não configurada");

  const form = new FormData();
  form.append(
    "files",
    new Blob([new Uint8Array(docxBuffer)], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
    filename,
  );

  const headers: Record<string, string> = {};
  if (apiKey) headers["X-Api-Key"] = apiKey;

  const res = await fetch(`${baseUrl}/forms/libreoffice/convert`, {
    method: "POST",
    headers,
    body: form,
  });

  if (!res.ok) throw new Error(`Gotenberg: conversão falhou (HTTP ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

// ── CloudConvert: DOCX → PDF (fallback enquanto há créditos) ────────────────

interface CCTask {
  id: string;
  operation: string;
  status: string;
  message?: string;
  result?: {
    form?: { url: string; parameters: Record<string, string> };
    files?: Array<{ url: string; filename: string }>;
  };
}

interface CCJob {
  id: string;
  status: string;
  tasks: CCTask[];
}

async function convertDocxToPdfCloudConvert(
  docxBuffer: Buffer,
  filename: string,
): Promise<Buffer> {
  const apiKey = process.env.CLOUDCONVERT_API_KEY;
  if (!apiKey) throw new Error("CLOUDCONVERT_API_KEY não configurada");

  // 1. Cria job: upload → convert → export
  const createRes = await fetch("https://api.cloudconvert.com/v2/jobs", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tasks: {
        upload:  { operation: "import/upload" },
        convert: { operation: "convert",    input: "upload",  input_format: "docx", output_format: "pdf", engine: "libreoffice" },
        export:  { operation: "export/url", input: "convert" },
      },
    }),
  });

  if (!createRes.ok) {
    throw new Error(`CloudConvert: erro ao criar job (HTTP ${createRes.status})`);
  }

  const { data: job } = (await createRes.json()) as { data: CCJob };
  const uploadTask = job.tasks.find((t) => t.operation === "import/upload");
  if (!uploadTask?.result?.form) throw new Error("CloudConvert: form de upload não disponível");

  // 2. Envia DOCX via multipart para S3 (retorna 201 ou 204)
  const { url: uploadUrl, parameters } = uploadTask.result.form;
  const form = new FormData();
  for (const [k, v] of Object.entries(parameters)) form.append(k, v);
  form.append(
    "file",
    new Blob([new Uint8Array(docxBuffer)], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
    filename,
  );

  const uploadRes = await fetch(uploadUrl, { method: "POST", body: form });
  if (!uploadRes.ok && uploadRes.status !== 201 && uploadRes.status !== 204) {
    throw new Error(`CloudConvert: upload falhou (HTTP ${uploadRes.status})`);
  }

  // 3. Polling até concluir (20× a cada 2s = até 40s)
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise<void>((r) => setTimeout(r, 2000));

    const statusRes = await fetch(
      `https://api.cloudconvert.com/v2/jobs/${job.id}?include=tasks`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    const { data: current } = (await statusRes.json()) as { data: CCJob };

    if (current.status === "finished") {
      const exportTask = current.tasks.find((t) => t.operation === "export/url");
      const pdfUrl = exportTask?.result?.files?.[0]?.url;
      if (!pdfUrl) throw new Error("CloudConvert: URL do PDF não encontrada");

      const pdfRes = await fetch(pdfUrl);
      if (!pdfRes.ok) throw new Error(`CloudConvert: download falhou (HTTP ${pdfRes.status})`);

      return Buffer.from(await pdfRes.arrayBuffer());
    }

    if (current.status === "error") {
      const failed = current.tasks.find((t) => t.status === "error");
      throw new Error(`CloudConvert: conversão falhou — ${failed?.message ?? "erro desconhecido"}`);
    }
  }

  throw new Error("CloudConvert: timeout — conversão demorou mais de 40s");
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const forcePdf = searchParams.get("format") === "pdf";

    if (!id) {
      return NextResponse.json({ error: "ID do plano é obrigatório." }, { status: 400 });
    }

    const user = await getCurrentUserProfile();
    if (!user) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    const db = getAdminDb();
    const planoSnap = await db.collection("magins_planos_aula").doc(id).get();

    if (!planoSnap.exists) {
      return NextResponse.json({ error: "Plano não encontrado." }, { status: 404 });
    }

    const planoData = planoSnap.data() as PlanoRecord;

    if (planoData.user_id !== user.uid) {
      return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
    }

    const planoKey = user.plano?.trim().toLowerCase() || "free";
    const limits = PLAN_LIMITS[planoKey] ?? PLAN_LIMITS.free;
    const currentDownloads = planoData.downloads ?? 0;

    if (currentDownloads >= limits.maxDownloadsPerPlano) {
      return NextResponse.json(
        {
          error: "Limite de downloads atingido para este plano de aula.",
          downloads: currentDownloads,
          maxDownloads: limits.maxDownloadsPerPlano,
        },
        { status: 403 },
      );
    }
    const conteudo = normalizeConteudo(planoData.conteudo_gerado ?? {});

    // Use plan title as filename if set, otherwise fall back to template name
    const planoTituloRaw = planoData.conteudo_gerado?._plano_titulo;
    const planoTitulo = typeof planoTituloRaw === "string" ? planoTituloRaw.trim() : "";

    const templateSnap = await db.collection("magis_templates").doc(planoData.template_id).get();
    const template = templateSnap.exists ? (templateSnap.data() as TemplateRecord) : null;
    const templateNome = template?.nome ?? "Plano";
    const fileBaseName = planoTitulo || templateNome;
    // Prefer schema snapshot saved at plan creation; fall back to current template schema
    const schema: TemplateFieldSchema[] =
      Array.isArray(planoData.schema_campos) && planoData.schema_campos.length > 0
        ? planoData.schema_campos
        : Array.isArray(template?.schema_campos)
          ? template.schema_campos
          : [];

    // Prefer snapshotted URLs saved at finalization; fall back to live template
    const arquivoUrl = planoData.arquivo_url ?? template?.arquivo_url ?? "";
    const ext = arquivoUrl.split(".").pop()?.toLowerCase() ?? "pdf";
    const isDocx = ext === "docx" || ext === "doc";

    // Gera o DOCX preenchido (reutilizado tanto para download DOCX quanto para conversão PDF)
    if (isDocx && arquivoUrl) {
      try {
        const fillableUrl = planoData.arquivo_fillable_url ?? template?.arquivo_fillable_url ?? "";
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

        const safeConteudo = Object.fromEntries(
          Object.entries(conteudo).map(([k, v]) => [k, escapeTemplateDelimiters(v)]),
        );
        const filledBuffer = fillDocx(docxBuffer, schema, safeConteudo);

        if (!forcePdf) {
          // Baixar DOCX diretamente
          const mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
          const docxFilename = sanitizeFilename(fileBaseName, ext);
          void db.collection("magins_planos_aula").doc(id).update({ downloads: FieldValue.increment(1) }).catch(() => {});
          return new NextResponse(new Blob([new Uint8Array(filledBuffer)], { type: mimeType }), {
            headers: {
              "Content-Type": mimeType,
              "Content-Disposition": `attachment; filename="${docxFilename}"`,
              "Content-Length": String(filledBuffer.length),
            },
          });
        }

        // Converter DOCX → PDF: Gotenberg → CloudConvert → erro
        let pdfBuffer: Buffer;
        try {
          if (!process.env.GOTENBERG_URL) throw new Error("Gotenberg não configurado");
          pdfBuffer = await convertDocxToPdfGotenberg(
            filledBuffer,
            sanitizeFilename(fileBaseName, "docx"),
          );
        } catch (gotenbergErr) {
          console.warn("[PlanoMagistra/download] Gotenberg falhou, tentando CloudConvert:", gotenbergErr);
          pdfBuffer = await convertDocxToPdfCloudConvert(
            filledBuffer,
            sanitizeFilename(fileBaseName, "docx"),
          );
        }
        const pdfFilename = sanitizeFilename(fileBaseName, "pdf");
        void db.collection("magins_planos_aula").doc(id).update({ downloads: FieldValue.increment(1) }).catch(() => {});
        return new NextResponse(new Uint8Array(pdfBuffer), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${pdfFilename}"`,
            "Content-Length": String(pdfBuffer.length),
          },
        });
      } catch (err) {
        console.warn("[PlanoMagistra/download] Falha no processamento DOCX/PDF, fallback:", err);
      }
    }

    // Fallback PDF: templates nativos PDF ou quando DOCX/CloudConvert falham
    let pdfBytes: Uint8Array;

    if (arquivoUrl && !isDocx) {
      try {
        const originalBuffer = await downloadFile(arquivoUrl);
        pdfBytes = await overlayValuesOnPdf(originalBuffer, schema, conteudo);
      } catch (storageErr) {
        console.warn("[PlanoMagistra/download] Storage indisponível, usando PDF gerado:", storageErr);
        pdfBytes = await buildFallbackPdf(fileBaseName, schema, conteudo);
      }
    } else {
      pdfBytes = await buildFallbackPdf(fileBaseName, schema, conteudo);
    }

    const pdfBuffer = Buffer.from(pdfBytes);
    const pdfFilename = sanitizeFilename(fileBaseName, "pdf");
    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${pdfFilename}"`,
        "Content-Length": String(pdfBuffer.length),
      },
    });
  } catch (error) {
    console.error("[PlanoMagistra/download] Erro:", error);
    return NextResponse.json({ error: "Falha ao gerar PDF." }, { status: 500 });
  }
}
