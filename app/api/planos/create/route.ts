import "server-only";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../../../../lib/firebase/admin";
import { requireCurrentUserProfile } from "../../../../lib/auth/session";
import { getLimitsStatus } from "../../../../lib/services/limits";
import type { CreatePlanoInput } from "../../../../lib/types/firestore";

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUserProfile();
    const db = getAdminDb();

    // Enforce plan limit server-side
    const limits = await getLimitsStatus(user.uid, user.plano ?? "free");
    if (!limits.canCreatePlano) {
      return NextResponse.json(
        {
          error: `Limite de ${limits.limits.maxPlanosPerMonth} planos/mês atingido. Faça upgrade do plano.`,
          limitReached: true,
        },
        { status: 403 },
      );
    }

    const body = (await request.json()) as Partial<CreatePlanoInput>;
    const { template_id, conteudo_gerado, status, schema_campos } = body;

    if (!template_id) {
      return NextResponse.json({ error: "template_id é obrigatório." }, { status: 400 });
    }

    // Verify template ownership
    const templateSnap = await db.collection("magis_templates").doc(template_id).get();
    if (!templateSnap.exists || templateSnap.data()?.user_id !== user.uid) {
      return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
    }

    const now = FieldValue.serverTimestamp();
    const docRef = await db.collection("magins_planos_aula").add({
      user_id: user.uid,
      template_id,
      conteudo_gerado: conteudo_gerado ?? {},
      status: status ?? "rascunho",
      data_geracao: now,
      downloads: 0,
      ...(Array.isArray(schema_campos) ? { schema_campos } : {}),
    });

    return NextResponse.json({ id: docRef.id });
  } catch (err) {
    console.error("[api/planos/create]", err);
    return NextResponse.json({ error: "Erro ao criar plano." }, { status: 500 });
  }
}
