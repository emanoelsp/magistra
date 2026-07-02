import "server-only";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../../../lib/firebase/admin";
import { requireCurrentUserProfile } from "../../../../lib/auth/session";
import type { NivelSuporte } from "../../../../lib/types/firestore";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireCurrentUserProfile();
    const { id } = await params;
    const db = getAdminDb();
    const snap = await db.collection("magis_estudantes").doc(id).get();
    if (!snap.exists || snap.data()?.user_id !== user.uid) {
      return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
    }
    return NextResponse.json({ id: snap.id, ...snap.data() });
  } catch {
    return NextResponse.json({ error: "Falha ao buscar estudante." }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireCurrentUserProfile();
    const { id } = await params;
    const db = getAdminDb();
    const snap = await db.collection("magis_estudantes").doc(id).get();
    if (!snap.exists || snap.data()?.user_id !== user.uid) {
      return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
    }

    const body = (await request.json()) as {
      nome?: string;
      data_nascimento?: string;
      escola_id?: string;
      escola_nome?: string;
      turma_id?: string;
      turma_nome?: string;
      cid?: string;
      diagnostico?: string;
      necessidades?: string;
      nivel_suporte?: NivelSuporte;
      habilidades_preditoras?: string[];
      observacoes?: string;
    };

    const NIVEL_SUPORTE_VALID: NivelSuporte[] = ["baixo", "medio", "alto"];
    if (body.nivel_suporte && !NIVEL_SUPORTE_VALID.includes(body.nivel_suporte)) {
      return NextResponse.json({ error: "nivel_suporte inválido." }, { status: 400 });
    }

    const update: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
    if (body.nome?.trim()) update.nome = body.nome.trim();
    if ("data_nascimento" in body) update.data_nascimento = body.data_nascimento ?? null;
    if ("escola_id" in body) update.escola_id = body.escola_id ?? null;
    if ("escola_nome" in body) update.escola_nome = body.escola_nome?.trim() ?? null;
    if ("cid" in body) update.cid = body.cid?.trim() ?? null;
    if ("diagnostico" in body) update.diagnostico = body.diagnostico?.trim() ?? null;
    if ("necessidades" in body) update.necessidades = body.necessidades?.trim() ?? null;
    if ("nivel_suporte" in body) update.nivel_suporte = body.nivel_suporte ?? null;
    if ("habilidades_preditoras" in body) update.habilidades_preditoras = body.habilidades_preditoras ?? [];
    if ("observacoes" in body) update.observacoes = body.observacoes?.trim() ?? null;

    // When turma changes, update both the old and new turma's tem_aluno_especial
    if ("turma_id" in body) {
      const oldTurmaId = typeof snap.data()?.turma_id === "string" ? (snap.data()?.turma_id as string) : null;
      const newTurmaId = body.turma_id ?? null;
      update.turma_id = newTurmaId;
      if ("turma_nome" in body) update.turma_nome = body.turma_nome?.trim() ?? null;

      if (newTurmaId && newTurmaId !== oldTurmaId) {
        const newTurmaSnap = await db.collection("magis_turmas").doc(newTurmaId).get();
        if (newTurmaSnap.exists && newTurmaSnap.data()?.user_id === user.uid) {
          await db.collection("magis_turmas").doc(newTurmaId).update({ tem_aluno_especial: true });
        }
      }
    }

    await db.collection("magis_estudantes").doc(id).update(update);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Falha ao atualizar estudante." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireCurrentUserProfile();
    const { id } = await params;
    const db = getAdminDb();
    const snap = await db.collection("magis_estudantes").doc(id).get();
    if (!snap.exists || snap.data()?.user_id !== user.uid) {
      return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
    }
    await db.collection("magis_estudantes").doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Falha ao excluir estudante." }, { status: 500 });
  }
}
