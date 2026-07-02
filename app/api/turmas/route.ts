import "server-only";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../../lib/firebase/admin";
import { requireCurrentUserProfile } from "../../../lib/auth/session";

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUserProfile();
    const body = (await request.json()) as {
      escola_id?: string;
      escola_nome?: string;
      nome?: string;
      ano_letivo?: number;
      tipo_professor?: string;
      disciplina?: string;
      tipo_curso?: string;
      curso_nome?: string;
      grupo_id?: string;
      tem_aluno_especial?: boolean;
    };

    const escola_id = body.escola_id?.trim() ?? "";
    const escola_nome = body.escola_nome?.trim() ?? "";
    const nome = body.nome?.trim() ?? "";
    const ano_letivo =
      typeof body.ano_letivo === "number" ? body.ano_letivo : new Date().getFullYear();
    const tipo_professor =
      body.tipo_professor === "segundo_professor" || body.tipo_professor === "professor_area"
        ? body.tipo_professor
        : undefined;
    const disciplina =
      tipo_professor === "segundo_professor" ? undefined : body.disciplina?.trim() || undefined;

    if (!escola_id || !nome) {
      return NextResponse.json(
        { error: "escola_id e nome são obrigatórios." },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const escolaSnap = await db.collection("magis_escolas").doc(escola_id).get();
    if (!escolaSnap.exists || escolaSnap.data()?.user_id !== user.uid) {
      return NextResponse.json({ error: "Escola não encontrada." }, { status: 404 });
    }

    const ref = db.collection("magis_turmas").doc();
    const criado_em = new Date().toISOString();
    const data: Record<string, unknown> = {
      user_id: user.uid,
      escola_id,
      escola_nome: escola_nome || (escolaSnap.data()?.nome as string ?? ""),
      nome,
      ano_letivo,
      criado_em,
    };
    if (tipo_professor) data.tipo_professor = tipo_professor;
    if (disciplina) data.disciplina = disciplina;
    if (body.tipo_curso) data.tipo_curso = body.tipo_curso;
    if (body.curso_nome) data.curso_nome = body.curso_nome;
    if (body.grupo_id) data.grupo_id = body.grupo_id;
    if (body.tem_aluno_especial) data.tem_aluno_especial = true;
    await ref.set(data);

    if (tipo_professor === "segundo_professor") {
      await db.collection("magis_users").doc(user.uid).update({ is_segundo_professor: true });
    }

    return NextResponse.json({ ok: true, id: ref.id, ...data });
  } catch {
    return NextResponse.json({ error: "Falha ao criar turma." }, { status: 500 });
  }
}
