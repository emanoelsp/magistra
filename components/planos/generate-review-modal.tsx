"use client";

/**
 * GenerateReviewModal
 *
 * Calls /api/ia/gerar-plano (ONE Pinecone retrieval, parallel AI per field),
 * then shows a review screen where the teacher can accept, edit, or skip each
 * generated field before inserting into the editor.
 */

import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Loader2,
  SkipForward,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import type { IaSugestao, TemplateFieldSchema } from "../../lib/types/firestore";

export interface ReviewField {
  fieldSchema: TemplateFieldSchema;
  sugestoes: IaSugestao[];
  error?: string;
}

export interface GenerateReviewModalProps {
  templateId: string;
  /** Fields the user wants to generate (all pedagogico fields when undefined). */
  fieldKeys?: string[];
  /** Flat metadata: disciplina, turma, escola, etc. */
  metadata: Record<string, string>;
  estudanteNome?: string;
  estudanteContexto?: string;
  onClose: () => void;
  /**
   * Called when the teacher confirms.
   * key → { value (html for ia_sugerida, text otherwise), sugestoes }
   */
  onApply: (result: Record<string, { value: string; sugestoes: IaSugestao[] }>) => void;
}

interface FieldState {
  schema: TemplateFieldSchema;
  sugestoes: IaSugestao[];
  selectedIdx: number; // index into sugestoes
  customText: string;  // teacher-edited text (starts from label of selected suggestion)
  skipped: boolean;
  error?: string;
}

function buildInsertValue(s: IaSugestao, role: string | undefined): string {
  if (role === "ia_sugerida") {
    return s.descricao
      ? `<p><strong>${s.label}</strong></p><p>${s.descricao}</p>`
      : `<p>${s.label}</p>`;
  }
  return s.descricao ? `${s.label}: ${s.descricao}` : s.label;
}

function SugestaoTabs({
  sugestoes,
  selectedIdx,
  onSelect,
}: {
  sugestoes: IaSugestao[];
  selectedIdx: number;
  onSelect: (idx: number) => void;
}) {
  if (sugestoes.length <= 1) return null;
  return (
    <div className="flex gap-1 flex-wrap">
      {sugestoes.map((s, i) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onSelect(i)}
          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${
            i === selectedIdx
              ? "border-violet-300 bg-violet-100 text-violet-700"
              : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700"
          }`}
        >
          Opção {i + 1}
        </button>
      ))}
    </div>
  );
}

function FieldCard({
  state,
  onChange,
  onSkip,
}: {
  state: FieldState;
  onChange: (patch: Partial<FieldState>) => void;
  onSkip: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const selected = state.sugestoes[state.selectedIdx];

  function handleSelectSugestao(idx: number) {
    const s = state.sugestoes[idx];
    if (!s) return;
    onChange({ selectedIdx: idx, customText: buildInsertValue(s, state.schema.role) });
  }

  const cardBase = "rounded-2xl border p-4 transition";
  const cardClass = state.skipped
    ? `${cardBase} border-slate-100 bg-slate-50 opacity-50`
    : state.error
    ? `${cardBase} border-rose-200 bg-rose-50`
    : `${cardBase} border-violet-100 bg-white`;

  return (
    <div className={cardClass}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 leading-tight">{state.schema.label}</p>
          {state.schema.group && (
            <p className="mt-0.5 text-[11px] uppercase tracking-wide font-medium text-slate-400">{state.schema.group}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onSkip}
          title={state.skipped ? "Incluir campo" : "Pular campo"}
          className={`shrink-0 rounded-full p-1 transition ${
            state.skipped
              ? "bg-slate-200 text-slate-500 hover:bg-slate-300"
              : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          }`}
        >
          <SkipForward className="h-3.5 w-3.5" />
        </button>
      </div>

      {!state.skipped && !state.error && (
        <div className="mt-3 space-y-2">
          {/* Alternative selectors */}
          <SugestaoTabs sugestoes={state.sugestoes} selectedIdx={state.selectedIdx} onSelect={handleSelectSugestao} />

          {/* Source badge */}
          {selected?.fonte && (
            <p className="text-[10px] text-violet-600 font-medium">{selected.fonte}</p>
          )}
          {selected?.aviso && (
            <p className="rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-[11px] text-amber-700">
              {selected.aviso}
            </p>
          )}

          {/* Editable text */}
          <div>
            <button
              type="button"
              className="flex items-center gap-1 text-[10px] font-medium text-slate-400 hover:text-slate-600 mb-1"
              onClick={() => setExpanded((e) => !e)}
            >
              <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
              {expanded ? "Ocultar editor" : "Editar texto"}
            </button>
            {expanded ? (
              <textarea
                rows={4}
                value={state.customText}
                onChange={(e) => onChange({ customText: e.target.value })}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-violet-400 resize-none"
              />
            ) : (
              <p className="text-sm text-slate-700 leading-relaxed line-clamp-3">
                {state.customText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}
              </p>
            )}
          </div>
        </div>
      )}

      {state.error && (
        <p className="mt-2 text-xs text-rose-600">{state.error}</p>
      )}
    </div>
  );
}

export function GenerateReviewModal({
  templateId,
  fieldKeys,
  metadata,
  estudanteNome,
  estudanteContexto,
  onClose,
  onApply,
}: GenerateReviewModalProps) {
  const [phase, setPhase] = useState<"loading" | "review" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fieldStates, setFieldStates] = useState<FieldState[]>([]);
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null);
  const abortRef = useRef(false);

  useEffect(() => {
    abortRef.current = false;

    fetch("/api/ia/gerar-plano", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId, fieldKeys, metadata, estudanteNome, estudanteContexto }),
    })
      .then(async (res) => {
        if (abortRef.current) return;
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(d.error ?? `Erro HTTP ${res.status}`);
        }
        return res.json() as Promise<{
          fields: Record<string, { label: string; sugestoes: IaSugestao[]; error?: string }>;
          quotaRemaining: number;
        }>;
      })
      .then((data) => {
        if (abortRef.current || !data) return;
        setQuotaRemaining(data.quotaRemaining);

        const states: FieldState[] = Object.entries(data.fields).map(([key, f]) => {
          const firstSug = f.sugestoes[0];
          const fakeSchema: TemplateFieldSchema = { key, label: f.label, type: "text", required: false };
          return {
            schema:      fakeSchema,
            sugestoes:   f.sugestoes,
            selectedIdx: 0,
            customText:  firstSug ? buildInsertValue(firstSug, undefined) : "",
            skipped:     f.sugestoes.length === 0,
            error:       f.error ?? (f.sugestoes.length === 0 ? "Não foi possível gerar sugestões." : undefined),
          };
        });

        setFieldStates(states);
        setPhase("review");
      })
      .catch((err: unknown) => {
        if (abortRef.current) return;
        setErrorMsg((err as Error).message ?? "Erro desconhecido.");
        setPhase("error");
      });

    return () => { abortRef.current = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateField(idx: number, patch: Partial<FieldState>) {
    setFieldStates((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  function handleApply() {
    const result: Record<string, { value: string; sugestoes: IaSugestao[] }> = {};
    for (const s of fieldStates) {
      if (s.skipped || !s.customText.trim()) continue;
      result[s.schema.key] = { value: s.customText, sugestoes: s.sugestoes };
    }
    onApply(result);
    onClose();
  }

  const acceptedCount = fieldStates.filter((s) => !s.skipped && s.customText.trim()).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="flex h-full max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-600">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">Revisar sugestões da Magis</p>
              {phase === "review" && (
                <p className="text-[11px] text-slate-500">
                  {acceptedCount} campo{acceptedCount !== 1 ? "s" : ""} prontos para inserir
                  {quotaRemaining !== null && quotaRemaining >= 0 && (
                    <span className="ml-1 text-slate-400">· {quotaRemaining} crédito{quotaRemaining !== 1 ? "s" : ""} restante{quotaRemaining !== 1 ? "s" : ""}</span>
                  )}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {phase === "loading" && (
            <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-violet-100">
                <WandSparkles className="h-6 w-6 animate-pulse text-violet-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">Magis está gerando o plano…</p>
                <p className="mt-1 text-xs text-slate-500">Consultando BNCC e currículos em um único acesso ao banco de conhecimento.</p>
              </div>
              <Loader2 className="h-5 w-5 animate-spin text-violet-500" />
            </div>
          )}

          {phase === "error" && (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <p className="text-sm font-semibold text-rose-700">Não foi possível gerar o plano</p>
              <p className="text-xs text-slate-500">{errorMsg}</p>
              <button type="button" onClick={onClose} className="rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-medium text-white">
                Fechar
              </button>
            </div>
          )}

          {phase === "review" && (
            <div className="space-y-3">
              {fieldStates.length === 0 && (
                <p className="py-8 text-center text-sm text-slate-500">Nenhum campo pedagógico encontrado no template.</p>
              )}
              {fieldStates.map((s, i) => (
                <FieldCard
                  key={s.schema.key}
                  state={s}
                  onChange={(patch) => updateField(i, patch)}
                  onSkip={() => updateField(i, { skipped: !s.skipped })}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {phase === "review" && (
          <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={acceptedCount === 0}
              onClick={handleApply}
              className="flex items-center gap-2 rounded-2xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Check className="h-4 w-4" />
              Inserir {acceptedCount} campo{acceptedCount !== 1 ? "s" : ""}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
