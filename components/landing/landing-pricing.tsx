import Link from "next/link";
import { Check, GraduationCap } from "lucide-react";
import { EscolaContactButton } from "../escola-contact-modal";
import { LANDING_PLANS } from "./plan-display";

export function LandingPricing() {
  return (
    <section id="precos" className="bg-slate-50 py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-16 text-center">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-violet-600">Planos</p>
          <h2 className="text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
            Sem surpresas.
            <br />
            Só resultado.
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-lg text-slate-500">
            Comece grátis, sem cartão de crédito. Atualize quando a Magis se tornar indispensável.
          </p>
          <p className="mx-auto mt-3 max-w-md text-sm text-slate-400">
            Preços promocionais de lançamento — pagamento será ativado em breve.
          </p>
        </div>

        <div className="grid items-center gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {LANDING_PLANS.map((plan) => (
            <div
              key={plan.id}
              className={[
                "lift relative flex flex-col rounded-3xl border shadow-sm transition-all",
                plan.featured ? "p-9 shadow-2xl shadow-slate-900/30 lg:-my-4" : "p-7",
                plan.theme === "dark"
                  ? "border-slate-950 bg-slate-950 text-white"
                  : plan.theme === "green"
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-slate-200 bg-white text-slate-900",
              ].join(" ")}
            >
              {plan.badge ? (
                <span
                  className={[
                    "w-fit rounded-full px-3 py-1 text-xs font-semibold",
                    plan.theme === "dark"
                      ? "bg-violet-500 text-white"
                      : plan.theme === "green"
                        ? "bg-white/25 text-white"
                        : "bg-slate-100 text-slate-600",
                  ].join(" ")}
                >
                  {plan.badge}
                </span>
              ) : (
                <span className="h-[26px]" aria-hidden />
              )}

              <h3 className={["mt-4 font-bold", plan.featured ? "text-3xl" : "text-2xl"].join(" ")}>{plan.name}</h3>

              <div className="mt-2 flex items-baseline gap-1">
                <span className={plan.featured ? "text-4xl font-black" : "text-3xl font-black"}>{plan.price}</span>
                <span className={`text-sm ${plan.theme !== "white" ? "text-white/70" : "text-slate-500"}`}>
                  {plan.period}
                </span>
              </div>

              <p className={`mt-3 text-sm leading-6 ${plan.theme !== "white" ? "text-white/75" : "text-slate-600"}`}>
                {plan.desc}
              </p>

              <ul className="mt-5 flex flex-1 flex-col gap-2.5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm">
                    <Check
                      className={[
                        "mt-0.5 h-4 w-4 shrink-0",
                        plan.theme === "dark"
                          ? "text-violet-400"
                          : plan.theme === "green"
                            ? "text-white"
                            : "text-emerald-600",
                      ].join(" ")}
                    />
                    <span className={plan.theme !== "white" ? "text-white/90" : "text-slate-700"}>{feature}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={plan.href}
                className={[
                  "mt-6 block w-full rounded-2xl py-3.5 text-center text-sm font-bold transition",
                  plan.theme === "dark"
                    ? "bg-violet-600 text-white hover:bg-violet-500"
                    : plan.theme === "green"
                      ? "bg-white text-emerald-700 hover:bg-emerald-50"
                      : "bg-slate-950 text-white hover:bg-slate-800",
                ].join(" ")}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>

        <div className="mt-10 overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-violet-950 shadow-2xl shadow-slate-900/40 ring-1 ring-violet-900/40">
          <div className="flex flex-col gap-8 p-8 md:flex-row md:items-center md:gap-12 lg:p-10">
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-white ring-1 ring-white/20">
                  <GraduationCap className="h-9 w-9" />
                </div>
                <div>
                  <p className="text-sm font-bold uppercase tracking-widest text-slate-400">Para instituições</p>
                  <h3 className="text-4xl font-bold text-white">Escola</h3>
                </div>
                <span className="rounded-full bg-violet-500 px-4 py-1.5 text-sm font-bold text-white">
                  Sob consulta
                </span>
              </div>
              <p className="mt-4 max-w-lg text-sm leading-relaxed text-slate-300">
                Para coordenações pedagógicas e redes de ensino que querem a Magis para toda a equipe — implantação
                assistida, suporte dedicado e treinamento incluso.
              </p>
            </div>

            <ul className="grid shrink-0 grid-cols-2 gap-x-8 gap-y-2.5">
              {[
                "Templates ilimitados",
                "Planos ilimitados",
                "Toda a equipe de professores",
                "Suporte dedicado",
                "Treinamento incluso",
                "Implantação assistida",
              ].map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-slate-300">
                  <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  {f}
                </li>
              ))}
            </ul>

            <div className="shrink-0 text-center">
              <EscolaContactButton className="inline-flex items-center gap-2 rounded-2xl bg-white px-7 py-4 text-sm font-bold text-slate-950 transition hover:bg-slate-100">
                Falar com nossa equipe
              </EscolaContactButton>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
