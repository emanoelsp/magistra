import Link from "next/link";
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
  Lock,
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
        @keyframes revealLine {
          from { transform: scaleX(0); }
          to   { transform: scaleX(1); }
        }

        .anim-up   { animation: fadeUp .7s ease both; }
        .d-1 { animation-delay: .10s; }
        .d-2 { animation-delay: .20s; }
        .d-3 { animation-delay: .32s; }
        .d-4 { animation-delay: .44s; }
        .d-5 { animation-delay: .56s; }

        .float { animation: floatY 5s ease-in-out infinite; }

        .ring-pulse { animation: pulseRing 2.8s ease-in-out infinite; }

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

        /* Wordmark gradient */
        .wordmark-accent {
          background: linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%);
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

        /* Pricing dark card */
        .pricing-pro {
          background: linear-gradient(155deg, #0f172a 0%, #1e1b4b 100%);
          border: 1px solid rgba(124,58,237,.38);
        }

        /* Feature tag */
        .tag-ia {
          background: linear-gradient(135deg, rgba(124,58,237,.15) 0%, rgba(124,58,237,.07) 100%);
          border: 1px solid rgba(124,58,237,.22);
        }
      `}</style>

      <div className="min-h-screen bg-white font-sans">

        {/* ── NAV ─────────────────────────────────────────────────── */}
        <nav className="nav-glass fixed inset-x-0 top-0 z-50 border-b border-slate-100">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
            <span className="text-xl font-black tracking-tight text-slate-950">
              PLANO<span className="wordmark-accent">MESTRE</span>
            </span>
            <div className="hidden items-center gap-8 text-sm font-medium text-slate-500 md:flex">
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
        <section className="grid-texture hero-glow relative overflow-hidden pt-20">
          <div className="mx-auto max-w-7xl px-6 pb-20 pt-24 sm:pt-32">
            <div className="grid gap-16 lg:grid-cols-[1fr,400px] lg:items-center">

              {/* LEFT */}
              <div>
                {/* Pill badge */}
                <div className="anim-up tag-ia mb-7 inline-flex items-center gap-2 rounded-full px-4 py-2">
                  <Zap className="h-3.5 w-3.5 text-violet-600" />
                  <span className="text-[11px] font-bold uppercase tracking-widest text-violet-700">
                    Assistente Pedagógico com IA
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
                    <span className="wordmark-accent">MESTRE</span>
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
                  Suba o template da sua escola, o assistente pedagógico extrai a estrutura e sugere conteúdos campo a campo — BNCC, SAEB e CTBC — sem copiar textos oficiais.
                </p>

                <div className="anim-up d-4 mt-8 flex flex-wrap gap-3">
                  <Link
                    href="/login"
                    className="btn-dark inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-6 py-3.5 text-sm font-bold text-white"
                  >
                    Criar conta gratuita
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <a
                    href="#como-funciona"
                    className="btn-ghost inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-6 py-3.5 text-sm font-bold text-slate-700"
                  >
                    Ver como funciona
                  </a>
                </div>

                {/* Quick stats */}
                <div className="anim-up d-5 mt-9 flex flex-wrap items-center gap-8">
                  {[
                    { n: "2.400+", label: "professores" },
                    { n: "18.000+", label: "planos gerados" },
                    { n: "26", label: "estados" },
                  ].map((s) => (
                    <div key={s.label}>
                      <p className="text-2xl font-black text-slate-950">{s.n}</p>
                      <p className="text-xs text-slate-400">{s.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* RIGHT — mock UI card */}
              <div className="float hidden lg:block">
                <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl shadow-slate-200/60">
                  {/* Window chrome */}
                  <div className="mb-4 flex items-center gap-1.5">
                    <div className="h-3 w-3 rounded-full bg-rose-400" />
                    <div className="h-3 w-3 rounded-full bg-amber-400" />
                    <div className="h-3 w-3 rounded-full bg-emerald-400" />
                    <span className="ml-2 text-[11px] font-medium text-slate-400">editor split-view</span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {/* Form fields */}
                    <div className="space-y-2">
                      {[
                        { label: "Turma",       val: "9º Ano B"     },
                        { label: "Disciplina",  val: "Matemática"   },
                        { label: "Bimestre",    val: "2º Bimestre"  },
                      ].map((f) => (
                        <div key={f.label} className="rounded-xl bg-slate-50 p-2.5">
                          <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">{f.label}</p>
                          <p className="text-xs font-semibold text-slate-800">{f.val}</p>
                        </div>
                      ))}

                      {/* Active IA field */}
                      <div className="rounded-xl border border-violet-100 bg-violet-50 p-2.5">
                        <div className="mb-1 flex items-center gap-1">
                          <Sparkles className="h-3 w-3 text-violet-500" />
                          <p className="text-[9px] font-bold uppercase tracking-widest text-violet-500">Habilidade BNCC</p>
                        </div>
                        <p className="text-[11px] leading-relaxed text-slate-700">
                          EF09MA06 — Conjuntos numéricos e operações...
                        </p>
                        <div className="mt-2 flex gap-1.5">
                          <span className="cursor-pointer rounded-lg bg-violet-600 px-2.5 py-1 text-[10px] font-bold text-white">
                            Inserir
                          </span>
                          <span className="cursor-pointer rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-500">
                            Nova sugestão
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* IA panel */}
                    <div className="flex flex-col gap-2 rounded-2xl bg-slate-950 p-3">
                      <div className="flex items-center gap-1.5">
                        <Brain className="h-3 w-3 text-violet-400" />
                        <span className="text-[9px] font-bold uppercase tracking-widest text-violet-400">
                          Assistente IA
                        </span>
                      </div>
                      {[
                        "EF09MA06 alinhada ao SAEB",
                        "Competência 3 — Argumentação",
                        "Obj.: resolver prob. algébricos",
                        "CTBC: sequência recomendada",
                      ].map((s, i) => (
                        <div key={i} className="rounded-lg bg-slate-800 p-2">
                          <p className="text-[10px] leading-relaxed text-slate-300">{s}</p>
                        </div>
                      ))}
                      <div className="mt-auto rounded-lg bg-emerald-600 p-2 text-center">
                        <p className="text-[10px] font-bold text-white">✓ PDF pronto para download</p>
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

        {/* ── COMO FUNCIONA ────────────────────────────────────────── */}
        <section id="como-funciona" className="py-28">
          <div className="mx-auto max-w-7xl px-6">
            <div className="mb-20 text-center">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-violet-600">
                Fluxo completo
              </p>
              <h2 className="text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
                Seu template.<br />Nossa inteligência.
              </h2>
              <p className="mx-auto mt-5 max-w-lg text-lg text-slate-500">
                O PlanoMestre aprende a estrutura do documento da sua escola e preenche cada campo com sugestões pedagógicas precisas.
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
                    title: "IA extrai e mapeia a estrutura",
                    desc: "O Assistente identifica campos de turma, objetivos, habilidades BNCC, competências SAEB e critérios de avaliação.",
                    iconBg: "bg-violet-600",
                  },
                  {
                    n: "03",
                    icon: Sparkles,
                    title: "Edite com sugestões em tempo real",
                    desc: "No editor split-view, foque um campo e veja sugestões geradas na hora. Insira, edite ou peça nova sugestão.",
                    iconBg: "bg-violet-600",
                  },
                  {
                    n: "04",
                    icon: FileDown,
                    title: "Baixe o PDF no formato da escola",
                    desc: "O plano final exporta exatamente no formato do template original — pronto para imprimir.",
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
                  desc: "Não adaptamos seu trabalho ao sistema. O sistema aprende com o seu documento.",
                  bg: "bg-slate-950",
                  tag: null,
                },
                {
                  icon: Brain,
                  title: "Assistente Pedagógico IA",
                  desc: "Sugere habilidades BNCC, competências SAEB e conteúdos CTBC — sem inventar códigos.",
                  bg: "bg-violet-600",
                  tag: "IA",
                },
                {
                  icon: FileText,
                  title: "Editor split-view",
                  desc: "Formulário e sugestões lado a lado. Inserção com um clique.",
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
                  title: "BNCC, SAEB e CTBC reais",
                  desc: "Nenhum dado inventado. Referências verificadas de fontes oficiais.",
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

        {/* ── HISTÓRIA — "Seu template, nossa IA" ─────────────────── */}
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
                  Outros sistemas pedem que você adapte seu trabalho. O PlanoMestre faz o oposto: você sobe o documento que a escola já usa, e a IA aprende a estrutura dele.
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
                    text: "\"Eu subo o PDF da minha escola na segunda e na terça já tenho os planos do bimestre prontos. O que levava 4 horas agora leva 40 minutos.\"",
                    name: "Carla M.",
                    role: "Professora de Ciências · São Paulo, SP",
                  },
                  {
                    text: "\"A IA entendeu o template da nossa escola na primeira tentativa. Os planos saem no formato certo, sem eu ajustar nada.\"",
                    name: "Rafael T.",
                    role: "Professor de Matemática · Fortaleza, CE",
                  },
                  {
                    text: "\"A parte de BNCC que eu mais demorava virou um clique. Nunca mais errei código de habilidade.\"",
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
                No MVP, o plano Starter está liberado gratuitamente. Crie sua conta e comece agora.
              </p>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              {(
                [
                  {
                    id: "starter",
                    name: "Starter",
                    badge: "Grátis no MVP",
                    price: "R$ 19,90",
                    period: "/ mês",
                    desc: "Para professores que querem experimentar o PlanoMestre.",
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
                    desc: "Para professores com múltiplas turmas e templates.",
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
                    desc: "Preço personalizado para sua demanda. Para coordenações e equipes pedagógicas.",
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
                ] as const
              ).map((plan) => (
                <div
                  key={plan.id}
                  className={[
                    "lift relative flex flex-col rounded-3xl border p-7 shadow-sm",
                    plan.highlight
                      ? "border-slate-950 bg-slate-950 text-white"
                      : "border-slate-200 bg-white text-slate-900",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "w-fit rounded-full px-3 py-1 text-xs font-semibold",
                      plan.highlight ? "bg-emerald-400 text-slate-950" : "bg-slate-100 text-slate-600",
                    ].join(" ")}
                  >
                    {plan.badge}
                  </span>

                  <h3 className="mt-4 text-2xl font-bold">{plan.name}</h3>

                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="text-3xl font-black">{plan.price}</span>
                    {plan.period && (
                      <span className={`text-sm ${plan.highlight ? "text-slate-300" : "text-slate-500"}`}>
                        {plan.period}
                      </span>
                    )}
                  </div>

                  <p className={`mt-3 text-sm leading-6 ${plan.highlight ? "text-slate-300" : "text-slate-600"}`}>
                    {plan.desc}
                  </p>

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

                  <Link
                    href={plan.available ? "/login" : "#precos"}
                    className={[
                      "mt-6 block w-full rounded-2xl py-3.5 text-center text-sm font-bold transition",
                      plan.available && plan.highlight
                        ? "bg-white text-slate-950 hover:bg-slate-100"
                        : plan.available
                          ? "bg-slate-950 text-white hover:bg-slate-800"
                          : "cursor-not-allowed bg-slate-100 text-slate-400",
                    ].join(" ")}
                  >
                    {plan.cta}
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA FINAL ────────────────────────────────────────────── */}
        <section className="bg-slate-950 py-28">
          <div className="mx-auto max-w-4xl px-6 text-center">
            <div className="mb-7 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-600">
              <GraduationCap className="h-8 w-8 text-white" />
            </div>
            <h2 className="text-4xl font-black tracking-tight text-white sm:text-5xl">
              Seu próximo plano<br />
              <span className="wordmark-accent">em 40 minutos.</span>
            </h2>
            <p className="mx-auto mt-5 max-w-lg text-lg text-slate-400">
              Junte-se a 2.400 professores que já automatizaram a burocracia escolar com o PlanoMestre.
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-4">
              <Link
                href="/login"
                className="btn-dark inline-flex items-center gap-2 rounded-2xl bg-white px-8 py-4 text-sm font-bold text-slate-950"
              >
                Criar conta gratuita
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
            <p className="mt-6 text-xs text-slate-600">Sem cartão de crédito. Plano gratuito disponível.</p>
          </div>
        </section>

        {/* ── FOOTER ───────────────────────────────────────────────── */}
        <footer className="border-t border-slate-800 bg-slate-950 py-8">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
            <span className="text-sm font-black tracking-tight text-slate-400">
              PLANO<span className="wordmark-accent">MESTRE</span>
            </span>
            <p className="text-xs text-slate-600">
              © 2025 PlanoMestre · Para professores da educação básica brasileira
            </p>
          </div>
        </footer>

      </div>
    </>
  );
}
