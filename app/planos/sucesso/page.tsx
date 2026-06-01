import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { PLAN_LABELS } from "../../../lib/services/limits";

interface Props {
  searchParams: Promise<{ plano?: string }>;
}

export default async function PlanosSucessoPage({ searchParams }: Props) {
  const { plano } = await searchParams;
  const label = plano ? (PLAN_LABELS[plano] ?? plano) : "novo plano";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6">
      <div className="max-w-md w-full rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
          <CheckCircle2 className="h-8 w-8 text-emerald-600" />
        </div>
        <h1 className="mt-5 text-2xl font-bold text-slate-950">Assinatura confirmada!</h1>
        <p className="mt-3 text-slate-500">
          Seu plano <strong>{label}</strong> foi ativado. Em alguns instantes você já pode aproveitar todos os recursos.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex w-full items-center justify-center rounded-2xl bg-slate-950 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          Ir ao dashboard
        </Link>
        <Link href="/planos" className="mt-3 block text-xs text-slate-400 hover:underline">
          Ver detalhes do plano
        </Link>
      </div>
    </div>
  );
}
