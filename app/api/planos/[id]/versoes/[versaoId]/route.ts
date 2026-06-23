import "server-only";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../../../../../lib/firebase/admin";
import { requireCurrentUserProfile } from "../../../../../../lib/auth/session";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; versaoId: string }> },
) {
  try {
    const user = await requireCurrentUserProfile();
    const { id: planoId, versaoId } = await params;

    const db = getAdminDb();
    const planoSnap = await db.collection("magins_planos_aula").doc(planoId).get();
    if (!planoSnap.exists || planoSnap.data()?.user_id !== user.uid) {
      return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
    }

    const versaoSnap = await db
      .collection("magins_planos_aula")
      .doc(planoId)
      .collection("versoes")
      .doc(versaoId)
      .get();

    if (!versaoSnap.exists) {
      return NextResponse.json({ error: "Versão não encontrada." }, { status: 404 });
    }

    const d = versaoSnap.data()!;
    const conteudo_gerado =
      typeof d.conteudo_gerado === "object" && d.conteudo_gerado !== null
        ? (d.conteudo_gerado as Record<string, unknown>)
        : {};

    return NextResponse.json({
      id: versaoSnap.id,
      saved_at: (d.saved_at as { toDate?: () => Date })?.toDate?.()?.toISOString() ?? new Date().toISOString(),
      conteudo_gerado,
    });
  } catch {
    return NextResponse.json({ error: "Erro ao buscar versão." }, { status: 500 });
  }
}
