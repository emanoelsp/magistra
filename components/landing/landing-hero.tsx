import Link from "next/link";
import { ArrowRight, MapPin, Sparkles } from "lucide-react";
import { EditorMockup } from "./editor-mockup";
import { SIGNUP_URL } from "./constants";

export function LandingHero() {
  return (
    <section id="inicio" className="grid-texture hero-glow relative overflow-hidden">
      <div className="mx-auto max-w-7xl px-6 pb-20 pt-24 md:pt-28">
        <div className="grid gap-16 lg:grid-cols-[1fr,400px] lg:items-center">
          <div>
            <div className="anim-up tag-magis mb-7 inline-flex items-center gap-2 rounded-full px-4 py-2">
              <Sparkles className="h-3.5 w-3.5 text-violet-600" />
              <span className="text-[11px] font-bold uppercase tracking-widest text-violet-700">
                Magis — Assistente Pedagógica IA
              </span>
            </div>

            <div className="anim-up d-1">
              <h1
                className="leading-[.88] font-black tracking-tight text-slate-950"
                style={{ fontSize: "clamp(64px, 11vw, 112px)" }}
              >
                PLANO
                <br />
                <span className="wordmark-accent">MAGISTRA</span>
              </h1>
            </div>

            <div className="anim-up d-2 my-7 flex items-center gap-5">
              <div className="ring-pulse flex h-[84px] w-[84px] flex-shrink-0 flex-col items-center justify-center rounded-full bg-violet-600 text-white shadow-lg shadow-violet-200">
                <span className="text-3xl font-black leading-none">70%</span>
                <span className="mt-0.5 text-center text-[9px] font-bold uppercase leading-tight tracking-wider">
                  menos
                  <br />
                  tempo
                </span>
              </div>
              <div>
                <p className="text-xl font-black text-slate-950">70% menos burocracia</p>
                <p className="text-sm text-slate-500">Em minutos, não horas. Todo bimestre.</p>
              </div>
            </div>

            <p className="anim-up d-3 max-w-xl text-lg leading-relaxed text-slate-600">
              Suba o template da sua escola e a <strong className="text-slate-900">Magis</strong> — nossa assistente
              pedagógica — aprende a estrutura e sugere conteúdos campo a campo: BNCC, SAEB e currículos regionais
              alinhados a cada território.
            </p>

            <p className="anim-up d-4 mt-4 flex max-w-xl items-center gap-2 text-sm font-semibold text-violet-700">
              <MapPin className="h-4 w-4 shrink-0" aria-hidden />
              Currículos de todos os 27 estados brasileiros
            </p>

            <div className="anim-up d-4 mt-8 flex flex-wrap gap-3">
              <Link
                href={SIGNUP_URL}
                className="btn-dark inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-6 py-3.5 text-sm font-bold text-white"
              >
                Começar com a Magis
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#magis"
                className="btn-ghost inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-6 py-3.5 text-sm font-bold text-slate-700"
              >
                Quem é a Magis?
              </a>
            </div>

            <div className="anim-up d-5 mt-9 inline-flex items-center gap-4 rounded-2xl bg-violet-600 px-6 py-4 shadow-lg shadow-violet-300/50">
              <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-white/20">
                <ClockIcon />
              </div>
              <div>
                <p className="text-sm font-bold text-white">Seu plano de aula em minutos, não horas</p>
                <p className="text-xs text-violet-200">Do template em branco ao PDF pronto em minutos.</p>
              </div>
            </div>
          </div>

          <div className="float hidden lg:block">
            <EditorMockup variant="compact" />
          </div>
        </div>

        <div className="anim-up d-5 mt-12 lg:hidden">
          <EditorMockup variant="compact" />
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-white to-transparent" />
    </section>
  );
}

function ClockIcon() {
  return (
    <>
      <span className="text-2xl font-black leading-none text-white">⚡</span>
      <span className="text-[9px] font-bold uppercase tracking-widest text-violet-200">rápido</span>
    </>
  );
}
