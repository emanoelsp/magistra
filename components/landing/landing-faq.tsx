"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

const FAQ_ITEMS = [
  {
    q: "Funciona com o template da minha escola?",
    a: "Sim. Você envia o DOCX ou PDF que a escola já usa. A Magis aprende a estrutura desse documento, preenche cada campo com a IA e você baixa o plano pronto em PDF — sem adaptar seu trabalho ao sistema.",
  },
  {
    q: "A Magis inventa códigos da BNCC?",
    a: "Não. A Magis usa referências verificadas de fontes oficiais (BNCC, SAEB e currículos territoriais). Ela foi instruída a nunca reproduzir texto literal de documentos oficiais nem inventar códigos.",
  },
  {
    q: "Como recebo o plano de aula pronto?",
    a: "Depois de preencher todos os campos com a ajuda da Magis, você baixa o PDF com 100% de fidelidade ao template da sua escola — pronto para imprimir ou entregar à coordenação.",
  },
  {
    q: "Preciso de cartão de crédito para começar?",
    a: "Não. O plano Explorador é gratuito e não exige cartão. Você pode criar conta, subir um template e gerar seu primeiro plano sem pagamento.",
  },
  {
    q: "Meus dados estão seguros?",
    a: "Sim. Seguimos a LGPD. Seus templates e planos ficam associados à sua conta e não são compartilhados com outros usuários.",
  },
  {
    q: "Posso usar em qualquer estado do Brasil?",
    a: "Sim. A Magis cobre currículos territoriais dos 27 estados, além da BNCC e do SAEB.",
  },
  {
    q: "Quanto tempo leva para montar um plano?",
    a: "Depende do template e da quantidade de campos, mas professores no beta relatam redução de horas para minutos — em média até 70% menos tempo de planejamento.",
  },
] as const;

export function LandingFaq() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="py-28">
      <div className="mx-auto max-w-3xl px-6">
        <div className="mb-12 text-center">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-violet-600">Dúvidas frequentes</p>
          <h2 className="text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">Perguntas comuns</h2>
        </div>

        <div className="space-y-3">
          {FAQ_ITEMS.map((item, i) => {
            const isOpen = openIndex === i;
            return (
              <div key={item.q} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                  onClick={() => setOpenIndex(isOpen ? null : i)}
                  aria-expanded={isOpen}
                >
                  <span className="text-sm font-bold text-slate-900">{item.q}</span>
                  <ChevronDown
                    className={`h-5 w-5 shrink-0 text-slate-400 transition ${isOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {isOpen && (
                  <div className="border-t border-slate-100 px-5 pb-4 pt-3">
                    <p className="text-sm leading-relaxed text-slate-600">{item.a}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
