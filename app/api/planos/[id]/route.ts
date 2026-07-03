import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

import { getAdminDb } from "../../../../lib/firebase/admin";
import { getCurrentUserProfile } from "../../../../lib/auth/session";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

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

  const data = planoSnap.data()!;

  if (data.user_id !== user.uid) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  if (data.status !== "rascunho") {
    return NextResponse.json(
      { error: "Apenas rascunhos podem ser excluídos." },
      { status: 422 },
    );
  }

  if (data.deleted_at) {
    return NextResponse.json({ ok: true }); // already deleted — idempotent
  }

  await db.collection("magins_planos_aula").doc(id).update({
    deleted_at: new Date().toISOString(),
    deleted_by: user.uid,
    // Keep a server-side timestamp for Firestore TTL policies if added later
    deleted_at_ts: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ ok: true });
}
