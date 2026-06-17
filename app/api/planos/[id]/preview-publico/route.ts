import "server-only";

import { NextResponse } from "next/server";

import { getAdminDb } from "../../../../../lib/firebase/admin";
import { downloadFile } from "../../../../../lib/storage/blob";
import { injectPlaceholders, fillDocx } from "../../../../../lib/utils/docx-filler";
import { verifyPreviewToken } from "../../../../../lib/utils/preview-token";
import type { PlanoRecord, TemplateFieldSchema, TemplateRecord } from "../../../../../lib/types/firestore";

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
    if (typeof v === "string") out[k] = htmlToPlainText(v);
  }
  return out;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token") ?? "";
  const exp = parseInt(searchParams.get("exp") ?? "0", 10);

  if (!verifyPreviewToken(`plan:${id}`, token, exp)) {
    return new NextResponse("Token inválido ou expirado.", { status: 401 });
  }

  try {
    const db = getAdminDb();
    const planoSnap = await db.collection("magins_planos_aula").doc(id).get();
    if (!planoSnap.exists) return new NextResponse("Plano não encontrado.", { status: 404 });

    const planoData = planoSnap.data() as PlanoRecord;
    const conteudo = normalizeConteudo(planoData.conteudo_gerado ?? {});

    const templateSnap = await db.collection("magis_templates").doc(planoData.template_id).get();
    const template = templateSnap.exists ? (templateSnap.data() as TemplateRecord) : null;

    const schema: TemplateFieldSchema[] =
      Array.isArray(planoData.schema_campos) && planoData.schema_campos.length > 0
        ? planoData.schema_campos
        : Array.isArray(template?.schema_campos)
          ? template!.schema_campos
          : [];

    const arquivoUrl = template?.arquivo_url ?? "";
    const ext = arquivoUrl.split(".").pop()?.toLowerCase() ?? "";
    if ((ext !== "docx" && ext !== "doc") || !arquivoUrl) {
      return new NextResponse("Template não é DOCX.", { status: 400 });
    }

    // Build the filled DOCX — same logic as /download
    const fillableUrl = template?.arquivo_fillable_url ?? "";
    let docxBuffer: Buffer;

    if (fillableUrl) {
      const fillableBuf = await downloadFile(fillableUrl);
      const zip = new (await import("pizzip")).default(fillableBuf);
      const xmlSample = zip.files["word/document.xml"]?.asText() ?? "";
      if (xmlSample.includes("{{")) {
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

    return new NextResponse(new Uint8Array(filledBuffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `inline; filename="plano-${id.slice(0, 8)}.docx"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    console.error("[planos/preview-publico]", err);
    return new NextResponse("Erro ao gerar preview.", { status: 500 });
  }
}
