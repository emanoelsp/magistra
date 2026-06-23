import "server-only";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../../../lib/firebase/admin";
import { requireCurrentUserProfile } from "../../../../lib/auth/session";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireCurrentUserProfile();
    const { id } = await params;
    const db = getAdminDb();
    const snap = await db.collection("magis_turmas").doc(id).get();
    if (!snap.exists || snap.data()?.user_id !== user.uid) {
      return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
    }

    const body = (await request.json()) as {
      nome?: string;
      ano_letivo?: number;
      disciplina?: string;
    };
    const update: Record<string, unknown> = {};
    if (body.nome?.trim()) update.nome = body.nome.trim();
    if (typeof body.ano_letivo === "number") update.ano_letivo = body.ano_letivo;
    if ("disciplina" in body) update.disciplina = body.disciplina?.trim() || "";

    await db.collection("magis_turmas").doc(id).update(update);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Falha ao atualizar turma." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireCurrentUserProfile();
    const { id } = await params;
    const db = getAdminDb();
    const snap = await db.collection("magis_turmas").doc(id).get();
    if (!snap.exists || snap.data()?.user_id !== user.uid) {
      return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
    }
    await db.collection("magis_turmas").doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Falha ao excluir turma." }, { status: 500 });
  }
}
