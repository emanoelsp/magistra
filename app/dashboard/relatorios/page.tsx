import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Clock,
  FileText,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";

import { requireCurrentUserProfile } from "../../../lib/auth/session";
import { getPlanCapabilities } from "../../../lib/services/plan-capabilities";
import { getRelatorioData } from "../../../lib/services/firestore/relatorios.server";

export const dynamic = "force-dynamic";

function formatTempo(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  icon,
  accent = "slate",
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  accent?: "slate" | "violet" | "emerald" | "amber";
}) {
  const accentCls = {
    slate:   "bg-slate-100 text-slate-600",
    violet:  "bg-violet-100 text-violet-600",
    emerald: "bg-emerald-100 text-emerald-600",
    amber:   "bg-amber-100 text-amber-600",
  }[accent];

  return (
    <div className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className={`flex h-10 w-10 items-center justify-center rounded-2xl ${accentCls}`}>
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold tracking-tight text-slate-950">{value}</p>
        <p className="mt-0.5 text-sm font-medium text-slate-600">{label}</p>
        {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
      </div>
    </div>
  );
}

function BarRow({
  label,
  value,
  max,
  sub,
  color = "violet",
}: {
  label: string;
  value: number;
  max: number;
  sub?: string;
  color?: "violet" | "emerald" | "amber" | "slate" | "rose";
}) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  const barCls = {
    violet:  "bg-violet-500",
    emerald: "bg-emerald-500",
    amber:   "bg-amber-400",
    slate:   "bg-slate-400",
    rose:    "bg-rose-400",
  }[color];

  return (
    <div className="flex items-center gap-3">
      <div className="w-36 shrink-0 truncate text-sm text-slate-700" title={label}>{label}</div>
      <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barCls}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="w-12 shrink-0 text-right text-sm font-semibold text-slate-900">{value}</div>
      {sub && <div className="w-10 shrink-0 text-right text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

const STATUS_COLOR: Record<string, "violet" | "emerald" | "amber" | "slate" | "rose"> = {
  gerado:   "emerald",
  rascunho: "slate",
  erro:     "rose",
  processando: "amber",
};

// ─── Page ──────────────────────────────────────────────────────────────────────

export default async function RelatoriosPage() {
  const user = await requireCurrentUserProfile();
  const caps = getPlanCapabilities(user.plano ?? "free");
  if (!caps.canAccessRelatorios) redirect("/dashboard");

  const data = await getRelatorioData(
    user.uid,
    user.tempo_economizado_min ?? 0,
    user.tokens_usados_mes ?? 0,
  );

  const maxMes = Math.max(...data.planosPorMes.map((m) => m.total), 1);
  const maxTemplate = Math.max(...data.templatesMaisUsados.map((t) => t.count), 1);
  const maxEscola = Math.max(...data.escolasMaisUsadas.map((e) => e.count), 1);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-2 text-sm font-medium text-slate-600 transition hover:text-slate-950"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar ao dashboard
        </Link>
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-violet-100 p-3 text-violet-600">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Relatórios</h1>
            <p className="text-sm text-slate-500">Visão completa do seu uso do PlanoMagistra.</p>
          </div>
        </div>
      </header>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Planos criados"
          value={String(data.totalPlanos)}
          sub={`${data.totalGerados} gerados · ${data.totalRascunhos} rascunhos`}
          icon={<FileText className="h-5 w-5" />}
          accent="slate"
        />
        <StatCard
          label="Tempo economizado"
          value={data.tempoEconomizadoMin > 0 ? formatTempo(data.tempoEconomizadoMin) : "—"}
          sub="acumulado vitalício"
          icon={<Clock className="h-5 w-5" />}
          accent="emerald"
        />
        <StatCard
          label="Tokens usados este mês"
          value={data.tokensUsadosMes.toLocaleString("pt-BR")}
          sub="reinicia no 1º do mês"
          icon={<Zap className="h-5 w-5" />}
          accent="amber"
        />
        <StatCard
          label="Taxa de conclusão"
          value={data.totalPlanos > 0 ? `${Math.round((data.totalGerados / data.totalPlanos) * 100)}%` : "—"}
          sub={data.mediaDiasPorPlano > 0 ? `média ${data.mediaDiasPorPlano}d por plano` : undefined}
          icon={<CheckCircle2 className="h-5 w-5" />}
          accent="violet"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">

        {/* Planos por mês — últimos 6 meses */}
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-900">Planos por mês</h2>
            <span className="ml-auto text-xs text-slate-400">últimos 6 meses</span>
          </div>
          {data.planosPorMes.every((m) => m.total === 0) ? (
            <p className="text-sm text-slate-400">Nenhum plano criado ainda.</p>
          ) : (
            <div className="space-y-3">
              {data.planosPorMes.map((m) => (
                <div key={m.key} className="flex items-center gap-3">
                  <div className="w-14 shrink-0 text-xs font-medium text-slate-500">{m.label}</div>
                  <div className="flex flex-1 gap-1 h-5 rounded-full overflow-hidden bg-slate-100">
                    {m.gerados > 0 && (
                      <div
                        className="bg-emerald-500 h-full"
                        style={{ width: `${Math.round((m.gerados / maxMes) * 100)}%` }}
                        title={`${m.gerados} gerados`}
                      />
                    )}
                    {m.rascunhos > 0 && (
                      <div
                        className="bg-slate-300 h-full"
                        style={{ width: `${Math.round((m.rascunhos / maxMes) * 100)}%` }}
                        title={`${m.rascunhos} rascunhos`}
                      />
                    )}
                  </div>
                  <div className="w-8 shrink-0 text-right text-sm font-semibold text-slate-900">{m.total}</div>
                </div>
              ))}
              <div className="mt-3 flex items-center gap-4 text-xs text-slate-400">
                <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-4 rounded-full bg-emerald-500" /> Gerados</span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-4 rounded-full bg-slate-300" /> Rascunhos</span>
              </div>
            </div>
          )}
        </div>

        {/* Status breakdown */}
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-900">Distribuição por status</h2>
          </div>
          {data.statusBreakdown.length === 0 ? (
            <p className="text-sm text-slate-400">Nenhum plano criado ainda.</p>
          ) : (
            <div className="space-y-3">
              {data.statusBreakdown.map((s) => (
                <BarRow
                  key={s.status}
                  label={s.label}
                  value={s.count}
                  max={data.totalPlanos}
                  sub={`${s.pct}%`}
                  color={STATUS_COLOR[s.status] ?? "slate"}
                />
              ))}
            </div>
          )}
        </div>

        {/* Templates mais usados */}
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-2">
            <FileText className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-900">Templates mais usados</h2>
          </div>
          {data.templatesMaisUsados.length === 0 ? (
            <p className="text-sm text-slate-400">Nenhum plano criado ainda.</p>
          ) : (
            <div className="space-y-3">
              {data.templatesMaisUsados.map((t) => (
                <BarRow
                  key={t.templateId}
                  label={t.nome}
                  value={t.count}
                  max={maxTemplate}
                  sub={t.count === 1 ? "plano" : "planos"}
                  color="violet"
                />
              ))}
            </div>
          )}
        </div>

        {/* Escolas */}
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-900">Escolas com mais planos</h2>
          </div>
          {data.escolasMaisUsadas.length === 0 ? (
            <p className="text-sm text-slate-400">Nenhum plano associado a escola ainda.</p>
          ) : (
            <div className="space-y-3">
              {data.escolasMaisUsadas.map((e) => (
                <BarRow
                  key={e.nome}
                  label={e.nome}
                  value={e.count}
                  max={maxEscola}
                  color="amber"
                />
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Tip Magis */}
      <div className="flex items-start gap-3 max-w-2xl">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-600 shadow-md">
          <Sparkles className="h-4 w-4 text-white" />
        </div>
        <div className="flex-1 rounded-2xl rounded-tl-none border border-violet-100 bg-violet-50 p-4 shadow-sm">
          <div className="mb-1 flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-violet-600" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-violet-600">Magis</span>
          </div>
          <p className="text-sm leading-relaxed text-slate-700">
            Os dados aqui são baseados em toda a sua atividade no PlanoMagistra.
            O tempo economizado é calculado a partir das palavras geradas pela IA comparado com o tempo da sessão.
          </p>
        </div>
      </div>
    </div>
  );
}
