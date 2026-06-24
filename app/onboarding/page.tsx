"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Check, GraduationCap, Loader2, Sparkles } from "lucide-react";
import { EscolaContactButton } from "../../components/escola-contact-modal";
import { PLANS } from "../../lib/services/plans";

export default function OnboardingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSelectPlan(planId: string) {
    if (loading) return;
    setError(null);
    setLoading(true);

    try {
      // Plano gratuito: ativa diretamente
      if (planId === "free") {
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
        return;
      }

      // Planos pagos: redireciona para o checkout do Mercado Pago
      const res = await fetch("/api/pagamentos/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plano: planId, periodo: "auto" }),
      });
      const data = (await res.json()) as { init_point?: string; error?: string };
      if (!res.ok || !data.init_point) throw new Error(data.error ?? "Erro ao iniciar checkout.");
      window.location.href = data.init_point;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao ativar plano.");
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center bg-slate-50 px-6 py-12">
      {/* Header */}
      <div className="text-center">
        <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-4 py-1.5 text-sm font-semibold text-emerald-700">
          <Sparkles className="h-4 w-4" />
          Bem-vindo ao PlanoMagistra
        </span>
        <h1 className="mt-5 text-4xl font-semibold tracking-tight text-slate-950">
          Escolha seu plano
        </h1>
        <p className="mt-3 max-w-lg text-sm leading-7 text-slate-600">
          Comece gratuitamente com 1 template e 1 plano por mês — sem cartão de crédito.
          Atualize quando quiser.
        </p>
      </div>

      {/* Plan cards */}
      <div className="mt-10 grid w-full max-w-5xl items-center gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {PLANS.map((plan) => (
          <div
            key={plan.id}
            className={[
              "relative flex flex-col rounded-3xl border shadow-sm transition",
              plan.featured ? "p-8 shadow-2xl shadow-slate-900/30 xl:-my-4" : "p-6",
              plan.theme === "dark"  ? "border-slate-950 bg-slate-950 text-white" :
              plan.theme === "green" ? "border-emerald-600 bg-emerald-600 text-white" :
              "border-slate-200 bg-white text-slate-900",
            ].join(" ")}
          >
            {/* Badge */}
            {plan.badge ? (
              <span
                className={[
                  "w-fit rounded-full px-3 py-1 text-xs font-semibold",
                  plan.theme === "dark"  ? "bg-violet-500 text-white" :
                  plan.theme === "green" ? "bg-white/25 text-white" :
                  "bg-slate-100 text-slate-600",
                ].join(" ")}
              >
                {plan.badge}
              </span>
            ) : (
              <span className="h-[26px]" />
            )}

            <h2 className={["mt-4 font-semibold", plan.featured ? "text-3xl" : "text-2xl"].join(" ")}>
              {plan.name}
            </h2>

            <div className="mt-2 flex items-baseline gap-1">
              <span className={plan.featured ? "text-4xl font-bold" : "text-3xl font-bold"}>
                {plan.price}
              </span>
              <span className={`text-sm ${plan.theme !== "white" ? "text-white/70" : "text-slate-500"}`}>
                {plan.period}
              </span>
            </div>

            <p className={`mt-3 text-sm leading-6 ${plan.theme !== "white" ? "text-white/75" : "text-slate-600"}`}>
              {plan.description}
            </p>

            {/* Features */}
            <ul className="mt-5 flex flex-1 flex-col gap-2.5">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm">
                  <Check
                    className={[
                      "mt-0.5 h-4 w-4 shrink-0",
                      plan.theme === "dark"  ? "text-violet-400" :
                      plan.theme === "green" ? "text-white" :
                      "text-emerald-600",
                    ].join(" ")}
                  />
                  <span className={plan.theme !== "white" ? "text-white/90" : "text-slate-700"}>
                    {feature}
                  </span>
                </li>
              ))}
            </ul>

            {/* CTA */}
            <button
              type="button"
              disabled={!plan.available || loading}
              onClick={() => plan.available && void handleSelectPlan(plan.id)}
              className={[
                "mt-6 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold transition",
                plan.theme === "dark"  ? "bg-violet-600 text-white hover:bg-violet-500" :
                plan.theme === "green" ? "bg-white text-emerald-700 hover:bg-emerald-50" :
                "bg-slate-950 text-white hover:bg-slate-800",
                loading ? "opacity-70" : "",
              ].join(" ")}
            >
              {loading && plan.available ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              {plan.cta}
            </button>
          </div>
        ))}
      </div>

      {/* Escola — horizontal card */}
      <div className="mt-8 w-full max-w-5xl overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-violet-950 shadow-2xl shadow-slate-900/40 ring-1 ring-violet-900/40">
        <div className="flex flex-col gap-6 p-7 sm:flex-row sm:items-center sm:gap-10">
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-white ring-1 ring-white/20">
              <GraduationCap className="h-8 w-8" />
            </div>
            <div>
              <p className="text-sm font-bold uppercase tracking-widest text-slate-400">Para instituições</p>
              <h3 className="text-3xl font-bold text-white">Escola</h3>
            </div>
            <span className="rounded-full bg-violet-500 px-4 py-1.5 text-sm font-bold text-white">
              Sob consulta
            </span>
          </div>
          <p className="flex-1 text-sm leading-relaxed text-slate-300">
            Para coordenações pedagógicas e redes de ensino — templates e planos ilimitados, suporte dedicado e treinamento incluso.
          </p>
          <div className="shrink-0 text-center">
            <EscolaContactButton className="rounded-2xl bg-white px-6 py-3.5 text-sm font-bold text-slate-950 transition hover:bg-slate-100">
              Falar com nossa equipe
            </EscolaContactButton>
          </div>
        </div>
      </div>

      {error && (
        <p className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-3 text-sm text-rose-700">
          {error}
        </p>
      )}

      {/* Bottom info */}
      <div className="mt-8 flex items-center gap-3 text-center">
        <BookOpen className="h-4 w-4 shrink-0 text-slate-400" />
        <p className="text-xs text-slate-500">
          O plano Explorador é vinculado ao seu e-mail — cada conta tem direito a um teste gratuito.
          Planos pagos chegarão em breve.
        </p>
      </div>
    </main>
  );
}
