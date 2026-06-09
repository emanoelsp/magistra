import "server-only";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../../lib/firebase/admin";
import { getCurrentUserProfile } from "../../../lib/auth/session";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    tipo?: string;
    nome?: string;
    email?: string;
    assunto?: string;
    mensagem?: string;
  };

  const { tipo, nome, email, assunto, mensagem } = body;

  if (!tipo || !nome?.trim() || !email?.trim() || !assunto?.trim() || !mensagem?.trim()) {
    return NextResponse.json({ error: "Todos os campos são obrigatórios." }, { status: 400 });
  }

  if (!["contato", "suporte"].includes(tipo)) {
    return NextResponse.json({ error: "Tipo inválido." }, { status: 400 });
  }

  const user = await getCurrentUserProfile();

  const db = getAdminDb();
  await db.collection("magis_messages").add({
    tipo,
    user_id: user?.uid ?? null,
    nome: nome.trim(),
    email: email.trim().toLowerCase(),
    assunto: assunto.trim(),
    mensagem: mensagem.trim(),
    status: "aberto",
    created_at: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true });
}
