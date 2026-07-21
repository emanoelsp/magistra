import "server-only";

import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import pdf from "pdf-parse";
import { FieldValue } from "firebase-admin/firestore";

import { getAdminDb } from "../../../../../lib/firebase/admin";
import { downloadFile } from "../../../../../lib/storage/blob";
import { getCurrentUserProfile } from "../../../../../lib/auth/session";
import { PLAN_LIMITS } from "../../../../../lib/services/limits";
import {
  buildFallbackPdf,
  buildFilledDocx,
  buildPlanoPdf,
  normalizeConteudo,
  safePdfText,
  wrapLines,
} from "../../../../../lib/services/pdf-convert.server";
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

export const maxDuration = 60;

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

    // Planos no plano free expiram após 90 dias — inclui ex-assinantes que cancelaram
    const FREE_EXPIRY_DAYS = 90;
    const isFreePlan = planoKey === "free";
    if (isFreePlan && planoData.data_geracao) {
      const geradoEm = new Date(planoData.data_geracao).getTime();
      const daysOld = Math.floor((Date.now() - geradoEm) / (1000 * 60 * 60 * 24));
      if (daysOld >= FREE_EXPIRY_DAYS) {
        return NextResponse.json(
          {
            error: "PLAN_EXPIRED",
            daysOld,
            expiryDays: FREE_EXPIRY_DAYS,
            data_geracao: planoData.data_geracao,
          },
          { status: 403 },
        );
      }
    }

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
    // Fast path: serve pre-generated PDF directly (private blob needs server-side auth).
    // NÃO serve o cache quando o PDF armazenado é o layout genérico (pdf_is_fallback):
    // uma falha momentânea do Gotenberg não pode condenar o professor ao formato
    // errado — cai para a geração on-demand, que tenta a conversão fiel de novo.
    if (planoData.pdf_url && planoData.pdf_status === "pronto" && planoData.pdf_is_fallback !== true) {
      try {
        const pdfBuf = await downloadFile(planoData.pdf_url);
        const titleRaw = planoData.conteudo_gerado?._plano_titulo;
        const title = typeof titleRaw === "string" ? titleRaw.trim() : "";
        const fastFilename = sanitizeFilename(title || "plano", "pdf");
        void db.collection("magins_planos_aula").doc(id).update({ downloads: FieldValue.increment(1) }).catch(() => {});
        return new NextResponse(new Uint8Array(pdfBuf), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${fastFilename}"`,
            "Content-Length": String(pdfBuf.length),
          },
        });
      } catch {
        // blob expired or unavailable — fall through to on-demand generation
      }
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

    const fillableUrl = planoData.arquivo_fillable_url ?? template?.arquivo_fillable_url ?? "";

    // Download DOCX direto: preenche o fillable e serve, sem conversão.
    if (isDocx && arquivoUrl && !forcePdf) {
      try {
        const filledBuffer = await buildFilledDocx({ arquivoUrl, fillableUrl, schema, conteudo });
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
      } catch (err) {
        console.warn("[PlanoMagistra/download] Falha ao gerar DOCX preenchido:", err);
      }
    }

    // Download PDF a partir de DOCX: conversão fiel (Gotenberg → CloudConvert).
    // Se ambas falharem, buildPlanoPdf devolve o layout genérico com faithful=false —
    // e nunca cacheamos esse resultado, para o próximo download tentar de novo.
    if (isDocx && arquivoUrl && forcePdf) {
      try {
        const { buffer: pdfBuffer, faithful } = await buildPlanoPdf({
          arquivoUrl, fillableUrl, schema, conteudo, fileBaseName,
        });
        const pdfFilename = sanitizeFilename(fileBaseName, "pdf");
        void db.collection("magins_planos_aula").doc(id).update({ downloads: FieldValue.increment(1) }).catch(() => {});
        if (!faithful) {
          console.warn(`[PlanoMagistra/download] PDF genérico (conversão falhou) plano=${id}`);
        }
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
