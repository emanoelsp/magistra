import { getAdminDb } from "../../lib/firebase/admin";
import { DollarSign, FileText, Sparkles, Users, TrendingUp, Server } from "lucide-react";

interface Stats {
  totalUsers: number;
  planosThisMonth: number;
  totalPlanos: number;
  tokensTotal: number;
  costAiUsdMonth: number;
  fixedCostsMonth: number;
  totalCostMonth: number;
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
    db.collection("magis_planos").get(),
    db.collection("magis_usage_logs").where("timestamp", ">=", startOfMonth).get(),
    db.collection("magis_admin_config").doc("singleton").get(),
  ]);

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

  const fixedCostsMonth =
    config.vercel_monthly_usd + config.firebase_monthly_usd + config.other_monthly_usd;

  return {
    totalUsers: usersSnap.size,
    planosThisMonth,
    totalPlanos: planosSnap.size,
    tokensTotal,
    costAiUsdMonth,
    fixedCostsMonth,
    totalCostMonth: costAiUsdMonth + fixedCostsMonth,
    actionCounts,
    config,
  };
}

function usd(v: number) {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 4 });
}

function num(v: number) {
  return v.toLocaleString("pt-BR");
}

export default async function AdminPage() {
  const stats = await getStats();
  const mes = new Date().toLocaleString("pt-BR", { month: "long", year: "numeric" });

  const cards = [
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
      color: "text-emerald-600",
      bg: "bg-emerald-50",
    },
    {
      label: "Tokens IA este mês",
      value: num(stats.tokensTotal),
      icon: Sparkles,
      color: "text-amber-600",
      bg: "bg-amber-50",
    },
    {
      label: "Custo IA este mês",
      value: usd(stats.costAiUsdMonth),
      icon: TrendingUp,
      color: "text-rose-600",
      bg: "bg-rose-50",
    },
    {
      label: "Custos fixos este mês",
      value: usd(stats.fixedCostsMonth),
      sub: "Vercel + Firebase + outros",
      icon: Server,
      color: "text-slate-600",
      bg: "bg-slate-100",
    },
    {
      label: "Custo total este mês",
      value: usd(stats.totalCostMonth),
      icon: DollarSign,
      color: "text-slate-950",
      bg: "bg-slate-200",
    },
  ];

  const actionLabels: Record<string, string> = {
    ia_campo: "Sugestão por campo",
    gerar_plano: "Geração de plano",
    introspect: "Introspecção de template",
  };

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-violet-600">Admin</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-950">Visão geral — {mes}</h1>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map(({ label, value, sub, icon: Icon, color, bg }) => (
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

      {/* Breakdown by action */}
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
                    <div
                      className="h-full rounded-full bg-violet-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Fixed costs detail */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-slate-950">Custos fixos mensais (configurados)</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: "Vercel (hosting)", value: stats.config.vercel_monthly_usd },
            { label: "Firebase (Firestore)", value: stats.config.firebase_monthly_usd },
            { label: "Outros", value: stats.config.other_monthly_usd },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{usd(value)}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Atualize os valores em{" "}
          <a href="/admin/config" className="underline hover:text-slate-700">
            Configuração
          </a>
          .
        </p>
      </div>

      {/* Gemini pricing reference */}
      <div className="rounded-2xl border border-violet-100 bg-violet-50 p-5">
        <p className="text-sm font-semibold text-violet-800">Tarifas Gemini configuradas</p>
        <p className="mt-1 text-xs text-violet-700">
          Input: <strong>{usd(stats.config.gemini_input_cost_per_1m)}/1M tokens</strong> ·{" "}
          Output: <strong>{usd(stats.config.gemini_output_cost_per_1m)}/1M tokens</strong>
        </p>
        <p className="mt-1 text-xs text-violet-600">
          Modelo padrão: {process.env.GOOGLE_GEMINI_MODEL ?? "gemini-2.0-flash"}. Atualize em Configuração se mudar de modelo.
        </p>
      </div>
    </div>
  );
}
