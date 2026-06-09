import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentSession } from "../../../../lib/auth/session";
import { getAdminAuth } from "../../../../lib/firebase/admin";

const bodySchema = z.object({
  password: z.string().min(6, "A senha deve ter no mínimo 6 caracteres").max(128),
  confirm: z.string(),
}).refine((d) => d.password === d.confirm, {
  message: "As senhas não coincidem",
  path: ["confirm"],
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
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 },
    );
  }

  await getAdminAuth().updateUser(session.uid, { password: parsed.data.password });

  return NextResponse.json({ ok: true });
}
