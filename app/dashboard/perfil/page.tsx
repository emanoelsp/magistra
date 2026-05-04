import Link from "next/link";
import { ArrowLeft, User2 } from "lucide-react";

import { requireCurrentUserProfile } from "../../../lib/auth/session";

export const dynamic = "force-dynamic";

export default async function PerfilPage() {
  const user = await requireCurrentUserProfile();

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-2 text-sm font-medium text-slate-600 transition hover:text-slate-950"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar ao dashboard
        </Link>
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-slate-100 p-3 text-slate-600">
            <User2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Perfil e assinatura</h1>
            <p className="text-sm text-slate-600">Gerencie seus dados e plano de assinatura.</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-950">Dados pessoais</h2>
          <dl className="mt-4 space-y-3">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">Nome</dt>
              <dd className="mt-1 text-sm text-slate-900">{user.nome || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">E-mail</dt>
              <dd className="mt-1 text-sm text-slate-900">{user.email}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">Escola padrão</dt>
              <dd className="mt-1 text-sm text-slate-900">{user.escola_padrao || "—"}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-slate-500">
            A edição de dados será disponibilizada em breve.
          </p>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-950">Assinatura</h2>
          <dl className="mt-4 space-y-3">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">Plano atual</dt>
              <dd className="mt-1 text-sm font-medium text-slate-900 capitalize">{user.plano}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">Tokens usados no mês</dt>
              <dd className="mt-1 text-sm text-slate-900">{user.tokens_usados_mes}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-slate-500">
            A integração com Mercado Pago será disponibilizada em breve.
          </p>
        </div>
      </div>
    </div>
  );
}
