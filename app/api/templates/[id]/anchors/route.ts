import "server-only";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../../../../lib/firebase/admin";
import { downloadFile } from "../../../../../lib/storage/blob";
import { scanDocxStructure } from "../../../../../lib/utils/docx-filler";
import { requireCurrentUserProfile } from "../../../../../lib/auth/session";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    let user: Awaited<ReturnType<typeof requireCurrentUserProfile>>;
    try { user = await requireCurrentUserProfile(); }
    catch { return NextResponse.json({ error: "Não autenticado." }, { status: 401 }); }

    const { id } = await params;
    const db = getAdminDb();
    const snap = await db.collection("magis_templates").doc(id).get();
    if (!snap.exists) return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
    const data = snap.data()!;
    if (data.user_id !== user.uid) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

    const arquivoUrl = typeof data.arquivo_url === "string" ? data.arquivo_url : "";
    const isDocx = /\.(docx|doc)$/i.test(arquivoUrl.split("?")[0]);
    if (!isDocx || !arquivoUrl) {
      return NextResponse.json({ anchors: [] });
    }

    const buffer = await downloadFile(arquivoUrl);
    const pairs = scanDocxStructure(buffer);
    // Retorna labels únicas não vazias, ordenadas
    const seen = new Set<string>();
    const anchors: { label: string; valuePreview: string; pattern: string }[] = [];
    for (const p of pairs) {
      const lbl = p.label.trim();
      if (!lbl || seen.has(lbl)) continue;
      seen.add(lbl);
      anchors.push({ label: lbl, valuePreview: p.valuePreview, pattern: p.pattern });
    }
    return NextResponse.json({ anchors });
  } catch (err) {
    console.error("[anchors] Erro:", err);
    return NextResponse.json({ error: "Falha ao ler âncoras." }, { status: 500 });
  }
}
