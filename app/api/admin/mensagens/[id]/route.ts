import "server-only";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../../../../lib/firebase/admin";
import { getCurrentSession } from "../../../../../lib/auth/session";

function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase());
  return admins.includes(email.toLowerCase());
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentSession();
  if (!session || !isAdmin(session.email)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }

  const { id } = await params;
  const body = (await request.json()) as {
    status?: string;
    resposta?: string;
    collection?: string;
    atualizado_em?: string;
  };

  const col = body.collection === "magis_suporte" ? "magis_suporte" : "magis_messages";

  const update: Record<string, string> = {};
  if (body.status) update.status = body.status;
  if (body.resposta !== undefined) {
    update.resposta = body.resposta;
    update.respondido_em = new Date().toISOString();
  }
  if (body.atualizado_em) update.atualizado_em = body.atualizado_em;

  await getAdminDb().collection(col).doc(id).update(update);

  return NextResponse.json({ ok: true });
}
