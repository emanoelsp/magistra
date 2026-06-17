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
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [usersSnap, planosSnap, logsSnap, configSnap] = await Promise.all([
      db.collection("magis_users").get(),
      db.collection("magins_planos_aula").get(),
      db.collection("magis_usage_logs").where("timestamp", ">=", startOfMonth).get(),
      db.collection("magis_admin_config").doc("singleton").get(),
    ]);

    const config = configSnap.data() ?? {
      vercel_monthly_usd: 0,
      firebase_monthly_usd: 0,
      other_monthly_usd: 0,
      gemini_input_cost_per_1m: 0.075,
      gemini_output_cost_per_1m: 0.30,
    };

    // Users
    const totalUsers = usersSnap.size;
    const newUsersThisMonth = usersSnap.docs.filter((d) => {
      const uid = d.id;
      return uid.length > 0; // placeholder — ideally filter by created_at
    }).length;

    // Plans
    const totalPlanos = planosSnap.size;
    const planosThisMonth = planosSnap.docs.filter((d) => {
      const data = d.data();
      return (data.data_geracao as string) >= startOfMonth;
    }).length;

    // Usage / costs
    let tokensInputMonth = 0;
    let tokensOutputMonth = 0;
    let costUsdMonth = 0;
    const actionCounts: Record<string, number> = {};

    for (const doc of logsSnap.docs) {
      const log = doc.data();
      tokensInputMonth += (log.tokens_input as number) ?? 0;
      tokensOutputMonth += (log.tokens_output as number) ?? 0;
      costUsdMonth += (log.cost_usd as number) ?? 0;
      const action = log.action as string;
      actionCounts[action] = (actionCounts[action] ?? 0) + 1;
    }

    const fixedCostsMonth =
      ((config.vercel_monthly_usd as number) ?? 0) +
      ((config.firebase_monthly_usd as number) ?? 0) +
      ((config.other_monthly_usd as number) ?? 0);

    const totalCostMonth = costUsdMonth + fixedCostsMonth;

    return NextResponse.json({
      totalUsers,
      newUsersThisMonth,
      totalPlanos,
      planosThisMonth,
      tokensInputMonth,
      tokensOutputMonth,
      tokensTotal: tokensInputMonth + tokensOutputMonth,
      costAiUsdMonth: costUsdMonth,
      fixedCostsMonth,
      totalCostMonth,
      actionCounts,
      config,
    });
  } catch (error) {
    console.error("[admin/stats]", error);
    return NextResponse.json({ error: "Falha ao buscar stats." }, { status: 500 });
  }
}
