import Link from "next/link";
import { Download, Edit2, FileText, FolderKanban, Plus, Sparkles } from "lucide-react";

import { requireCurrentUserProfile } from "../../lib/auth/session";
import { getDashboardStats, getRecentTemplates, getUserPlanosComNome } from "../../lib/services/firestore/dashboard.server";
import { getLimitsStatus } from "../../lib/services/limits";

export const dynamic = "force-dynamic";

const PLAN_LABELS: Record<string, string> = {
  free:     "Explorador",
  starter:  "Educador",
  medio:    "Mestre",
  pro:      "Regente",
  escola:   "Escola",
  avancado: "Regente",
  premium:  "Regente",
};

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  gerado:               { label: "Gerado",            cls: "bg-emerald-100 text-emerald-800" },
  rascunho:             { label: "Rascunho",           cls: "bg-slate-100 text-slate-700" },
  processando:          { label: "Processando",        cls: "bg-amber-100 text-amber-800" },
  aguardando_geracao:   { label: "Aguardando geração", cls: "bg-blue-100 text-blue-700" },
  aguardando_aprovacao: { label: "Aguardando revisão", cls: "bg-violet-100 text-violet-700" },
  erro:                 { label: "Erro",               cls: "bg-rose-100 text-rose-800" },
};

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(iso),
  );
}

interface UsagePillProps {
  used: number;
  max: number;
  label: string;
  icon: React.ReactNode;
}

function UsagePill({ used, max, label, icon }: UsagePillProps) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const atLimit = used >= max;
  const nearLimit = !atLimit && pct >= 67;

  const pillCls = atLimit
    ? "bg-rose-500/25 text-rose-200"
    : nearLimit
    ? "bg-amber-500/25 text-amber-200"
    : "bg-white/10 text-slate-300";

  const barCls = atLimit
    ? "bg-rose-400"
    : nearLimit
    ? "bg-amber-400"
    : "bg-emerald-400";

  return (
    <div className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${pillCls}`}>
      {icon}
      <span>
        {used}/{max} {label}
      </span>
      <div className="h-1 w-10 overflow-hidden rounded-full bg-white/20">
        <div className={`h-full rounded-full transition-all ${barCls}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  const user = await requireCurrentUserProfile();
  const [stats, planosResult, templates, limits] = await Promise.all([
    getDashboardStats(user),
    getUserPlanosComNome(user.uid, 5, 1),
    getRecentTemplates(user.uid, 4),
    getLimitsStatus(user.uid, user.plano),
  ]);

  const planos = planosResult.items;
  const primeiroNome = (user.nome ?? user.email ?? "Professor").split(" ")[0];
  const temTemplates = stats.totalTemplates > 0;
  const canAddTemplate = limits.canCreateTemplate;

  return (
    <div className="flex flex-col gap-8">

      {/* Hero */}
      <section className="rounded-[2rem] bg-slate-950 px-8 py-10 text-white shadow-xl">
        <h1 className="text-3xl font-semibold tracking-tight">
          Olá, {primeiroNome}!
        </h1>
        <p className="mt-2 text-slate-300">
          Crie planos de aula completos em minutos com o apoio da nossa assistente pedagógica Magis!
        </p>

        {/* Action buttons */}
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Link
            href="/dashboard/templates"
            className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500"
          >
            <Plus className="h-4 w-4" />
            Adicionar template
          </Link>

          <Link
            href="/dashboard/gerar"
            className="inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-500"
          >
            <Sparkles className="h-4 w-4" />
            Gerar novo plano
          </Link>
        </div>

        {/* Usage indicators */}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <UsagePill
            used={limits.currentTemplates}
            max={limits.limits.maxTemplates}
            label="templates"
            icon={<FolderKanban className="h-3.5 w-3.5" />}
          />
          <UsagePill
            used={limits.currentPlanosThisMonth}
            max={limits.limits.maxPlanosPerMonth}
            label="planos/mês"
            icon={<FileText className="h-3.5 w-3.5" />}
          />
          <span className="text-xs text-slate-500">Plano {PLAN_LABELS[limits.plano] ?? limits.plano}</span>
        </div>
      </section>

      {/* Recentes: templates + planos */}
      <section className="grid gap-6 xl:grid-cols-2">

        {/* Templates */}
        <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight text-slate-950">Seus templates</h2>
            <div className="flex items-center gap-2">
              <Link
                href="/dashboard/templates"
                className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-950 hover:text-slate-950"
              >
                Ver todos
              </Link>
              {canAddTemplate && (
                <Link
                  href="/dashboard/templates"
                  className="flex items-center gap-1.5 rounded-xl bg-slate-950 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-800"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Novo template
                </Link>
              )}
            </div>
          </div>

          {templates.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
              <FolderKanban className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-700">
                Nenhum template ainda.
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Suba o modelo de plano da sua escola para começar.
              </p>
              <Link
                href="/dashboard/templates"
                className="mt-4 inline-flex items-center gap-1.5 rounded-2xl bg-slate-950 px-4 py-2 text-xs font-medium text-white transition hover:bg-slate-800"
              >
                <Plus className="h-3 w-3" />
                Adicionar template
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {templates.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="shrink-0 rounded-xl bg-amber-50 p-2 text-amber-600">
                      <FolderKanban className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{t.nome}</p>
                      <p className="truncate text-xs text-slate-400">
                        {t.escola_nome ? `${t.escola_nome} · ` : ""}
                        {formatDate(t.data_criacao)}
                      </p>
                    </div>
                  </div>
                  <Link
                    href={`/dashboard/templates/${t.id}/editar`}
                    className="shrink-0 rounded-xl border border-slate-200 p-1.5 text-slate-400 transition hover:border-slate-950 hover:text-slate-950"
                    title="Editar template"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Planos */}
        <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight text-slate-950">Seus planos</h2>
            <div className="flex items-center gap-2">
              <Link
                href="/dashboard/historico"
                className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-950 hover:text-slate-950"
              >
                Ver todos
              </Link>
              <Link
                href="/dashboard/gerar"
                className="flex items-center gap-1.5 rounded-xl bg-slate-950 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5" />
                Novo plano
              </Link>
            </div>
          </div>

          {planos.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
              <FileText className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-700">
                Nenhum plano gerado ainda.
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Gere seu primeiro plano com a Magis.
              </p>
              <Link
                href="/dashboard/gerar"
                className="mt-4 inline-flex items-center gap-1.5 rounded-2xl bg-slate-950 px-4 py-2 text-xs font-medium text-white transition hover:bg-slate-800"
              >
                <Plus className="h-3 w-3" />
                Criar primeiro plano
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {planos.map((plano) => {
                const status =
                  STATUS_CONFIG[plano.status] ?? { label: plano.status, cls: "bg-slate-100 text-slate-600" };
                const temConteudo = Object.keys(plano.conteudo_gerado ?? {}).length > 0;
                return (
                  <li key={plano.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="shrink-0 rounded-xl bg-violet-50 p-2 text-violet-600">
                        <FileText className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {plano.template_nome}
                        </p>
                        <p className="truncate text-xs text-slate-400">
                          {formatDate(plano.data_geracao)}
                        </p>
                        <span
                          className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${status.cls}`}
                        >
                          {status.label}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {plano.status === "gerado" && temConteudo && (
                        <a
                          href={`/api/planos/${plano.id}/download`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-xl border border-slate-200 p-1.5 text-slate-400 transition hover:border-slate-950 hover:text-slate-950"
                          title="Baixar plano"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </a>
                      )}
                      <Link
                        href={`/dashboard/historico/${plano.id}`}
                        className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-950 hover:text-slate-950"
                      >
                        Detalhes
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

      </section>
    </div>
  );
}
