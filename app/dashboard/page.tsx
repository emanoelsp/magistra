import Link from "next/link";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  Clock,
  FileText,
  FolderKanban,
  GraduationCap,
  Sparkles,
  Upload,
} from "lucide-react";

function MagisBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-600 shadow-sm">
        <Sparkles className="h-3.5 w-3.5 text-white" />
      </div>
      <div className="relative max-w-sm">
        <div style={{ position:"absolute", left:-8, top:10, width:0, height:0, borderTop:"7px solid transparent", borderBottom:"7px solid transparent", borderRight:"8px solid #ddd6fe" }} />
        <div style={{ position:"absolute", left:-6, top:11, width:0, height:0, borderTop:"6px solid transparent", borderBottom:"6px solid transparent", borderRight:"7px solid #f5f3ff" }} />
        <div className="rounded-2xl rounded-tl-none border border-violet-200 bg-violet-50 px-4 py-3">
          <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-violet-600">
            <Sparkles className="h-2.5 w-2.5" /> Magis
          </p>
          {children}
        </div>
      </div>
    </div>
  );
}

import { requireCurrentUserProfile } from "../../lib/auth/session";
import {
  getDashboardStats,
  getRecentEscolasComTurmas,
  getRecentTemplates,
  getUserPlanosComNome,
} from "../../lib/services/firestore/dashboard.server";
import { getLimitsStatus } from "../../lib/services/limits";
import {
  EscolasPaginatedList,
  TemplatesPaginatedList,
  PlanosPaginatedList,
} from "../../components/dashboard/dashboard-paginated-cards";

export const dynamic = "force-dynamic";

function formatTempoEconomizado(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

const PLAN_LABELS: Record<string, string> = {
  free:     "Explorador",
  starter:  "Educador",
  medio:    "Mestre",
  pro:      "Regente",
  escola:   "Escola",
  avancado: "Regente",
  premium:  "Regente",
};


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

  const barCls = atLimit ? "bg-rose-400" : nearLimit ? "bg-amber-400" : "bg-emerald-400";

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
  const [stats, planosResult, templates, limits, escolasData] = await Promise.all([
    getDashboardStats(user),
    getUserPlanosComNome(user.uid, 12, 1),
    getRecentTemplates(user.uid, 12),
    getLimitsStatus(user.uid, user.plano),
    getRecentEscolasComTurmas(user.uid, 12),
  ]);

  const planos = planosResult.items;
  const primeiroNome = (user.nome?.trim() || user.email?.split("@")[0] || "Professor").split(" ")[0];
  const temTemplates = stats.totalTemplates > 0;
  const temCamposConfigurados = templates.some((t) => t.campo_count > 0);
  const temPlanos = stats.totalPlanos > 0;
  const canAddTemplate = limits.canCreateTemplate;
  const showOnboarding = !temPlanos;
  const temEscolas = escolasData.total > 0;

  return (
    <div className="flex flex-col gap-6 md:gap-8">

      {/* Hero */}
      <section className="rounded-[2rem] bg-slate-950 px-5 py-7 text-white shadow-xl md:px-8 md:py-10">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl md:text-3xl">
          Olá, {primeiroNome}!
        </h1>
        <p className="mt-1.5 text-sm text-slate-300 md:mt-2 md:text-base">
          Crie planos de aula completos em minutos com o apoio da nossa assistente pedagógica Magis!
        </p>

        {!showOnboarding && (
          <div className="mt-5 flex flex-wrap items-center gap-2.5 md:gap-3">
            <Link
              href="/dashboard/escolas"
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-600 md:px-5 md:py-3"
            >
              <GraduationCap className="h-4 w-4" />
              Nova escola
            </Link>

            <Link
              href="/dashboard/templates"
              className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 md:px-5 md:py-3"
            >
              <FileText className="h-4 w-4" />
              Criar template
            </Link>

            <Link
              href="/dashboard/gerar"
              className="inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500 md:px-5 md:py-3"
            >
              <Sparkles className="h-4 w-4" />
              Gerar novo plano
            </Link>
          </div>
        )}

        {(user.tempo_economizado_min ?? 0) > 0 && (
          <div className="mt-4 flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-300">
              <Clock className="h-3.5 w-3.5" />
              {formatTempoEconomizado(user.tempo_economizado_min!)} economizados com o Magistra
            </span>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2 md:mt-5 md:gap-3">
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
          <span className="text-xs text-slate-500">
            Plano {PLAN_LABELS[limits.plano] ?? limits.plano}
          </span>
        </div>
      </section>

      {/* Onboarding checklist */}
      {showOnboarding && (() => {
        const completedCount = [temEscolas, temCamposConfigurados, temPlanos].filter(Boolean).length;
        const totalSteps = 3;
        return (
          <section className="rounded-[2rem] border border-indigo-100 bg-gradient-to-br from-indigo-50 to-violet-50 px-5 py-6 shadow-sm md:px-8 md:py-8">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-indigo-500">Primeiros passos</p>
                <h2 className="mt-1 text-base font-semibold tracking-tight text-slate-950 sm:text-lg">
                  {temCamposConfigurados && !temPlanos
                    ? "Falta só um passo — gere seu primeiro plano!"
                    : `${totalSteps} passos para o seu primeiro plano de aula`}
                </h2>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200">
                  {completedCount} / {totalSteps} concluídos
                </span>
                <div className="w-32 h-1.5 rounded-full bg-white/70">
                  <div
                    className="h-1.5 rounded-full bg-emerald-500 transition-all duration-500"
                    style={{ width: `${(completedCount / totalSteps) * 100}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {/* Step 1 — Escola */}
              <div className={`flex flex-col gap-3 rounded-2xl p-5 shadow-sm transition ${temEscolas ? "bg-emerald-50 border border-emerald-200" : "bg-white border border-slate-200"}`}>
                <div className="flex items-center gap-3">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${temEscolas ? "bg-emerald-600" : "bg-slate-700"} text-white`}>
                    {temEscolas ? <Check className="h-4 w-4" /> : <GraduationCap className="h-4 w-4" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-bold uppercase tracking-wider ${temEscolas ? "text-emerald-600" : "text-slate-500"}`}>Passo 1</p>
                    <p className="text-sm font-semibold text-slate-900">Cadastre sua escola</p>
                  </div>
                  {temEscolas ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" /> : <Circle className="h-5 w-5 shrink-0 text-slate-300" />}
                </div>
                <p className="text-xs leading-5 text-slate-500">
                  Registre a escola e organize suas turmas para vincular aos planos.
                </p>
                {!temEscolas && (
                  <Link
                    href="/dashboard/escolas"
                    className="mt-auto inline-flex items-center gap-1.5 self-start rounded-xl bg-slate-700 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-600"
                  >
                    Cadastrar agora <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>

              {/* Step 2 — Template + Campos */}
              <div className={`flex flex-col gap-3 rounded-2xl p-5 shadow-sm transition ${temCamposConfigurados ? "bg-emerald-50 border border-emerald-200" : temEscolas ? "bg-white border border-indigo-200" : "bg-white/60 border border-slate-200 opacity-60"}`}>
                <div className="flex items-center gap-3">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${temCamposConfigurados ? "bg-emerald-600" : temTemplates ? "bg-violet-600" : "bg-indigo-600"} text-white`}>
                    {temCamposConfigurados ? <Check className="h-4 w-4" /> : temTemplates ? <Sparkles className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-bold uppercase tracking-wider ${temCamposConfigurados ? "text-emerald-600" : temTemplates ? "text-violet-600" : "text-indigo-600"}`}>Passo 2</p>
                    <p className="text-sm font-semibold text-slate-900">Suba o template da escola</p>
                  </div>
                  {temCamposConfigurados ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" /> : <Circle className="h-5 w-5 shrink-0 text-slate-300" />}
                </div>
                <p className="text-xs leading-5 text-slate-500">
                  Envie o arquivo Word (.docx) com o modelo de plano de aula da sua escola e configure os campos fixos ou com sugestão da Magis.
                </p>
                {temEscolas && !temTemplates && (
                  <Link
                    href="/dashboard/templates"
                    className="mt-auto inline-flex items-center gap-1.5 self-start rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500"
                  >
                    Subir agora <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                )}
                {temTemplates && !temCamposConfigurados && templates[0] && (
                  <Link
                    href={`/dashboard/templates/${templates[0].id}/editar`}
                    className="mt-auto inline-flex items-center gap-1.5 self-start rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-violet-500"
                  >
                    Revisar campos <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>

              {/* Step 3 — Plano */}
              <div className={`flex flex-col gap-3 rounded-2xl p-5 shadow-sm transition ${temCamposConfigurados ? "bg-white border border-emerald-200 ring-1 ring-emerald-100" : "bg-white/60 border border-slate-200 opacity-60"}`}>
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white">
                    <FileText className="h-4 w-4" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold uppercase tracking-wider text-emerald-600">Passo 3</p>
                    <p className="text-sm font-semibold text-slate-900">Gere seu primeiro plano</p>
                  </div>
                  <Circle className="h-5 w-5 shrink-0 text-slate-300" />
                </div>
                <p className="text-xs leading-5 text-slate-500">
                  Preencha os dados da turma, deixe a Magis sugerir o conteúdo e baixe o plano pronto.
                </p>
                {temCamposConfigurados && (
                  <Link
                    href="/dashboard/gerar"
                    className="mt-auto inline-flex items-center gap-1.5 self-start rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500"
                  >
                    Gerar agora <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>
            </div>
          </section>
        );
      })()}

      {/* Escolas · Templates · Planos */}
      <section className="grid gap-6 lg:grid-cols-3">

      {/* Escolas e Turmas */}
      <div className={`flex flex-col rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm md:p-6 transition-all duration-300${showOnboarding && !temEscolas ? " opacity-40 blur-[1px] pointer-events-none select-none" : ""}`}>
        <div className="mb-4 flex items-center justify-between gap-3 md:mb-5">
          <h2 className="text-base font-semibold tracking-tight text-slate-950 md:text-lg">
            Suas escolas
          </h2>
          {temEscolas && (
            <Link
              href="/dashboard/escolas"
              className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-950 hover:text-slate-950"
            >
              Ver todas
            </Link>
          )}
        </div>

        {!temEscolas ? (
          <div className="flex flex-col gap-4 py-2">
            <MagisBubble>
              <p className="text-sm leading-relaxed text-slate-700">
                Cadastre sua escola e organize as turmas para vincular seus planos de aula de forma organizada!
              </p>
            </MagisBubble>
            <div className="pl-11">
              <Link
                href="/dashboard/escolas"
                className="inline-flex items-center gap-1.5 rounded-2xl bg-violet-600 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-violet-500"
              >
                <GraduationCap className="h-3.5 w-3.5" />
                Cadastrar escola
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        ) : (
          <EscolasPaginatedList items={escolasData.escolas} pageSize={4} />
        )}
      </div>

        {/* Templates */}
        <div className={`flex flex-col rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm md:p-6 transition-all duration-300${showOnboarding && !temTemplates ? " opacity-40 blur-[1px] pointer-events-none select-none" : ""}`}>
          <div className="mb-4 flex items-center justify-between gap-3 md:mb-5">
            <h2 className="text-base font-semibold tracking-tight text-slate-950 md:text-lg">
              Seus templates
            </h2>
            {templates.length > 0 && (
              <Link
                href="/dashboard/templates"
                className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-950 hover:text-slate-950"
              >
                Ver todos
              </Link>
            )}
          </div>

          {templates.length === 0 ? (
            <div className="flex flex-col gap-4 py-2">
              <MagisBubble>
                <p className="text-sm leading-relaxed text-slate-700">
                  Para criar planos, preciso conhecer o modelo da sua escola.
                  Suba o arquivo <strong>.docx</strong> e eu identifico os campos automaticamente!
                </p>
              </MagisBubble>
              <div className="pl-11">
                <Link
                  href="/dashboard/templates"
                  className="inline-flex items-center gap-1.5 rounded-2xl bg-violet-600 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-violet-500"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Subir template da escola
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          ) : (
            <TemplatesPaginatedList items={templates} pageSize={4} />
          )}
        </div>

        {/* Planos */}
        <div className={`flex flex-col rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm md:p-6 transition-all duration-300${showOnboarding && !temCamposConfigurados ? " opacity-40 blur-[1px] pointer-events-none select-none" : ""}`}>
          <div className="mb-4 flex items-center justify-between gap-3 md:mb-5">
            <h2 className="text-base font-semibold tracking-tight text-slate-950 md:text-lg">
              Seus planos
            </h2>
            {planos.length > 0 && (
              <Link
                href="/dashboard/historico"
                className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-950 hover:text-slate-950"
              >
                Ver todos
              </Link>
            )}
          </div>

          {planos.length === 0 ? (
            <div className="flex flex-col gap-4 py-2">
              <MagisBubble>
                {temTemplates ? (
                  <p className="text-sm leading-relaxed text-slate-700">
                    Tudo pronto! Já tenho o template da sua escola.
                    Quer que eu prepare o primeiro plano agora?
                  </p>
                ) : (
                  <p className="text-sm leading-relaxed text-slate-700">
                    Ainda não temos templates cadastrados. Assim que você subir
                    o modelo da escola, crio seu primeiro plano em minutos!
                  </p>
                )}
              </MagisBubble>
              <div className="pl-11">
                {temTemplates ? (
                  <Link
                    href="/dashboard/gerar"
                    className="inline-flex items-center gap-1.5 rounded-2xl bg-violet-600 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-violet-500"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Gerar meu primeiro plano
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                ) : (
                  <Link
                    href="/dashboard/templates"
                    className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-300 px-4 py-2.5 text-xs font-semibold text-slate-600 transition hover:border-slate-950 hover:text-slate-950"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Subir template primeiro
                  </Link>
                )}
              </div>
            </div>
          ) : (
            <PlanosPaginatedList items={planos} />
          )}
        </div>

      </section>{/* /grid 3 cols */}
    </div>
  );
}
