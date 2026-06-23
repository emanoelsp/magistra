import { Brain, FileDown, Sparkles, Upload } from "lucide-react";

export function LandingHowItWorks() {
  return (
    <section id="como-funciona" className="py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-20 text-center">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-violet-600">Fluxo completo</p>
          <h2 className="text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
            Seu template.
            <br />A inteligência da Magis.
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-lg text-slate-500">
            A Magis aprende a estrutura do documento da sua escola e preenche cada campo com sugestões pedagógicas
            precisas.
          </p>
        </div>

        <div className="relative mx-auto max-w-3xl">
          <div className="step-line absolute bottom-8 left-[39px] top-8 w-px" />

          <div className="space-y-6">
            {[
              {
                n: "01",
                icon: Upload,
                title: "Suba o template da sua escola",
                desc: "Envie o DOCX (recomendado) ou PDF que a escola já usa. Nenhuma configuração manual.",
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
                title: "Baixe o plano pronto em PDF",
                desc: "Com tudo preenchido, baixe o PDF gerado no formato exato da escola — pronto para imprimir e entregar à coordenação.",
                iconBg: "bg-emerald-600",
              },
            ].map((step) => {
              const Icon = step.icon;
              return (
                <div
                  key={step.n}
                  className="lift relative flex gap-6 rounded-3xl border border-slate-100 bg-white p-6 shadow-sm"
                >
                  <div
                    className={`icon-wrap z-10 flex h-[52px] w-[52px] flex-shrink-0 items-center justify-center rounded-2xl ${step.iconBg} text-white shadow-md`}
                  >
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
  );
}
