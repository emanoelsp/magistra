import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../../../../lib/firebase/admin";
import { getCurrentUserProfile } from "../../../../lib/auth/session";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUserProfile();
    if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

    const body = await request.json() as { minutos?: unknown };
    const minutos = body.minutos;
    if (typeof minutos !== "number" || minutos <= 0 || !Number.isFinite(minutos)) {
      return NextResponse.json({ error: "Valor inválido." }, { status: 400 });
    }

    await getAdminDb()
      .collection("magis_users")
      .doc(user.uid)
      .update({ tempo_economizado_min: FieldValue.increment(Math.round(minutos)) });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Falha ao registrar." }, { status: 500 });
  }
}
