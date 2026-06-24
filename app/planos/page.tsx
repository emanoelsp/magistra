import Link from "next/link";
import { Star } from "lucide-react";
import { getCurrentUserProfile } from "../../lib/auth/session";
import { PLANS } from "../../lib/services/plans";
import { CheckoutButton } from "./checkout-button";
import { PlanFeaturesToggle } from "./plan-features-toggle";

export const dynamic = "force-dynamic";

const themeToBorder: Record<string, string> = {
  green: "border-emerald-300",
  dark:  "border-violet-300",
  white: "border-slate-200",
};

export default async function PlanosPage() {
  const user = await getCurrentUserProfile();
  const loggedIn = !!user;
  const planoAtual = user?.plano?.toLowerCase() ?? null;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-6 py-10">
        {/* Header */}
        <div className="mb-4 text-center">
          <Link href="/" className="text-xs font-semibold uppercase tracking-widest text-violet-600 hover:underline">
            ← PlanoMagistra
          </Link>
        </div>
        <h1 className="text-center text-4xl font-bold tracking-tight text-slate-950">
          Escolha seu plano
        </h1>
        <p className="mt-3 text-center text-lg text-slate-500">
          Comece grátis. Faça upgrade quando quiser.
        </p>

        {/* Cards */}
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((p) => {
            const isAtual = planoAtual === p.id;
            const isPago = p.id !== "free";
            const borderCls = themeToBorder[p.theme] ?? "border-slate-200";
            return (
              <div
                key={p.id}
                className={`relative flex flex-col rounded-3xl border-2 bg-white p-6 shadow-sm transition ${borderCls} ${p.featured ? "ring-2 ring-violet-500 ring-offset-2" : ""}`}
              >
                {p.badge ? (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="flex items-center gap-1 rounded-full bg-violet-600 px-3 py-0.5 text-xs font-bold text-white">
                      <Star className="h-3 w-3" /> {p.badge}
                    </span>
                  </div>
                ) : null}

                <div className="flex-1">
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400">{p.name}</p>
                  <p className="mt-1 text-2xl font-bold text-slate-950">
                    {p.id === "free" ? "Grátis" : `${p.price}${p.period}`}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">{p.description}</p>

                  <PlanFeaturesToggle features={p.features} />
                </div>

                <div className="mt-6">
                  {isAtual ? (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 py-2.5 text-center text-sm font-semibold text-emerald-700">
                      Plano atual
                    </div>
                  ) : p.id === "free" ? (
                    <Link
                      href={loggedIn ? "/dashboard" : "/login"}
                      className="flex w-full items-center justify-center rounded-2xl border border-slate-300 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-950"
                    >
                      {loggedIn ? "Ir ao dashboard" : "Começar grátis"}
                    </Link>
                  ) : isPago ? (
                    <CheckoutButton
                      plano={p.id}
                      label={loggedIn ? "Assinar agora" : "Criar conta e assinar"}
                      loggedIn={loggedIn}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {/* Escola */}
        <div className="mt-8 rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-lg font-bold text-slate-950">Escola ou rede de ensino?</p>
          <p className="mt-2 text-slate-500">
            Templates ilimitados, planos ilimitados, downloads ilimitados e suporte dedicado.
            Fale conosco para um plano personalizado.
          </p>
          <a
            href="mailto:contato@planomagistra.com.br"
            className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            Solicitar proposta
          </a>
        </div>

        {/* Pagamento seguro */}
        <p className="mt-8 text-center text-xs text-slate-400">
          Pagamentos processados com segurança pelo Mercado Pago · Cancele quando quiser
        </p>
      </div>
    </div>
  );
}
