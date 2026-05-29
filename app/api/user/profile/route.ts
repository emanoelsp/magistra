import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentSession } from "../../../../lib/auth/session";
import { getAdminDb } from "../../../../lib/firebase/admin";

const bodySchema = z.object({
  nome: z.string().min(1, "Nome obrigatório").max(120).optional(),
  escola_padrao: z.string().max(200).optional(),
});

export async function POST(req: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  }

  const updates: Record<string, string> = {};
  if (parsed.data.nome !== undefined) updates.nome = parsed.data.nome.trim();
  if (parsed.data.escola_padrao !== undefined) {
    updates.escola_padrao = parsed.data.escola_padrao.trim();
  }

  if (Object.keys(updates).length > 0) {
    await getAdminDb().collection("magis_users").doc(session.uid).set(updates, { merge: true });
  }

  return NextResponse.json({ ok: true });
}
