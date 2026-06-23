import { Check, Sparkles } from "lucide-react";

export function LandingSocialProof() {
  return (
    <section className="py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid gap-16 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-violet-600">Por que funciona</p>
            <h2 className="text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
              O template
              <br />
              <span className="wordmark-accent">já é da sua escola.</span>
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-slate-600">
              Outros sistemas pedem que você adapte seu trabalho. O PlanoMagistra faz o oposto: você sobe o documento
              que a escola já usa, e a <strong className="text-slate-900">Magis</strong> aprende a estrutura dele.
            </p>
            <p className="mt-4 text-lg leading-relaxed text-slate-600">
              Resultado? Planos no formato exato que a coordenação espera, com conteúdo pedagógico alinhado à BNCC —
              sem horas de digitação.
            </p>

            <div className="mt-8 grid grid-cols-2 gap-3">
              {["Sem reformatação", "Sem adaptar layout", "Sem BNCC inventado", "Sem horas perdidas"].map((item) => (
                <div key={item} className="flex items-center gap-2.5">
                  <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100">
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                  </div>
                  <span className="text-sm font-semibold text-slate-700">{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-3xl border border-violet-200 bg-violet-50 p-6">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-violet-600 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
                <Sparkles className="h-3 w-3" />
                Beta aberto
              </div>
              <p className="text-sm leading-relaxed text-violet-900">
                Estamos em beta com professores da educação básica em{" "}
                <strong>São Paulo, Ceará e Pernambuco</strong> — refinando a Magis com quem vive a rotina de sala de
                aula todos os dias.
              </p>
            </div>

            {[
              {
                quote:
                  "Na primeira semana já tinha os planos do bimestre prontos. O que levava horas agora leva uma fração do tempo.",
                context: "Professora de Ciências · beta SP",
              },
              {
                quote:
                  "A Magis entendeu o template da nossa escola na primeira tentativa. Os planos saem no formato certo, sem eu ajustar nada.",
                context: "Professor de Matemática · beta CE",
              },
              {
                quote:
                  "A parte de BNCC que eu mais demorava virou um clique. É como ter uma coordenadora ao lado.",
                context: "Professora de Língua Portuguesa · beta PE",
              },
            ].map((item) => (
              <div key={item.context} className="lift rounded-3xl border border-slate-100 bg-slate-50 p-6">
                <p className="text-sm italic leading-relaxed text-slate-700">&ldquo;{item.quote}&rdquo;</p>
                <p className="mt-4 text-xs font-medium text-slate-400">{item.context}</p>
              </div>
            ))}

            <p className="text-center text-[11px] text-slate-400">
              Depoimentos de participantes do beta — nomes omitidos por privacidade.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
