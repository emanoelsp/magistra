import Link from "next/link";
import {
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Download,
  Edit2,
  FileText,
  FolderKanban,
  GraduationCap,
  Pencil,
  Plus,
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

function formatDateShort(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(iso));
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
    getUserPlanosComNome(user.uid, 5, 1),
    getRecentTemplates(user.uid, 4),
    getLimitsStatus(user.uid, user.plano),
    getRecentEscolasComTurmas(user.uid, 4),
  ]);

  const planos = planosResult.items;
  const primeiroNome = (user.nome ?? user.email ?? "Professor").split(" ")[0];
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

        <div className="mt-5 flex flex-wrap items-center gap-2.5 md:gap-3">
          <Link
            href="/dashboard/templates"
            className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 md:px-5 md:py-3"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden xs:inline">Adicionar</span> template
          </Link>

          <Link
            href="/dashboard/gerar"
            className="inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500 md:px-5 md:py-3"
          >
            <Sparkles className="h-4 w-4" />
            Gerar novo plano
          </Link>
        </div>

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
      {showOnboarding && (
        <section className="rounded-[2rem] border border-indigo-100 bg-gradient-to-br from-indigo-50 to-violet-50 px-5 py-6 shadow-sm md:px-8 md:py-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-indigo-500">Primeiros passos</p>
              <h2 className="mt-1 text-base font-semibold tracking-tight text-slate-950 sm:text-lg">
                {temTemplates && temCamposConfigurados
                  ? "Falta só um passo — gere seu primeiro plano!"
                  : "3 passos para o seu primeiro plano de aula"}
              </h2>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200">
              {[temTemplates, temCamposConfigurados, temPlanos].filter(Boolean).length} / 3 concluídos
            </span>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {/* Step 1 */}
            <div className={`flex flex-col gap-3 rounded-2xl p-4 shadow-sm transition sm:p-5 ${temTemplates ? "bg-emerald-50 border border-emerald-200" : "bg-white border border-slate-200"}`}>
              <div className="flex items-center justify-between">
                <span className={`flex h-8 w-8 items-center justify-center rounded-xl sm:h-9 sm:w-9 ${temTemplates ? "bg-emerald-600" : "bg-indigo-600"} text-white`}>
                  {temTemplates ? <Check className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
                </span>
                {temTemplates ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <Circle className="h-5 w-5 text-slate-300" />}
              </div>
              <div>
                <p className={`text-xs font-bold uppercase tracking-wider ${temTemplates ? "text-emerald-600" : "text-indigo-600"}`}>Passo 1</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">Suba o template da escola</p>
                <p className="mt-1 hidden text-xs leading-5 text-slate-500 sm:block">
                  Envie o arquivo Word (.docx) com o modelo de plano de aula da sua escola.
                </p>
              </div>
              {!temTemplates && (
                <Link
                  href="/dashboard/templates"
                  className="mt-auto inline-flex items-center gap-1.5 self-start rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500"
                >
                  Subir agora <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>

            {/* Step 2 */}
            <div className={`flex flex-col gap-3 rounded-2xl p-4 shadow-sm transition sm:p-5 ${temCamposConfigurados ? "bg-emerald-50 border border-emerald-200" : temTemplates ? "bg-white border border-violet-200" : "bg-white/60 border border-slate-200 opacity-60"}`}>
              <div className="flex items-center justify-between">
                <span className={`flex h-8 w-8 items-center justify-center rounded-xl sm:h-9 sm:w-9 ${temCamposConfigurados ? "bg-emerald-600" : "bg-violet-600"} text-white`}>
                  {temCamposConfigurados ? <Check className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                </span>
                {temCamposConfigurados ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <Circle className="h-5 w-5 text-slate-300" />}
              </div>
              <div>
                <p className={`text-xs font-bold uppercase tracking-wider ${temCamposConfigurados ? "text-emerald-600" : "text-violet-600"}`}>Passo 2</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">Revise os campos detectados</p>
                <p className="mt-1 hidden text-xs leading-5 text-slate-500 sm:block">
                  A Magis detecta os campos automaticamente — confirme ou ajuste os nomes.
                </p>
              </div>
              {temTemplates && !temCamposConfigurados && templates[0] && (
                <Link
                  href={`/dashboard/templates/${templates[0].id}/editar`}
                  className="mt-auto inline-flex items-center gap-1.5 self-start rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-violet-500"
                >
                  Revisar campos <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>

            {/* Step 3 */}
            <div className={`flex flex-col gap-3 rounded-2xl p-4 shadow-sm transition sm:p-5 ${temCamposConfigurados ? "bg-white border border-emerald-200 ring-1 ring-emerald-100" : "bg-white/60 border border-slate-200 opacity-60"}`}>
              <div className="flex items-center justify-between">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-600 text-white sm:h-9 sm:w-9">
                  <FileText className="h-4 w-4" />
                </span>
                <Circle className="h-5 w-5 text-slate-300" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-600">Passo 3</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">Gere seu primeiro plano</p>
                <p className="mt-1 hidden text-xs leading-5 text-slate-500 sm:block">
                  Preencha os dados da turma, deixe a Magis sugerir o conteúdo e baixe o plano pronto.
                </p>
              </div>
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
      )}

      {/* Escolas e Turmas */}
      <section className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm md:p-6">
        <div className="mb-4 flex items-center justify-between gap-3 md:mb-5">
          <h2 className="text-base font-semibold tracking-tight text-slate-950 md:text-lg">
            Suas escolas
          </h2>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard/escolas"
              className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-950 hover:text-slate-950"
            >
              Ver todas
            </Link>
            <Link
              href="/dashboard/escolas"
              className="flex items-center gap-1.5 rounded-xl bg-slate-950 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-800"
            >
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Nova escola</span>
              <span className="sm:hidden">Nova</span>
            </Link>
          </div>
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
          <>
            <ul className="divide-y divide-slate-100">
              {escolasData.escolas.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="shrink-0 rounded-xl bg-indigo-50 p-2 text-indigo-600">
                      <Building2 className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{e.nome}</p>
                      <p className="text-xs text-slate-400">
                        {e.turmaCount === 0
                          ? "Nenhuma turma"
                          : `${e.turmaCount} turma${e.turmaCount !== 1 ? "s" : ""}`}
                      </p>
                    </div>
                  </div>
                  <Link
                    href="/dashboard/escolas"
                    className="shrink-0 rounded-xl border border-slate-200 p-1.5 text-slate-400 transition hover:border-slate-950 hover:text-slate-950"
                    title="Ver escola"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                </li>
              ))}
            </ul>
            {escolasData.total > escolasData.escolas.length && (
              <p className="mt-3 text-center text-xs text-slate-400">
                +{escolasData.total - escolasData.escolas.length} escola
                {escolasData.total - escolasData.escolas.length !== 1 ? "s" : ""} não exibida
                {escolasData.total - escolasData.escolas.length !== 1 ? "s" : ""} —{" "}
                <Link href="/dashboard/escolas" className="text-violet-600 hover:underline">
                  ver todas
                </Link>
              </p>
            )}
          </>
        )}
      </section>

      {/* Templates + Planos */}
      <section className="grid gap-6 xl:grid-cols-2">

        {/* Templates */}
        <div className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm md:p-6">
          <div className="mb-4 flex items-center justify-between gap-3 md:mb-5">
            <h2 className="text-base font-semibold tracking-tight text-slate-950 md:text-lg">
              Seus templates
            </h2>
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
                  <span className="hidden sm:inline">Novo template</span>
                  <span className="sm:hidden">Novo</span>
                </Link>
              )}
            </div>
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
            <ul className="divide-y divide-slate-100">
              {templates.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`shrink-0 rounded-xl p-2 ${t.deletado ? "bg-slate-100 text-slate-400" : "bg-amber-50 text-amber-600"}`}>
                      <FolderKanban className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className={`truncate text-sm font-medium ${t.deletado ? "text-slate-400 line-through" : "text-slate-900"}`}>
                        {t.nome}
                      </p>
                      <p className="truncate text-xs text-slate-400">
                        {t.escola_nome ? `${t.escola_nome} · ` : ""}
                        <span className="hidden sm:inline">{formatDate(t.data_criacao)}</span>
                        <span className="sm:hidden">{formatDateShort(t.data_criacao)}</span>
                        {t.deletado && <span className="ml-1.5 text-rose-400">· excluído</span>}
                      </p>
                    </div>
                  </div>
                  {t.deletado ? (
                    <span className="shrink-0 rounded-xl border border-slate-100 p-1.5 text-slate-300">
                      <Edit2 className="h-3.5 w-3.5" />
                    </span>
                  ) : (
                    <Link
                      href={`/dashboard/templates/${t.id}/editar`}
                      className="shrink-0 rounded-xl border border-slate-200 p-1.5 text-slate-400 transition hover:border-slate-950 hover:text-slate-950"
                      title="Editar template"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Planos */}
        <div className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm md:p-6">
          <div className="mb-4 flex items-center justify-between gap-3 md:mb-5">
            <h2 className="text-base font-semibold tracking-tight text-slate-950 md:text-lg">
              Seus planos
            </h2>
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
                <span className="hidden sm:inline">Novo plano</span>
                <span className="sm:hidden">Novo</span>
              </Link>
            </div>
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
            <ul className="divide-y divide-slate-100">
              {planos.map((plano) => {
                const status =
                  STATUS_CONFIG[plano.status] ?? { label: plano.status, cls: "bg-slate-100 text-slate-600" };
                const temConteudo = Object.keys(plano.conteudo_gerado ?? {}).length > 0;
                const titulo =
                  typeof plano.conteudo_gerado?._plano_titulo === "string" &&
                  plano.conteudo_gerado._plano_titulo.trim()
                    ? plano.conteudo_gerado._plano_titulo
                    : plano.template_nome;
                return (
                  <li key={plano.id} className="flex items-center justify-between gap-2 py-3 sm:gap-3">
                    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                      <span className={`shrink-0 rounded-xl p-2 ${plano.template_deletado ? "bg-slate-100 text-slate-400" : "bg-violet-50 text-violet-600"}`}>
                        <FileText className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className={`truncate text-sm font-medium ${plano.template_deletado ? "text-slate-400 line-through" : "text-slate-900"}`}>
                          {titulo}
                        </p>
                        <p className="truncate text-xs text-slate-400">
                          <span className="hidden sm:inline">{formatDate(plano.data_geracao)}</span>
                          <span className="sm:hidden">{formatDateShort(plano.data_geracao)}</span>
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${status.cls}`}>
                            {status.label}
                          </span>
                          {plano.template_deletado && (
                            <span className="inline-block rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-500">
                              template excluído
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
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
                      {(plano.status === "rascunho" || plano.status === "aguardando_geracao") && (
                        <Link
                          href={`/dashboard/gerar?resume=${plano.id}`}
                          className="flex items-center gap-1 rounded-xl border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-xs font-medium text-violet-700 transition hover:border-violet-400 hover:bg-violet-100 sm:px-3"
                          title="Continuar editando"
                        >
                          <Pencil className="h-3 w-3" />
                          <span className="hidden sm:inline">Continuar</span>
                        </Link>
                      )}
                      {plano.status === "gerado" && (
                        <Link
                          href={`/dashboard/historico/${plano.id}`}
                          className="rounded-xl border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-950 hover:text-slate-950 sm:px-3"
                        >
                          Detalhes
                        </Link>
                      )}
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
