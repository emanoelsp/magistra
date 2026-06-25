import "server-only";

import { after } from "next/server";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { getAdminDb } from "../../../../../lib/firebase/admin";
import { getCurrentUserProfile } from "../../../../../lib/auth/session";
import { downloadFile, uploadFile } from "../../../../../lib/storage/blob";
import { injectPlaceholders, fillDocx } from "../../../../../lib/utils/docx-filler";
import type { PlanoRecord, TemplateFieldSchema, TemplateRecord } from "../../../../../lib/types/firestore";

export const maxDuration = 60;

// ── Helpers (inline — shared logic mirrors download/route.ts) ─────────────

function htmlToPlainText(html: string): string {
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

function normalizeConteudo(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") out[k] = htmlToPlainText(v);
  }
  return out;
}

function escapeDelimiters(v: string) { return v.replace(/\{\{/g, "{ {").replace(/\}\}/g, "} }"); }

function safePdfText(text: string): string {
  return text.normalize("NFC").replace(/[^\x00-\xFF]/g, (ch) => {
    const base = ch.normalize("NFD").charAt(0);
    return base.charCodeAt(0) <= 0xff ? base : "?";
  });
}

function wrapLines(text: string, cpl: number): string[] {
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

const PDF_GROUP_ORDER = ["dados_turma", "objetivos", "competencias", "habilidades", "conteudos", "avaliacao", "outros"];
const PDF_GROUP_LABELS: Record<string, string> = {
  dados_turma: "Dados da turma", objetivos: "Objetivos", competencias: "Competências",
  habilidades: "Habilidades", conteudos: "Conteúdos", avaliacao: "Avaliação", outros: "Outros",
};

async function buildFallbackPdf(titulo: string, schema: TemplateFieldSchema[], values: Record<string, string>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const PAGE_W = 595, PAGE_H = 842, MARGIN = 50, CONTENT_W = PAGE_W - MARGIN * 2;
  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  function newPage() { page = doc.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN; }
  function ensureSpace(n: number) { if (y < MARGIN + n) newPage(); }

  for (const line of wrapLines(safePdfText(titulo), 60)) {
    ensureSpace(20); page.drawText(line, { x: MARGIN, y, size: 15, font: bold, color: rgb(0.05, 0.05, 0.05) }); y -= 20;
  }
  page.drawText(safePdfText(`Gerado em ${new Date().toLocaleDateString("pt-BR", { dateStyle: "long" })} — PlanoMagistra`),
    { x: MARGIN, y, size: 8, font, color: rgb(0.55, 0.55, 0.55) }); y -= 10;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT_W, y }, thickness: 1, color: rgb(0.82, 0.82, 0.82) }); y -= 18;

  const groups = new Map<string, TemplateFieldSchema[]>();
  for (const f of schema) { const g = f.group ?? (f.role === "manual" ? "dados_turma" : "outros"); if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push(f); }
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

async function convertDocxToPdfGotenberg(docxBuffer: Buffer, filename: string): Promise<Buffer> {
  const baseUrl = process.env.GOTENBERG_URL?.replace(/\/$/, "");
  const apiKey  = process.env.GOTENBERG_API_KEY;
  if (!baseUrl) throw new Error("GOTENBERG_URL não configurada");
  const form = new FormData();
  form.append("files", new Blob([new Uint8Array(docxBuffer)], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), filename);
  const headers: Record<string, string> = {};
  if (apiKey) headers["X-Api-Key"] = apiKey;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 38_000);
  try {
    const res = await fetch(`${baseUrl}/forms/libreoffice/convert`, { method: "POST", headers, body: form, signal: controller.signal });
    if (!res.ok) throw new Error(`Gotenberg HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally { clearTimeout(t); }
}

// ── Core background task ──────────────────────────────────────────────────

async function gerarPdfBackground(planoId: string, uid: string): Promise<void> {
  const db = getAdminDb();
  const planoSnap = await db.collection("magins_planos_aula").doc(planoId).get();
  if (!planoSnap.exists || (planoSnap.data() as PlanoRecord).user_id !== uid) return;
  const plano = planoSnap.data() as PlanoRecord;

  const templateSnap = await db.collection("magis_templates").doc(plano.template_id).get();
  const template = templateSnap.exists ? (templateSnap.data() as TemplateRecord) : null;

  const schema: TemplateFieldSchema[] =
    Array.isArray(plano.schema_campos) && plano.schema_campos.length > 0
      ? plano.schema_campos
      : Array.isArray(template?.schema_campos) ? template.schema_campos : [];

  const fileBaseName = (() => {
    const t = plano.conteudo_gerado?._plano_titulo;
    return (typeof t === "string" && t.trim()) ? t.trim() : (template?.nome ?? "Plano");
  })();

  const conteudo = normalizeConteudo(plano.conteudo_gerado ?? {});
  const safeConteudo = Object.fromEntries(Object.entries(conteudo).map(([k, v]) => [k, escapeDelimiters(v)]));

  const arquivoUrl = plano.arquivo_url ?? template?.arquivo_url ?? "";
  const ext = arquivoUrl.split(".").pop()?.toLowerCase() ?? "";
  const isDocx = ext === "docx" || ext === "doc";

  let pdfBuffer: Buffer;

  if (isDocx && arquivoUrl) {
    try {
      const fillableUrl = plano.arquivo_fillable_url ?? template?.arquivo_fillable_url ?? "";
      let docxBuffer: Buffer;
      if (fillableUrl) {
        const fillableBuf = await downloadFile(fillableUrl);
        const zip = new (await import("pizzip")).default(fillableBuf);
        const xml = zip.files["word/document.xml"]?.asText() ?? "";
        docxBuffer = xml.includes("{{") ? fillableBuf : injectPlaceholders(await downloadFile(arquivoUrl), schema);
      } else {
        docxBuffer = injectPlaceholders(await downloadFile(arquivoUrl), schema);
      }
      const filled = fillDocx(docxBuffer, schema, safeConteudo);
      pdfBuffer = await convertDocxToPdfGotenberg(filled, `${fileBaseName}.docx`);
    } catch {
      // Gotenberg failed — fall back to text-only PDF
      pdfBuffer = Buffer.from(await buildFallbackPdf(fileBaseName, schema, conteudo));
    }
  } else {
    pdfBuffer = Buffer.from(await buildFallbackPdf(fileBaseName, schema, conteudo));
  }

  const safeName = fileBaseName.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9\s\-_]/g, "").replace(/\s+/g, "_").slice(0, 80);
  const pdfUrl = await uploadFile({ path: `planos/${planoId}/${safeName}.pdf`, buffer: pdfBuffer, contentType: "application/pdf" });

  await db.collection("magins_planos_aula").doc(planoId).update({
    pdf_url: pdfUrl,
    pdf_status: "pronto",
    downloads: FieldValue.increment(1),
  });
}

// ── Route handler ─────────────────────────────────────────────────────────

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const user = await getCurrentUserProfile();
    if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

    const db = getAdminDb();
    const snap = await db.collection("magins_planos_aula").doc(id).get();
    if (!snap.exists) return NextResponse.json({ error: "Plano não encontrado." }, { status: 404 });
    if ((snap.data() as PlanoRecord).user_id !== user.uid)
      return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

    // Idempotency: if already generated or in progress, don't re-trigger
    const existing = snap.data() as PlanoRecord;
    if (existing.pdf_status === "pronto" && existing.pdf_url) {
      return NextResponse.json({ status: "pronto", pdf_url: existing.pdf_url });
    }

    await db.collection("magins_planos_aula").doc(id).update({ pdf_status: "gerando", pdf_error: null });

    after(
      gerarPdfBackground(id, user.uid).catch(async (err) => {
        const msg = err instanceof Error ? err.message : "Falha desconhecida";
        console.error(`[gerar-pdf] background error plano=${id}:`, msg);
        await getAdminDb().collection("magins_planos_aula").doc(id).update({ pdf_status: "erro", pdf_error: msg }).catch(() => {});
      }),
    );

    return NextResponse.json({ status: "processando" }, { status: 202 });
  } catch (err) {
    console.error("[gerar-pdf] route error:", err);
    return NextResponse.json({ error: "Falha ao iniciar geração." }, { status: 500 });
  }
}
