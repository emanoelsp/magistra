import "server-only";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../../../../../lib/firebase/admin";
import { getCurrentSession } from "../../../../../../lib/auth/session";
import { PLAN_LIMITS } from "../../../../../../lib/services/limits";

function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase());
  return admins.includes(email.toLowerCase());
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ uid: string }> },
) {
  const session = await getCurrentSession();
  if (!session || !isAdmin(session.email)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }

  const { uid } = await params;
  const body = (await request.json()) as { plano?: string };
  const plano = body.plano?.trim().toLowerCase();

  if (!plano || !PLAN_LIMITS[plano]) {
    return NextResponse.json({ error: "Plano inválido." }, { status: 400 });
  }

  await getAdminDb().collection("magis_users").doc(uid).update({ plano });

  return NextResponse.json({ ok: true, plano });
}
