import Link from "next/link";
import { ArrowLeft, Sparkles, TrendingUp } from "lucide-react";

import { PlanGenerationWizard } from "../../../components/planos/plan-generation-wizard";
import { requireCurrentUserProfile } from "../../../lib/auth/session";
import { getUserPlanosComNome, getUserTemplateOptions } from "../../../lib/services/firestore/dashboard.server";
import { getLimitsStatus } from "../../../lib/services/limits";

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

interface GerarPlanoPageProps {
  searchParams: Promise<{ template?: string }>;
}

export default async function GerarPlanoPage({ searchParams }: GerarPlanoPageProps) {
  const user = await requireCurrentUserProfile();

  const [templates, { template: preSelectedId }, limits, recentPlanos] = await Promise.all([
    getUserTemplateOptions(user.uid),
    searchParams,
    getLimitsStatus(user.uid, user.plano),
    getUserPlanosComNome(user.uid, 3),
  ]);

  const planoLabel = PLAN_LABELS[limits.plano] ?? limits.plano;
  const canCreatePlano = limits.canCreatePlano;

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-2 text-sm font-medium text-slate-600 transition hover:text-slate-950"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar ao dashboard
        </Link>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-violet-100 p-3 text-violet-600">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Gerar plano</h1>
              <p className="text-sm text-slate-500">Geração assistida com a Magis, passo a passo.</p>
            </div>
          </div>

          {/* Usage badges */}
          <div className="flex flex-col items-start gap-1.5 sm:items-end">
            <div className="flex items-center gap-2">
              <span className={["rounded-full px-3 py-1 text-xs font-semibold", !canCreatePlano ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600"].join(" ")}>
                {limits.currentPlanosThisMonth}/{limits.limits.maxPlanosPerMonth} planos/mês
              </span>
            </div>
            <p className="text-xs text-slate-400">Plano {planoLabel}</p>
          </div>
        </div>
      </header>

      {/* Magis bubble — plano limit */}
      {!canCreatePlano && (
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-600 shadow-sm">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div className="relative max-w-2xl">
            <div style={{ position: "absolute", left: -9, top: 10, width: 0, height: 0, borderTop: "8px solid transparent", borderBottom: "8px solid transparent", borderRight: "9px solid #fecaca" }} />
            <div style={{ position: "absolute", left: -7, top: 11, width: 0, height: 0, borderTop: "7px solid transparent", borderBottom: "7px solid transparent", borderRight: "8px solid #fff1f2" }} />
            <div className="rounded-2xl rounded-tl-none border border-rose-200 bg-rose-50 px-4 py-3.5">
              <div className="mb-1.5 flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-violet-500" />
                <span className="text-xs font-bold text-violet-700">Magis</span>
              </div>
              <p className="text-sm leading-relaxed text-rose-800">
                Você atingiu o limite de <strong>{limits.limits.maxPlanosPerMonth} planos por mês</strong> do plano{" "}
                <strong>{planoLabel}</strong>.{" "}
                <Link href="/dashboard/perfil" className="font-semibold underline underline-offset-2 hover:text-rose-900">
                  Atualize seu plano
                </Link>{" "}
                para criar mais planos.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Magis bubble — sem templates */}
      {canCreatePlano && templates.length === 0 && (
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-600 shadow-sm">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div className="relative max-w-2xl">
            <div style={{ position: "absolute", left: -9, top: 10, width: 0, height: 0, borderTop: "8px solid transparent", borderBottom: "8px solid transparent", borderRight: "9px solid #fde68a" }} />
            <div style={{ position: "absolute", left: -7, top: 11, width: 0, height: 0, borderTop: "7px solid transparent", borderBottom: "7px solid transparent", borderRight: "8px solid #fffbeb" }} />
            <div className="rounded-2xl rounded-tl-none border border-amber-200 bg-amber-50 px-4 py-3.5">
              <div className="mb-1.5 flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-violet-500" />
                <span className="text-xs font-bold text-violet-700">Magis</span>
              </div>
              <p className="text-sm leading-relaxed text-amber-900">
                Você ainda não tem nenhum template cadastrado.{" "}
                <Link href="/dashboard/templates" className="font-semibold underline underline-offset-2 hover:text-amber-950">
                  Adicione o modelo da sua escola
                </Link>{" "}
                para começar a gerar planos. 📄
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Seção principal */}
      <section>
        {!canCreatePlano ? (
          <div className="rounded-3xl border border-slate-100 bg-white p-8 shadow-sm">
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link
                href="/dashboard/perfil"
                className="flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                <TrendingUp className="h-4 w-4" />
                Fazer upgrade do plano
              </Link>
              <div className="relative flex cursor-not-allowed select-none items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-3 text-sm font-medium text-slate-400">
                <Sparkles className="h-4 w-4" />
                Contratar planos avulsos
                <span className="absolute -right-2 -top-2 rounded-full bg-slate-800 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                  Em breve
                </span>
              </div>
            </div>
          </div>
        ) : templates.length === 0 ? (
          <div className="rounded-3xl border border-slate-100 bg-white p-8 shadow-sm">
            <div className="flex justify-center">
              <Link
                href="/dashboard/templates"
                className="flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Adicionar template
              </Link>
            </div>
          </div>
        ) : (
          <PlanGenerationWizard
            userId={user.uid}
            userName={user.nome || user.email}
            availableTemplates={templates}
            preSelectedTemplateId={preSelectedId}
            recentPlanos={recentPlanos}
          />
        )}
      </section>
    </div>
  );
}
