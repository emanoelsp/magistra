import { BookCheck, Clock, FileText, Shield, Sparkles, Upload } from "lucide-react";

export function LandingFeatures() {
  return (
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
              title: "Documento no formato original",
              desc: "O PDF gerado mantém 100% da estrutura do template da escola — pronto para imprimir ou entregar digitalmente.",
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
  );
}
