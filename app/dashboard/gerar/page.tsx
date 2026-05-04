import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PlanGenerationWizard } from "../../../components/planos/plan-generation-wizard";
import { requireCurrentUserProfile } from "../../../lib/auth/session";
import { getUserTemplateOptions } from "../../../lib/services/firestore/dashboard.server";

export const dynamic = "force-dynamic";

interface GerarPlanoPageProps {
  searchParams: Promise<{ template?: string }>;
}

export default async function GerarPlanoPage({ searchParams }: GerarPlanoPageProps) {
  const user = await requireCurrentUserProfile();
  const [templates, { template: preSelectedId }] = await Promise.all([
    getUserTemplateOptions(user.uid),
    searchParams,
  ]);

  return (
    <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4">
          <Link
            href="/dashboard"
            className="inline-flex w-fit items-center gap-2 text-sm font-medium text-slate-600 transition hover:text-slate-950"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar ao dashboard
          </Link>

          <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white px-6 py-4 shadow-sm">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-600">Geração assistida</p>
              <h1 className="text-lg font-semibold tracking-tight text-slate-950">Fluxo multi-step de planos</h1>
            </div>
          </div>
        </div>

        {templates.length === 0 ? (
          <section className="rounded-[2rem] border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
            <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Nenhum template disponível</h2>
            <p className="mt-4 text-sm leading-7 text-slate-600">
              Cadastre ao menos um template na coleção `templates` para habilitar a geração orientada por IA.
            </p>
            <Link
              href="/dashboard"
              className="mt-6 inline-flex items-center justify-center rounded-2xl border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
            >
              Voltar para a visão geral
            </Link>
          </section>
        ) : (
          <PlanGenerationWizard
            userId={user.uid}
            userName={user.nome || user.email}
            availableTemplates={templates}
            preSelectedTemplateId={preSelectedId}
          />
        )}
    </div>
  );
}
