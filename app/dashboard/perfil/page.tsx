import Link from "next/link";
import { ArrowLeft, BookCopy, CreditCard, FolderKanban, User2 } from "lucide-react";

import { requireCurrentUserProfile } from "../../../lib/auth/session";
import { getDashboardStats } from "../../../lib/services/firestore/dashboard.server";
import { getLimitsStatus } from "../../../lib/services/limits";
import { PerfilForm } from "./perfil-form";

export const dynamic = "force-dynamic";

const PLAN_INFO: Record<string, { label: string; color: string; gradient: string }> = {
  free:     { label: "Explorador", color: "bg-emerald-100 text-emerald-700", gradient: "from-emerald-600 to-emerald-800" },
  starter:  { label: "Educador",   color: "bg-blue-100 text-blue-700",       gradient: "from-blue-600 to-blue-800"       },
  medio:    { label: "Mestre",     color: "bg-violet-100 text-violet-700",    gradient: "from-violet-600 to-violet-800"   },
  pro:      { label: "Regente",    color: "bg-amber-100 text-amber-700",      gradient: "from-amber-500 to-amber-700"     },
  avancado: { label: "Regente",    color: "bg-amber-100 text-amber-700",      gradient: "from-amber-500 to-amber-700"     },
  premium:  { label: "Regente",    color: "bg-amber-100 text-amber-700",      gradient: "from-amber-500 to-amber-700"     },
  escola:   { label: "Escola",     color: "bg-slate-100 text-slate-700",      gradient: "from-slate-700 to-slate-900"     },
};

function proximoMes(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1, 1);
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric" }).format(d);
}

export default async function PerfilPage() {
  const user = await requireCurrentUserProfile();
  const [stats, limits] = await Promise.all([
    getDashboardStats(user),
    getLimitsStatus(user.uid, user.plano),
  ]);
  const renovaEm = proximoMes();

  const planoKey = user.plano?.toLowerCase() ?? "free";
  const plano = PLAN_INFO[planoKey] ?? {
    label: stats.planoAtual,
    color: "bg-slate-100 text-slate-700",
    gradient: "from-slate-700 to-slate-900",
  };

  const maxTemplates = limits.limits.maxTemplates >= 999 ? "∞" : String(limits.limits.maxTemplates);
  const maxPlanos    = limits.limits.maxPlanosPerMonth >= 999 ? "∞" : String(limits.limits.maxPlanosPerMonth);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-2 text-sm font-medium text-slate-600 transition hover:text-slate-950"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar ao dashboard
        </Link>
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-rose-100 p-3 text-rose-600">
            <User2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
              Perfil e assinatura
            </h1>
            <p className="text-sm text-slate-500">Gerencie seus dados e plano de assinatura.</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_440px]">
        {/* Formulário editável */}
        <PerfilForm
          nome={user.nome}
          email={user.email}
          escolaPadrao={user.escola_padrao}
        />

        {/* Coluna direita: métricas + assinatura */}
        <div className="flex flex-col gap-6">

          {/* Card de métricas de uso */}
          <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
            <h2 className="text-lg font-semibold tracking-tight text-slate-950">Seu uso</h2>

            {/* Templates */}
            <div className="mt-5 space-y-4">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FolderKanban className="h-4 w-4 text-amber-500" />
                    <span className="text-sm font-medium text-slate-700">Templates</span>
                  </div>
                  <span className="text-sm font-bold text-slate-950">
                    {limits.currentTemplates}
                    <span className="font-normal text-slate-400"> / {maxTemplates}</span>
                  </span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-amber-400 transition-all"
                    style={{
                      width: limits.limits.maxTemplates >= 999
                        ? "100%"
                        : `${Math.min(100, (limits.currentTemplates / limits.limits.maxTemplates) * 100)}%`,
                    }}
                  />
                </div>
              </div>

              {/* Planos este mês */}
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <BookCopy className="h-4 w-4 text-violet-500" />
                    <span className="text-sm font-medium text-slate-700">Planos este mês</span>
                  </div>
                  <span className="text-sm font-bold text-slate-950">
                    {limits.currentPlanosThisMonth}
                    <span className="font-normal text-slate-400"> / {maxPlanos}</span>
                  </span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-violet-500 transition-all"
                    style={{
                      width: limits.limits.maxPlanosPerMonth >= 999
                        ? "100%"
                        : `${Math.min(100, (limits.currentPlanosThisMonth / limits.limits.maxPlanosPerMonth) * 100)}%`,
                    }}
                  />
                </div>
              </div>

              {/* Total de planos */}
              <div className="flex items-center justify-between rounded-2xl bg-emerald-50 px-4 py-3">
                <div className="flex items-center gap-2">
                  <BookCopy className="h-4 w-4 text-emerald-500" />
                  <span className="text-sm font-medium text-slate-700">Total de planos gerados</span>
                </div>
                <span className="text-sm font-bold text-slate-950">{stats.totalPlanos}</span>
              </div>
            </div>

            <p className="mt-4 text-xs text-slate-400">
              Limite mensal renova em{" "}
              <span className="font-medium text-slate-600">{renovaEm}</span>
            </p>
          </div>

          {/* Card de assinatura */}
          <div className={`rounded-3xl bg-gradient-to-br ${plano.gradient} p-7 shadow-sm`}>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/60">
                Assinatura ativa
              </p>
              <CreditCard className="h-4 w-4 text-white/50" />
            </div>

            <p className="mt-2 text-2xl font-bold text-white">{plano.label}</p>
            <p className="mt-0.5 text-sm text-white/70">
              {maxTemplates === "∞" ? "Templates ilimitados" : `Até ${maxTemplates} template${limits.limits.maxTemplates > 1 ? "s" : ""}`}
              {" · "}
              {maxPlanos === "∞" ? "Planos ilimitados" : `${maxPlanos} planos/mês`}
            </p>

            <button
              disabled
              title="Em breve"
              className="mt-6 w-full cursor-not-allowed rounded-2xl border border-white/20 bg-white/10 py-3 text-sm font-semibold text-white/50 backdrop-blur-sm"
            >
              Alterar plano — em breve
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
