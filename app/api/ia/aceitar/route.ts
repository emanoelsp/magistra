import "server-only";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../../../lib/firebase/admin";
import { requireCurrentUserProfile } from "../../../../lib/auth/session";

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUserProfile();
    const body = (await request.json()) as {
      templateId?: string;
      fieldKey?: string;
      sugestaoId?: string;
      tipo?: "titulo" | "completo";
    };

    const { templateId, fieldKey, sugestaoId, tipo } = body;
    if (!templateId || !fieldKey || !sugestaoId) {
      return NextResponse.json({ ok: true }); // silently ignore incomplete events
    }

    const db = getAdminDb();
    await db.collection("magis_usage_logs").add({
      user_id: user.uid,
      action: "sugestao_aceita",
      template_id: templateId,
      field_key: fieldKey,
      sugestao_id: sugestaoId,
      tipo: tipo ?? "completo",
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true }); // never fail the client on telemetry
  }
}
