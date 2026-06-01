import "server-only";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../../../lib/firebase/admin";
import { getCurrentSession } from "../../../../lib/auth/session";
import { PLAN_PRICES_BRL } from "../../../../lib/services/limits";

const USD_BRL = 5.7;

function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase());
  return admins.includes(email.toLowerCase());
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session || !isAdmin(session.email)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }

  const body = (await request.json()) as { tipo: "mensal" | "anual"; notas?: string };
  const { tipo, notas } = body;

  const db = getAdminDb();
  const now = new Date();

  const periodo = tipo === "mensal"
    ? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
    : String(now.getFullYear());

  // Verifica se já fechado
  const existSnap = await db.collection("magis_balancetes")
    .where("tipo", "==", tipo)
    .where("periodo", "==", periodo)
    .get();
  if (!existSnap.empty) {
    return NextResponse.json({ error: `Caixa ${tipo} de ${periodo} já foi fechado.` }, { status: 409 });
  }

  // Busca saldo anterior
  const prevSnap = await db.collection("magis_balancetes")
    .where("tipo", "==", tipo)
    .orderBy("periodo", "desc")
    .limit(2)
    .get();
  const saldo_anterior_brl = prevSnap.docs.length > 0
    ? ((prevSnap.docs[0].data().saldo_final_brl as number) ?? 0)
    : 0;

  // Coleta dados reais do mês/ano
  const startIso = tipo === "mensal"
    ? new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    : new Date(now.getFullYear(), 0, 1).toISOString();

  const [usersSnap, planosSnap, logsSnap, configSnap] = await Promise.all([
    db.collection("magis_users").get(),
    db.collection("magis_planos").where("data_geracao", ">=", startIso).get(),
    db.collection("magis_usage_logs").where("timestamp", ">=", startIso).get(),
    db.collection("magis_admin_config").doc("singleton").get(),
  ]);

  const config = (configSnap.data() ?? { vercel_monthly_usd: 0, firebase_monthly_usd: 0, other_monthly_usd: 0 }) as Record<string, number>;

  // MRR
  const usuarios_por_plano: Record<string, number> = {};
  let mrr_brl = 0;
  for (const doc of usersSnap.docs) {
    const plano = ((doc.data().plano as string) ?? "free").toLowerCase();
    usuarios_por_plano[plano] = (usuarios_por_plano[plano] ?? 0) + 1;
    mrr_brl += PLAN_PRICES_BRL[plano] ?? 0;
  }

  let custo_ia_usd = 0;
  let tokens_total = 0;
  for (const doc of logsSnap.docs) {
    custo_ia_usd += (doc.data().cost_usd as number) ?? 0;
    tokens_total += (doc.data().tokens_total as number) ?? 0;
  }

  const meses = tipo === "anual" ? 12 : 1;
  const custo_fixo_usd = (config.vercel_monthly_usd + config.firebase_monthly_usd + config.other_monthly_usd) * meses;
  const custo_total_usd = custo_ia_usd + custo_fixo_usd;
  const resultado_brl = mrr_brl - (custo_total_usd * USD_BRL);
  const saldo_final_brl = saldo_anterior_brl + resultado_brl;

  await db.collection("magis_balancetes").add({
    tipo,
    periodo,
    mrr_brl,
    custo_ia_usd,
    custo_fixo_usd,
    custo_total_usd,
    resultado_brl,
    saldo_anterior_brl,
    saldo_final_brl,
    fechado_em: now.toISOString(),
    fechado_por: session.email ?? "admin",
    notas: notas ?? "",
    usuarios_por_plano,
    total_usuarios: usersSnap.size,
    planos_gerados: planosSnap.size,
    tokens_total,
  });

  return NextResponse.json({ ok: true, periodo, resultado_brl, saldo_final_brl });
}
