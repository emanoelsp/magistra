import { AlertTriangle, CheckCircle2, Zap } from "lucide-react";
import { getAdminDb } from "../../../lib/firebase/admin";

// Free-tier daily limits
const GEMINI_DAILY_LIMIT = 1500;
const GROQ_DAILY_LIMIT = 1000;
const ALERT_THRESHOLD = 0.8; // warn at 80%

// OpenAI pricing per call (est. ~8k tokens @ gpt-4o-mini)
const OPENAI_COST_PER_CALL_USD = 0.0015;

interface ProviderDay {
  calls: number;
  actions: Record<string, number>;
}

interface UsageData {
  today: Record<string, ProviderDay>;
  last7days: { date: string; counts: Record<string, number> }[];
  totalCostOpenAI: number;
  openAICalls30d: number;
}

const ACTION_LABELS: Record<string, string> = {
  introspect: "Extração de template",
  ia_campo: "Sugestão por campo",
  gerar_plano: "Geração de plano",
};

async function getUsage(): Promise<UsageData> {
  const db = getAdminDb();

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayStart = `${todayStr}T00:00:00.000Z`;
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [todaySnap, last7dSnap, openai30dSnap] = await Promise.all([
    db.collection("magis_usage_logs").where("timestamp", ">=", todayStart).get(),
    db.collection("magis_usage_logs").where("timestamp", ">=", since7d).get(),
    db.collection("magis_usage_logs")
      .where("provider", "==", "openai")
      .where("timestamp", ">=", since30d)
      .get(),
  ]);

  // Today per-provider breakdown
  const today: Record<string, ProviderDay> = {};
  for (const doc of todaySnap.docs) {
    const d = doc.data();
    const provider = (d.provider as string) ?? "gemini"; // old logs default to gemini
    const action = (d.action as string) ?? "unknown";
    today[provider] ??= { calls: 0, actions: {} };
    today[provider].calls += 1;
    today[provider].actions[action] = (today[provider].actions[action] ?? 0) + 1;
  }

  // 7-day trend per provider
  const buckets: Record<string, Record<string, number>> = {};
  for (const doc of last7dSnap.docs) {
    const d = doc.data();
    const day = (d.timestamp as string).slice(0, 10);
    const provider = (d.provider as string) ?? "gemini";
    buckets[day] ??= {};
    buckets[day][provider] = (buckets[day][provider] ?? 0) + 1;
  }
  const last7days = Object.entries(buckets)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, counts]) => ({ date, counts }));

  const openAICalls30d = openai30dSnap.size;
  const totalCostOpenAI = openAICalls30d * OPENAI_COST_PER_CALL_USD;

  return { today, last7days, totalCostOpenAI, openAICalls30d };
}

function ProviderCard({
  name,
  calls,
  limit,
  color,
  bgColor,
  barColor,
  actions,
  extra,
}: {
  name: string;
  calls: number;
  limit?: number;
  color: string;
  bgColor: string;
  barColor: string;
  actions?: Record<string, number>;
  extra?: string;
}) {
  const pct = limit ? Math.min((calls / limit) * 100, 100) : null;
  const isWarning = pct !== null && pct >= ALERT_THRESHOLD * 100;
  const isCritical = pct !== null && pct >= 95;

  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${isCritical ? "border-rose-300 bg-rose-50" : isWarning ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <p className="font-semibold text-slate-950">{name}</p>
          {extra && <p className="text-xs text-slate-500 mt-0.5">{extra}</p>}
        </div>
        <span className={`rounded-xl p-2 ${bgColor}`}>
          <Zap className={`h-4 w-4 ${color}`} />
        </span>
      </div>

      <p className={`text-3xl font-bold ${color}`}>{calls.toLocaleString("pt-BR")}</p>
      <p className="text-xs text-slate-500 mt-0.5">
        {limit ? `chamadas hoje / ${limit.toLocaleString("pt-BR")} limite` : "chamadas hoje"}
      </p>

      {pct !== null && (
        <div className="mt-3">
          <div className="flex justify-between text-xs mb-1">
            <span className={isWarning ? "font-semibold text-amber-700" : "text-slate-500"}>
              {Math.round(pct)}% do limite diário gratuito
            </span>
            {isWarning && (
              <span className={`font-semibold ${isCritical ? "text-rose-700" : "text-amber-700"}`}>
                {isCritical ? "CRÍTICO" : "ALERTA"}
              </span>
            )}
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {isWarning && (
        <div className={`mt-3 flex items-start gap-2 rounded-xl p-3 text-xs ${isCritical ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"}`}>
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            {isCritical
              ? `Limite quase esgotado! Próximas chamadas podem usar o fallback.`
              : `Acima de 80% do limite. Monitore de perto.`}
          </span>
        </div>
      )}

      {actions && Object.keys(actions).length > 0 && (
        <div className="mt-3 space-y-1">
          {Object.entries(actions).map(([action, count]) => (
            <div key={action} className="flex justify-between text-xs text-slate-600">
              <span>{ACTION_LABELS[action] ?? action}</span>
              <span className="font-medium">{count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const dynamic = "force-dynamic";

export default async function UsoIAPage() {
  const { today, last7days, totalCostOpenAI, openAICalls30d } = await getUsage();

  const gemini = today.gemini ?? { calls: 0, actions: {} };
  const openai = today.openai ?? { calls: 0, actions: {} };
  const groq = today.groq ?? { calls: 0, actions: {} };

  const todayDate = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const allProvidersOk = gemini.calls < GEMINI_DAILY_LIMIT * ALERT_THRESHOLD && groq.calls < GROQ_DAILY_LIMIT * ALERT_THRESHOLD;

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-violet-600">Admin</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-950">Uso de APIs — hoje</h1>
        <p className="mt-1 text-sm text-slate-500 capitalize">{todayDate}</p>
      </div>

      {/* Status geral */}
      <div className={`flex items-center gap-3 rounded-2xl border p-4 ${allProvidersOk ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
        {allProvidersOk
          ? <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
          : <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />}
        <p className={`text-sm font-medium ${allProvidersOk ? "text-emerald-900" : "text-amber-900"}`}>
          {allProvidersOk
            ? "Todos os provedores dentro dos limites gratuitos."
            : "Um ou mais provedores estão acima de 80% do limite diário gratuito."}
        </p>
      </div>

      {/* Cards de provedores */}
      <div className="grid gap-4 sm:grid-cols-3">
        <ProviderCard
          name="Gemini 2.0 Flash"
          calls={gemini.calls}
          limit={GEMINI_DAILY_LIMIT}
          color="text-blue-600"
          bgColor="bg-blue-50"
          barColor={gemini.calls >= GEMINI_DAILY_LIMIT * 0.95 ? "bg-rose-500" : gemini.calls >= GEMINI_DAILY_LIMIT * ALERT_THRESHOLD ? "bg-amber-500" : "bg-blue-500"}
          actions={gemini.actions}
          extra="1.500 req/dia gratuitos"
        />
        <ProviderCard
          name="OpenAI GPT-4o-mini"
          calls={openai.calls}
          color="text-emerald-600"
          bgColor="bg-emerald-50"
          barColor="bg-emerald-500"
          actions={openai.actions}
          extra="Sem tier gratuito — pago por uso"
        />
        <ProviderCard
          name="Groq llama-3.3-70b"
          calls={groq.calls}
          limit={GROQ_DAILY_LIMIT}
          color="text-violet-600"
          bgColor="bg-violet-50"
          barColor={groq.calls >= GROQ_DAILY_LIMIT * 0.95 ? "bg-rose-500" : groq.calls >= GROQ_DAILY_LIMIT * ALERT_THRESHOLD ? "bg-amber-500" : "bg-violet-500"}
          actions={groq.actions}
          extra="~1.000 req/dia gratuitos (fallback)"
        />
      </div>

      {/* OpenAI custo acumulado (30 dias) */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950 mb-1">Custo estimado OpenAI (30 dias)</h2>
        <p className="text-xs text-slate-500 mb-4">
          Baseado em ~8.000 tokens por chamada (gpt-4o-mini: $0,15/1M in + $0,60/1M out ≈ $0,0015/chamada)
        </p>
        <div className="flex items-end gap-6">
          <div>
            <p className="text-3xl font-bold text-emerald-700">
              ${totalCostOpenAI.toFixed(4)}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">{openAICalls30d} chamadas nos últimos 30 dias</p>
          </div>
          {openAICalls30d === 0 && (
            <p className="text-sm text-slate-400 pb-1">Nenhuma chamada ainda — Gemini atende tudo no tier gratuito.</p>
          )}
        </div>
      </div>

      {/* Tendência 7 dias */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950 mb-4">Tendência — últimos 7 dias</h2>
        {last7days.length === 0 ? (
          <p className="text-sm text-slate-400">Nenhum log nos últimos 7 dias.</p>
        ) : (
          <div className="space-y-3">
            {last7days.map(({ date, counts }) => {
              const total = Object.values(counts).reduce((a, b) => a + b, 0);
              const geminiCount = counts.gemini ?? 0;
              const openaiCount = counts.openai ?? 0;
              const groqCount = counts.groq ?? 0;
              return (
                <div key={date}>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="font-medium text-slate-700">
                      {new Date(date + "T12:00:00Z").toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" })}
                    </span>
                    <span className="text-slate-500">{total} chamadas</span>
                  </div>
                  <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100 gap-px">
                    {geminiCount > 0 && (
                      <div className="bg-blue-500 rounded-l-full" style={{ width: `${(geminiCount / total) * 100}%` }} title={`Gemini: ${geminiCount}`} />
                    )}
                    {openaiCount > 0 && (
                      <div className="bg-emerald-500" style={{ width: `${(openaiCount / total) * 100}%` }} title={`OpenAI: ${openaiCount}`} />
                    )}
                    {groqCount > 0 && (
                      <div className="bg-violet-500 rounded-r-full" style={{ width: `${(groqCount / total) * 100}%` }} title={`Groq: ${groqCount}`} />
                    )}
                  </div>
                  <div className="flex gap-4 mt-1 text-[10px] text-slate-400">
                    {geminiCount > 0 && <span><span className="inline-block w-2 h-2 rounded-full bg-blue-500 mr-1" />Gemini {geminiCount}</span>}
                    {openaiCount > 0 && <span><span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1" />OpenAI {openaiCount}</span>}
                    {groqCount > 0 && <span><span className="inline-block w-2 h-2 rounded-full bg-violet-500 mr-1" />Groq {groqCount}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-4 flex gap-4 text-xs text-slate-400 border-t border-slate-100 pt-3">
          <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500 mr-1.5 align-middle" />Gemini (gratuito até 1.500/dia)</span>
          <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 mr-1.5 align-middle" />OpenAI (pago)</span>
          <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-violet-500 mr-1.5 align-middle" />Groq (gratuito até 1.000/dia)</span>
        </div>
      </div>

      {/* Referência de limites */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950 mb-3">Referência de limites e custos</h2>
        <div className="space-y-2 text-sm">
          {[
            { provider: "Gemini 2.0 Flash", tier: "Gratuito", limit: "1.500 req/dia · 32.000 tokens/req", cost: "Grátis (free tier)", color: "bg-blue-100 text-blue-800" },
            { provider: "OpenAI GPT-4o-mini", tier: "Pago", limit: "Sem limite de volume", cost: "~$0,0015/extração · ~$0,0007/sugestão", color: "bg-emerald-100 text-emerald-800" },
            { provider: "Groq llama-3.3-70b", tier: "Gratuito", limit: "~1.000 req/dia (estimado)", cost: "Grátis (free tier)", color: "bg-violet-100 text-violet-800" },
          ].map(({ provider, tier, limit, cost, color }) => (
            <div key={provider} className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${color}`}>{tier}</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-800">{provider}</p>
                <p className="text-xs text-slate-500">{limit} · {cost}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Hierarquia de fallback: Gemini → OpenAI → Groq. OpenAI é ativado apenas quando Gemini esgota a cota diária.
        </p>
      </div>
    </div>
  );
}
