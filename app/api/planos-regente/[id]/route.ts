import "server-only";

import { NextResponse } from "next/server";
import { getAdminDb } from "../../../../lib/firebase/admin";
import { requireCurrentUserProfile } from "../../../../lib/auth/session";
import type { FieldValue } from "firebase-admin/firestore";

// PATCH — marca o plano como usado por um PEI
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireCurrentUserProfile();
    const { id } = await params;
    const db = getAdminDb();

    const snap = await db.collection("magis_planos_regente").doc(id).get();
    if (!snap.exists || snap.data()?.user_id !== user.uid) {
      return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
    }

    const body = (await request.json()) as { plano_pei_id?: string };
    if (body.plano_pei_id) {
      const { FieldValue: FV } = await import("firebase-admin/firestore");
      await db.collection("magis_planos_regente").doc(id).update({
        usado_por_pei: (FV as unknown as { arrayUnion: (...args: string[]) => FieldValue }).arrayUnion(body.plano_pei_id),
      });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Falha ao atualizar." }, { status: 500 });
  }
}

// DELETE — remove o plano regente da biblioteca
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireCurrentUserProfile();
    const { id } = await params;
    const db = getAdminDb();

    const snap = await db.collection("magis_planos_regente").doc(id).get();
    if (!snap.exists || snap.data()?.user_id !== user.uid) {
      return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
    }

    await db.collection("magis_planos_regente").doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Falha ao excluir." }, { status: 500 });
  }
}
