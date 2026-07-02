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
      tipo_professor?: string;
      disciplina?: string;
      grupo_id?: string | null;
      tem_aluno_especial?: boolean;
    };
    const update: Record<string, unknown> = {};
    if (body.nome?.trim()) update.nome = body.nome.trim();
    if (typeof body.ano_letivo === "number") update.ano_letivo = body.ano_letivo;
    if (body.tipo_professor === "segundo_professor" || body.tipo_professor === "professor_area") {
      update.tipo_professor = body.tipo_professor;
      if (body.tipo_professor === "segundo_professor") update.disciplina = "";
    }
    if ("disciplina" in body && body.tipo_professor !== "segundo_professor") {
      update.disciplina = body.disciplina?.trim() || "";
    }
    if ("grupo_id" in body) update.grupo_id = body.grupo_id ?? null;
    if ("tem_aluno_especial" in body) update.tem_aluno_especial = !!body.tem_aluno_especial;

    await db.collection("magis_turmas").doc(id).update(update);

    if (body.tipo_professor === "segundo_professor") {
      await db.collection("magis_users").doc(user.uid).update({ is_segundo_professor: true });
    } else if (body.tipo_professor === "professor_area") {
      const turmasSnap = await db.collection("magis_turmas").where("user_id", "==", user.uid).get();
      const isSegundo = turmasSnap.docs.some((d) => d.data().tipo_professor === "segundo_professor");
      await db.collection("magis_users").doc(user.uid).update({ is_segundo_professor: isSegundo });
    }

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
