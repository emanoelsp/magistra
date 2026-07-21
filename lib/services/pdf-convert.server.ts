import "server-only";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { downloadFile } from "../storage/blob";
import { injectPlaceholders, fillDocx } from "../utils/docx-filler";
import type { TemplateFieldSchema } from "../types/firestore";

/**
 * Fonte única da geração de PDF do plano. Antes, o download (on-demand) e o
 * gerar-pdf (pré-geração em background) tinham cópias divergentes: o download
 * caía Gotenberg → CloudConvert, mas o gerar-pdf só tentava Gotenberg. Uma
 * falha momentânea do Gotenberg fazia o background salvar o PDF genérico
 * (buildFallbackPdf, fora do formato do template) e cacheá-lo como "pronto" —
 * daí em diante todo download servia o layout errado. Unificar aqui garante a
 * mesma cadeia de fallback e o mesmo sinal de fidelidade nos dois caminhos.
 */

// ── Text helpers ──────────────────────────────────────────────────────────────

export function htmlToPlainText(html: string): string {
  if (!html || !html.trim().startsWith("<")) return html;
  return html
    .replace(/<li>/gi, "• ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeConteudo(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") out[k] = htmlToPlainText(v);
  }
  return out;
}

/** Neutraliza {{ }} vindos do conteúdo para não colidirem com os placeholders. */
export function escapeDelimiters(v: string): string {
  return v.replace(/\{\{/g, "{ {").replace(/\}\}/g, "} }");
}

// pdf-lib StandardFonts usam WinAnsi — normaliza e descarta fora do Latin-1
export function safePdfText(text: string): string {
  return text.normalize("NFC").replace(/[^\x00-\xFF]/g, (ch) => {
    const base = ch.normalize("NFD").charAt(0);
    return base.charCodeAt(0) <= 0xff ? base : "?";
  });
}

export function wrapLines(text: string, cpl: number): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    if (raw.length <= cpl) { out.push(raw); continue; }
    const words = raw.split(" ");
    let line = "";
    for (const w of words) {
      if ((line + " " + w).trim().length > cpl) { if (line) out.push(line.trim()); line = w; }
      else line = line ? line + " " + w : w;
    }
    if (line) out.push(line.trim());
  }
  return out;
}

// ── Generic fallback PDF (NÃO segue o layout do template) ──────────────────────

const PDF_GROUP_ORDER = ["dados_turma", "objetivos", "competencias", "habilidades", "conteudos", "avaliacao", "outros"];
const PDF_GROUP_LABELS: Record<string, string> = {
  dados_turma: "Dados da turma", objetivos: "Objetivos", competencias: "Competências",
  habilidades: "Habilidades", conteudos: "Conteúdos", avaliacao: "Avaliação", outros: "Outros",
};

export async function buildFallbackPdf(
  titulo: string,
  schema: TemplateFieldSchema[],
  values: Record<string, string>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const PAGE_W = 595, PAGE_H = 842, MARGIN = 50, CONTENT_W = PAGE_W - MARGIN * 2;
  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  const newPage = () => { page = doc.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN; };
  const ensureSpace = (n: number) => { if (y < MARGIN + n) newPage(); };

  for (const line of wrapLines(safePdfText(titulo), 60)) {
    ensureSpace(20); page.drawText(line, { x: MARGIN, y, size: 15, font: bold, color: rgb(0.05, 0.05, 0.05) }); y -= 20;
  }
  page.drawText(safePdfText(`Gerado em ${new Date().toLocaleDateString("pt-BR", { dateStyle: "long" })} — PlanoMagistra`),
    { x: MARGIN, y, size: 8, font, color: rgb(0.55, 0.55, 0.55) }); y -= 10;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT_W, y }, thickness: 1, color: rgb(0.82, 0.82, 0.82) }); y -= 18;

  const groups = new Map<string, TemplateFieldSchema[]>();
  for (const f of schema) {
    const g = f.group ?? (f.role === "manual" ? "dados_turma" : "outros");
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(f);
  }
  const ordered: Array<[string, TemplateFieldSchema[]]> = [
    ...PDF_GROUP_ORDER.filter((g) => groups.has(g)).map((g) => [g, groups.get(g)!] as [string, TemplateFieldSchema[]]),
    ...[...groups.entries()].filter(([g]) => !PDF_GROUP_ORDER.includes(g)),
  ];

  for (const [gk, fields] of ordered) {
    const filled = fields.filter((f) => values[f.key]?.trim());
    if (!filled.length) continue;
    ensureSpace(30);
    page.drawText(safePdfText((PDF_GROUP_LABELS[gk] ?? gk).toUpperCase()), { x: MARGIN, y, size: 7.5, font: bold, color: rgb(0.38, 0.38, 0.65) }); y -= 5;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT_W, y }, thickness: 0.4, color: rgb(0.82, 0.82, 0.9) }); y -= 12;
    for (const f of filled) {
      const lines = wrapLines(safePdfText(values[f.key]!.trim()), 88);
      ensureSpace(12 + lines.length * 12 + 8);
      page.drawText(safePdfText(`${f.label}:`), { x: MARGIN, y, size: 8, font: bold, color: rgb(0.15, 0.15, 0.15) }); y -= 12;
      for (const l of lines) { ensureSpace(14); page.drawText(l, { x: MARGIN + 10, y, size: 9, font, color: rgb(0.08, 0.08, 0.08) }); y -= 12; }
      y -= 6;
    }
    y -= 8;
  }
  return doc.save();
}

// ── DOCX → PDF converters (LibreOffice) ────────────────────────────────────────

export async function convertDocxToPdfGotenberg(docxBuffer: Buffer, filename: string): Promise<Buffer> {
  const baseUrl = process.env.GOTENBERG_URL?.replace(/\/$/, "");
  const apiKey  = process.env.GOTENBERG_API_KEY;
  if (!baseUrl) throw new Error("GOTENBERG_URL não configurada");

  const form = new FormData();
  form.append(
    "files",
    new Blob([new Uint8Array(docxBuffer)], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
    filename,
  );
  const headers: Record<string, string> = {};
  if (apiKey) headers["X-Api-Key"] = apiKey;

  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 38_000);
  try {
    const res = await fetch(`${baseUrl}/forms/libreoffice/convert`, { method: "POST", headers, body: form, signal: controller.signal });
    if (!res.ok) throw new Error(`Gotenberg: conversão falhou (HTTP ${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(abortTimer);
  }
}

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
interface CCJob { id: string; status: string; tasks: CCTask[]; }

export async function convertDocxToPdfCloudConvert(docxBuffer: Buffer, filename: string): Promise<Buffer> {
  const apiKey = process.env.CLOUDCONVERT_API_KEY;
  if (!apiKey) throw new Error("CLOUDCONVERT_API_KEY não configurada");

  const createRes = await fetch("https://api.cloudconvert.com/v2/jobs", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      tasks: {
        upload:  { operation: "import/upload" },
        convert: { operation: "convert", input: "upload", input_format: "docx", output_format: "pdf", engine: "libreoffice" },
        export:  { operation: "export/url", input: "convert" },
      },
    }),
  });
  if (!createRes.ok) throw new Error(`CloudConvert: erro ao criar job (HTTP ${createRes.status})`);

  const { data: job } = (await createRes.json()) as { data: CCJob };
  const uploadTask = job.tasks.find((t) => t.operation === "import/upload");
  if (!uploadTask?.result?.form) throw new Error("CloudConvert: form de upload não disponível");

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

  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise<void>((r) => setTimeout(r, 2000));
    const statusRes = await fetch(`https://api.cloudconvert.com/v2/jobs/${job.id}?include=tasks`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
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

/** Gotenberg → CloudConvert. Lança quando ambos falham (sem cair no genérico). */
export async function convertDocxToPdf(docxBuffer: Buffer, filename: string): Promise<Buffer> {
  try {
    if (!process.env.GOTENBERG_URL) throw new Error("Gotenberg não configurado");
    return await convertDocxToPdfGotenberg(docxBuffer, filename);
  } catch (gotenbergErr) {
    console.warn("[pdf-convert] Gotenberg falhou, tentando CloudConvert:", gotenbergErr);
    return await convertDocxToPdfCloudConvert(docxBuffer, filename);
  }
}

// ── Filled DOCX + high-level plano PDF ─────────────────────────────────────────

/**
 * Constrói o DOCX preenchido a partir do fillable salvo (preferido) ou
 * re-injetando os placeholders no original. `conteudo` deve vir já
 * normalizado (htmlToPlainText); os delimitadores são escapados aqui.
 */
export async function buildFilledDocx(opts: {
  arquivoUrl: string;
  fillableUrl?: string;
  schema: TemplateFieldSchema[];
  conteudo: Record<string, string>;
}): Promise<Buffer> {
  const { arquivoUrl, fillableUrl, schema, conteudo } = opts;

  let docxBuffer: Buffer;
  if (fillableUrl) {
    const fillableBuf = await downloadFile(fillableUrl);
    const zip = new (await import("pizzip")).default(fillableBuf);
    const xml = zip.files["word/document.xml"]?.asText() ?? "";
    docxBuffer = xml.includes("{{") ? fillableBuf : injectPlaceholders(await downloadFile(arquivoUrl), schema);
  } else {
    docxBuffer = injectPlaceholders(await downloadFile(arquivoUrl), schema);
  }

  const safeConteudo = Object.fromEntries(
    Object.entries(conteudo).map(([k, v]) => [k, escapeDelimiters(v)]),
  );
  return fillDocx(docxBuffer, schema, safeConteudo);
}

export interface PlanoPdfResult {
  buffer: Buffer;
  /** true = conversão fiel do DOCX; false = layout genérico (buildFallbackPdf). */
  faithful: boolean;
}

/**
 * Gera o PDF do plano com fidelidade máxima ao template DOCX. Só cai no layout
 * genérico quando não há DOCX ou quando as DUAS engines de conversão falham —
 * e nesse caso `faithful=false` sinaliza para o chamador não cachear como final.
 */
export async function buildPlanoPdf(opts: {
  arquivoUrl: string;
  fillableUrl?: string;
  schema: TemplateFieldSchema[];
  conteudo: Record<string, string>;
  fileBaseName: string;
}): Promise<PlanoPdfResult> {
  const { arquivoUrl, fillableUrl, schema, conteudo, fileBaseName } = opts;
  const ext = arquivoUrl.split(".").pop()?.toLowerCase().replace(/\?.*$/, "") ?? "";
  const isDocx = ext === "docx" || ext === "doc";

  if (isDocx && arquivoUrl) {
    try {
      const filled = await buildFilledDocx({ arquivoUrl, fillableUrl, schema, conteudo });
      const buffer = await convertDocxToPdf(filled, `${fileBaseName}.docx`);
      return { buffer, faithful: true };
    } catch (err) {
      console.warn("[pdf-convert] Conversão DOCX→PDF falhou, usando layout genérico:", err);
    }
  }
  return { buffer: Buffer.from(await buildFallbackPdf(fileBaseName, schema, conteudo)), faithful: false };
}
