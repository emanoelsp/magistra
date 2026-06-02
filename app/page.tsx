import Link from "next/link";
import MagisWidget from "../components/magis-widget";
import { EscolaContactButton } from "../components/escola-contact-modal";
import { ContactModal } from "../components/landing/contact-modal";
import { StickyCta } from "../components/landing/sticky-cta";
import { TermsLink } from "../components/landing/terms-modal";
import {
  ArrowRight,
  BookCheck,
  Brain,
  ChevronRight,
  Check,
  Clock,
  FileDown,
  FileText,
  GraduationCap,
  Heart,
  Lock,
  MessageCircle,
  Shield,
  Sparkles,
  Star,
  Upload,
  Zap,
} from "lucide-react";

export default function HomePage() {
  return (
    <>
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(28px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes floatY {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-10px); }
        }
        @keyframes pulseRing {
          0%, 100% { box-shadow: 0 0 0 0   rgba(124,58,237,.45); }
          60%       { box-shadow: 0 0 0 14px rgba(124,58,237,0); }
        }
        @keyframes magisFloat {
          0%, 100% { transform: translateY(0px) rotate(-1deg); }
          50%       { transform: translateY(-8px) rotate(1deg); }
        }
        @keyframes typingDot {
          0%, 80%, 100% { transform: scale(0.6); opacity: .4; }
          40%            { transform: scale(1);   opacity: 1; }
        }

        .anim-up   { animation: fadeUp .7s ease both; }
        .d-1 { animation-delay: .10s; }
        .d-2 { animation-delay: .20s; }
        .d-3 { animation-delay: .32s; }
        .d-4 { animation-delay: .44s; }
        .d-5 { animation-delay: .56s; }

        .float { animation: floatY 5s ease-in-out infinite; }
        .magis-float { animation: magisFloat 6s ease-in-out infinite; }

        .ring-pulse { animation: pulseRing 2.8s ease-in-out infinite; }

        .dot-1 { animation: typingDot 1.4s infinite .0s; }
        .dot-2 { animation: typingDot 1.4s infinite .2s; }
        .dot-3 { animation: typingDot 1.4s infinite .4s; }

        /* Grid texture */
        .grid-texture {
          background-image:
            linear-gradient(rgba(148,163,184,.10) 1px, transparent 1px),
            linear-gradient(90deg, rgba(148,163,184,.10) 1px, transparent 1px);
          background-size: 44px 44px;
        }

        /* Violet radial glow */
        .hero-glow {
          background:
            radial-gradient(ellipse 90% 55% at 55% -10%, rgba(124,58,237,.10) 0%, transparent 65%),
            radial-gradient(ellipse 55% 35% at 80% 85%, rgba(16,185,129,.07) 0%, transparent 55%);
        }

        /* Magis glow */
        .magis-glow {
          background:
            radial-gradient(ellipse 80% 60% at 50% 0%, rgba(124,58,237,.12) 0%, transparent 70%),
            radial-gradient(ellipse 60% 40% at 20% 100%, rgba(16,185,129,.08) 0%, transparent 60%);
        }

        /* Wordmark gradient */
        .wordmark-accent {
          background: linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .magis-accent {
          background: linear-gradient(135deg, #7c3aed 0%, #c4b5fd 60%, #34d399 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        /* Sticky nav blur */
        .nav-glass {
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          background: rgba(255,255,255,.88);
        }

        /* Card lift */
        .lift {
          transition: transform .2s ease, box-shadow .2s ease, border-color .2s ease;
        }
        .lift:hover {
          transform: translateY(-4px);
          box-shadow: 0 16px 48px rgba(0,0,0,.08);
          border-color: #cbd5e1;
        }

        /* Icon rotate on card hover */
        .icon-wrap {
          transition: transform .22s ease;
        }
        .lift:hover .icon-wrap {
          transform: scale(1.12) rotate(-4deg);
        }

        /* Buttons */
        .btn-dark {
          transition: transform .15s ease, background-color .15s ease, box-shadow .15s ease;
        }
        .btn-dark:hover {
          transform: translateY(-2px);
          background-color: #1e293b;
          box-shadow: 0 8px 28px rgba(15,23,42,.28);
        }
        .btn-violet {
          transition: transform .15s ease, background-color .15s ease, box-shadow .15s ease;
        }
        .btn-violet:hover {
          transform: translateY(-2px);
          background-color: #7c3aed;
          box-shadow: 0 8px 28px rgba(124,58,237,.35);
        }
        .btn-ghost {
          transition: border-color .15s ease, color .15s ease, background-color .15s ease;
        }
        .btn-ghost:hover {
          border-color: #94a3b8;
          background-color: #f8fafc;
        }

        /* Step connector line */
        .step-line {
          background: linear-gradient(180deg, #e2e8f0 0%, #c4b5fd 50%, #a7f3d0 100%);
        }

        /* Feature tag */
        .tag-ia {
          background: linear-gradient(135deg, rgba(124,58,237,.15) 0%, rgba(124,58,237,.07) 100%);
          border: 1px solid rgba(124,58,237,.22);
        }
        .tag-magis {
          background: linear-gradient(135deg, rgba(124,58,237,.18) 0%, rgba(167,139,250,.12) 100%);
          border: 1px solid rgba(124,58,237,.30);
        }

        /* Magis chat bubble */
        .magis-bubble {
          background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%);
        }
        .magis-card {
          background: linear-gradient(155deg, #0f172a 0%, #1e1b4b 100%);
          border: 1px solid rgba(124,58,237,.35);
        }
      `}</style>

      <div className="min-h-screen bg-white font-sans">

        {/* ── NAV ─────────────────────────────────────────────────── */}
        <nav className="nav-glass fixed inset-x-0 top-0 z-50 border-b border-slate-100">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6">
            <img src="/images/logo.png" alt="PlanoMagistra" className="max-h-28 w-auto" />
            <div className="hidden items-center gap-8 text-sm font-medium text-slate-500 md:flex">
              <a href="#magis"         className="transition hover:text-slate-950">Conheça a Magis</a>
              <a href="#como-funciona" className="transition hover:text-slate-950">Como funciona</a>
              <a href="#recursos"      className="transition hover:text-slate-950">Recursos</a>
              <a href="#precos"        className="transition hover:text-slate-950">Preços</a>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/login" className="text-sm font-medium text-slate-500 transition hover:text-slate-950">
                Entrar
              </Link>
              <Link
                href="/login"
                className="btn-dark rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white"
              >
                Começar grátis
              </Link>
            </div>
          </div>
        </nav>

        {/* ── HERO ────────────────────────────────────────────────── */}
        <section className="grid-texture hero-glow relative overflow-hidden pt-10">
          <div className="mx-auto max-w-7xl px-6 pb-20 pt-24 sm:pt-32">
            <div className="grid gap-16 lg:grid-cols-[1fr,400px] lg:items-center">

              {/* LEFT */}
              <div>
                {/* Pill badge */}
                <div className="anim-up tag-magis mb-7 inline-flex items-center gap-2 rounded-full px-4 py-2">
                  <Sparkles className="h-3.5 w-3.5 text-violet-600" />
                  <span className="text-[11px] font-bold uppercase tracking-widest text-violet-700">
                    Magis — Assistente Pedagógica IA
                  </span>
                </div>

                {/* Wordmark hero */}
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

                {/* 70% stamp + label */}
                <div className="anim-up d-2 my-7 flex items-center gap-5">
                  <div className="ring-pulse flex h-[84px] w-[84px] flex-shrink-0 flex-col items-center justify-center rounded-full bg-violet-600 text-white shadow-lg shadow-violet-200">
                    <span className="text-3xl font-black leading-none">70%</span>
                    <span className="mt-0.5 text-center text-[9px] font-bold uppercase leading-tight tracking-wider">
                      menos<br />tempo
                    </span>
                  </div>
                  <div>
                    <p className="text-xl font-black text-slate-950">
                      70% menos burocracia
                    </p>
                    <p className="text-sm text-slate-500">
                      De horas a minutos. Todo bimestre.
                    </p>
                  </div>
                </div>

                <p className="anim-up d-3 max-w-xl text-lg leading-relaxed text-slate-600">
                  Suba o template da sua escola e a <strong className="text-slate-900">Magis</strong> — nossa assistente pedagógica — aprende a estrutura e sugere conteúdos campo a campo: BNCC, SAEB e currículos regionais alinhados a cada território.
                </p>

                {/* Chips dos 27 estados */}
                <div className="anim-up d-35 mt-4 flex max-w-xl flex-wrap gap-1.5">
                  {["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"].map((uf) => (
                    <span
                      key={uf}
                      className="rounded-lg bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-600 ring-1 ring-violet-200"
                    >
                      {uf}
                    </span>
                  ))}
                </div>

                <div className="anim-up d-4 mt-8 flex flex-wrap gap-3">
                  <Link
                    href="/login"
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

                {/* CTA tempo */}
                <div className="anim-up d-5 mt-9 inline-flex items-center gap-4 rounded-2xl bg-violet-600 px-6 py-4 shadow-lg shadow-violet-300/50">
                  <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-white/20">
                    <span className="text-2xl font-black leading-none text-white">5</span>
                    <span className="text-[9px] font-bold uppercase tracking-widest text-violet-200">min</span>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">Seu plano de aula em menos de 5 minutos</p>
                    <p className="text-xs text-violet-200">Do template em branco ao Word preenchido. Todo bimestre.</p>
                  </div>
                </div>
              </div>

              {/* RIGHT — editor passo a passo mockup */}
              <div className="float hidden lg:block">
                <div className="overflow-hidden rounded-3xl shadow-2xl shadow-slate-300/60 ring-1 ring-slate-200">
                  {/* Browser chrome */}
                  <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-100 px-4 py-3">
                    <div className="h-3 w-3 rounded-full bg-rose-400" />
                    <div className="h-3 w-3 rounded-full bg-amber-400" />
                    <div className="h-3 w-3 rounded-full bg-emerald-400" />
                    <div className="ml-3 flex-1 rounded-md border border-slate-200 bg-white px-3 py-1 font-mono text-[10px] text-slate-400">
                      planomagistra.com.br/dashboard/editor
                    </div>
                  </div>

                  {/* Toolbar */}
                  <div className="flex items-center justify-between border-b border-slate-100 bg-white px-4 py-2.5">
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Plano de Aula</p>
                      <p className="text-xs font-semibold text-slate-800">9º Ano B — Matemática</p>
                    </div>
                    <div className="flex gap-2">
                      <span className="rounded-xl border border-slate-200 px-2.5 py-1.5 text-[10px] font-medium text-slate-600">Salvar</span>
                      <span className="rounded-xl bg-emerald-600 px-2.5 py-1.5 text-[10px] font-bold text-white">↓ Baixar DOCX</span>
                    </div>
                  </div>

                  {/* Split-view */}
                  <div className="grid grid-cols-[1fr,1fr] divide-x divide-slate-100 bg-white">

                    {/* Left — form fields */}
                    <div className="space-y-2 p-4">
                      <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-slate-400">Campos do template</p>
                      {[
                        { label: "Turma",      val: "9º Ano B"          },
                        { label: "Disciplina", val: "Matemática"         },
                        { label: "Bimestre",   val: "2º Bimestre / 2026" },
                        { label: "Conteúdo",   val: "Equações do 2º grau"},
                      ].map((f) => (
                        <div key={f.label} className="rounded-xl bg-slate-50 p-2.5">
                          <p className="mb-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">{f.label}</p>
                          <p className="text-xs font-medium text-slate-700">{f.val}</p>
                        </div>
                      ))}

                      {/* Active AI field */}
                      <div className="rounded-xl border-2 border-violet-300 bg-violet-50 p-2.5 ring-2 ring-violet-100/60">
                        <div className="mb-1 flex items-center gap-1">
                          <Sparkles className="h-3 w-3 text-violet-500" />
                          <p className="text-[9px] font-bold uppercase tracking-wider text-violet-600">Habilidade BNCC · IA ativa</p>
                        </div>
                        <p className="text-[11px] leading-relaxed text-slate-700">
                          EF09MA06 — Resolver e elaborar problemas...
                        </p>
                        <div className="mt-2 flex gap-1.5">
                          <span className="rounded-lg bg-violet-600 px-2.5 py-1 text-[10px] font-bold text-white">Inserir</span>
                          <span className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-500">Reescrever</span>
                        </div>
                      </div>
                    </div>

                    {/* Right — Magis panel */}
                    <div className="flex flex-col gap-2.5 bg-slate-950 p-4">
                      <div className="mb-1 flex items-center gap-2">
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-600">
                          <Sparkles className="h-3 w-3 text-white" />
                        </div>
                        <span className="text-[9px] font-bold uppercase tracking-widest text-violet-400">Magis sugere</span>
                      </div>

                      <div className="rounded-xl border border-violet-500/40 bg-violet-900/30 p-2.5">
                        <p className="text-[10px] leading-relaxed text-slate-200">EF09MA06 alinhada ao SAEB T5</p>
                      </div>
                      {[
                        "Competência 3 — Argumentação matemática",
                        "Obj.: compreender a fórmula de Báskara",
                        "Currículo regional: sequência recomendada",
                      ].map((s, i) => (
                        <div key={i} className="rounded-xl border border-slate-700 bg-slate-800 p-2.5">
                          <p className="text-[10px] leading-relaxed text-slate-300">{s}</p>
                        </div>
                      ))}

                      <div className="flex items-center gap-1.5 px-1 py-1">
                        <span className="dot-1 h-1.5 w-1.5 rounded-full bg-violet-400" />
                        <span className="dot-2 h-1.5 w-1.5 rounded-full bg-violet-400" />
                        <span className="dot-3 h-1.5 w-1.5 rounded-full bg-violet-400" />
                        <span className="ml-1 text-[9px] text-slate-500">Magis está gerando…</span>
                      </div>

                      <div className="mt-auto rounded-xl bg-emerald-600/90 p-2.5 text-center">
                        <p className="text-[10px] font-bold text-white">✓ 6 / 8 campos preenchidos</p>
                        <p className="mt-0.5 text-[9px] text-emerald-200">Pronto para baixar em DOCX</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Fade to white */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-white to-transparent" />
        </section>

        {/* ── STATS STRIP ─────────────────────────────────────────── */}
        <section className="bg-slate-950 py-7">
          <div className="mx-auto max-w-7xl px-6">
            <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
              {[
                { n: "70%",    label: "menos tempo de planejamento",  color: "text-violet-400"  },
                { n: "2.400+", label: "professores brasileiros",      color: "text-emerald-400" },
                { n: "18K+",   label: "planos de aula gerados",       color: "text-white"       },
                { n: "100%",   label: "alinhado à BNCC e SAEB",       color: "text-white"       },
              ].map((s) => (
                <div key={s.label} className="text-center">
                  <p className={`text-3xl font-black ${s.color}`}>{s.n}</p>
                  <p className="mt-1 text-xs text-slate-400">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>


        {/* ── CONHEÇA A MAGIS ──────────────────────────────────────── */}
        <section id="magis" className="magis-glow py-28">
          <div className="mx-auto max-w-7xl px-6">
            <div className="grid gap-16 lg:grid-cols-2 lg:items-center">

              {/* Left — Magis visual */}
              <div className="flex flex-col items-center gap-6">
                {/* Magis avatar card */}
                <div className="magis-card magis-float w-full max-w-xs rounded-3xl p-5 shadow-2xl shadow-violet-900/30">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-violet-600 shadow-lg shadow-violet-500/40">
                      <Sparkles className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <p className="text-base font-black text-white">Magis</p>
                      <p className="text-[11px] text-violet-300">Assistente Pedagógica IA</p>
                    </div>
                    <div className="ml-auto flex gap-1">
                      <span className="h-2 w-2 rounded-full bg-emerald-400 dot-1" />
                      <span className="h-2 w-2 rounded-full bg-emerald-400 dot-2" />
                      <span className="h-2 w-2 rounded-full bg-emerald-400 dot-3" />
                    </div>
                  </div>

                  <div className="mt-3 space-y-2">
                    {[
                      { from: "magis", text: "Olá! Vi que você está montando o plano do 9º ano. Que tal começarmos pelas habilidades BNCC de Matemática?" },
                      { from: "user",  text: "Sim! Preciso focar em álgebra para o 2º bimestre." },
                      { from: "magis", text: "Perfeito. Separei as habilidades EF09MA06 e EF09MA07, alinhadas ao SAEB — posso incluir o sequenciamento do currículo específico do seu território também." },
                    ].map((msg, i) => (
                      <div
                        key={i}
                        className={`rounded-2xl px-4 py-3 text-[11px] leading-5 ${
                          msg.from === "magis"
                            ? "magis-bubble text-white"
                            : "bg-slate-700 text-slate-200"
                        }`}
                      >
                        {msg.from === "magis" && (
                          <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-violet-200">
                            Magis
                          </p>
                        )}
                        {msg.text}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Traits */}
                <div className="grid w-full max-w-xs grid-cols-2 gap-3">
                  {[
                    { icon: Heart,          label: "Acolhedora",         desc: "Linguagem próxima e empática" },
                    { icon: Brain,          label: "Especialista",        desc: "BNCC, SAEB e currículos territoriais" },
                    { icon: Shield,         label: "Confiável",           desc: "Zero referências inventadas" },
                    { icon: MessageCircle,  label: "Contextual",          desc: "Adapta ao seu perfil de turma" },
                  ].map((t) => {
                    const Icon = t.icon;
                    return (
                      <div key={t.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <Icon className="h-4 w-4 text-violet-500" />
                        <p className="mt-2 text-xs font-bold text-slate-900">{t.label}</p>
                        <p className="mt-0.5 text-[10px] text-slate-500">{t.desc}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right — narrative */}
              <div>
                <div className="tag-magis mb-6 inline-flex items-center gap-2 rounded-full px-4 py-2">
                  <Sparkles className="h-3.5 w-3.5 text-violet-600" />
                  <span className="text-[11px] font-bold uppercase tracking-widest text-violet-700">
                    Magis — Assistente Pedagógica IA do Plano Magistra
                  </span>
                </div>

                <h2 className="text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
                  Sua coordenadora<br />
                  <span className="magis-accent">pedagógica digital.</span>
                </h2>

                <p className="mt-6 text-lg leading-relaxed text-slate-600">
                  A <strong className="text-slate-900">Magis</strong> não é apenas um gerador de texto. Ela foi treinada para pensar como uma coordenadora pedagógica moderna: conhece a BNCC de ponta a ponta, domina o SAEB, entende o currículo específico de cada território nacional — e ainda aprende a estrutura do documento da <em>sua</em> escola.
                </p>
                <p className="mt-4 text-lg leading-relaxed text-slate-600">
                  Ela é acolhedora sem ser imprecisa, técnica sem ser fria. Cada sugestão vem contextualizada pela série, disciplina e perfil da sua turma.
                </p>

                <div className="mt-8 space-y-3">
                  {[
                    { phrase: "\"Magis está montando seu plano de aula…\"" },
                    { phrase: "\"Sugestão gerada pela Magis com base na BNCC\"" },
                    { phrase: "\"Pergunte à Magis sobre habilidades SAEB\"" },
                    { phrase: "\"Planejamento com apoio da Magis\"" },
                  ].map((p) => (
                    <div key={p.phrase} className="flex items-center gap-3 rounded-2xl border border-violet-100 bg-violet-50 px-5 py-3.5">
                      <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                      <p className="text-sm italic text-violet-800">{p.phrase}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-8">
                  <Link
                    href="/login"
                    className="btn-violet inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-6 py-3.5 text-sm font-bold text-white"
                  >
                    Conhecer a Magis
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── COMO FUNCIONA ────────────────────────────────────────── */}
        <section id="como-funciona" className="py-28">
          <div className="mx-auto max-w-7xl px-6">
            <div className="mb-20 text-center">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-violet-600">
                Fluxo completo
              </p>
              <h2 className="text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
                Seu template.<br />A inteligência da Magis.
              </h2>
              <p className="mx-auto mt-5 max-w-lg text-lg text-slate-500">
                A Magis aprende a estrutura do documento da sua escola e preenche cada campo com sugestões pedagógicas precisas.
              </p>
            </div>

            {/* Steps — vertical centered with connector */}
            <div className="relative mx-auto max-w-3xl">
              {/* vertical line */}
              <div className="step-line absolute left-[39px] top-8 bottom-8 w-px" />

              <div className="space-y-6">
                {[
                  {
                    n: "01",
                    icon: Upload,
                    title: "Suba o template da sua escola",
                    desc: "Envie o PDF ou DOCX que a escola já usa. Nenhuma configuração manual.",
                    iconBg: "bg-slate-950",
                  },
                  {
                    n: "02",
                    icon: Brain,
                    title: "Magis mapeia a estrutura",
                    desc: "A Magis identifica cada campo: turma, objetivos, habilidades BNCC, competências SAEB e critérios de avaliação — entendendo o contexto pedagógico de cada seção.",
                    iconBg: "bg-violet-600",
                  },
                  {
                    n: "03",
                    icon: Sparkles,
                    title: "Magis sugere em tempo real",
                    desc: "No editor passo a passo, foque um campo e a Magis gera sugestões na hora. Insira, edite ou peça uma nova — ela adapta ao perfil da sua turma.",
                    iconBg: "bg-violet-600",
                  },
                  {
                    n: "04",
                    icon: FileDown,
                    title: "Baixe o PDF no formato da escola",
                    desc: "O plano final exporta exatamente no formato do template original — pronto para imprimir e entregar à coordenação.",
                    iconBg: "bg-emerald-600",
                  },
                ].map((step) => {
                  const Icon = step.icon;
                  return (
                    <div key={step.n} className="lift relative flex gap-6 rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
                      <div className={`icon-wrap z-10 flex h-[52px] w-[52px] flex-shrink-0 items-center justify-center rounded-2xl ${step.iconBg} text-white shadow-md`}>
                        <Icon className="h-6 w-6" />
                      </div>
                      <div className="pt-1">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{step.n}</span>
                        <h3 className="mt-0.5 text-xl font-bold text-slate-950">{step.title}</h3>
                        <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{step.desc}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* ── VEJA O EDITOR EM AÇÃO ──────────────────────────────────── */}
        <section className="py-24">
          <div className="mx-auto max-w-7xl px-6">
            <div className="mb-12 text-center">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-violet-600">
                Demonstração
              </p>
              <h2 className="text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
                Veja o editor<br />
                <span className="wordmark-accent">em ação.</span>
              </h2>
              <p className="mx-auto mt-5 max-w-lg text-lg text-slate-500">
                Foque em um campo e a Magis gera sugestões pedagógicas precisas na hora — BNCC, SAEB e currículo do seu território, sem digitar nada.
              </p>
            </div>

            {/* Browser mockup */}
            <div className="overflow-hidden rounded-3xl shadow-2xl shadow-slate-300/60 ring-1 ring-slate-200">
              {/* Browser chrome */}
              <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-100 px-5 py-3.5">
                <div className="h-3 w-3 rounded-full bg-rose-400" />
                <div className="h-3 w-3 rounded-full bg-amber-400" />
                <div className="h-3 w-3 rounded-full bg-emerald-400" />
                <div className="ml-3 flex-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs text-slate-400">
                  planomagistra.com.br/dashboard/editor
                </div>
              </div>

              {/* Toolbar */}
              <div className="flex items-center justify-between border-b border-slate-100 bg-white px-6 py-3.5">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Plano de Aula</p>
                  <p className="text-sm font-semibold text-slate-800">9º Ano B — Matemática</p>
                </div>
                <div className="flex gap-2">
                  <span className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600">Rascunho</span>
                  <span className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white">↓ Baixar DOCX</span>
                </div>
              </div>

              {/* Split-view */}
              <div className="grid divide-x divide-slate-100 bg-white lg:grid-cols-[1fr,380px]">
                {/* Left — form */}
                <div className="p-6">
                  <p className="mb-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Campos do template</p>
                  <div className="space-y-3">
                    {[
                      { label: "Turma",       val: "9º Ano B" },
                      { label: "Disciplina",  val: "Matemática" },
                      { label: "Bimestre",    val: "2º Bimestre · 2026" },
                      { label: "Conteúdo",    val: "Equações do 2º grau — Fórmula de Báskara" },
                      { label: "Metodologia", val: "Resolução de problemas + Aula dialogada" },
                    ].map((f) => (
                      <div key={f.label} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                        <p className="mb-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">{f.label}</p>
                        <p className="text-sm text-slate-700">{f.val}</p>
                      </div>
                    ))}

                    {/* Active AI field */}
                    <div className="rounded-2xl border-2 border-violet-300 bg-violet-50 px-4 py-3 ring-2 ring-violet-100/60">
                      <div className="mb-2 flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-violet-500" />
                        <p className="text-[9px] font-bold uppercase tracking-wider text-violet-600">Habilidade BNCC · Magis sugerindo…</p>
                      </div>
                      <p className="text-sm leading-relaxed text-slate-700">
                        EF09MA06 — Resolver e elaborar problemas que envolvam equações polinomiais do 2º grau…
                      </p>
                      <div className="mt-3 flex gap-2">
                        <span className="rounded-xl bg-violet-600 px-3 py-1.5 text-xs font-bold text-white">Inserir</span>
                        <span className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500">Reescrever</span>
                      </div>
                    </div>

                    {/* Empty field */}
                    <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-3 opacity-50">
                      <p className="mb-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">Avaliação</p>
                      <p className="text-sm italic text-slate-400">Foque aqui para pedir sugestão à Magis…</p>
                    </div>
                  </div>
                </div>

                {/* Right — Magis panel */}
                <div className="flex flex-col gap-3 bg-slate-950 p-6">
                  <div className="mb-1 flex items-center gap-2.5">
                    <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-violet-600">
                      <Sparkles className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-white">Magis</p>
                      <p className="text-[9px] text-violet-400">Assistente Pedagógica IA</p>
                    </div>
                    <div className="ml-auto flex gap-1">
                      <span className="dot-1 h-2 w-2 rounded-full bg-emerald-400" />
                      <span className="dot-2 h-2 w-2 rounded-full bg-emerald-400" />
                      <span className="dot-3 h-2 w-2 rounded-full bg-emerald-400" />
                    </div>
                  </div>

                  <p className="text-[10px] text-slate-400">Sugestões para <span className="font-bold text-violet-300">Habilidade BNCC</span>:</p>

                  <div className="rounded-xl border border-violet-500/40 bg-violet-900/30 p-3">
                    <p className="text-[11px] font-semibold leading-relaxed text-violet-200">EF09MA06</p>
                    <p className="mt-1 text-[10px] leading-relaxed text-slate-300">Resolver e elaborar problemas que envolvam equações polinomiais do 2º grau — alinhada ao SAEB Tema 5, Descritora D32.</p>
                  </div>

                  {[
                    { code: "EF09MA07", desc: "Indicar a relação entre as raízes e os coeficientes da equação — Descritora D33." },
                    { code: "Competência 3", desc: "Argumentação: elaborar e testar conjecturas a partir de situações-problema." },
                  ].map((s, i) => (
                    <div key={i} className="rounded-xl border border-slate-700 bg-slate-800 p-3">
                      <p className="text-[10px] font-bold text-slate-300">{s.code}</p>
                      <p className="mt-0.5 text-[10px] leading-relaxed text-slate-400">{s.desc}</p>
                    </div>
                  ))}

                  <div className="flex items-center gap-1.5 px-1">
                    <span className="dot-1 h-1.5 w-1.5 rounded-full bg-violet-400" />
                    <span className="dot-2 h-1.5 w-1.5 rounded-full bg-violet-400" />
                    <span className="dot-3 h-1.5 w-1.5 rounded-full bg-violet-400" />
                    <span className="ml-1 text-[9px] text-slate-500">Magis está gerando mais sugestões…</span>
                  </div>

                  <div className="mt-auto rounded-xl bg-emerald-600/90 p-3 text-center">
                    <p className="text-xs font-bold text-white">✓ 6 / 8 campos preenchidos</p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-emerald-900/40">
                      <div className="h-full w-[75%] rounded-full bg-emerald-300" />
                    </div>
                    <p className="mt-1.5 text-[9px] text-emerald-200">Pronto para baixar em DOCX</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── RECURSOS ─────────────────────────────────────────────── */}
        <section id="recursos" className="bg-slate-50 py-28">
          <div className="mx-auto max-w-7xl px-6">
            <div className="mb-16 text-center">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-violet-600">Recursos</p>
              <h2 className="text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
                Tudo que um professor precisa
              </h2>
            </div>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  icon: Upload,
                  title: "Template da sua escola",
                  desc: "Não adaptamos seu trabalho ao sistema. A Magis aprende com o seu documento.",
                  bg: "bg-slate-950",
                  tag: null,
                },
                {
                  icon: Sparkles,
                  title: "Magis, Assistente Pedagógica",
                  desc: "Sugere habilidades BNCC, competências SAEB e conteúdos do currículo específico de cada território — com a precisão de uma coordenadora, sem inventar códigos.",
                  bg: "bg-violet-600",
                  tag: "Magis IA",
                },
                {
                  icon: FileText,
                  title: "Editor split-view",
                  desc: "Formulário e sugestões da Magis lado a lado. Inserção com um clique.",
                  bg: "bg-slate-950",
                  tag: null,
                },
                {
                  icon: BookCheck,
                  title: "PDF no formato original",
                  desc: "O download mantém 100% da estrutura do template da escola.",
                  bg: "bg-emerald-600",
                  tag: "PDF",
                },
                {
                  icon: Shield,
                  title: "BNCC, SAEB e currículos territoriais reais",
                  desc: "Nenhum dado inventado. A Magis usa referências verificadas de fontes oficiais.",
                  bg: "bg-slate-950",
                  tag: null,
                },
                {
                  icon: Clock,
                  title: "70% menos tempo",
                  desc: "De horas a minutos. Professores relatam economia de até 3h por plano.",
                  bg: "bg-violet-600",
                  tag: null,
                },
              ].map((f) => {
                const Icon = f.icon;
                return (
                  <div key={f.title} className="lift feature-card rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
                    <div className={`icon-wrap mb-5 flex h-12 w-12 items-center justify-center rounded-2xl ${f.bg} text-white`}>
                      <Icon className="h-6 w-6" />
                    </div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-bold text-slate-950">{f.title}</h3>
                      {f.tag && (
                        <span className="tag-ia rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-violet-700">
                          {f.tag}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-slate-500">{f.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── DEPOIMENTOS ─────────────────────────────────────────── */}
        <section className="py-28">
          <div className="mx-auto max-w-7xl px-6">
            <div className="grid gap-16 lg:grid-cols-2 lg:items-center">

              {/* Left — narrative */}
              <div>
                <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-violet-600">
                  Por que funciona
                </p>
                <h2 className="text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
                  O template<br />
                  <span className="wordmark-accent">já é da sua escola.</span>
                </h2>
                <p className="mt-6 text-lg leading-relaxed text-slate-600">
                  Outros sistemas pedem que você adapte seu trabalho. O PlanoMagistra faz o oposto: você sobe o documento que a escola já usa, e a <strong className="text-slate-900">Magis</strong> aprende a estrutura dele.
                </p>
                <p className="mt-4 text-lg leading-relaxed text-slate-600">
                  Resultado? Planos no formato exato que a coordenação espera, com conteúdo pedagógico alinhado à BNCC — sem horas de digitação.
                </p>

                <div className="mt-8 grid grid-cols-2 gap-3">
                  {[
                    "Sem reformatação",
                    "Sem adaptar layout",
                    "Sem BNCC inventado",
                    "Sem horas perdidas",
                  ].map((item) => (
                    <div key={item} className="flex items-center gap-2.5">
                      <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100">
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                      </div>
                      <span className="text-sm font-semibold text-slate-700">{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right — depoimentos */}
              <div className="space-y-4">
                {[
                  {
                    text: "\"A Magis entendeu exatamente o que eu precisava. Na primeira semana já tinha os planos do bimestre prontos. O que levava 4 horas agora leva 40 minutos.\"",
                    name: "Carla M.",
                    role: "Professora de Ciências · São Paulo, SP",
                  },
                  {
                    text: "\"A Magis entendeu o template da nossa escola na primeira tentativa. Os planos saem no formato certo, sem eu ajustar nada.\"",
                    name: "Rafael T.",
                    role: "Professor de Matemática · Fortaleza, CE",
                  },
                  {
                    text: "\"A parte de BNCC que eu mais demorava virou um clique. A Magis nunca erra código de habilidade — é como ter uma coordenadora ao lado.\"",
                    name: "Amanda S.",
                    role: "Professora de Língua Portuguesa · Recife, PE",
                  },
                ].map((q) => (
                  <div key={q.name} className="lift rounded-3xl border border-slate-100 bg-slate-50 p-6">
                    <div className="mb-3 flex gap-1">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />
                      ))}
                    </div>
                    <p className="text-sm italic leading-relaxed text-slate-700">{q.text}</p>
                    <div className="mt-4">
                      <p className="text-sm font-bold text-slate-950">{q.name}</p>
                      <p className="text-xs text-slate-400">{q.role}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── PRICING ──────────────────────────────────────────────── */}
        <section id="precos" className="bg-slate-50 py-28">
          <div className="mx-auto max-w-7xl px-6">
            <div className="mb-16 text-center">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-violet-600">Planos</p>
              <h2 className="text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
                Sem surpresas.<br />Só resultado.
              </h2>
              <p className="mx-auto mt-5 max-w-lg text-lg text-slate-500">
                Comece grátis, sem cartão de crédito. Atualize quando a Magis se tornar indispensável.
              </p>
            </div>

            {/* ── 4 planos individuais ── */}
            <div className="grid items-center gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {(
                [
                  {
                    id: "free",
                    name: "Explorador",
                    badge: "Teste grátis",
                    price: "R$ 0",
                    period: "/ mês",
                    desc: "Para dar os primeiros passos com a Magis sem compromisso.",
                    features: [
                      "1 template por mês",
                      "1 plano por mês",
                      "Magis: BNCC, SAEB e currículo territorial",
                      "Editor passo a passo",
                      "1 download por plano (DOCX)",
                    ],
                    href: "/login",
                    cta: "Começar grátis",
                    theme: "green" as const,
                    featured: false,
                  },
                  {
                    id: "starter",
                    name: "Educador",
                    badge: "",
                    price: "R$ 9,90",
                    period: "/ mês",
                    desc: "Para professores que buscam agilidade no planejamento sem abrir mão da qualidade.",
                    features: [
                      "1 template ativo",
                      "2 planos por mês",
                      "1 download por plano (DOCX ou PDF)",
                      "Tudo do Explorador",
                      "Prioridade no suporte",
                    ],
                    href: "/login",
                    cta: "Começar agora",
                    theme: "white" as const,
                    featured: false,
                  },
                  {
                    id: "medio",
                    name: "Mestre",
                    badge: "Mais popular",
                    price: "R$ 19,90",
                    period: "/ mês",
                    desc: "Para o professor que não abre mão de planejamentos de qualidade.",
                    features: [
                      "2 templates ativos",
                      "4 planos por mês",
                      "2 downloads por plano (DOCX e/ou PDF)",
                      "Tudo do Educador",
                      "Histórico completo",
                    ],
                    href: "/login",
                    cta: "Começar agora",
                    theme: "dark" as const,
                    featured: true,
                  },
                  {
                    id: "pro",
                    name: "Regente",
                    badge: "",
                    price: "R$ 49,90",
                    period: "/ mês",
                    desc: "Para professores com múltiplas turmas, disciplinas e templates.",
                    features: [
                      "5 templates ativos",
                      "10 planos por mês",
                      "4 downloads por plano (DOCX e/ou PDF)",
                      "Tudo do Mestre",
                      "Relatórios de uso",
                    ],
                    href: "/login",
                    cta: "Começar agora",
                    theme: "white" as const,
                    featured: false,
                  },
                ] as const
              ).map((plan) => (
                <div
                  key={plan.id}
                  className={[
                    "lift relative flex flex-col rounded-3xl border shadow-sm transition-all",
                    plan.featured ? "p-9 shadow-2xl shadow-slate-900/30 lg:-my-4" : "p-7",
                    plan.theme === "dark"  ? "border-slate-950 bg-slate-950 text-white" :
                    plan.theme === "green" ? "border-emerald-600 bg-emerald-600 text-white" :
                    "border-slate-200 bg-white text-slate-900",
                  ].join(" ")}
                >
                  {/* Badge — só renderiza se tiver texto */}
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
                    <span className="h-[26px]" /> /* placeholder para alinhar */
                  )}

                  <h3 className={[
                    "mt-4 font-bold",
                    plan.featured ? "text-3xl" : "text-2xl",
                  ].join(" ")}>{plan.name}</h3>

                  <div className="mt-2 flex items-baseline gap-1">
                    <span className={plan.featured ? "text-4xl font-black" : "text-3xl font-black"}>
                      {plan.price}
                    </span>
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

                  <Link
                    href={plan.href}
                    className={[
                      "mt-6 block w-full rounded-2xl py-3.5 text-center text-sm font-bold transition",
                      plan.theme === "dark"  ? "bg-violet-600 text-white hover:bg-violet-500" :
                      plan.theme === "green" ? "bg-white text-emerald-700 hover:bg-emerald-50" :
                      "bg-slate-950 text-white hover:bg-slate-800",
                    ].join(" ")}
                  >
                    {plan.cta}
                  </Link>
                </div>
              ))}
            </div>

            {/* ── Escola — card horizontal ── */}
            <div className="mt-10 overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-violet-950 shadow-2xl shadow-slate-900/40 ring-1 ring-violet-900/40">
              <div className="flex flex-col gap-8 p-8 md:flex-row md:items-center md:gap-12 lg:p-10">
                {/* Left — info */}
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
                    Para coordenações pedagógicas e redes de ensino que querem a Magis para toda a equipe — implantação assistida, suporte dedicado e treinamento incluso.
                  </p>
                </div>

                {/* Middle — features */}
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

                {/* Right — CTA */}
                <div className="shrink-0 text-center">
                  <EscolaContactButton className="inline-flex items-center gap-2 rounded-2xl bg-white px-7 py-4 text-sm font-bold text-slate-950 transition hover:bg-slate-100">
                    Falar com nossa equipe
                  </EscolaContactButton>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── CTA FINAL ────────────────────────────────────────────── */}
        <section className="bg-slate-950 py-16">
          <div className="mx-auto max-w-4xl px-6 text-center">
            <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-600">
              <Sparkles className="h-7 w-7 text-white" />
            </div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-violet-400">
              Magis — Assistente Pedagógica IA
            </p>
            <h2 className="text-4xl font-black tracking-tight text-white sm:text-5xl">
              Seu próximo plano<br />
              <span className="magis-accent">em menos de 5 minutos.</span>
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-lg text-slate-400">
              Junte-se a 2.400 professores que já planejam com a Magis — inteligência pedagógica que conhece a BNCC tão bem quanto você.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <Link
                href="/login"
                className="btn-violet inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-8 py-4 text-sm font-bold text-white"
              >
                Começar com a Magis
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 px-8 py-4 text-sm font-bold text-slate-300 transition hover:border-slate-500 hover:text-white"
              >
                Já tenho conta
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>

            {/* Contato — separador visual */}
            <div className="mx-auto mt-8 max-w-sm">
              <div className="h-px bg-slate-800" />
            </div>
            <div className="mt-5 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <p className="text-sm font-medium text-slate-300">
                Ficou curioso? Entre em contato e tire suas dúvidas.
              </p>
              <ContactModal />
            </div>

            <p className="mt-6 text-xs text-slate-700">Sem cartão de crédito. Comece grátis com 1 template e 1 plano por mês.</p>
          </div>
        </section>

        {/* ── FOOTER ───────────────────────────────────────────────── */}
        <footer className="border-t border-slate-800 bg-slate-950 py-10">
          <div className="mx-auto max-w-7xl px-6">
            <div className="flex flex-col items-center gap-4 text-center">
              {/* LGPD badge */}
              <div className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-4 py-2">
                <Lock className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-xs font-medium text-slate-400">Dados seguros · Conformidade LGPD</span>
              </div>
              <p className="text-xs text-slate-400">
                © 2026 PlanoMagistra · Para professores da educação básica brasileira
              </p>
              <TermsLink />
              <p className="text-[10px] text-slate-600">
                Powered by Magis — Assistente Pedagógica IA do Plano Magistra
              </p>
            </div>
          </div>
        </footer>

      </div>

      {/* ── MAGIS WIDGET ─────────────────────────────────────────────── */}
      <MagisWidget />

      {/* ── STICKY CTA ───────────────────────────────────────────────── */}
      <StickyCta />
    </>
  );
}
