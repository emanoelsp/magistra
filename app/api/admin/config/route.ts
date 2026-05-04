import "server-only";

import { NextResponse } from "next/server";
import { getAdminDb } from "../../../../lib/firebase/admin";
import { getCurrentSession as getSession } from "../../../../lib/auth/session";

function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase());
  return admins.includes(email.toLowerCase());
}

export async function GET() {
  try {
    const session = await getSession();
    if (!isAdmin(session?.email)) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

    const db = getAdminDb();
    const snap = await db.collection("admin_config").doc("singleton").get();
    const config = snap.data() ?? {
      vercel_monthly_usd: 0,
      firebase_monthly_usd: 0,
      other_monthly_usd: 0,
      gemini_input_cost_per_1m: 0.075,
      gemini_output_cost_per_1m: 0.30,
    };

    return NextResponse.json({ config });
  } catch (error) {
    console.error("[admin/config GET]", error);
    return NextResponse.json({ error: "Falha ao buscar configuração." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!isAdmin(session?.email)) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

    const body = await request.json() as Record<string, number>;
    const db = getAdminDb();

    await db.collection("admin_config").doc("singleton").set(
      { ...body, updated_at: new Date().toISOString() },
      { merge: true },
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[admin/config POST]", error);
    return NextResponse.json({ error: "Falha ao salvar configuração." }, { status: 500 });
  }
}
