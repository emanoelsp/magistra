import "server-only";

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { getAdminDb } from "../../../../../lib/firebase/admin";
import { requireCurrentUserProfile } from "../../../../../lib/auth/session";
import { getLimitsStatus } from "../../../../../lib/services/limits";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    let user: Awaited<ReturnType<typeof requireCurrentUserProfile>>;
    try {
      user = await requireCurrentUserProfile();
    } catch {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    const { id } = await params;
    const db = getAdminDb();

    const snap = await db.collection("magis_templates").doc(id).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
    }

    const tData = snap.data()!;
    if (tData.user_id !== user.uid) {
      return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
    }

    const limits = await getLimitsStatus(user.uid, user.plano);
    if (!limits.canCreateTemplate) {
      return NextResponse.json(
        { error: "Limite de templates atingido para o seu plano." },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({})) as { nome?: string };
    const originalNome = typeof tData.nome === "string" ? tData.nome : "Template";
    const novoNome =
      typeof body.nome === "string" && body.nome.trim()
        ? body.nome.trim()
        : originalNome.endsWith(" (cópia)")
          ? originalNome
          : `${originalNome} (cópia)`;

    const novoTemplate: Record<string, unknown> = {
      user_id: user.uid,
      nome: novoNome,
      escola_nome: tData.escola_nome ?? null,
      tipo_plano: tData.tipo_plano ?? null,
      schema_campos: Array.isArray(tData.schema_campos) ? tData.schema_campos : [],
      data_criacao: new Date().toISOString(),
      // Reuse same original file — no need to copy the blob in MVP
      arquivo_url: typeof tData.arquivo_url === "string" ? tData.arquivo_url : null,
      // Copy structural scan so future re-introspections benefit from it
      estrutura_docx: Array.isArray(tData.estrutura_docx) ? tData.estrutura_docx : [],
    };

    if (tData.metadata_padrao && typeof tData.metadata_padrao === "object") {
      novoTemplate.metadata_padrao = tData.metadata_padrao;
    }
    if (tData.estado && typeof tData.estado === "string") {
      novoTemplate.estado = tData.estado;
    }

    const newRef = await db.collection("magis_templates").add(novoTemplate);

    revalidatePath("/dashboard/templates");
    revalidatePath("/dashboard/historico");

    return NextResponse.json({ ok: true, id: newRef.id, nome: novoNome });
  } catch (error) {
    console.error("[duplicar-template] Erro:", error);
    return NextResponse.json({ error: "Falha ao duplicar template." }, { status: 500 });
  }
}
