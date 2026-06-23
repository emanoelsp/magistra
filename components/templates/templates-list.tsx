"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock, Copy, Edit2, Eye, FileText, FilePen, Plus, Sparkles, Trash2 } from "lucide-react";

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
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  // Modal Magis para confirmar nome antes de duplicar
  const [duplicateModal, setDuplicateModal] = useState<{ id: string; nome: string } | null>(null);
  const [duplicateNome, setDuplicateNome] = useState("");
  const duplicateInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const totalPages = Math.ceil(templates.length / PAGE_SIZE);
  const visibleTemplates = templates.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function openDuplicateModal(template: TemplateOption) {
    const sugerido = template.nome.endsWith(" (cópia)") ? template.nome : `${template.nome} (cópia)`;
    setDuplicateNome(sugerido);
    setDuplicateModal({ id: template.id, nome: template.nome });
  }

  // Foca o input assim que o modal abre
  useEffect(() => {
    if (duplicateModal) {
      setTimeout(() => duplicateInputRef.current?.select(), 50);
    }
  }, [duplicateModal]);

  async function handleDuplicate() {
    if (!duplicateModal) return;
    const nome = duplicateNome.trim();
    if (!nome) return;
    setError(null);
    setDuplicatingId(duplicateModal.id);
    setDuplicateModal(null);
    try {
      const res = await fetch(`/api/templates/${duplicateModal.id}/duplicar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome }),
      });
      const data = (await res.json()) as { ok?: boolean; nome?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Erro ao duplicar.");
      setSuccessMsg(`"${data.nome}" criado com sucesso.`);
      setTimeout(() => setSuccessMsg(null), 4000);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível duplicar o template.");
    } finally {
      setDuplicatingId(null);
    }
  }

  async function handleDelete(templateId: string) {
    const templateName = templates.find((t) => t.id === templateId)?.nome ?? "Template";
    setConfirmDeleteId(null);
    setError(null);
    setDeletingId(templateId);
    try {
      await templatesService.deleteTemplate(templateId);
      setSuccessMsg(`"${templateName}" excluído com sucesso.`);
      setTimeout(() => setSuccessMsg(null), 4000);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível excluir o template.");
    } finally {
      setDeletingId(null);
    }
  }

  const confirmDeleteTemplate = templates.find((t) => t.id === confirmDeleteId);

  const deleteConfirmModal = confirmDeleteId && confirmDeleteTemplate && (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm"
      onClick={() => setConfirmDeleteId(null)}
    >
      <style>{`
        @keyframes magis-pop {
          from { opacity: 0; transform: scale(0.7) translateY(24px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
      <div
        className="flex w-full max-w-sm flex-col items-center gap-5 rounded-3xl bg-white p-8 shadow-2xl"
        style={{ animation: "magis-pop 0.35s cubic-bezier(0.34,1.56,0.64,1) both" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-rose-100 shadow-lg shadow-rose-100">
          <Trash2 className="h-7 w-7 text-rose-600" />
          <span
            className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-amber-400"
            style={{ animation: "magis-pop 0.4s 0.2s cubic-bezier(0.34,1.56,0.64,1) both" }}
          >
            <AlertTriangle className="h-3 w-3 text-white" />
          </span>
        </div>

        <div className="w-full rounded-2xl border border-violet-100 bg-violet-50 px-5 py-4 text-center">
          <div className="mb-1.5 flex items-center justify-center gap-1.5">
            <Sparkles className="h-3 w-3 text-violet-500" />
            <span className="text-xs font-bold text-violet-700">Magis</span>
          </div>
          <p className="text-sm font-medium leading-relaxed text-slate-800">
            Tem certeza que deseja excluir{" "}
            <span className="font-semibold text-slate-900">{confirmDeleteTemplate.nome}</span>?
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Essa ação é permanente e não pode ser desfeita. Os planos criados com este template não serão afetados.
          </p>
        </div>

        <div className="flex w-full gap-3">
          <button
            type="button"
            onClick={() => setConfirmDeleteId(null)}
            className="flex-1 rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleDelete(confirmDeleteId)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-rose-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-rose-500"
          >
            <Trash2 className="h-4 w-4" />
            Excluir template
          </button>
        </div>
      </div>
    </div>
  );

  const duplicateModal_el = duplicateModal && (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm"
      onClick={() => setDuplicateModal(null)}
    >
      <style>{`
        @keyframes magis-pop {
          from { opacity: 0; transform: scale(0.7) translateY(24px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
      <div
        className="flex w-full max-w-sm flex-col items-center gap-5 rounded-3xl bg-white p-8 shadow-2xl"
        style={{ animation: "magis-pop 0.35s cubic-bezier(0.34,1.56,0.64,1) both" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Avatar Magis */}
        <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-violet-600 shadow-lg shadow-violet-200">
          <Sparkles className="h-7 w-7 text-white" />
          <span
            className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500"
            style={{ animation: "magis-pop 0.4s 0.2s cubic-bezier(0.34,1.56,0.64,1) both" }}
          >
            <Copy className="h-3 w-3 text-white" />
          </span>
        </div>

        {/* Balão de diálogo — estilo WhatsApp */}
        <div className="w-full rounded-2xl border border-violet-100 bg-violet-50 px-5 py-4">
          <div className="mb-2 flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-violet-500" />
            <span className="text-xs font-bold text-violet-700">Magis</span>
          </div>
          <p className="text-sm leading-relaxed text-slate-800">
            Antes de duplicarmos{" "}
            <span className="font-semibold">"{duplicateModal.nome}"</span>, qual será o nome do novo template?
          </p>
        </div>

        {/* Input do nome */}
        <div className="w-full">
          <input
            ref={duplicateInputRef}
            type="text"
            value={duplicateNome}
            onChange={(e) => setDuplicateNome(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleDuplicate(); if (e.key === "Escape") setDuplicateModal(null); }}
            placeholder="Nome do template…"
            aria-label="Nome do novo template"
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
          />
        </div>

        {/* Botões */}
        <div className="flex w-full gap-3">
          <button
            type="button"
            onClick={() => setDuplicateModal(null)}
            className="flex-1 rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleDuplicate()}
            disabled={!duplicateNome.trim()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-violet-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-50"
          >
            <Copy className="h-4 w-4" />
            Duplicar
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {deleteConfirmModal}
      {duplicateModal_el}

      {successMsg && (
        <div className="mb-3 flex items-center gap-2.5 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          {successMsg}
        </div>
      )}

      {error && (
        <p className="mb-3 rounded-xl bg-rose-50 px-4 py-2 text-xs text-rose-700">{error}</p>
      )}

      <ul className="mt-4 space-y-3">
        {visibleTemplates.map((template) => {
          const isDeleted = Boolean(template.deletado);
          return (
            <li
              key={template.id}
              className={`rounded-2xl border p-4 transition ${isDeleted ? "border-slate-100 bg-slate-50/50 opacity-70" : "border-slate-200 bg-slate-50 hover:border-slate-300"}`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className={`mt-0.5 rounded-xl p-2 shadow-sm ${isDeleted ? "bg-slate-100 text-slate-400" : "bg-white text-slate-500"}`}>
                    <FileText className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className={`font-semibold ${isDeleted ? "text-slate-400 line-through" : "text-slate-900"}`}>
                        {template.nome}
                      </p>
                      {isDeleted && (
                        <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-500">
                          excluído
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
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

                {isDeleted ? null : (
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

                    <button
                      type="button"
                      onClick={() => openDuplicateModal(template)}
                      disabled={duplicatingId === template.id}
                      title="Criar uma cópia deste template"
                      className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {duplicatingId === template.id ? "Duplicando…" : "Duplicar"}
                    </button>

                    <Link
                      href={`/dashboard/templates/${template.id}/editar`}
                      className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                      Editar
                    </Link>

                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(template.id)}
                      disabled={deletingId === template.id}
                      className="flex items-center gap-1.5 rounded-xl border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:border-rose-500 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {deletingId === template.id ? "Excluindo…" : "Excluir"}
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
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
