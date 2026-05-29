import "server-only";

import { NextResponse } from "next/server";

import { getCurrentSession } from "../../../../lib/auth/session";
import { getAdminDb } from "../../../../lib/firebase/admin";

const ALLOWED_PLANS = ["free", "starter", "medio", "pro"] as const;

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();

    if (!session) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    const body = (await request.json()) as { plano?: string };
    const plano = body?.plano?.trim().toLowerCase();

    if (!plano || !ALLOWED_PLANS.includes(plano as (typeof ALLOWED_PLANS)[number])) {
      return NextResponse.json(
        { error: "Plano inválido. Somente 'starter' disponível no MVP." },
        { status: 400 },
      );
    }

    const db = getAdminDb();
    await db.collection("magis_users").doc(session.uid).set(
      {
        plano,
        onboarding_concluido: true,
      },
      { merge: true },
    );

    return NextResponse.json({ ok: true, plano });
  } catch (error) {
    console.error("[PlanoMagistra/api/onboarding/plano] Erro:", error);
    return NextResponse.json({ error: "Falha ao ativar o plano." }, { status: 500 });
  }
}
