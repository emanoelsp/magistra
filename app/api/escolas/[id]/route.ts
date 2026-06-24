import "server-only";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../../../lib/firebase/admin";
import { requireCurrentUserProfile } from "../../../../lib/auth/session";

async function checkOwnership(uid: string, id: string) {
  const db = getAdminDb();
  const snap = await db.collection("magis_escolas").doc(id).get();
  if (!snap.exists) return { db, doc: null };
  const data = snap.data()!;
  if (data.user_id !== uid) return { db, doc: null };
  return { db, doc: snap };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireCurrentUserProfile();
    const { id } = await params;
    const { db, doc } = await checkOwnership(user.uid, id);
    if (!doc) return NextResponse.json({ error: "Não encontrado." }, { status: 404 });

    const body = (await request.json()) as { nome?: string; cursos?: unknown };
    const nome = body.nome?.trim() ?? "";
    if (!nome) return NextResponse.json({ error: "Nome obrigatório." }, { status: 400 });

    const update: Record<string, unknown> = { nome };
    if (Array.isArray(body.cursos)) update.cursos = body.cursos;
    await db.collection("magis_escolas").doc(id).update(update);

    const turmasSnap = await db
      .collection("magis_turmas")
      .where("escola_id", "==", id)
      .where("user_id", "==", user.uid)
      .get();
    const batch = db.batch();
    turmasSnap.docs.forEach((d) => batch.update(d.ref, { escola_nome: nome }));
    if (!turmasSnap.empty) await batch.commit();

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Falha ao atualizar escola." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireCurrentUserProfile();
    const { id } = await params;
    const { db, doc } = await checkOwnership(user.uid, id);
    if (!doc) return NextResponse.json({ error: "Não encontrado." }, { status: 404 });

    const turmasSnap = await db
      .collection("magis_turmas")
      .where("escola_id", "==", id)
      .where("user_id", "==", user.uid)
      .get();
    const batch = db.batch();
    turmasSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(db.collection("magis_escolas").doc(id));
    await batch.commit();

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Falha ao excluir escola." }, { status: 500 });
  }
}
