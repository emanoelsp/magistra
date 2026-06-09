import "server-only";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../../lib/firebase/admin";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      nome?: string;
      email?: string;
      assunto?: string;
      mensagem?: string;
    };

    const { nome, email, assunto, mensagem } = body;
    if (!nome?.trim() || !email?.trim() || !assunto?.trim() || !mensagem?.trim()) {
      return NextResponse.json({ error: "Todos os campos são obrigatórios." }, { status: 400 });
    }

    const db = getAdminDb();
    await db.collection("magis_contato_site").add({
      nome: nome.trim(),
      email: email.trim().toLowerCase(),
      assunto: assunto.trim(),
      mensagem: mensagem.trim(),
      status: "aberto",
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/contato]", err);
    return NextResponse.json({ error: "Erro ao salvar mensagem." }, { status: 500 });
  }
}
