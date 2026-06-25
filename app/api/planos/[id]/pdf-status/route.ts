import "server-only";

import { NextResponse } from "next/server";
import { getAdminDb } from "../../../../../lib/firebase/admin";
import { getCurrentUserProfile } from "../../../../../lib/auth/session";
import type { PlanoRecord } from "../../../../../lib/types/firestore";

export const dynamic = "force-dynamic";

export async function GET(
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

    const data = snap.data() as PlanoRecord;
    if (data.user_id !== user.uid) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

    return NextResponse.json({
      pdf_status: data.pdf_status ?? null,
      pdf_url:    data.pdf_url    ?? null,
      pdf_error:  data.pdf_error  ?? null,
    });
  } catch {
    return NextResponse.json({ error: "Falha ao verificar status." }, { status: 500 });
  }
}
