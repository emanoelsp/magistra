import "server-only";

import { NextResponse } from "next/server";
import { getAdminDb } from "../../../../lib/firebase/admin";
import { getCurrentSession as getSession } from "../../../../lib/auth/session";

function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase());
  return admins.includes(email.toLowerCase());
}

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!isAdmin(session?.email)) {
      return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const days = Math.min(parseInt(searchParams.get("days") ?? "30"), 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const db = getAdminDb();
    const logsSnap = await db.collection("usage_logs").where("timestamp", ">=", since).orderBy("timestamp", "desc").get();

    const logs = logsSnap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        user_id: d.user_id as string,
        action: d.action as string,
        model: d.model as string,
        tokens_input: d.tokens_input as number,
        tokens_output: d.tokens_output as number,
        tokens_total: d.tokens_total as number,
        cost_usd: d.cost_usd as number,
        timestamp: d.timestamp as string,
        metadata: d.metadata as Record<string, string>,
      };
    });

    // Daily breakdown
    const byDay: Record<string, { cost: number; tokens: number; calls: number }> = {};
    const byAction: Record<string, { cost: number; tokens: number; calls: number }> = {};

    for (const log of logs) {
      const day = log.timestamp.slice(0, 10);
      byDay[day] ??= { cost: 0, tokens: 0, calls: 0 };
      byDay[day].cost += log.cost_usd;
      byDay[day].tokens += log.tokens_total;
      byDay[day].calls += 1;

      byAction[log.action] ??= { cost: 0, tokens: 0, calls: 0 };
      byAction[log.action].cost += log.cost_usd;
      byAction[log.action].tokens += log.tokens_total;
      byAction[log.action].calls += 1;
    }

    return NextResponse.json({ logs: logs.slice(0, 200), byDay, byAction });
  } catch (error) {
    console.error("[admin/costs]", error);
    return NextResponse.json({ error: "Falha ao buscar custos." }, { status: 500 });
  }
}
