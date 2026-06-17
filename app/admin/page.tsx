export const dynamic = "force-dynamic";

import { getAdminDb } from "../../lib/firebase/admin";
import { PLAN_PRICES_BRL, PLAN_LABELS } from "../../lib/services/limits";
import { DollarSign, FileText, Sparkles, Users, TrendingUp, Server, TrendingDown, Activity } from "lucide-react";

const USD_BRL = 5.7; // taxa de câmbio aproximada — atualize em config se necessário

interface Stats {
  totalUsers: number;
  usuariosPorPlano: Record<string, number>;
  mrr: number;
  planosThisMonth: number;
  totalPlanos: number;
  tokensTotal: number;
  costAiUsdMonth: number;
  fixedCostsUsdMonth: number;
  totalCostUsdMonth: number;
  totalCostBrlMonth: number;
  resultadoBrl: number;
  actionCounts: Record<string, number>;
  config: {
    vercel_monthly_usd: number;
    firebase_monthly_usd: number;
    other_monthly_usd: number;
    gemini_input_cost_per_1m: number;
    gemini_output_cost_per_1m: number;
  };
}

async function getStats(): Promise<Stats> {
  const db = getAdminDb();
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [usersSnap, planosSnap, logsSnap, configSnap] = await Promise.all([
    db.collection("magis_users").get(),
    db.collection("magins_planos_aula").get(),
    db.collection("magis_usage_logs").where("timestamp", ">=", startOfMonth).get(),
    db.collection("magis_admin_config").doc("singleton").get(),
  ]);

  // seed config com zeros se não existir
  if (!configSnap.exists) {
    await db.collection("magis_admin_config").doc("singleton").set({
      vercel_monthly_usd: 0,
      firebase_monthly_usd: 0,
      other_monthly_usd: 0,
      gemini_input_cost_per_1m: 0.075,
      gemini_output_cost_per_1m: 0.30,
      updated_at: new Date().toISOString(),
    });
  }

  const config = (configSnap.data() ?? {
    vercel_monthly_usd: 0,
    firebase_monthly_usd: 0,
    other_monthly_usd: 0,
    gemini_input_cost_per_1m: 0.075,
    gemini_output_cost_per_1m: 0.30,
  }) as Stats["config"];

  const planosThisMonth = planosSnap.docs.filter(
    (d) => (d.data().data_geracao as string) >= startOfMonth,
  ).length;

  // MRR por plano
  const usuariosPorPlano: Record<string, number> = {};
  let mrr = 0;
  for (const doc of usersSnap.docs) {
    const plano = ((doc.data().plano as string) ?? "free").toLowerCase();
    usuariosPorPlano[plano] = (usuariosPorPlano[plano] ?? 0) + 1;
    mrr += PLAN_PRICES_BRL[plano] ?? 0;
  }

  let tokensTotal = 0;
  let costAiUsdMonth = 0;
  const actionCounts: Record<string, number> = {};
  for (const doc of logsSnap.docs) {
    const log = doc.data();
    tokensTotal += (log.tokens_total as number) ?? 0;
    costAiUsdMonth += (log.cost_usd as number) ?? 0;
    const action = log.action as string;
    actionCounts[action] = (actionCounts[action] ?? 0) + 1;
  }

  const fixedCostsUsdMonth =
    config.vercel_monthly_usd + config.firebase_monthly_usd + config.other_monthly_usd;
  const totalCostUsdMonth = costAiUsdMonth + fixedCostsUsdMonth;
  const totalCostBrlMonth = totalCostUsdMonth * USD_BRL;
  const resultadoBrl = mrr - totalCostBrlMonth;

  return {
    totalUsers: usersSnap.size,
    usuariosPorPlano,
    mrr,
    planosThisMonth,
    totalPlanos: planosSnap.size,
    tokensTotal,
    costAiUsdMonth,
    fixedCostsUsdMonth,
    totalCostUsdMonth,
    totalCostBrlMonth,
    resultadoBrl,
    actionCounts,
    config,
  };
}

function brl(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function usd(v: number) {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}
function num(v: number) {
  return v.toLocaleString("pt-BR");
}

export default async function AdminPage() {
  const stats = await getStats();
  const mes = new Date().toLocaleString("pt-BR", { month: "long", year: "numeric" });

  const topCards = [
    {
      label: "MRR (receita mensal)",
      value: brl(stats.mrr),
      sub: `${num(stats.totalUsers)} usuários`,
      icon: DollarSign,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
    },
    {
      label: "Custo total este mês",
      value: brl(stats.totalCostBrlMonth),
      sub: `${usd(stats.totalCostUsdMonth)} · câmbio ~R$${USD_BRL}`,
      icon: TrendingDown,
      color: "text-rose-600",
      bg: "bg-rose-50",
    },
    {
      label: "Resultado mensal",
      value: brl(stats.resultadoBrl),
      sub: stats.resultadoBrl >= 0 ? "Positivo" : "Negativo",
      icon: Activity,
      color: stats.resultadoBrl >= 0 ? "text-emerald-700" : "text-rose-700",
      bg: stats.resultadoBrl >= 0 ? "bg-emerald-100" : "bg-rose-100",
    },
    {
      label: "Usuários cadastrados",
      value: num(stats.totalUsers),
      icon: Users,
      color: "text-violet-600",
      bg: "bg-violet-50",
    },
    {
      label: "Planos gerados este mês",
      value: num(stats.planosThisMonth),
      sub: `${num(stats.totalPlanos)} no total`,
      icon: FileText,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      label: "Tokens IA este mês",
      value: num(stats.tokensTotal),
      sub: `Custo IA: ${usd(stats.costAiUsdMonth)}`,
      icon: Sparkles,
      color: "text-amber-600",
      bg: "bg-amber-50",
    },
  ];

  const actionLabels: Record<string, string> = {
    ia_campo: "Sugestão por campo",
    gerar_plano: "Geração de plano",
    introspect: "Introspecção de template",
  };

  // ordenar planos para exibição
  const planoOrder = ["pro", "avancado", "premium", "medio", "starter", "escola", "free"];
  const planosComUsuarios = planoOrder
    .filter((p) => stats.usuariosPorPlano[p] > 0)
    .concat(Object.keys(stats.usuariosPorPlano).filter((p) => !planoOrder.includes(p)));

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-violet-600">Admin</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-950">Visão geral — {mes}</h1>
      </div>

      {/* Top stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {topCards.map(({ label, value, sub, icon: Icon, color, bg }) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-500">{label}</p>
                <p className={`mt-1.5 text-2xl font-bold ${color}`}>{value}</p>
                {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
              </div>
              <span className={`rounded-xl p-2.5 ${bg}`}>
                <Icon className={`h-5 w-5 ${color}`} />
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* MRR por plano */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-1 text-base font-semibold text-slate-950">MRR por plano</h2>
        <p className="mb-4 text-xs text-slate-500">Receita mensal recorrente estimada com base nos planos ativos.</p>
        {planosComUsuarios.length === 0 ? (
          <p className="text-sm text-slate-400">Nenhum usuário ainda.</p>
        ) : (
          <div className="space-y-3">
            {planosComUsuarios.map((plano) => {
              const count = stats.usuariosPorPlano[plano] ?? 0;
              const preco = PLAN_PRICES_BRL[plano] ?? 0;
              const receita = count * preco;
              const pct = stats.mrr > 0 ? (receita / stats.mrr) * 100 : 0;
              return (
                <div key={plano}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="font-medium text-slate-700">
                      {PLAN_LABELS[plano] ?? plano}{" "}
                      <span className="font-normal text-slate-400">({count} usuário{count !== 1 ? "s" : ""})</span>
                    </span>
                    <span className="font-semibold text-slate-950">{brl(receita)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Resultado financeiro */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-slate-950">Resultado financeiro do mês</h2>
        <div className="space-y-2">
          {[
            { label: "Receita (MRR)",       value: brl(stats.mrr),              color: "text-emerald-600" },
            { label: "Custo IA",            value: `− ${brl(stats.costAiUsdMonth * USD_BRL)}`, color: "text-rose-500" },
            { label: "Custos fixos (hosting)", value: `− ${brl(stats.fixedCostsUsdMonth * USD_BRL)}`, color: "text-rose-500" },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <span className="text-sm text-slate-700">{label}</span>
              <span className={`font-semibold ${color}`}>{value}</span>
            </div>
          ))}
          <div className="flex items-center justify-between rounded-xl border-2 border-slate-950 bg-slate-950 px-4 py-3">
            <span className="text-sm font-bold text-white">Resultado líquido</span>
            <span className={`text-lg font-bold ${stats.resultadoBrl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {brl(stats.resultadoBrl)}
            </span>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Taxa de câmbio utilizada: 1 USD = R$ {USD_BRL}. Atualize a constante em <code>app/admin/page.tsx</code> se necessário.
        </p>
      </div>

      {/* Chamadas IA */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-slate-950">Chamadas IA este mês por tipo</h2>
        {Object.keys(stats.actionCounts).length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma chamada registrada ainda.</p>
        ) : (
          <div className="space-y-3">
            {Object.entries(stats.actionCounts).map(([action, count]) => {
              const total = Object.values(stats.actionCounts).reduce((a, b) => a + b, 0);
              const pct = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <div key={action}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="font-medium text-slate-700">{actionLabels[action] ?? action}</span>
                    <span className="text-slate-500">{num(count)} chamadas ({pct}%)</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-violet-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Custos fixos */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-slate-950">Custos fixos mensais</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: "Vercel (hosting)", value: stats.config.vercel_monthly_usd },
            { label: "Firebase", value: stats.config.firebase_monthly_usd },
            { label: "Outros", value: stats.config.other_monthly_usd },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{usd(value)}</p>
            </div>
          ))}
        </div>
        <a href="/admin/config" className="mt-3 inline-block text-xs text-violet-600 underline hover:text-violet-800">
          Editar custos fixos →
        </a>
      </div>
    </div>
  );
}
