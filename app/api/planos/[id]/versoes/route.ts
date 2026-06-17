import "server-only";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../../../../../lib/firebase/admin";
import { requireCurrentUserProfile } from "../../../../../lib/auth/session";

const MAX_VERSIONS = 5;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireCurrentUserProfile();
    const { id: planoId } = await params;

    const db = getAdminDb();

    // Verify ownership
    const planoSnap = await db.collection("magins_planos_aula").doc(planoId).get();
    if (!planoSnap.exists || planoSnap.data()?.user_id !== user.uid) {
      return NextResponse.json({ ok: true }); // silently ignore — don't leak info
    }

    const body = (await request.json()) as { conteudo_gerado?: Record<string, unknown> };
    const conteudo = body.conteudo_gerado ?? {};

    const versoesRef = db.collection("magins_planos_aula").doc(planoId).collection("versoes");

    // Save new version
    await versoesRef.add({
      conteudo_gerado: conteudo,
      saved_at: FieldValue.serverTimestamp(),
      saved_by: user.uid,
    });

    // Keep only the last MAX_VERSIONS — delete older ones
    const all = await versoesRef.orderBy("saved_at", "asc").get();
    if (all.size > MAX_VERSIONS) {
      const toDelete = all.docs.slice(0, all.size - MAX_VERSIONS);
      await Promise.all(toDelete.map((d) => d.ref.delete()));
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/planos/versoes]", err);
    return NextResponse.json({ ok: true }); // never block the client
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireCurrentUserProfile();
    const { id: planoId } = await params;

    const db = getAdminDb();
    const planoSnap = await db.collection("magins_planos_aula").doc(planoId).get();
    if (!planoSnap.exists || planoSnap.data()?.user_id !== user.uid) {
      return NextResponse.json({ versoes: [] });
    }

    const snap = await db
      .collection("magins_planos_aula")
      .doc(planoId)
      .collection("versoes")
      .orderBy("saved_at", "desc")
      .limit(MAX_VERSIONS)
      .get();

    const versoes = snap.docs.map((d) => ({
      id: d.id,
      saved_at: (d.data().saved_at as { toDate?: () => Date })?.toDate?.()?.toISOString() ?? new Date().toISOString(),
    }));

    return NextResponse.json({ versoes });
  } catch {
    return NextResponse.json({ versoes: [] });
  }
}
