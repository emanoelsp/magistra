import Link from "next/link";
import { AlertCircle, FileText } from "lucide-react";

import { requireCurrentUserProfile } from "../../../lib/auth/session";
import { getUserTemplateOptions } from "../../../lib/services/firestore/dashboard.server";
import { getLimitsStatus } from "../../../lib/services/limits";
import { TemplatesUploader } from "../../../components/templates/templates-uploader";
import { TemplatesList } from "../../../components/templates/templates-list";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const user = await requireCurrentUserProfile();
  const [templates, limitsStatus] = await Promise.all([
    getUserTemplateOptions(user.uid),
    getLimitsStatus(user.uid, user.plano),
  ]);

  const templateLimitReached = !limitsStatus.canCreateTemplate;
  const planoLimitReached = !limitsStatus.canCreatePlano;

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-500">
            Meus templates
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
            Modelos oficiais da escola
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Centralize os templates da sua escola para gerar planos consistentes com sugestão de IA.
          </p>
        </div>

        {/* Usage badge */}
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
            <span
              className={[
                "rounded-full px-3 py-1 text-xs font-semibold",
                templateLimitReached
                  ? "bg-rose-100 text-rose-700"
                  : "bg-slate-100 text-slate-600",
              ].join(" ")}
            >
              {limitsStatus.currentTemplates}/{limitsStatus.limits.maxTemplates} templates
            </span>
            <span
              className={[
                "rounded-full px-3 py-1 text-xs font-semibold",
                planoLimitReached
                  ? "bg-rose-100 text-rose-700"
                  : "bg-slate-100 text-slate-600",
              ].join(" ")}
            >
              {limitsStatus.currentPlanosThisMonth}/{limitsStatus.limits.maxPlanosPerMonth} planos/mês
            </span>
          </div>
          <p className="text-xs text-slate-400">Plano {limitsStatus.plano}</p>
        </div>
      </header>

      {/* Limit alerts */}
      {templateLimitReached && (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <p className="text-sm text-rose-700">
            Você atingiu o limite de {limitsStatus.limits.maxTemplates} templates do plano{" "}
            <strong>{limitsStatus.plano}</strong>. Exclua um template existente para adicionar um novo.
          </p>
        </div>
      )}

      {planoLimitReached && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-700">
            Você atingiu o limite de {limitsStatus.limits.maxPlanosPerMonth} planos por mês do plano{" "}
            <strong>{limitsStatus.plano}</strong>. Os planos renovam no início do próximo mês.
          </p>
        </div>
      )}

      {/* Upload section */}
      <section>
        {templateLimitReached ? (
          <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
            <p className="text-sm font-medium text-slate-600">
              Limite de templates atingido. Exclua um template existente para adicionar outro.
            </p>
          </div>
        ) : (
          <TemplatesUploader userId={user.uid} />
        )}
      </section>

      {/* Templates list */}
      <section className="rounded-3xl border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <FileText className="h-4 w-4 text-slate-500" />
            Templates cadastrados
          </h2>
          {templates.length > 0 && (
            <p className="text-xs text-slate-500">
              {templates.length}{" "}
              {templates.length === 1 ? "modelo disponível" : "modelos disponíveis"}
            </p>
          )}
        </div>

        {templates.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">
            Nenhum template encontrado para{" "}
            <span className="font-medium">{user.nome || user.email}</span>. Adicione ao menos um
            modelo para gerar planos.
          </p>
        ) : (
          <TemplatesList templates={templates} canCreatePlano={!planoLimitReached} />
        )}
      </section>

      {/* Quick link to history */}
      <div className="text-center">
        <Link
          href="/dashboard/historico"
          className="text-sm text-slate-500 underline-offset-2 hover:text-slate-950 hover:underline"
        >
          Ver histórico de planos gerados →
        </Link>
      </div>
    </div>
  );
}
