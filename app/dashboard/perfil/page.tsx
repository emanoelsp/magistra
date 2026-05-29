import Link from "next/link";
import { ArrowLeft, BookCopy, CreditCard, FolderKanban, User2 } from "lucide-react";

import { requireCurrentUserProfile } from "../../../lib/auth/session";
import { getDashboardStats } from "../../../lib/services/firestore/dashboard.server";
import { PerfilForm } from "./perfil-form";

export const dynamic = "force-dynamic";

const PLAN_INFO: Record<string, { label: string; description: string; color: string }> = {
  free:     { label: "Explorador", description: "1 template por mês · 1 plano por mês",    color: "bg-emerald-100 text-emerald-700" },
  starter:  { label: "Educador",   description: "1 template ativo · 2 planos por mês",      color: "bg-blue-100 text-blue-700"     },
  medio:    { label: "Mestre",     description: "2 templates ativos · 4 planos por mês",    color: "bg-violet-100 text-violet-700"  },
  pro:      { label: "Regente",    description: "5 templates ativos · 10 planos por mês",   color: "bg-amber-100 text-amber-700"   },
  escola:   { label: "Escola",     description: "Templates ilimitados · Planos ilimitados", color: "bg-slate-100 text-slate-700"   },
  avancado: { label: "Regente",    description: "5 templates ativos · 10 planos por mês",   color: "bg-amber-100 text-amber-700"   },
  premium:  { label: "Regente",    description: "5 templates ativos · 10 planos por mês",   color: "bg-amber-100 text-amber-700"   },
};

function proximoMes(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1, 1);
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric" }).format(d);
}

export default async function PerfilPage() {
  const user = await requireCurrentUserProfile();
  const stats = await getDashboardStats(user);
  const renovaEm = proximoMes();

  const planoKey = user.plano?.toLowerCase() ?? "free";
  const plano = PLAN_INFO[planoKey] ?? {
    label: stats.planoAtual,
    description: "Plano ativo",
    color: "bg-slate-100 text-slate-700",
  };

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
            <div className="mt-5 grid grid-cols-3 gap-4">
              <div className="rounded-2xl bg-amber-50 p-5 text-center">
                <span className="flex justify-center text-amber-500">
                  <FolderKanban className="h-6 w-6" />
                </span>
                <p className="mt-3 text-3xl font-bold text-slate-950">{stats.totalTemplates}</p>
                <p className="mt-1 text-xs font-medium text-amber-700">
                  {stats.totalTemplates === 1 ? "template" : "templates"}
                </p>
              </div>
              <div className="rounded-2xl bg-violet-50 p-5 text-center">
                <span className="flex justify-center text-violet-500">
                  <BookCopy className="h-6 w-6" />
                </span>
                <p className="mt-3 text-3xl font-bold text-slate-950">{stats.planosGeradosMes}</p>
                <p className="mt-1 text-xs font-medium text-violet-700">este mês</p>
              </div>
              <div className="rounded-2xl bg-emerald-50 p-5 text-center">
                <span className="flex justify-center text-emerald-500">
                  <BookCopy className="h-6 w-6" />
                </span>
                <p className="mt-3 text-3xl font-bold text-slate-950">{stats.totalPlanos}</p>
                <p className="mt-1 text-xs font-medium text-emerald-700">
                  {stats.totalPlanos === 1 ? "plano total" : "planos total"}
                </p>
              </div>
            </div>
            <p className="mt-4 text-center text-xs text-slate-400">
              Renova em <span className="font-medium text-slate-600">{renovaEm}</span>
            </p>
          </div>

          {/* Card de assinatura — inteiramente roxo */}
          <div className="rounded-3xl bg-gradient-to-br from-violet-600 to-violet-800 p-7 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-violet-200">
                Assinatura ativa
              </p>
              <CreditCard className="h-4 w-4 text-violet-300" />
            </div>

            <p className="mt-2 text-2xl font-bold text-white">{plano.label}</p>
            <p className="mt-0.5 text-sm text-violet-200">{plano.description}</p>

            <button
              disabled
              title="Em breve"
              className="mt-6 w-full cursor-not-allowed rounded-2xl border border-white/20 bg-white/10 py-3 text-sm font-semibold text-white/60 backdrop-blur-sm"
            >
              Alterar plano — em breve
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
