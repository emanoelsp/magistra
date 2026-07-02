"use client";

import { useState } from "react";
import { BookOpen, Check, Sparkles, Trash2, Upload, X } from "lucide-react";
import type { PlanoRegenteConteudo, PlanoRegenteRecord } from "../../lib/types/firestore";
import type { TemplateFieldSchema } from "../../lib/types/firestore";
import { showMagisToast } from "../../lib/utils/magis-toast";

// Mapeamento grupo do campo → chave do conteúdo extraído
const GROUP_TO_CONTEUDO: Record<string, keyof PlanoRegenteConteudo> = {
  objetivos: "objetivos",
  competencias: "competencias",
  habilidades: "habilidades",
  conteudos: "conteudos",
  avaliacao: "avaliacao",
  outros: "outros",
};

function getConteudoParaGrupo(conteudo: PlanoRegenteConteudo, group?: string): string {
  if (!group) return conteudo.outros ?? "";
  const key = GROUP_TO_CONTEUDO[group];
  if (key && conteudo[key]) return conteudo[key]!;
  // fallback: joins all non-empty fields
  return Object.values(conteudo).filter(Boolean).join("\n\n");
}

// ── Uploader inline (dentro do picker) ──────────────────────────────────────

function UploadZone({
  onUploaded,
}: {
  onUploaded: (novos: PlanoRegenteRecord[]) => void;
}) {
  const [uploading, setUploading] = useState(false);

  async function handleFiles(files: File[]) {
    if (!files.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f));
      const res = await fetch("/api/planos-regente", { method: "POST", body: fd });
      const data = (await res.json()) as { ok?: boolean; planos?: PlanoRegenteRecord[]; errors?: { arquivo: string; erro: string }[] };
      if (data.planos?.length) {
        onUploaded(data.planos);
        showMagisToast(`${data.planos.length} plano(s) extraído(s)!`, "success");
      }
      if (data.errors?.length) {
        data.errors.forEach((e) => showMagisToast(`${e.arquivo}: ${e.erro}`, "error"));
      }
    } catch {
      showMagisToast("Erro ao enviar arquivos.", "error");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center cursor-pointer hover:border-violet-400 hover:bg-violet-50 transition"
      onClick={() => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".pdf,.docx,.doc";
        input.multiple = true;
        input.onchange = () => { if (input.files) void handleFiles(Array.from(input.files)); };
        input.click();
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const dropped = Array.from(e.dataTransfer.files).filter((f) =>
          /\.(pdf|docx|doc)$/i.test(f.name)
        );
        if (dropped.length) void handleFiles(dropped);
      }}
    >
      <Upload className="h-5 w-5 text-slate-400" />
      <p className="text-sm font-medium text-slate-600">
        {uploading ? "Extraindo com IA…" : "Arraste ou clique para enviar PDFs do regente"}
      </p>
      <p className="text-xs text-slate-400">PDF, DOCX · múltiplos arquivos · máx. 10 MB cada</p>
    </div>
  );
}

// ── Picker modal ─────────────────────────────────────────────────────────────

interface PlanoRegentePickerProps {
  field: TemplateFieldSchema;
  planos: PlanoRegenteRecord[];
  usedPlanIds: Set<string>;
  planoPeiId?: string;
  onSelect: (plano: PlanoRegenteRecord, conteudo: string) => void;
  onClose: () => void;
  onPlanosChange: (planos: PlanoRegenteRecord[]) => void;
}

export function PlanoRegentePicker({
  field,
  planos,
  usedPlanIds,
  planoPeiId,
  onSelect,
  onClose,
  onPlanosChange,
}: PlanoRegentePickerProps) {
  const [deleting, setDeleting] = useState<string | null>(null);

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await fetch(`/api/planos-regente/${id}`, { method: "DELETE" });
      onPlanosChange(planos.filter((p) => p.id !== id));
      showMagisToast("Plano removido.", "success");
    } catch {
      showMagisToast("Erro ao remover.", "error");
    } finally {
      setDeleting(null);
    }
  }

  async function handleSelect(plano: PlanoRegenteRecord) {
    const conteudo = getConteudoParaGrupo(plano.conteudo, field.group);
    if (!conteudo.trim()) {
      showMagisToast(`Nenhum conteúdo de "${field.group ?? "outros"}" encontrado neste plano.`, "error");
      return;
    }

    // Mark as used in Firestore
    if (planoPeiId) {
      void fetch(`/api/planos-regente/${plano.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plano_pei_id: planoPeiId }),
      });
    }

    onSelect(plano, conteudo);
    onClose();
  }

  const GROUP_LABEL: Record<string, string> = {
    objetivos: "Objetivos",
    competencias: "Competências",
    habilidades: "Habilidades",
    conteudos: "Conteúdos",
    avaliacao: "Avaliação",
    metodologia: "Metodologia",
    outros: "Outros",
  };
  const groupLabel = GROUP_LABEL[field.group ?? "outros"] ?? "Conteúdo";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 backdrop-blur-sm"
      style={{ background: "rgba(0,0,0,0.55)" }}
    >
      <div className="flex w-full max-w-md flex-col overflow-hidden rounded-3xl shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 bg-indigo-700 px-5 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20">
            <BookOpen className="h-4 w-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white leading-tight">Importar do plano do regente</p>
            <p className="text-[11px] text-indigo-300">Campo: {field.label} · {groupLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full text-white/60 hover:bg-white/20 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[70vh] overflow-y-auto bg-[#ece5dd] px-4 py-4 space-y-3">
          {/* Magis bubble */}
          <div className="flex items-end gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 shadow-sm mb-0.5">
              <Sparkles className="h-3 w-3 text-white" />
            </div>
            <div className="max-w-[82%] rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 shadow-sm">
              <p className="text-sm leading-snug text-slate-800">
                Escolha o plano do professor regente para importar o campo <strong>{groupLabel}</strong>. Depois peça à Magis para adaptar para o seu aluno.
              </p>
            </div>
          </div>

          {/* Upload zone (always visible to add more) */}
          <UploadZone onUploaded={(novos) => onPlanosChange([...planos, ...novos])} />

          {/* Plan list */}
          {planos.length > 0 && (
            <ul className="space-y-2">
              {planos.map((plano) => {
                const conteudoCampo = getConteudoParaGrupo(plano.conteudo, field.group);
                const temConteudo = !!conteudoCampo.trim();
                const jaUsado = usedPlanIds.has(plano.id);

                return (
                  <li
                    key={plano.id}
                    className={`rounded-2xl border bg-white p-3 shadow-sm transition ${temConteudo ? "border-slate-200 hover:border-indigo-300" : "border-slate-100 opacity-60"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                            {plano.disciplina}
                          </span>
                          {jaUsado && (
                            <span className="flex items-center gap-0.5 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                              <Check className="h-3 w-3" />
                              Usado
                            </span>
                          )}
                          {!temConteudo && (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                              sem {groupLabel}
                            </span>
                          )}
                        </div>
                        {plano.professor && (
                          <p className="mt-0.5 text-xs text-slate-500 truncate">Prof. {plano.professor}</p>
                        )}
                        <p className="mt-0.5 text-xs text-slate-400 truncate">{plano.arquivo_nome}</p>
                        {temConteudo && (
                          <p className="mt-1 text-xs text-slate-500 line-clamp-2">{conteudoCampo.slice(0, 140)}{conteudoCampo.length > 140 ? "…" : ""}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void handleDelete(plano.id)}
                          disabled={deleting === plano.id}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-500 transition"
                          title="Remover da biblioteca"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleSelect(plano)}
                          disabled={!temConteudo}
                          className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Importar
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {planos.length === 0 && (
            <p className="text-center text-xs text-slate-500 py-2">
              Nenhum plano do regente na biblioteca. Faça o upload acima.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
