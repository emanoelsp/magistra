import "server-only";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../../lib/firebase/admin";
import { requireCurrentUserProfile } from "../../../lib/auth/session";
import type { NivelSuporte } from "../../../lib/types/firestore";

export async function GET(request: Request) {
  try {
    const user = await requireCurrentUserProfile();
    const { searchParams } = new URL(request.url);
    const turmaId = searchParams.get("turma_id");

    const db = getAdminDb();
    let query = db.collection("magis_estudantes").where("user_id", "==", user.uid);
    if (turmaId) {
      query = query.where("turma_id", "==", turmaId);
    }

    const snap = await query.get();
    const estudantes = snap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => (a as { nome?: string }).nome?.localeCompare((b as { nome?: string }).nome ?? "", "pt-BR") ?? 0);
    return NextResponse.json({ estudantes });
  } catch {
    return NextResponse.json({ error: "Falha ao listar estudantes." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUserProfile();
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

    const nome = body.nome?.trim() ?? "";
    if (!nome) {
      return NextResponse.json({ error: "nome é obrigatório." }, { status: 400 });
    }

    const NIVEL_SUPORTE_VALID: NivelSuporte[] = ["baixo", "medio", "alto"];
    if (body.nivel_suporte && !NIVEL_SUPORTE_VALID.includes(body.nivel_suporte)) {
      return NextResponse.json({ error: "nivel_suporte inválido." }, { status: 400 });
    }

    const db = getAdminDb();
    const ref = db.collection("magis_estudantes").doc();
    const criado_em = new Date().toISOString();

    const data: Record<string, unknown> = { user_id: user.uid, nome, criado_em };
    if (body.data_nascimento) data.data_nascimento = body.data_nascimento;
    if (body.escola_id) data.escola_id = body.escola_id;
    if (body.escola_nome) data.escola_nome = body.escola_nome.trim();
    if (body.turma_id) data.turma_id = body.turma_id;
    if (body.turma_nome) data.turma_nome = body.turma_nome.trim();
    if (body.cid) data.cid = body.cid.trim();
    if (body.diagnostico) data.diagnostico = body.diagnostico.trim();
    if (body.necessidades) data.necessidades = body.necessidades.trim();
    if (body.nivel_suporte) data.nivel_suporte = body.nivel_suporte;
    if (Array.isArray(body.habilidades_preditoras)) data.habilidades_preditoras = body.habilidades_preditoras;
    if (body.observacoes) data.observacoes = body.observacoes.trim();

    await ref.set(data);

    // Auto-set tem_aluno_especial on the linked turma
    if (body.turma_id) {
      const turmaRef = db.collection("magis_turmas").doc(body.turma_id);
      const turmaSnap = await turmaRef.get();
      if (turmaSnap.exists && turmaSnap.data()?.user_id === user.uid) {
        await turmaRef.update({ tem_aluno_especial: true });
      }
    }

    return NextResponse.json({ ok: true, id: ref.id, ...data });
  } catch {
    return NextResponse.json({ error: "Falha ao criar estudante." }, { status: 500 });
  }
}
