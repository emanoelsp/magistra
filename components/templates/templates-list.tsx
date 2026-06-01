"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Clock, Edit2, Eye, FileText, FilePen, Plus, Trash2 } from "lucide-react";

import { templatesService } from "../../lib/services/firestore/templates.service";
import type { TemplateOption } from "../../lib/types/firestore";

const PAGE_SIZE = 3;

const TIPO_LABELS: Record<string, string> = {
  plano_anual: "Plano anual",
  plano_semestral: "Plano semestral",
  plano_quinzenal: "Plano quinzenal",
  plano_de_aula: "Plano de aula",
  sequencia_didatica: "Sequência didática",
  situacao_de_aprendizagem: "Situação de aprendizagem",
  projeto_de_extensao: "Projeto de extensão",
  caso_de_uso: "Caso de uso",
};

interface TemplatesListProps {
  templates: TemplateOption[];
  canCreatePlano: boolean;
}

export function TemplatesList({ templates, canCreatePlano }: TemplatesListProps) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const totalPages = Math.ceil(templates.length / PAGE_SIZE);
  const visibleTemplates = templates.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  async function handleDelete(templateId: string) {
    setError(null);
    setDeletingId(templateId);
    try {
      await templatesService.deleteTemplate(templateId);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível excluir o template.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      {error && (
        <p className="mb-3 rounded-xl bg-rose-50 px-4 py-2 text-xs text-rose-700">{error}</p>
      )}

      <ul className="mt-4 space-y-3">
        {visibleTemplates.map((template) => (
          <li
            key={template.id}
            className="rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-slate-300"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 rounded-xl bg-white p-2 text-slate-500 shadow-sm">
                  <FileText className="h-4 w-4" />
                </span>
                <div>
                  <p className="font-semibold text-slate-900">{template.nome}</p>
                  <p className="mt-0.5 text-xs text-slate-600">
                    {template.escolaNome ?? "Escola não informada"}
                    {template.tipoPlano && (
                      <>
                        {" · "}
                        {TIPO_LABELS[template.tipoPlano] ?? template.tipoPlano.replace(/_/g, " ")}
                      </>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {template.campoCount > 0
                      ? `${template.campoCount} campos`
                      : "Sem campos extraídos"}
                    {" · criado em "}
                    {new Date(template.criadoEm).toLocaleDateString("pt-BR")}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {template.campoCount === 0 && (
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                    Sem campos
                  </span>
                )}

                {template.fillable_status === "processando" && (
                  <span className="flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                    <Clock className="h-3 w-3 animate-pulse" /> Preparando DOCX…
                  </span>
                )}
                {template.fillable_status === "pronto" && (
                  <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                    <CheckCircle2 className="h-3 w-3" /> DOCX pronto
                  </span>
                )}
                {template.fillable_status === "erro" && (
                  <span className="flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700" title="Falha ao gerar o DOCX preenchível. Tente re-introspectar o template.">
                    <AlertCircle className="h-3 w-3" /> Erro no DOCX
                  </span>
                )}

                {(() => {
                  const temMeta =
                    !!(template.escolaNome?.trim()) ||
                    Object.values(template.metadata_padrao ?? {}).some((v) => v.trim());
                  const label = temMeta ? "Novo plano" : "Preencher metadados";
                  const Icon = temMeta ? Plus : FilePen;
                  const colorClass = temMeta
                    ? "bg-emerald-600 text-white hover:bg-emerald-500"
                    : "bg-violet-600 text-white hover:bg-violet-500";

                  return (
                    <Link
                      href={`/dashboard/gerar?template=${template.id}`}
                      className={[
                        "flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition",
                        canCreatePlano ? colorClass : "cursor-not-allowed bg-slate-200 text-slate-400",
                      ].join(" ")}
                      onClick={!canCreatePlano ? (e) => e.preventDefault() : undefined}
                      title={
                        !canCreatePlano
                          ? "Limite de planos do mês atingido"
                          : temMeta
                            ? "Criar novo plano com este template"
                            : "Preencher metadados do template antes de criar planos"
                      }
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </Link>
                  );
                })()}

                <Link
                  href={`/dashboard/templates/${template.id}/visualizar`}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
                  title="Visualizar template com campos destacados"
                >
                  <Eye className="h-3.5 w-3.5" />
                  Visualizar
                </Link>

                <Link
                  href={`/dashboard/templates/${template.id}/editar`}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
                >
                  <Edit2 className="h-3.5 w-3.5" />
                  Editar
                </Link>

                <button
                  type="button"
                  onClick={() => void handleDelete(template.id)}
                  disabled={deletingId === template.id}
                  className="flex items-center gap-1.5 rounded-xl border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:border-rose-500 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {deletingId === template.id ? "Excluindo…" : "Excluir"}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-950 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Anterior
          </button>
          <span className="text-xs text-slate-400">
            {page + 1} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page === totalPages - 1}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-950 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Próximo
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </>
  );
}
