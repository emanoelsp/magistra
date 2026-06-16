import "server-only";

import { NextResponse } from "next/server";

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
    if (typeof v === "string") out[k] = htmlToPlainText(v);
  }
  return out;
}

function escapeTemplateDelimiters(value: string): string {
  return value.replace(/\{\{/g, "{ {").replace(/\}\}/g, "} }");
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const db = getAdminDb();
    const planoSnap = await db.collection("magis_planos").doc(id).get();
    if (!planoSnap.exists) {
      return new NextResponse("Plano não encontrado.", { status: 404 });
    }

    const planoData = planoSnap.data() as PlanoRecord;
    const conteudo = normalizeConteudo(planoData.conteudo_gerado ?? {});

    const templateSnap = await db.collection("magis_templates").doc(planoData.template_id).get();
    const template = templateSnap.exists ? (templateSnap.data() as TemplateRecord) : null;
    const schema: TemplateFieldSchema[] =
      Array.isArray(planoData.schema_campos) && planoData.schema_campos.length > 0
        ? planoData.schema_campos
        : Array.isArray(template?.schema_campos)
          ? template.schema_campos
          : [];

    const arquivoUrl = template?.arquivo_url ?? "";
    const ext = arquivoUrl.split(".").pop()?.toLowerCase() ?? "";
    if ((ext !== "docx" && ext !== "doc") || !arquivoUrl) {
      return new NextResponse("Template DOCX não disponível.", { status: 404 });
    }

    const fillableUrl = template?.arquivo_fillable_url ?? "";
    let docxBuffer: Buffer;

    if (fillableUrl) {
      const fillableBuf = await downloadFile(fillableUrl);
      const zip = new (await import("pizzip")).default(fillableBuf);
      const xmlSample = zip.files["word/document.xml"]?.asText() ?? "";
      const isManuallyPrepared = xmlSample.includes("{{");
      docxBuffer = isManuallyPrepared ? fillableBuf : injectPlaceholders(await downloadFile(arquivoUrl), schema);
    } else {
      docxBuffer = injectPlaceholders(await downloadFile(arquivoUrl), schema);
    }

    const safeConteudo = Object.fromEntries(
      Object.entries(conteudo).map(([k, v]) => [k, escapeTemplateDelimiters(v)]),
    );
    const filledBuffer = fillDocx(docxBuffer, schema, safeConteudo);

    return new NextResponse(filledBuffer.buffer as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("[PlanoMagistra/preview-docx] Erro:", error);
    return new NextResponse("Erro ao gerar pré-visualização.", { status: 500 });
  }
}
