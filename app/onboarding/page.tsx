"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Check, Loader2, Lock, Sparkles } from "lucide-react";

const PLANS = [
  {
    id: "starter",
    name: "Starter",
    badge: "Grátis no MVP",
    price: "R$ 19,90",
    period: "/ mês",
    description: "Para professores que querem experimentar o PlanoMestre.",
    features: [
      "2 templates ativos",
      "3 planos por mês",
      "Sugestões IA: BNCC, SAEB, CTBC",
      "Editor Word-like com painel IA",
      "Download PDF",
    ],
    available: true,
    cta: "Começar grátis",
    highlight: true,
  },
  {
    id: "pro",
    name: "Pro",
    badge: "Em breve",
    price: "R$ 49,90",
    period: "/ mês",
    description: "Para professores com múltiplas turmas e templates.",
    features: [
      "5 templates ativos",
      "10 planos por mês",
      "Tudo do Starter",
      "Download DOCX",
      "Histórico completo",
    ],
    available: false,
    cta: "Em breve",
    highlight: false,
  },
  {
    id: "escola",
    name: "Escola",
    badge: "Em breve",
    price: "Sob consulta",
    period: "",
    description: "Preço personalizado para sua demanda. Para coordenações e equipes pedagógicas.",
    features: [
      "Templates ilimitados",
      "Planos ilimitados",
      "Toda a equipe de professores",
      "Suporte dedicado",
      "Treinamento incluso",
    ],
    available: false,
    cta: "Falar com vendas",
    highlight: false,
  },
] as const;

export default function OnboardingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSelectPlan(planId: string) {
    if (loading) return;
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/onboarding/plano", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plano: planId }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Falha ao ativar plano.");
      }

      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao ativar plano.");
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6 py-12">
      {/* Header */}
      <div className="text-center">
        <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-4 py-1.5 text-sm font-semibold text-emerald-700">
          <Sparkles className="h-4 w-4" />
          Bem-vindo ao PlanoMestre
        </span>
        <h1 className="mt-5 text-4xl font-semibold tracking-tight text-slate-950">
          Escolha seu plano
        </h1>
        <p className="mt-3 max-w-lg text-sm leading-7 text-slate-600">
          No MVP, o plano Médio está liberado gratuitamente. Basta clicar em{" "}
          <strong>"Começar grátis"</strong> para ativar e começar a usar.
        </p>
      </div>

      {/* Plan cards */}
      <div className="mt-10 grid w-full max-w-4xl gap-6 md:grid-cols-3">
        {PLANS.map((plan) => (
          <div
            key={plan.id}
            className={[
              "relative flex flex-col rounded-3xl border p-6 shadow-sm transition",
              plan.highlight
                ? "border-slate-950 bg-slate-950 text-white"
                : "border-slate-200 bg-white text-slate-900",
            ].join(" ")}
          >
            {/* Badge */}
            <span
              className={[
                "w-fit rounded-full px-3 py-1 text-xs font-semibold",
                plan.highlight ? "bg-emerald-400 text-slate-950" : "bg-slate-100 text-slate-600",
              ].join(" ")}
            >
              {plan.badge}
            </span>

            <h2 className="mt-4 text-2xl font-semibold">{plan.name}</h2>

            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-3xl font-bold">{plan.price}</span>
              {plan.period && (
                <span
                  className={`text-sm ${plan.highlight ? "text-slate-300" : "text-slate-500"}`}
                >
                  {plan.period}
                </span>
              )}
            </div>

            <p
              className={`mt-3 text-sm leading-6 ${plan.highlight ? "text-slate-300" : "text-slate-600"}`}
            >
              {plan.description}
            </p>

            {/* Features */}
            <ul className="mt-5 flex flex-1 flex-col gap-2.5">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm">
                  {plan.available ? (
                    <Check
                      className={`mt-0.5 h-4 w-4 shrink-0 ${plan.highlight ? "text-emerald-400" : "text-emerald-600"}`}
                    />
                  ) : (
                    <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  )}
                  <span className={plan.highlight ? "text-slate-200" : "text-slate-700"}>
                    {feature}
                  </span>
                </li>
              ))}
            </ul>

            {/* CTA */}
            <button
              type="button"
              disabled={!plan.available || loading}
              onClick={() => void handleSelectPlan(plan.id)}
              className={[
                "mt-6 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold transition",
                plan.available && plan.highlight
                  ? "bg-white text-slate-950 hover:bg-slate-100"
                  : plan.available
                    ? "bg-slate-950 text-white hover:bg-slate-800"
                    : "cursor-not-allowed bg-slate-100 text-slate-400",
                (loading) ? "opacity-70" : "",
              ].join(" ")}
            >
              {loading && plan.available && plan.highlight ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              {plan.cta}
            </button>
          </div>
        ))}
      </div>

      {error && (
        <p className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-3 text-sm text-rose-700">
          {error}
        </p>
      )}

      {/* Bottom info */}
      <div className="mt-10 flex items-center gap-3 text-center">
        <BookOpen className="h-4 w-4 shrink-0 text-slate-400" />
        <p className="text-xs text-slate-500">
          Nenhum cartão de crédito necessário no MVP. O plano Starter está gratuito para testar o
          core — 2 templates e 3 planos por mês são suficientes para validar o fluxo completo.
        </p>
      </div>
    </main>
  );
}
