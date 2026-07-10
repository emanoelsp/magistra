import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentSession } from "../../../../lib/auth/session";
import { getAdminDb } from "../../../../lib/firebase/admin";

const perfilPedagogicoSchema = z.object({
  disciplina:   z.string().max(120).optional(),
  turma:        z.string().max(60).optional(),
  nivel_ensino: z.string().max(60).optional(),
  uf:           z.string().max(2).optional(),
  municipio:    z.string().max(120).optional(),
  cargo:        z.string().max(120).optional(),
});

const bodySchema = z.object({
  nome:              z.string().min(1, "Nome obrigatório").max(120).optional(),
  escola_padrao:     z.string().max(200).optional(),
  perfil_pedagogico: perfilPedagogicoSchema.optional(),
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

  const updates: Record<string, unknown> = {};
  if (parsed.data.nome !== undefined) updates.nome = parsed.data.nome.trim();
  if (parsed.data.escola_padrao !== undefined) updates.escola_padrao = parsed.data.escola_padrao.trim();
  if (parsed.data.perfil_pedagogico !== undefined) {
    // Trim all string fields; omit blanks to keep Firestore doc clean
    const pp: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.data.perfil_pedagogico)) {
      if (typeof v === "string" && v.trim()) pp[k] = v.trim();
    }
    updates.perfil_pedagogico = pp;
  }

  if (Object.keys(updates).length > 0) {
    await getAdminDb().collection("magis_users").doc(session.uid).set(updates, { merge: true });
  }

  return NextResponse.json({ ok: true });
}
