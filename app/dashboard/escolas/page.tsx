import Link from "next/link";
import { ArrowLeft, Building2 } from "lucide-react";
import { requireCurrentUserProfile } from "../../../lib/auth/session";
import { getUserEscolas, getUserTurmas } from "../../../lib/services/firestore/escolas.server";
import { getLimitsStatus } from "../../../lib/services/limits";
import { EscolasManager } from "../../../components/escolas/escolas-manager";

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

export default async function EscolasPage() {
  const user = await requireCurrentUserProfile();
  const [escolas, turmas, limitsStatus] = await Promise.all([
    getUserEscolas(user.uid),
    getUserTurmas(user.uid),
    getLimitsStatus(user.uid, user.plano),
  ]);

  const templateLimitReached = !limitsStatus.canCreateTemplate;
  const canCreatePlano = limitsStatus.canCreatePlano;
  const planoLabel = PLAN_LABELS[limitsStatus.plano] ?? limitsStatus.plano;

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
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-amber-100 p-3 text-amber-600">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Minhas Escolas</h1>
              <p className="text-sm text-slate-500">Organize escolas e turmas para agilizar o preenchimento dos seus planos.</p>
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

      <EscolasManager initialEscolas={escolas} initialTurmas={turmas} initialEscolaPadrao={user.escola_padrao} />
    </div>
  );
}
