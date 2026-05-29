import { getAdminDb } from "../../../lib/firebase/admin";

interface LogEntry {
  id: string;
  user_id: string;
  action: string;
  model: string;
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;
  cost_usd: number;
  timestamp: string;
}

interface DayBucket { cost: number; tokens: number; calls: number }

async function getCosts() {
  const db = getAdminDb();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [logsSnap, configSnap, usersSnap] = await Promise.all([
    db.collection("magis_usage_logs").where("timestamp", ">=", since).orderBy("timestamp", "desc").get(),
    db.collection("magis_admin_config").doc("singleton").get(),
    db.collection("magis_users").get(),
  ]);

  const config = (configSnap.data() ?? {
    vercel_monthly_usd: 0,
    firebase_monthly_usd: 0,
    other_monthly_usd: 0,
    gemini_input_cost_per_1m: 0.075,
    gemini_output_cost_per_1m: 0.30,
  }) as Record<string, number>;

  const emailByUid: Record<string, string> = {};
  for (const d of usersSnap.docs) {
    emailByUid[d.id] = (d.data().email as string) ?? d.id.slice(0, 8);
  }

  const logs: LogEntry[] = logsSnap.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      user_id: d.user_id as string,
      action: d.action as string,
      model: d.model as string,
      tokens_input: (d.tokens_input as number) ?? 0,
      tokens_output: (d.tokens_output as number) ?? 0,
      tokens_total: (d.tokens_total as number) ?? 0,
      cost_usd: (d.cost_usd as number) ?? 0,
      timestamp: d.timestamp as string,
    };
  });

  const byDay: Record<string, DayBucket> = {};
  const byAction: Record<string, DayBucket> = {};
  let totalCostAi = 0;

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

    totalCostAi += log.cost_usd;
  }

  const fixedCosts = config.vercel_monthly_usd + config.firebase_monthly_usd + config.other_monthly_usd;

  return { logs: logs.slice(0, 100), byDay, byAction, totalCostAi, fixedCosts, config, emailByUid };
}

function usd(v: number) {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 4 });
}
function num(v: number) { return v.toLocaleString("pt-BR"); }

const ACTION_LABELS: Record<string, string> = {
  ia_campo: "Sugestão por campo",
  gerar_plano: "Geração de plano",
  introspect: "Introspecção de template",
};

export default async function CustosPage() {
  const { logs, byDay, byAction, totalCostAi, fixedCosts, config, emailByUid } = await getCosts();

  const sortedDays = Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0]));
  const maxDayCost = Math.max(...sortedDays.map(([, v]) => v.cost), 0.0001);

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-violet-600">Admin</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-950">Custos & IA — últimos 30 dias</h1>
      </div>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Custo IA (30 dias)", value: usd(totalCostAi), sub: `${num(logs.length)} chamadas`, color: "text-rose-600" },
          { label: "Custos fixos/mês", value: usd(fixedCosts), sub: "Vercel + Firebase + outros", color: "text-slate-700" },
          { label: "Total estimado/mês", value: usd(totalCostAi + fixedCosts), sub: "IA + hospedagem", color: "text-slate-950" },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium text-slate-500">{label}</p>
            <p className={`mt-1.5 text-2xl font-bold ${color}`}>{value}</p>
            <p className="mt-0.5 text-xs text-slate-400">{sub}</p>
          </div>
        ))}
      </div>

      {/* By action */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-slate-950">Custo por tipo de chamada</h2>
        <div className="space-y-3">
          {Object.entries(byAction).map(([action, bucket]) => (
            <div key={action} className="flex items-center gap-4">
              <div className="w-48 shrink-0">
                <p className="text-sm font-medium text-slate-800">{ACTION_LABELS[action] ?? action}</p>
                <p className="text-xs text-slate-500">{num(bucket.calls)} chamadas · {num(bucket.tokens)} tokens</p>
              </div>
              <div className="flex-1">
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-violet-500"
                    style={{ width: `${totalCostAi > 0 ? (bucket.cost / totalCostAi) * 100 : 0}%` }}
                  />
                </div>
              </div>
              <p className="w-24 text-right text-sm font-semibold text-rose-600">{usd(bucket.cost)}</p>
            </div>
          ))}
          {Object.keys(byAction).length === 0 && (
            <p className="text-sm text-slate-400">Nenhuma chamada registrada ainda.</p>
          )}
        </div>
      </div>

      {/* Daily chart */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-slate-950">Custo diário (últimos 30 dias)</h2>
        <div className="flex items-end gap-1 overflow-x-auto pb-2" style={{ minHeight: 100 }}>
          {sortedDays.length === 0 ? (
            <p className="text-sm text-slate-400">Sem dados.</p>
          ) : (
            sortedDays.map(([day, bucket]) => {
              const pct = (bucket.cost / maxDayCost) * 100;
              return (
                <div key={day} className="group flex flex-col items-center gap-1" style={{ minWidth: 28 }}>
                  <div
                    className="w-6 rounded-t bg-violet-400 transition-all group-hover:bg-violet-600"
                    style={{ height: `${Math.max(pct, 4)}px` }}
                    title={`${day}: ${usd(bucket.cost)} (${num(bucket.calls)} chamadas)`}
                  />
                  <span className="text-[9px] text-slate-400 rotate-45 origin-left">{day.slice(5)}</span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Fixed costs detail */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-slate-950">Detalhamento de custos fixos</h2>
        <div className="space-y-2">
          {[
            { label: "Vercel (hosting + Blob storage)", value: config.vercel_monthly_usd as number },
            { label: "Firebase (Firestore + Auth)", value: config.firebase_monthly_usd as number },
            { label: "Outros (domínio, e-mail, etc.)", value: config.other_monthly_usd as number },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <span className="text-sm text-slate-700">{label}</span>
              <span className="font-semibold text-slate-900">{usd(value)}</span>
            </div>
          ))}
        </div>
        <a href="/admin/config" className="mt-3 inline-block text-xs text-violet-600 underline hover:text-violet-800">
          Editar custos fixos →
        </a>
      </div>

      {/* Recent log */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-950">Log de chamadas recentes</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                {["Horário", "Usuário", "Ação", "Tokens in", "Tokens out", "Custo"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left font-semibold uppercase tracking-wider text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Nenhum log ainda.</td></tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 text-slate-500">{log.timestamp.slice(0, 16).replace("T", " ")}</td>
                    <td className="px-4 py-2 text-slate-700">{emailByUid[log.user_id] ?? log.user_id.slice(0, 8)}</td>
                    <td className="px-4 py-2">
                      <span className="rounded-full bg-violet-100 px-2 py-0.5 font-medium text-violet-700">
                        {ACTION_LABELS[log.action] ?? log.action}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-slate-600">{num(log.tokens_input)}</td>
                    <td className="px-4 py-2 text-slate-600">{num(log.tokens_output)}</td>
                    <td className="px-4 py-2 font-semibold text-rose-600">{usd(log.cost_usd)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
