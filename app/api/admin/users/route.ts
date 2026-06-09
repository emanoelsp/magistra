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
    if (!isAdmin(session?.email)) {
      return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
    }

    const db = getAdminDb();
    const [usersSnap, templatesSnap, planosSnap, logsSnap] = await Promise.all([
      db.collection("magis_users").orderBy("email").get(),
      db.collection("magis_templates").get(),
      db.collection("magis_planos").get(),
      db.collection("magis_usage_logs").get(),
    ]);

    // Build aggregates per user
    const templatesByUser: Record<string, number> = {};
    for (const doc of templatesSnap.docs) {
      const uid = doc.data().user_id as string;
      templatesByUser[uid] = (templatesByUser[uid] ?? 0) + 1;
    }

    const planosByUser: Record<string, number> = {};
    for (const doc of planosSnap.docs) {
      const uid = doc.data().user_id as string;
      planosByUser[uid] = (planosByUser[uid] ?? 0) + 1;
    }

    const costByUser: Record<string, number> = {};
    const tokensByUser: Record<string, number> = {};
    for (const doc of logsSnap.docs) {
      const log = doc.data();
      const uid = log.user_id as string;
      costByUser[uid] = (costByUser[uid] ?? 0) + ((log.cost_usd as number) ?? 0);
      tokensByUser[uid] = (tokensByUser[uid] ?? 0) + ((log.tokens_total as number) ?? 0);
    }

    const users = usersSnap.docs.map((doc) => {
      const data = doc.data();
      return {
        uid: doc.id,
        email: data.email as string,
        nome: data.nome as string,
        plano: data.plano as string,
        escola: data.escola_padrao as string | null,
        templates: templatesByUser[doc.id] ?? 0,
        planos: planosByUser[doc.id] ?? 0,
        tokens: tokensByUser[doc.id] ?? 0,
        costUsd: costByUser[doc.id] ?? 0,
      };
    });

    return NextResponse.json({ users });
  } catch (error) {
    console.error("[admin/users]", error);
    return NextResponse.json({ error: "Falha ao buscar usuários." }, { status: 500 });
  }
}
