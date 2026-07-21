import "server-only";

import { after } from "next/server";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

import { getAdminDb } from "../../../../../lib/firebase/admin";
import { getCurrentUserProfile } from "../../../../../lib/auth/session";
import { uploadFile } from "../../../../../lib/storage/blob";
import { buildPlanoPdf, normalizeConteudo } from "../../../../../lib/services/pdf-convert.server";
import type { PlanoRecord, TemplateFieldSchema, TemplateRecord } from "../../../../../lib/types/firestore";

export const maxDuration = 60;

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
  const arquivoUrl = plano.arquivo_url ?? template?.arquivo_url ?? "";
  const fillableUrl = plano.arquivo_fillable_url ?? template?.arquivo_fillable_url ?? "";

  // Gotenberg → CloudConvert → layout genérico (com sinal de fidelidade).
  const { buffer: pdfBuffer, faithful } = await buildPlanoPdf({
    arquivoUrl, fillableUrl, schema, conteudo, fileBaseName,
  });

  const safeName = fileBaseName.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9\s\-_]/g, "").replace(/\s+/g, "_").slice(0, 80);
  const pdfUrl = await uploadFile({ path: `planos/${planoId}/${safeName}.pdf`, buffer: pdfBuffer, contentType: "application/pdf" });

  await db.collection("magins_planos_aula").doc(planoId).update({
    pdf_url: pdfUrl,
    pdf_status: "pronto",
    // Não incrementa downloads aqui: isto é pré-geração, não um download real.
    // pdf_is_fallback marca PDFs genéricos para o download tentar conversão fiel.
    pdf_is_fallback: !faithful,
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

    // Idempotency: only skip re-trigger for a FAITHFUL cached PDF. Um fallback
    // genérico cacheado não deve bloquear uma nova tentativa de conversão fiel.
    const existing = snap.data() as PlanoRecord;
    if (existing.pdf_status === "pronto" && existing.pdf_url && existing.pdf_is_fallback !== true) {
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
