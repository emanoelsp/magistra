import Link from "next/link";
import { ArrowLeft, FileText, Sparkles } from "lucide-react";

import { requireCurrentUserProfile } from "../../../lib/auth/session";
import { getUserTemplateOptions } from "../../../lib/services/firestore/dashboard.server";
import { getUserEscolas } from "../../../lib/services/firestore/escolas.server";
import { getLimitsStatus } from "../../../lib/services/limits";
import { TemplatesUploader } from "../../../components/templates/templates-uploader";
import { TemplatesWizard } from "../../../components/templates/templates-wizard";
import { TemplatesList } from "../../../components/templates/templates-list";
import { LimitActions } from "../../../components/dashboard/limit-actions";

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

export default async function TemplatesPage() {
  const user = await requireCurrentUserProfile();
  const [templates, limitsStatus, escolas] = await Promise.all([
    getUserTemplateOptions(user.uid),
    getLimitsStatus(user.uid, user.plano),
    getUserEscolas(user.uid),
  ]);

  const templateLimitReached = !limitsStatus.canCreateTemplate;
  const canCreatePlano = limitsStatus.canCreatePlano;
  const planoLabel = PLAN_LABELS[limitsStatus.plano] ?? limitsStatus.plano;

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
            <div className="rounded-2xl bg-indigo-100 p-3 text-indigo-600">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Meus templates</h1>
              <p className="text-sm text-slate-500">Modelos oficiais da escola para gerar planos com a Magis.</p>
            </div>
          </div>

          {/* Usage badges */}
          <div className="flex flex-col items-start gap-1.5 sm:items-end">
            <div className="flex items-center gap-2">
              <span className={["rounded-full px-3 py-1 text-xs font-semibold", templateLimitReached ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600"].join(" ")}>
                {limitsStatus.currentTemplates}/{limitsStatus.limits.maxTemplates} templates
              </span>
              <span className={["rounded-full px-3 py-1 text-xs font-semibold", !canCreatePlano ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600"].join(" ")}>
                {limitsStatus.currentPlanosThisMonth}/{limitsStatus.limits.maxPlanosPerMonth} planos/mês
              </span>
            </div>
            <p className="text-xs text-slate-400">Plano {planoLabel}</p>
          </div>
        </div>
      </header>

      {/* Limit alerts — Magis chat bubbles */}
      {templateLimitReached && (
        <div className="flex items-start gap-3">
          {/* Magis avatar */}
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-600 shadow-sm">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          {/* Speech bubble */}
          <div className="relative max-w-2xl">
            {/* Tail outer (border) */}
            <div style={{ position: "absolute", left: -9, top: 10, width: 0, height: 0, borderTop: "8px solid transparent", borderBottom: "8px solid transparent", borderRight: "9px solid #fecaca" }} />
            {/* Tail inner (fill) */}
            <div style={{ position: "absolute", left: -7, top: 11, width: 0, height: 0, borderTop: "7px solid transparent", borderBottom: "7px solid transparent", borderRight: "8px solid #fff1f2" }} />
            <div className="rounded-2xl rounded-tl-none border border-rose-200 bg-rose-50 px-4 py-3.5">
              <div className="mb-1.5 flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-violet-500" />
                <span className="text-xs font-bold text-violet-700">Magis</span>
              </div>
              <p className="text-sm leading-relaxed text-rose-800">
                Você atingiu o limite de <strong>{limitsStatus.limits.maxTemplates} templates</strong> do plano{" "}
                <strong>{planoLabel}</strong>.{" "}
                <Link href="/dashboard/perfil" className="font-semibold underline underline-offset-2 hover:text-rose-900">
                  Atualize seu plano
                </Link>{" "}
                para adicionar mais modelos.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Upload section */}
      <section>
        {templateLimitReached ? (
          <div className="rounded-3xl border border-slate-100 bg-white p-8 shadow-sm">
            <LimitActions avulsoTipo="avulso_template" avulsoLabel="Contratar template avulso" />
          </div>
        ) : (
          <TemplatesWizard userId={user.uid} escolas={escolas} />
        )}
      </section>

      {/* Templates list */}
      <section className="rounded-3xl border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <FileText className="h-4 w-4 text-slate-500" />
            Templates cadastrados
          </h2>
          {templates.length > 0 && (() => {
            const ativos = templates.filter((t) => !t.deletado).length;
            const excluidos = templates.length - ativos;
            return (
              <p className="text-xs text-slate-500">
                {ativos} {ativos === 1 ? "disponível" : "disponíveis"}
                {excluidos > 0 && (
                  <span className="ml-1.5 text-rose-400">· {excluidos} excluído{excluidos > 1 ? "s" : ""}</span>
                )}
              </p>
            );
          })()}
        </div>

        {templates.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">
            Nenhum template encontrado para{" "}
            <span className="font-medium">{user.nome || user.email}</span>. Adicione ao menos um
            modelo para gerar planos.
          </p>
        ) : (
          <TemplatesList templates={templates} canCreatePlano={canCreatePlano} />
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
