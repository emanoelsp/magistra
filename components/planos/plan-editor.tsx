"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Loader2,
  Save,
  Sparkles,
  WandSparkles,
} from "lucide-react";

import { planosService } from "../../lib/services/firestore/planos.service";
import type { IaSugestao, TemplateFieldSchema, TemplateRecord } from "../../lib/types/firestore";
import { RichTextEditor, htmlToPlainText } from "../editor/RichTextEditor";

export interface PlanEditorHandle {
  getCurrentValues: () => Record<string, string>;
}

interface PlanEditorProps {
  template: TemplateRecord;
  userId: string;
  userName: string;
  wizardMode?: boolean;
  initialValues?: Record<string, string>;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

const GROUP_LABELS: Record<string, string> = {
  dados_turma: "Dados fixos",
  objetivos: "Objetivos",
  competencias: "Competências",
  habilidades: "Habilidades",
  conteudos: "Conteúdos",
  avaliacao: "Avaliação",
  outros: "Outros campos",
};

function groupFields(fields: TemplateFieldSchema[]) {
  const groups: Record<string, TemplateFieldSchema[]> = {};
  for (const field of fields) {
    const g = field.group ?? (field.role === "manual" ? "dados_turma" : "outros");
    if (!groups[g]) groups[g] = [];
    groups[g].push(field);
  }
  return groups;
}

function extractMetadata(
  values: Record<string, string>,
  fields: TemplateFieldSchema[],
): Record<string, string> {
  const manualFields = fields.filter((f) => f.role === "manual" || f.group === "dados_turma");
  const meta: Record<string, string> = {};
  for (const f of manualFields) {
    if (values[f.key]?.trim()) {
      meta[f.key] = values[f.key].trim();
    }
  }
  return meta;
}

function isMetadataComplete(metadata: Record<string, string>): boolean {
  const filled = Object.values(metadata).filter((v) => v.trim().length >= 2);
  return filled.length >= 2;
}

export const PlanEditor = forwardRef<PlanEditorHandle, PlanEditorProps>(function PlanEditor(
  { template, userId, userName, wizardMode = false, initialValues },
  ref,
) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const schema = template.schema_campos ?? [];
  const manualFields = schema.filter(
    (f) => f.role === "manual" || f.group === "dados_turma" || (!f.role && !f.group),
  );
  const iaFields = schema.filter((f) => f.role === "ia_sugerida");
  const groupedIA = groupFields(iaFields);

  const [values, setValues] = useState<Record<string, string>>(() => {
    if (initialValues) return initialValues;
    const initial: Record<string, string> = {};
    for (const f of schema) initial[f.key] = "";
    if (template.escola_nome) {
      const escolaField = manualFields.find(
        (f) => f.key.includes("escola") || f.label.toLowerCase().includes("escola"),
      );
      if (escolaField) initial[escolaField.key] = template.escola_nome;
    }
    return initial;
  });

  useImperativeHandle(ref, () => ({
    getCurrentValues: () => values,
  }));

  const [activeFieldKey, setActiveFieldKey] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, IaSugestao[]>>({});
  const [loadingField, setLoadingField] = useState<string | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [planoId, setPlanoId] = useState<string | null>(null);
  const [autoSuggestedOnce, setAutoSuggestedOnce] = useState(false);

  const activeField = schema.find((f) => f.key === activeFieldKey) ?? null;
  const activeSuggestions = activeFieldKey ? (suggestions[activeFieldKey] ?? []) : [];
  const metadata = extractMetadata(values, schema);
  const metadataComplete = isMetadataComplete(metadata);

  const setFieldValue = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const fetchSuggestionsForField = useCallback(
    async (field: TemplateFieldSchema, meta: Record<string, string>) => {
      if (loadingField) return;
      setSuggestError(null);
      setLoadingField(field.key);
      try {
        const res = await fetch("/api/ia/campo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            templateId: template.id,
            fieldKey: field.key,
            fieldLabel: field.label,
            fieldGroup: field.group,
            metadata: meta,
          }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error ?? "Falha ao buscar sugestões.");
        }
        const data = (await res.json()) as { sugestoes: IaSugestao[] };
        setSuggestions((prev) => ({
          ...prev,
          [field.key]: Array.isArray(data.sugestoes) ? data.sugestoes : [],
        }));
      } catch (err) {
        setSuggestError(err instanceof Error ? err.message : "Erro ao gerar sugestões.");
      } finally {
        setLoadingField(null);
      }
    },
    [template.id, loadingField],
  );

  // Auto-suggest todos os campos ia quando metadata fica completa pela primeira vez
  useEffect(() => {
    if (!metadataComplete || autoSuggestedOnce || iaFields.length === 0) return;
    setAutoSuggestedOnce(true);
    const firstIaField = iaFields[0];
    if (firstIaField) {
      void fetchSuggestionsForField(firstIaField, metadata);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metadataComplete]);

  function insertSuggestion(suggestion: IaSugestao) {
    if (!activeFieldKey) return;
    const field = schema.find((f) => f.key === activeFieldKey);
    const current = values[activeFieldKey] ?? "";
    if (field?.role === "ia_sugerida") {
      const isEmpty = !current || current === "<p></p>";
      setFieldValue(
        activeFieldKey,
        isEmpty ? `<p>${suggestion.label}</p>` : `${current}<p>${suggestion.label}</p>`,
      );
    } else {
      const separator = current.trim() ? "\n" : "";
      setFieldValue(activeFieldKey, current + separator + suggestion.label);
    }
  }

  async function savePlano(status: "rascunho" | "gerado"): Promise<string> {
    // Save HTML as-is — htmlToPlainText is applied at download time so rich text persists across sessions
    const conteudo: Record<string, unknown> = {
      criado_por: userName,
      template_nome: template.nome,
      ...values,
    };

    if (planoId) {
      await planosService.updatePlano(planoId, { conteudo_gerado: conteudo, status });
      return planoId;
    }

    const id = await planosService.createPlano({
      user_id: userId,
      template_id: template.id,
      conteudo_gerado: conteudo,
      status,
    });
    setPlanoId(id);
    return id;
  }

  function handleSaveRascunho() {
    setSaveStatus("saving");
    startTransition(() => {
      void savePlano("rascunho")
        .then(() => {
          setSaveStatus("saved");
          setTimeout(() => setSaveStatus("idle"), 2500);
        })
        .catch(() => {
          setSaveStatus("error");
          setTimeout(() => setSaveStatus("idle"), 3000);
        });
    });
  }

  function handleFinalizar() {
    setSaveStatus("saving");
    startTransition(() => {
      void savePlano("gerado")
        .then((id) => {
          setSaveStatus("saved");
          window.open(`/api/planos/${id}/download`, "_blank");
          setTimeout(() => router.push("/dashboard/historico"), 1000);
        })
        .catch(() => {
          setSaveStatus("error");
          setTimeout(() => setSaveStatus("idle"), 3000);
        });
    });
  }

  const isSaving = saveStatus === "saving" || isPending;

  return (
    <div
      className="flex flex-col gap-4"
      style={wizardMode ? undefined : { height: "calc(100vh - 190px)" }}
    >
      {/* Toolbar — standalone mode only */}
      {!wizardMode && (
        <header className="flex shrink-0 items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="flex items-center gap-1.5 rounded-xl px-2 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
            >
              <ArrowLeft className="h-4 w-4" />
              Voltar
            </button>
            <div className="h-4 w-px bg-slate-200" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-600">
                Editor de plano
              </p>
              <h1 className="text-base font-semibold text-slate-950">{template.nome}</h1>
            </div>
            {template.escola_nome && (
              <span className="hidden rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600 sm:inline">
                {template.escola_nome}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {saveStatus === "saved" && (
              <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Salvo
              </span>
            )}
            {saveStatus === "error" && (
              <span className="text-xs font-medium text-rose-600">Falha ao salvar</span>
            )}
            <button
              type="button"
              onClick={handleSaveRascunho}
              disabled={isSaving}
              className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950 disabled:opacity-50"
            >
              {isSaving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Salvar rascunho
            </button>
            <button
              type="button"
              onClick={handleFinalizar}
              disabled={isSaving}
              className="flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              Finalizar e baixar PDF
            </button>
          </div>
        </header>
      )}

      {/* Split view */}
      <div className={`flex overflow-hidden rounded-2xl border border-slate-200 bg-white ${wizardMode ? "h-[620px]" : "flex-1"}`}>
        {/* Left: template form editor */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {schema.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center">
              <p className="font-medium text-slate-700">
                Este template não tem campos extraídos ainda.
              </p>
              <p className="mt-2 text-sm text-slate-500">
                Edite o template para adicionar campos manualmente.
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              {/* Manual fields */}
              {manualFields.length > 0 && (
                <section>
                  <div className="mb-4 flex items-center gap-2">
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
                      Dados fixos
                    </span>
                    <p className="text-xs text-slate-500">Preencha as informações da turma</p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    {manualFields.map((field) => (
                      <FieldInput
                        key={field.key}
                        field={field}
                        value={values[field.key] ?? ""}
                        active={activeFieldKey === field.key}
                        onChange={(v) => setFieldValue(field.key, v)}
                        onFocus={() => setActiveFieldKey(field.key)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* IA fields grouped */}
              {Object.entries(groupedIA).map(([group, fields]) => (
                <section key={group}>
                  <div className="mb-4 flex items-center gap-2">
                    <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-700">
                      {GROUP_LABELS[group] ?? group}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-slate-500">
                      <Sparkles className="h-3 w-3 text-violet-400" />
                      IA pode sugerir
                    </span>
                  </div>
                  <div className="space-y-4">
                    {fields.map((field) => (
                      <IaFieldInput
                        key={field.key}
                        field={field}
                        value={values[field.key] ?? ""}
                        active={activeFieldKey === field.key}
                        hasSuggestions={(suggestions[field.key]?.length ?? 0) > 0}
                        isLoading={loadingField === field.key}
                        metadataComplete={metadataComplete}
                        onChange={(v) => setFieldValue(field.key, v)}
                        onFocus={() => setActiveFieldKey(field.key)}
                        onSuggest={() => void fetchSuggestionsForField(field, metadata)}
                      />
                    ))}
                  </div>
                </section>
              ))}

              {/* Caso o schema tenha campos sem role */}
              {schema.filter((f) => !f.role && f.group !== "dados_turma").length > 0 && (
                <section>
                  <div className="mb-4">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                      Outros campos
                    </span>
                  </div>
                  <div className="space-y-4">
                    {schema
                      .filter((f) => !f.role && f.group !== "dados_turma")
                      .map((field) => (
                        <FieldInput
                          key={field.key}
                          field={field}
                          value={values[field.key] ?? ""}
                          active={activeFieldKey === field.key}
                          onChange={(v) => setFieldValue(field.key, v)}
                          onFocus={() => setActiveFieldKey(field.key)}
                        />
                      ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>

        {/* Right: AI suggestions panel */}
        <div className="w-80 shrink-0 overflow-y-auto border-l border-slate-200 bg-slate-50 xl:w-96">
          <AISuggestionsPanel
            activeField={activeField}
            suggestions={activeSuggestions}
            isLoading={loadingField === activeFieldKey}
            error={suggestError}
            metadata={metadata}
            metadataComplete={metadataComplete}
            onInsert={insertSuggestion}
            onGenerate={() => {
              if (activeField) void fetchSuggestionsForField(activeField, metadata);
            }}
          />
        </div>
      </div>
    </div>
  );
});

// ─── Sub-components ────────────────────────────────────────────────────────────

interface FieldInputProps {
  field: TemplateFieldSchema;
  value: string;
  active: boolean;
  onChange: (v: string) => void;
  onFocus: () => void;
}

function FieldInput({ field, value, active, onChange, onFocus }: FieldInputProps) {
  const baseInput =
    "w-full rounded-2xl border bg-white px-4 py-3 text-sm text-slate-950 outline-none transition";
  const activeClass = active
    ? "border-violet-400 ring-2 ring-violet-100"
    : "border-slate-300 focus:border-violet-400 focus:ring-2 focus:ring-violet-100";

  return (
    <label className="block">
      <span className="block text-sm font-medium text-slate-700">{field.label}</span>
      {field.required && <span className="text-xs text-rose-500"> *</span>}
      {field.helperText && (
        <span className="block text-xs text-slate-500">{field.helperText}</span>
      )}
      {field.type === "textarea" ? (
        <textarea
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          placeholder={field.placeholder ?? `Ex.: ${field.label.toLowerCase()}`}
          className={`mt-1.5 ${baseInput} ${activeClass}`}
        />
      ) : field.type === "number" ? (
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          className={`mt-1.5 ${baseInput} ${activeClass}`}
        />
      ) : field.type === "select" && field.options ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          className={`mt-1.5 ${baseInput} ${activeClass}`}
        >
          <option value="">Selecione…</option>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          placeholder={field.placeholder ?? `Ex.: ${field.label.toLowerCase()}`}
          className={`mt-1.5 ${baseInput} ${activeClass}`}
        />
      )}
    </label>
  );
}

interface IaFieldInputProps extends FieldInputProps {
  hasSuggestions: boolean;
  isLoading: boolean;
  metadataComplete: boolean;
  onSuggest: () => void;
}

function IaFieldInput({
  field,
  value,
  active,
  hasSuggestions,
  isLoading,
  metadataComplete,
  onChange,
  onFocus,
  onSuggest,
}: IaFieldInputProps) {
  // Auto-fetch suggestions the first time this field becomes active
  useEffect(() => {
    if (active && !hasSuggestions && !isLoading && metadataComplete) {
      onSuggest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <div className={`rounded-2xl border bg-white p-4 transition ${active ? "border-violet-300 shadow-sm" : "border-slate-200"}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <span className="text-sm font-medium text-slate-800">{field.label}</span>
          {field.required && <span className="ml-1 text-xs text-rose-500">*</span>}
        </div>
        <button
          type="button"
          onClick={() => {
            onFocus();
            onSuggest();
          }}
          disabled={isLoading || !metadataComplete}
          title={
            !metadataComplete
              ? "Preencha ao menos dois dados fixos para sugerir"
              : "Gerar sugestões da IA"
          }
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-violet-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <WandSparkles className="h-3 w-3" />
          )}
          {hasSuggestions ? "Novas sugestões" : "Sugerir IA"}
        </button>
      </div>

      {field.helperText && (
        <p className="mb-2 text-xs text-slate-500">{field.helperText}</p>
      )}

      <RichTextEditor
        value={value}
        onChange={onChange}
        onFocus={onFocus}
        active={active}
        placeholder={
          metadataComplete
            ? `Clique em "Sugerir IA" ou escreva aqui…`
            : `Preencha os dados fixos para habilitar sugestões…`
        }
      />
    </div>
  );
}

interface AISuggestionsPanelProps {
  activeField: TemplateFieldSchema | null;
  suggestions: IaSugestao[];
  isLoading: boolean;
  error: string | null;
  metadata: Record<string, string>;
  metadataComplete: boolean;
  onInsert: (s: IaSugestao) => void;
  onGenerate: () => void;
}

function AISuggestionsPanel({
  activeField,
  suggestions,
  isLoading,
  error,
  metadata,
  metadataComplete,
  onInsert,
  onGenerate,
}: AISuggestionsPanelProps) {
  const metaEntries = Object.entries(metadata).slice(0, 4);

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="rounded-xl bg-violet-100 p-2 text-violet-600">
          <Sparkles className="h-4 w-4" />
        </span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-600">
            PlanoMagistra IA
          </p>
          <p className="text-sm font-medium text-slate-800">
            {activeField ? activeField.label : "Sugestões por campo"}
          </p>
        </div>
      </div>

      {/* Context */}
      {metaEntries.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Contexto
          </p>
          <div className="space-y-1">
            {metaEntries.map(([k, v]) => (
              <p key={k} className="text-xs text-slate-700">
                <span className="font-medium capitalize">{k.replace(/_/g, " ")}:</span>{" "}
                <span>{v}</span>
              </p>
            ))}
          </div>
          {!metadataComplete && (
            <p className="mt-2 text-xs text-amber-600">
              Preencha ao menos dois dados fixos para ativar as sugestões.
            </p>
          )}
        </div>
      )}

      {/* No field selected */}
      {!activeField && (
        <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center">
          <WandSparkles className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm text-slate-500">
            Clique em um campo pedagógico para ver sugestões da IA.
          </p>
        </div>
      )}

      {/* Loading */}
      {isLoading && activeField && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 p-6">
          <Loader2 className="h-6 w-6 animate-spin text-violet-600" />
          <p className="text-center text-sm text-violet-700">
            Gerando sugestões para "{activeField.label}"…
          </p>
        </div>
      )}

      {/* Error */}
      {error && !isLoading && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
          <p className="text-xs font-medium text-rose-700">{error}</p>
          {activeField && (
            <button
              type="button"
              onClick={onGenerate}
              className="mt-2 text-xs font-medium text-rose-600 underline hover:text-rose-800"
            >
              Tentar novamente
            </button>
          )}
        </div>
      )}

      {/* Suggestions */}
      {!isLoading && suggestions.length > 0 && activeField && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Sugestões ({suggestions.length})
          </p>
          {suggestions.map((s) => (
            <div
              key={s.id}
              className="rounded-xl border border-slate-200 bg-white p-3 transition hover:border-violet-300 hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-900">{s.label}</p>
                  {s.descricao && (
                    <p className="mt-1 text-xs text-slate-600">{s.descricao}</p>
                  )}
                  {s.fonte && (
                    <span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                      {s.fonte}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onInsert(s)}
                  className="shrink-0 rounded-lg bg-violet-100 px-2 py-1 text-xs font-medium text-violet-700 transition hover:bg-violet-600 hover:text-white"
                >
                  Inserir
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty suggestions after loading */}
      {!isLoading && !error && suggestions.length === 0 && activeField && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Nenhuma sugestão carregada para "{activeField.label}".
          </p>
          <button
            type="button"
            onClick={onGenerate}
            disabled={!metadataComplete}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-violet-300 bg-white px-4 py-2.5 text-sm font-medium text-violet-700 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <WandSparkles className="h-4 w-4" />
            Gerar sugestões
          </button>
        </div>
      )}

      {/* Generate button when suggestions already loaded */}
      {!isLoading && suggestions.length > 0 && activeField && (
        <button
          type="button"
          onClick={onGenerate}
          disabled={!metadataComplete}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs font-medium text-violet-600 transition hover:border-violet-400 hover:bg-violet-50 disabled:opacity-50"
        >
          <WandSparkles className="h-3.5 w-3.5" />
          Gerar novas sugestões
        </button>
      )}

      {/* Tip */}
      <div className="mt-auto rounded-xl bg-slate-100 p-3">
        <p className="text-xs text-slate-500">
          <span className="font-medium">Dica:</span> Preencha os dados fixos (turma, ano,
          disciplina) para que a IA sugira conteúdo específico alinhado ao BNCC e SAEB.
        </p>
      </div>
    </div>
  );
}
