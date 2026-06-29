import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, BookOpen, Download, FileText, Plus, Sparkles } from "lucide-react";

import { requireCurrentUserProfile } from "../../../lib/auth/session";
import { getPlanCapabilities } from "../../../lib/services/plan-capabilities";
import { getLimitsStatus } from "../../../lib/services/limits";
import { BibliotecaAdicionarButton } from "../../../components/biblioteca/biblioteca-adicionar-button";

export const dynamic = "force-dynamic";

interface LibraryTemplate {
  id: string;
  nome: string;
  descricao: string;
  tipo: string;
  nivel: string;
  arquivoComVariaveis: string;
  arquivoEmBranco: string;
}

const LIBRARY: LibraryTemplate[] = [
  {
    id: "plano-aula",
    nome: "Plano de Aula",
    descricao: "Modelo completo de plano de aula com campos para objetivos, habilidades BNCC, metodologia e avaliação.",
    tipo: "Plano de Aula",
    nivel: "Ensino Fundamental / Médio",
    arquivoComVariaveis: "Plano de aula - com variaveis.docx",
    arquivoEmBranco: "Plano de aula Em branco.docx",
  },
  {
    id: "planejamento-anual-emiep",
    nome: "Planejamento Anual EMIEP",
    descricao: "Planejamento anual do EMIEP 2026 com campos de competências, habilidades e cronograma bimestral.",
    tipo: "Planejamento Anual",
    nivel: "Ensino Médio Técnico",
    arquivoComVariaveis: "C-Planejamento anual - EMIEP-2026 - com variaveis.docx",
    arquivoEmBranco: "C-Planejamento anual - EMIEP-2026 Em branco .docx",
  },
  {
    id: "planejamento-cre-emiep",
    nome: "Planejamento CRE EMIEP 2026",
    descricao: "Template de planejamento da Coordenadoria Regional de Educação para o EMIEP 2026.",
    tipo: "Planejamento CRE",
    nivel: "Ensino Médio Técnico",
    arquivoComVariaveis: "PLANEJAMENTO EMIEP 2026 CRE - com variaveis.docx",
    arquivoEmBranco: "PLANEJAMENTO EMIEP 2026 CRE Em branco.docx",
  },
  {
    id: "plano-30-dias",
    nome: "Plano de 30 Dias",
    descricao: "Sequência didática de 30 dias com distribuição de conteúdos, objetivos e instrumentos de avaliação.",
    tipo: "Sequência Didática",
    nivel: "Ensino Fundamental / Médio",
    arquivoComVariaveis: "Plano_30dias_5421_13-07_a_09-08_2026 - com variaveis.docx",
    arquivoEmBranco: "Plano_30dias_5421_13-07_a_09-08_2026 Em branco.docx",
  },
];

const TIPO_COLORS: Record<string, string> = {
  "Plano de Aula":     "bg-violet-100 text-violet-700",
  "Planejamento Anual": "bg-amber-100 text-amber-700",
  "Planejamento CRE":  "bg-blue-100 text-blue-700",
  "Sequência Didática": "bg-emerald-100 text-emerald-700",
};

export default async function BibliotecaPage() {
  const user = await requireCurrentUserProfile();
  const caps = getPlanCapabilities(user.plano ?? "free");
  if (!caps.canAccessBiblioteca) redirect("/dashboard");

  const limits = await getLimitsStatus(user.uid, user.plano);
  const canCreate = limits.canCreateTemplate;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-2 text-sm font-medium text-slate-600 transition hover:text-slate-950"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar ao dashboard
        </Link>
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-indigo-100 p-3 text-indigo-600">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Biblioteca de Templates</h1>
            <p className="text-sm text-slate-500">Templates prontos da rede pública — adicione aos seus com um clique.</p>
          </div>
        </div>
      </header>

      {/* Magis tip */}
      <div className="flex items-start gap-3 max-w-2xl">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-600 shadow-md">
          <Sparkles className="h-4 w-4 text-white" />
        </div>
        <div className="flex-1 rounded-2xl rounded-tl-none border border-violet-100 bg-violet-50 p-4 shadow-sm">
          <div className="mb-1 flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-violet-600" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-violet-600">Magis</span>
          </div>
          <p className="text-sm leading-relaxed text-slate-700">
            Esses templates já vêm com os campos pedagógicos mapeados e prontos para receber sugestões de IA.
            Ao adicionar, você pode configurar os campos fixos e vinculá-los à sua escola.
          </p>
        </div>
      </div>

      {!canCreate && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Você atingiu o limite de templates do seu plano. Para adicionar mais, atualize seu plano.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {LIBRARY.map((tpl) => {
          const badgeCls = TIPO_COLORS[tpl.tipo] ?? "bg-slate-100 text-slate-700";
          return (
            <div
              key={tpl.id}
              className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-slate-300 hover:shadow-md"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-semibold text-slate-950">{tpl.nome}</h2>
                  <p className="mt-0.5 text-xs text-slate-500">{tpl.nivel}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${badgeCls}`}>
                  {tpl.tipo}
                </span>
              </div>

              <p className="text-sm leading-relaxed text-slate-600">{tpl.descricao}</p>

              <div className="mt-auto flex flex-wrap items-center gap-2">
                <a
                  href={`/api/biblioteca/download?arquivo=${encodeURIComponent(tpl.arquivoEmBranco)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-slate-950 hover:text-slate-950"
                >
                  <Download className="h-3.5 w-3.5" />
                  Baixar modelo
                </a>

                <BibliotecaAdicionarButton
                  templateId={tpl.id}
                  templateNome={tpl.nome}
                  arquivoComVariaveis={tpl.arquivoComVariaveis}
                  disabled={!canCreate}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
