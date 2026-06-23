import "server-only";

import { NextResponse } from "next/server";
import { getAdminDb } from "../../../../../lib/firebase/admin";
import { requireCurrentUserProfile } from "../../../../../lib/auth/session";
import { getLimitsStatus } from "../../../../../lib/services/limits";
import type { PlanoRecord, TemplateRecord, TemplateFieldSchema } from "../../../../../lib/types/firestore";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireCurrentUserProfile();
    const { id } = await params;

    const db = getAdminDb();
    const planoSnap = await db.collection("magins_planos_aula").doc(id).get();

    if (!planoSnap.exists) {
      return NextResponse.json({ error: "Plano não encontrado." }, { status: 404 });
    }

    const plano = planoSnap.data() as PlanoRecord;

    if (plano.user_id !== user.uid) {
      return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
    }

    // Check monthly plan creation limit
    const limits = await getLimitsStatus(user.uid, user.plano ?? "free");
    if (!limits.canCreatePlano) {
      return NextResponse.json(
        { error: "Você atingiu o limite de planos deste mês." },
        { status: 403 },
      );
    }

    // Fetch template schema to distinguish manual vs IA fields
    const templateSnap = await db.collection("magis_templates").doc(plano.template_id).get();
    const template = templateSnap.exists ? (templateSnap.data() as TemplateRecord) : null;

    // Build renewed content: keep manual fields, clear IA fields so Magis regenerates them
    const oldConteudo = plano.conteudo_gerado ?? {};
    const newConteudo: Record<string, unknown> = {};

    const schema = (template?.schema_campos ?? plano.schema_campos ?? []) as TemplateFieldSchema[];

    if (schema.length > 0) {
      for (const field of schema) {
        if (field.role === "manual" && oldConteudo[field.key] !== undefined) {
          newConteudo[field.key] = oldConteudo[field.key];
        }
        // ia_sugerida fields are intentionally left empty so Magis regenerates them
      }
    } else {
      // No schema available: copy everything (best-effort)
      Object.assign(newConteudo, oldConteudo);
    }

    const currentYear = new Date().getFullYear();
    newConteudo._renovado_de = id;
    newConteudo._ano_letivo = String(currentYear);

    // Carry forward metadata fields that identify the plan in the UI
    if (typeof oldConteudo._plano_titulo === "string" && oldConteudo._plano_titulo.trim()) {
      newConteudo._plano_titulo = oldConteudo._plano_titulo;
    }

    const newRef = db.collection("magins_planos_aula").doc();
    await newRef.set({
      user_id: user.uid,
      template_id: plano.template_id,
      status: "rascunho",
      data_geracao: new Date().toISOString(),
      conteudo_gerado: newConteudo,
      ...(schema.length > 0 ? { schema_campos: schema } : {}),
      downloads: 0,
    });

    return NextResponse.json({ ok: true, id: newRef.id });
  } catch (err) {
    console.error("[planos/renovar]", err);
    return NextResponse.json({ error: "Falha ao renovar plano." }, { status: 500 });
  }
}
