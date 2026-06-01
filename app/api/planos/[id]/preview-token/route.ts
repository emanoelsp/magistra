import "server-only";

import { NextResponse } from "next/server";

import { getAdminDb } from "../../../../../lib/firebase/admin";
import { getCurrentSession } from "../../../../../lib/auth/session";
import { createPreviewToken } from "../../../../../lib/utils/preview-token";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const { id } = await params;
  const db = getAdminDb();
  const snap = await db.collection("magis_planos").doc(id).get();

  if (!snap.exists || snap.data()?.user_id !== session.uid) {
    return NextResponse.json({ error: "Plano não encontrado." }, { status: 404 });
  }

  const { token, exp } = createPreviewToken(`plan:${id}`);
  return NextResponse.json({ token, exp });
}
