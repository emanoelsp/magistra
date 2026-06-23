import Link from "next/link";
import { ArrowRight, ChevronRight, Sparkles } from "lucide-react";
import { ContactModal } from "./contact-modal";
import { LOGIN_URL, SIGNUP_URL } from "./constants";

export function LandingCta() {
  return (
    <section className="bg-slate-950 py-16">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-600">
          <Sparkles className="h-7 w-7 text-white" />
        </div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-violet-400">
          Magis — Assistente Pedagógica IA
        </p>
        <h2 className="text-4xl font-black tracking-tight text-white sm:text-5xl">
          Seu próximo plano
          <br />
          <span className="magis-accent">em minutos, não horas.</span>
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-lg text-slate-400">
          Junte-se aos professores que já planejam com a Magis — inteligência pedagógica que conhece a BNCC tão bem
          quanto você.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <Link
            href={SIGNUP_URL}
            className="btn-violet inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-8 py-4 text-sm font-bold text-white"
          >
            Começar com a Magis
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href={LOGIN_URL}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 px-8 py-4 text-sm font-bold text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            Já tenho conta
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="mx-auto mt-8 max-w-sm">
          <div className="h-px bg-slate-800" />
        </div>
        <div className="mt-5 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <p className="text-sm font-medium text-slate-300">Ficou curioso? Entre em contato e tire suas dúvidas.</p>
          <ContactModal />
        </div>

        <p className="mt-6 text-xs text-slate-700">
          Sem cartão de crédito. Comece grátis com 1 template ativo e 1 plano por mês.
        </p>
      </div>
    </section>
  );
}
