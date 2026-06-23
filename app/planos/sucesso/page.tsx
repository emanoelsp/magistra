import Link from "next/link";
import { CheckCircle2, Sparkles } from "lucide-react";
import { PLAN_LABELS } from "../../../lib/services/limits";

interface Props {
  searchParams: Promise<{ plano?: string; tipo?: string; qty?: string }>;
}

export default async function PlanosSucessoPage({ searchParams }: Props) {
  const { plano, tipo, qty: qtyStr } = await searchParams;
  const qty = Math.max(1, parseInt(qtyStr ?? "1", 10) || 1);

  let titulo = "Assinatura confirmada!";
  let mensagem: string;

  if (tipo === "avulso_template") {
    titulo = qty === 1 ? "Template extra ativado!" : `${qty} templates extras ativados!`;
    mensagem = qty === 1
      ? "Seu slot de template extra foi adicionado. Já pode cadastrar um novo template!"
      : `Seus ${qty} slots de template extra foram adicionados. Já pode cadastrar novos templates!`;
  } else if (tipo === "avulso_plano") {
    titulo = qty === 1 ? "Plano extra ativado!" : `${qty} planos extras ativados!`;
    mensagem = qty === 1
      ? "Seu slot de plano extra foi adicionado. Já pode gerar mais um plano este mês!"
      : `Seus ${qty} slots de plano extra foram adicionados. Já pode gerar mais planos este mês!`;
  } else {
    const label = plano ? (PLAN_LABELS[plano] ?? plano) : "novo plano";
    mensagem = `Seu plano ${label} foi ativado. Em alguns instantes você já pode aproveitar todos os recursos.`;
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6">
      <div className="max-w-md w-full rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
          <CheckCircle2 className="h-8 w-8 text-emerald-600" />
        </div>
        <h1 className="mt-5 text-2xl font-bold text-slate-950">{titulo}</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-500">{mensagem}</p>

        {/* Magis note */}
        <div className="mt-5 flex items-start gap-2.5 rounded-2xl border border-violet-100 bg-violet-50 px-4 py-3 text-left">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
          <p className="text-xs leading-relaxed text-violet-700">
            Os novos slots já estão disponíveis no seu dashboard. O acesso é liberado automaticamente após a confirmação do pagamento pelo Mercado Pago.
          </p>
        </div>

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
