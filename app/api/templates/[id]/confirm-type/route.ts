import "server-only";

import { NextResponse } from "next/server";

import { getAdminDb } from "../../../../../lib/firebase/admin";
import { requireCurrentUserProfile } from "../../../../../lib/auth/session";
import type { TemplateType } from "../../../../../lib/types/firestore";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const user = await requireCurrentUserProfile();

    const body = (await request.json()) as { template_type: TemplateType };
    if (body.template_type !== "regente" && body.template_type !== "plano_educacional_individualizado") {
      return NextResponse.json({ error: "template_type inválido." }, { status: 400 });
    }

    const db = getAdminDb();
    const snap = await db.collection("magis_templates").doc(id).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
    }
    if (snap.data()?.user_id !== user.uid) {
      return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
    }

    await db.collection("magis_templates").doc(id).update({
      template_type: body.template_type,
      tipo_incerto: false,
    });

    return NextResponse.json({ ok: true, template_type: body.template_type });
  } catch (error) {
    console.error("[confirm-type]", error);
    return NextResponse.json({ error: "Erro interno." }, { status: 500 });
  }
}
