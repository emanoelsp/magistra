import Link from "next/link";
import { ArrowRight, Brain, Heart, MessageCircle, Shield, Sparkles } from "lucide-react";
import { SIGNUP_URL } from "./constants";

export function LandingMagisSection() {
  return (
    <section id="magis" className="magis-glow py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid gap-16 lg:grid-cols-2 lg:items-center">
          <div className="flex flex-col items-center gap-6">
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
                  <span className="dot-1 h-2 w-2 rounded-full bg-emerald-400" />
                  <span className="dot-2 h-2 w-2 rounded-full bg-emerald-400" />
                  <span className="dot-3 h-2 w-2 rounded-full bg-emerald-400" />
                </div>
              </div>

              <div className="mt-3 space-y-2">
                {[
                  {
                    from: "magis",
                    text: "Olá! Vi que você está montando o plano do 9º ano. Que tal começarmos pelas habilidades BNCC de Matemática?",
                  },
                  { from: "user", text: "Sim! Preciso focar em álgebra para o 2º bimestre." },
                  {
                    from: "magis",
                    text: "Perfeito. Separei as habilidades EF09MA06 e EF09MA07, alinhadas ao SAEB — posso incluir o sequenciamento do currículo específico do seu território também.",
                  },
                ].map((msg, i) => (
                  <div
                    key={i}
                    className={`rounded-2xl px-4 py-3 text-[11px] leading-5 ${
                      msg.from === "magis" ? "magis-bubble text-white" : "bg-slate-700 text-slate-200"
                    }`}
                  >
                    {msg.from === "magis" && (
                      <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-violet-200">Magis</p>
                    )}
                    {msg.text}
                  </div>
                ))}
              </div>
            </div>

            <div className="grid w-full max-w-xs grid-cols-2 gap-3">
              {[
                { icon: Heart, label: "Acolhedora", desc: "Linguagem próxima e empática" },
                { icon: Brain, label: "Especialista", desc: "BNCC, SAEB, Currículo Digital e currículos territoriais" },
                { icon: Shield, label: "Confiável", desc: "Zero referências inventadas" },
                { icon: MessageCircle, label: "Contextual", desc: "Adapta ao seu perfil de turma" },
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

          <div>
            <div className="tag-magis mb-6 inline-flex items-center gap-2 rounded-full px-4 py-2">
              <Sparkles className="h-3.5 w-3.5 text-violet-600" />
              <span className="text-[11px] font-bold uppercase tracking-widest text-violet-700">
                Magis — Assistente Pedagógica IA do Plano Magistra
              </span>
            </div>

            <h2 className="text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
              Sua coordenadora
              <br />
              <span className="magis-accent">pedagógica digital.</span>
            </h2>

            <p className="mt-6 text-lg leading-relaxed text-slate-600">
              A <strong className="text-slate-900">Magis</strong> não é apenas um gerador de texto. Ela foi treinada
              para pensar como uma coordenadora pedagógica moderna: conhece a BNCC de ponta a ponta, domina o SAEB,
              incorpora o Currículo Digital do MEC e entende o currículo específico de cada território nacional — e
              ainda aprende a estrutura do documento da <em>sua</em> escola.
            </p>
            <p className="mt-4 text-lg leading-relaxed text-slate-600">
              Ela é acolhedora sem ser imprecisa, técnica sem ser fria. Cada sugestão vem contextualizada pela série,
              disciplina e perfil da sua turma.
            </p>

            <div className="mt-8 space-y-3">
              {[
                '"Magis está montando seu plano de aula…"',
                '"Sugestão gerada pela Magis com base na BNCC"',
                '"Pergunte à Magis sobre habilidades SAEB"',
                '"Planejamento com apoio da Magis"',
              ].map((phrase) => (
                <div
                  key={phrase}
                  className="flex items-center gap-3 rounded-2xl border border-violet-100 bg-violet-50 px-5 py-3.5"
                >
                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                  <p className="text-sm italic text-violet-800">{phrase}</p>
                </div>
              ))}
            </div>

            <div className="mt-8">
              <Link
                href={SIGNUP_URL}
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
  );
}
