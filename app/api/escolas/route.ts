import "server-only";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../../lib/firebase/admin";
import { requireCurrentUserProfile } from "../../../lib/auth/session";
import { getUserEscolas } from "../../../lib/services/firestore/escolas.server";

export async function GET() {
  try {
    const user = await requireCurrentUserProfile();
    const escolas = await getUserEscolas(user.uid);
    return NextResponse.json({ escolas });
  } catch {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUserProfile();
    const body = (await request.json()) as { nome?: string; cursos?: unknown };
    const nome = body.nome?.trim() ?? "";
    if (!nome) return NextResponse.json({ error: "Nome obrigatório." }, { status: 400 });

    const db = getAdminDb();
    const ref = db.collection("magis_escolas").doc();
    const criado_em = new Date().toISOString();
    const data: Record<string, unknown> = { user_id: user.uid, nome, criado_em };
    if (Array.isArray(body.cursos) && body.cursos.length > 0) data.cursos = body.cursos;
    await ref.set(data);
    return NextResponse.json({ ok: true, id: ref.id, nome, cursos: data.cursos ?? [], criado_em });
  } catch {
    return NextResponse.json({ error: "Falha ao criar escola." }, { status: 500 });
  }
}
