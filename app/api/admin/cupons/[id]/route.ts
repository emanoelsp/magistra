import "server-only";

import { NextResponse } from "next/server";

import { getAdminDb } from "../../../../../lib/firebase/admin";
import { getCurrentSession, getCurrentUserProfile } from "../../../../../lib/auth/session";

async function requireAdmin() {
  const [session, profile] = await Promise.all([getCurrentSession(), getCurrentUserProfile()]);
  if (!session || profile?.role !== "admin") return null;
  return session;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Não autorizado." }, { status: 403 });

  const { id } = await params;
  const body = (await request.json()) as { active?: boolean };

  if (typeof body.active !== "boolean") {
    return NextResponse.json({ error: "Campo 'active' obrigatório." }, { status: 400 });
  }

  const db = getAdminDb();
  await db.collection("magis_cupons").doc(id).update({ active: body.active });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Não autorizado." }, { status: 403 });

  const { id } = await params;
  const db = getAdminDb();
  await db.collection("magis_cupons").doc(id).delete();
  return NextResponse.json({ ok: true });
}
