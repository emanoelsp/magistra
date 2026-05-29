import "server-only";

import { NextResponse } from "next/server";
import mammoth from "mammoth";

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
    const templateNome = template?.nome ?? "Plano";
    // Prefer schema snapshot saved at plan creation; fall back to current template schema
    const schema: TemplateFieldSchema[] =
      Array.isArray(planoData.schema_campos) && planoData.schema_campos.length > 0
        ? planoData.schema_campos
        : Array.isArray(template?.schema_campos)
          ? template.schema_campos
          : [];

    const arquivoUrl = template?.arquivo_url ?? "";
    const ext = arquivoUrl.split(".").pop()?.toLowerCase() ?? "";
    const isDocx = ext === "docx" || ext === "doc";

    if (!isDocx || !arquivoUrl) {
      // No DOCX available — return minimal HTML with field list
      const rows = schema
        .map((f) => {
          const val = conteudo[f.key] || "—";
          return `<tr><th>${f.label}</th><td>${val}</td></tr>`;
        })
        .join("");
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
        <style>body{font-family:Arial,sans-serif;padding:40px}
        h1{font-size:16px;text-align:center}
        table{width:100%;border-collapse:collapse}
        th,td{border:1px solid #ccc;padding:6px 10px;font-size:13px;vertical-align:top}
        th{font-weight:bold;width:40%;background:#f5f5f5}</style></head>
        <body><h1>${templateNome}</h1><table>${rows}</table></body></html>`;
      return new NextResponse(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Fill the DOCX
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

    // Convert filled DOCX to HTML via mammoth
    const { value: bodyHtml } = await mammoth.convertToHtml(
      { buffer: Buffer.from(filledBuffer) },
      {
        styleMap: [
          "p[style-name='Heading 1'] => h1:fresh",
          "p[style-name='Heading 2'] => h2:fresh",
          "b => strong",
        ],
      },
    );

    const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Arial, sans-serif;
      font-size: 12px;
      padding: 32px 40px;
      color: #111;
      background: #fff;
    }
    h1 { font-size: 15px; margin: 12px 0 8px; }
    h2 { font-size: 13px; margin: 10px 0 6px; }
    p { margin: 4px 0; line-height: 1.5; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 8px 0;
    }
    td, th {
      border: 1px solid #555;
      padding: 4px 8px;
      vertical-align: top;
    }
    img { max-width: 100%; height: auto; display: block; margin: 0 auto 8px; }
    ul, ol { padding-left: 20px; margin: 4px 0; }
    li { margin: 2px 0; }
    strong { font-weight: bold; }
  </style>
</head>
<body>
${bodyHtml}
</body>
</html>`;

    return new NextResponse(fullHtml, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("[PlanoMagistra/preview] Erro:", error);
    return new NextResponse("Erro ao gerar preview.", { status: 500 });
  }
}
