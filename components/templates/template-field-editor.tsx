"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  GripVertical,
  HelpCircle,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import type { TemplateFieldSchema, TemplateRecord } from "../../lib/types/firestore";
import { ESTADOS_BRASIL } from "../../lib/constants/estados-brasil";
import { OfficeInlineViewer } from "../shared/office-inline-viewer";

interface TemplateFieldEditorProps {
  template: TemplateRecord;
  mode?: "edit" | "confirm";
}

const FIELD_TYPES: TemplateFieldSchema["type"][] = [
  "text",
  "textarea",
  "number",
  "date",
  "select",
  "multiselect",
];

const FIELD_ROLES: Array<{ value: TemplateFieldSchema["role"]; label: string }> = [
  { value: "manual", label: "Metadado fixo (professor preenche)" },
  { value: "ia_sugerida", label: "Campo IA (sugestão automática)" },
];

const FIELD_GROUPS: Array<{ value: TemplateFieldSchema["group"]; label: string }> = [
  { value: "dados_turma", label: "Dados da turma" },
  { value: "objetivos", label: "Objetivos" },
  { value: "competencias", label: "Competências" },
  { value: "habilidades", label: "Habilidades" },
  { value: "conteudos", label: "Conteúdos" },
  { value: "avaliacao", label: "Avaliação" },
  { value: "outros", label: "Outros" },
];

function newField(): TemplateFieldSchema {
  return {
    key: `campo_${Date.now()}`,
    label: "",
    type: "text",
    required: false,
    role: "manual",
    group: "dados_turma",
    placeholder: "",
    helperText: "",
    aiInstructions: "",
  };
}

// ─── TemplateFieldEditor ──────────────────────────────────────────────────────

export function TemplateFieldEditor({ template, mode = "edit" }: TemplateFieldEditorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [nome, setNome] = useState(template.nome);
  const [estado, setEstado] = useState(template.estado ?? "");
  const [fields, setFields] = useState<TemplateFieldSchema[]>(
    template.schema_campos.length > 0 ? [...template.schema_campos] : [],
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isReExtracting, setIsReExtracting] = useState(false);
  const [reExtractMsg, setReExtractMsg] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [activeFieldKey, setActiveFieldKey] = useState<string | null>(null);
  const [expandedField, setExpandedField] = useState<string | null>(null);
  const [showConfirmSuccess, setShowConfirmSuccess] = useState(false);
  const [previewVersion, setPreviewVersion] = useState(0);

  const fieldListRef = useRef<HTMLDivElement>(null);
  const panelScrollRef = useRef<HTMLDivElement>(null);

  function preserveScroll(fn: () => void) {
    const el = panelScrollRef.current;
    const top = el?.scrollTop ?? 0;
    fn();
    requestAnimationFrame(() => { if (el) el.scrollTop = top; });
  }

  const isDocx = (template.arquivo_url ?? "").match(/\.(docx|doc)$/i) !== null;

  // Scroll to field card when activeFieldKey changes
  useEffect(() => {
    if (!activeFieldKey || !fieldListRef.current) return;
    const card = fieldListRef.current.querySelector(`[data-field-card="${activeFieldKey}"]`);
    if (card) card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeFieldKey]);


  async function handleReExtract() {
    setIsReExtracting(true);
    setError(null);
    setReExtractMsg(null);
    try {
      const res = await fetch(`/api/templates/${template.id}/re-introspect`, { method: "POST" });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        schema?: TemplateFieldSchema[];
        totalCampos?: number;
        error?: string;
      } | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "Falha ao re-extrair campos.");
      setFields(Array.isArray(data.schema) ? data.schema : []);
      setReExtractMsg(`${data.totalCampos ?? 0} campos extraídos.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao re-extrair campos.");
    } finally {
      setIsReExtracting(false);
    }
  }

  function addField() {
    const f = newField();
    setFields((prev) => [...prev, f]);
    setExpandedField(f.key);
    setActiveFieldKey(f.key);
  }

  function removeField(index: number) {
    const key = fields[index]?.key;
    setFields((prev) => prev.filter((_, i) => i !== index));
    if (activeFieldKey === key) setActiveFieldKey(null);
    if (expandedField === key) setExpandedField(null);
  }

  function updateField(index: number, patch: Partial<TemplateFieldSchema>) {
    setFields((prev) =>
      prev.map((f, i) => {
        if (i !== index) return f;
        const updated = { ...f, ...patch };
        if (patch.label !== undefined && f.key.startsWith("campo_")) {
          updated.key =
            patch.label
              .toLowerCase()
              .normalize("NFD")
              .replace(/[̀-ͯ]/g, "")
              .replace(/[^a-z0-9]+/g, "_")
              .replace(/^_|_$/g, "") || f.key;
        }
        return updated;
      }),
    );
  }

  function handleSave() {
    setError(null);
    setSaved(false);

    for (const f of fields) {
      if (!f.label.trim()) {
        setError("Todos os campos precisam ter um nome.");
        return;
      }
    }

    startTransition(() => {
      void fetch(`/api/templates/${template.id}/schema`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: nome.trim() || template.nome,
          estado: estado || null,
          schema_campos: fields,
        }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const d = await res.json().catch(() => null) as { error?: string } | null;
            throw new Error(d?.error ?? "Falha ao salvar.");
          }
          return res.json();
        })
        .then(() => {
          if (mode === "confirm") {
            setShowConfirmSuccess(true);
            setTimeout(() => {
              setShowConfirmSuccess(false);
              router.push("/dashboard/templates");
            }, 3000);
          } else {
            setSaved(true);
            setPreviewVersion((v) => v + 1);
            setTimeout(() => setSaved(false), 2500);
            router.refresh();
          }
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : "Falha ao salvar.");
        });
    });
  }

  const fieldListPanel = (
    <div className="flex flex-col gap-4" ref={fieldListRef}>
      {/* Template name */}
      <div>
        <label className="block text-sm font-medium text-slate-700">Nome do template</label>
        <input
          type="text"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          className="mt-1.5 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
        />
      </div>

      {/* Estado (RAG guardrail) */}
      <div>
        <label className="block text-sm font-medium text-slate-700">
          Estado da escola
          <span className="ml-1.5 text-xs font-normal text-violet-600">(filtra currículo regional na IA)</span>
        </label>
        <div className="relative mt-1.5">
          <select
            value={estado}
            onChange={(e) => setEstado(e.target.value)}
            className="w-full appearance-none rounded-2xl border border-slate-300 bg-white px-4 py-3 pr-10 text-sm text-slate-950 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
          >
            <option value="">Não especificado</option>
            {ESTADOS_BRASIL.map((e) => (
              <option key={e.uf} value={e.uf}>{e.uf} — {e.nome}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        </div>
      </div>

      {/* Help modal */}
      {showHelp && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 px-4 py-8 backdrop-blur-sm"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="relative flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-5">
              <div>
                <h2 className="text-base font-bold text-slate-950">Guia do editor de template</h2>
                <p className="mt-0.5 text-xs text-slate-400">Entenda cada tipo de campo e como configurá-los</p>
              </div>
              <button
                type="button"
                onClick={() => setShowHelp(false)}
                className="rounded-xl border border-slate-200 p-1.5 text-slate-400 transition hover:border-slate-950 hover:text-slate-950"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto">
              <div className="space-y-2 p-6">

                {/* Fixo */}
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5">
                  <div className="mb-3 flex items-center gap-2.5">
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">Fixo</span>
                    <h3 className="text-sm font-bold text-slate-950">Campo fixo</h3>
                  </div>
                  <p className="text-sm leading-relaxed text-slate-600">
                    Preenchido manualmente pelo professor — a Magis <strong className="text-slate-800">não</strong> sugere conteúdo. Ideal para escola, turma, professor e período.
                  </p>
                  <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
                    <p className="text-xs font-semibold text-amber-800">Como adicionar valor padrão</p>
                    <p className="mt-1 text-xs leading-relaxed text-amber-700">
                      Expanda o campo (clique na seta) e preencha <em>Valor padrão</em>. Ele aparece pré-preenchido em todos os planos gerados com este template.
                    </p>
                  </div>
                </div>

                {/* IA */}
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5">
                  <div className="mb-3 flex items-center gap-2.5">
                    <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-bold text-violet-700">IA</span>
                    <h3 className="text-sm font-bold text-slate-950">Campo sugerido pela Magis</h3>
                  </div>
                  <p className="text-sm leading-relaxed text-slate-600">
                    Quando o professor foca neste campo no editor, a Magis gera sugestões automáticas alinhadas à BNCC, SAEB e ao currículo territorial com um clique.
                  </p>
                  <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50 px-4 py-3">
                    <p className="text-xs font-semibold text-violet-800">Como adicionar contexto para a IA</p>
                    <p className="mt-1 text-xs leading-relaxed text-violet-700">
                      Expanda o campo e preencha <em>Contexto para a IA</em>. Exemplos:
                    </p>
                    <ul className="mt-1.5 space-y-0.5 text-xs text-violet-700">
                      <li>· <em>"Sugira habilidades do 6º ao 9º ano"</em></li>
                      <li>· <em>"Foque em competências socioemocionais"</em></li>
                      <li>· <em>"Priorize descritores do SAEB para Matemática"</em></li>
                    </ul>
                  </div>
                </div>

                {/* Variáveis */}
                {isDocx && fields.length > 0 && (
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5">
                    <h3 className="mb-1 text-sm font-bold text-slate-950">Variáveis do documento</h3>
                    <p className="mb-4 text-xs leading-relaxed text-slate-500">
                      Insira <code className="rounded bg-slate-200 px-1 font-mono">{"{{chave}}"}</code> no seu arquivo Word exatamente onde cada campo deve aparecer ao gerar o plano.
                    </p>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {fields.map((f) => (
                        <button
                          key={f.key}
                          type="button"
                          onClick={() => {
                            setExpandedField(f.key);
                            setActiveFieldKey(f.key);
                            setShowHelp(false);
                          }}
                          className="flex flex-col rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left transition hover:border-violet-300 hover:bg-violet-50"
                          title="Clique para destacar no documento"
                        >
                          <span className="truncate text-[10px] text-slate-400">{f.label}</span>
                          <code className="truncate font-mono text-[11px] font-semibold text-violet-600">{`{{${f.key}}}`}</code>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            </div>
          </div>
        </div>
      )}

      {/* Fields list */}
      <div>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Campos detectados ({fields.length})
            </h2>
            <p className="text-xs text-slate-500">
              {mode === "confirm"
                ? "Confirme, ajuste ou remova os campos extraídos pela IA."
                : "Metadados fixos e campos que a IA sugere."}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowHelp(true)}
              className="flex items-center justify-center rounded-xl border border-slate-200 p-2 text-slate-400 transition hover:border-slate-950 hover:text-slate-950"
              title="Ajuda"
            >
              <HelpCircle className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={addField}
              className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
            >
              <Plus className="h-3.5 w-3.5" />
              Adicionar
            </button>
          </div>
        </div>

        {fields.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center">
            <p className="text-sm text-slate-500">Nenhum campo. Adicione manualmente ou re-extraia do arquivo.</p>
            <div className="mt-4 flex flex-col items-center gap-3">
              {template.arquivo_url && (
                <button
                  type="button"
                  onClick={() => void handleReExtract()}
                  disabled={isReExtracting}
                  className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-60"
                >
                  {isReExtracting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  {isReExtracting ? "Extraindo…" : "Re-extrair do arquivo"}
                </button>
              )}
              <button
                type="button"
                onClick={addField}
                className="text-sm font-medium text-slate-600 hover:text-slate-950"
              >
                Adicionar campo manualmente
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {fields.length > 0 && template.arquivo_url && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void handleReExtract()}
                  disabled={isReExtracting}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-500 transition hover:border-slate-400 hover:text-slate-900 disabled:opacity-50"
                >
                  {isReExtracting ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  Re-extrair
                </button>
              </div>
            )}

            {fields.map((field, index) => {
              const isExpanded = expandedField === field.key;
              const isActive = activeFieldKey === field.key;
              return (
                <div
                  key={field.key}
                  data-field-card={field.key}
                  className={`rounded-2xl border bg-white transition-all ${
                    isActive
                      ? "border-violet-300 ring-1 ring-violet-200"
                      : "border-slate-200"
                  }`}
                >
                  {/* Field header — always visible */}
                  <div
                    className="flex cursor-pointer items-center gap-2 px-4 py-3"
                    onClick={() => {
                      setActiveFieldKey(field.key);
                      setExpandedField(isExpanded ? null : field.key);
                    }}
                  >
                    <GripVertical className="h-4 w-4 shrink-0 text-slate-300" />
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {field.label || <span className="italic text-slate-400">sem nome</span>}
                      </p>
                      <p className="text-xs text-slate-400">
                        {field.role === "ia_sugerida" ? "IA sugere" : "Manual"} ·{" "}
                        {field.group ?? "outros"}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                        field.role === "ia_sugerida"
                          ? "bg-violet-100 text-violet-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {field.role === "ia_sugerida" ? "IA" : "Fixo"}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeField(index);
                      }}
                      className="rounded-lg p-1 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" />
                    ) : (
                      <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                    )}
                  </div>

                  {/* Expanded field config */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-3">

                      {/* Row 1: nome do campo + variável — chips read-only */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-slate-400">Campo:</span>
                          <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700">
                            {field.label || <em className="text-slate-400">sem nome</em>}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-slate-400">Variável:</span>
                          <code className="rounded-lg border border-violet-100 bg-violet-50 px-2.5 py-1 font-mono text-[11px] text-violet-600">{`{{${field.key}}}`}</code>
                        </div>
                      </div>


                      {/* Row 3: papel — segmented toggle */}
                      <div>
                        <span className="text-xs font-medium text-slate-600">Papel</span>
                        <div className="mt-1.5 flex gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              preserveScroll(() => updateField(index, { role: "manual", group: field.group ?? "dados_turma" }))
                            }
                            className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold transition ${
                              field.role !== "ia_sugerida"
                                ? "border-amber-400 bg-amber-50 text-amber-800"
                                : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                            }`}
                          >
                            <span className={`h-3.5 w-3.5 rounded-full border-2 flex items-center justify-center ${
                              field.role !== "ia_sugerida" ? "border-amber-500 bg-amber-500" : "border-slate-300"
                            }`}>
                              {field.role !== "ia_sugerida" && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                            </span>
                            Fixo / Manual
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              preserveScroll(() => updateField(index, { role: "ia_sugerida", group: field.group ?? "outros" }))
                            }
                            className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold transition ${
                              field.role === "ia_sugerida"
                                ? "border-violet-400 bg-violet-50 text-violet-800"
                                : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                            }`}
                          >
                            <span className={`h-3.5 w-3.5 rounded-full border-2 flex items-center justify-center ${
                              field.role === "ia_sugerida" ? "border-violet-500 bg-violet-500" : "border-slate-300"
                            }`}>
                              {field.role === "ia_sugerida" && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                            </span>
                            Sugestão / Magis
                          </button>
                        </div>
                      </div>

                      {/* Contexto para a Magis — only for ia_sugerida fields */}
                      {field.role === "ia_sugerida" && (
                        <label className="block">
                          <span className="text-xs font-semibold text-violet-700">Contexto para a Magis</span>
                          <p className="mt-0.5 mb-1 text-[10px] leading-relaxed text-slate-400">
                            Dê instruções específicas para a Magis ao sugerir conteúdo neste campo. Ex.: <em>"Foco em 6º ano"</em>, <em>"Priorizar SAEB"</em>.
                          </p>
                          <textarea
                            value={field.aiInstructions ?? ""}
                            onChange={(e) =>
                              updateField(index, { aiInstructions: e.target.value })
                            }
                            rows={2}
                            placeholder="Ex.: Priorizar habilidades do 6º ano, foco em interpretação de texto…"
                            className="mt-0.5 w-full rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-violet-400 focus:bg-white"
                          />
                        </label>
                      )}

                      {/* Valor padrão — only for manual/fixed fields */}
                      {field.role !== "ia_sugerida" && (
                        <label className="block">
                          <span className="text-xs font-semibold text-amber-700">Valor padrão</span>
                          <p className="mt-0.5 mb-1 text-[10px] leading-relaxed text-slate-400">
                            Aparece pré-preenchido em todos os planos gerados com este template.
                          </p>
                          <textarea
                            value={field.defaultValue ?? ""}
                            onChange={(e) =>
                              preserveScroll(() => updateField(index, { defaultValue: e.target.value || undefined }))
                            }
                            rows={2}
                            placeholder="Ex.: Escola Estadual, 9º Ano B, 2º Bimestre…"
                            className="mt-0.5 w-full rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-amber-400 focus:bg-white"
                          />
                        </label>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>
      )}

      {reExtractMsg && (
        <p className="rounded-xl bg-violet-50 px-4 py-3 text-sm font-medium text-violet-700">
          {reExtractMsg} Salve para confirmar.
        </p>
      )}

      {saved && (
        <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          Template salvo com sucesso!
        </p>
      )}

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-2xl border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-950"
        >
          {mode === "confirm" ? "Pular" : "Cancelar"}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : mode === "confirm" ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {mode === "confirm" ? "Confirmar template" : "Salvar alterações"}
        </button>
      </div>
    </div>
  );

  const confirmSuccessModal = showConfirmSuccess && (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm">
      <div
        className="flex w-full max-w-sm flex-col items-center gap-5 rounded-3xl bg-white p-8 shadow-2xl"
        style={{ animation: "magis-pop 0.35s cubic-bezier(0.34,1.56,0.64,1) both" }}
      >
        <style>{`
          @keyframes magis-pop {
            from { opacity: 0; transform: scale(0.7) translateY(24px); }
            to   { opacity: 1; transform: scale(1) translateY(0); }
          }
          @keyframes magis-spin {
            from { transform: rotate(0deg); }
            to   { transform: rotate(360deg); }
          }
        `}</style>

        {/* Magis avatar */}
        <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-violet-600 shadow-lg shadow-violet-200">
          <Sparkles className="h-7 w-7 text-white" />
          <span
            className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500"
            style={{ animation: "magis-pop 0.4s 0.2s cubic-bezier(0.34,1.56,0.64,1) both" }}
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-white" />
          </span>
        </div>

        {/* Magis bubble */}
        <div className="w-full rounded-2xl border border-violet-100 bg-violet-50 px-5 py-4 text-center">
          <div className="mb-1.5 flex items-center justify-center gap-1.5">
            <Sparkles className="h-3 w-3 text-violet-500" />
            <span className="text-xs font-bold text-violet-700">Magis</span>
          </div>
          <p className="text-sm font-medium leading-relaxed text-slate-800">
            Seu template foi configurado com sucesso! 🎉
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Redirecionando para Meus Templates…
          </p>
        </div>

        {/* Progress bar */}
        <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-violet-500"
            style={{ animation: "magis-progress 3s linear forwards" }}
          />
        </div>
        <style>{`
          @keyframes magis-progress {
            from { width: 100%; }
            to   { width: 0%; }
          }
        `}</style>
      </div>
    </div>
  );

  // DOCX templates: split-view (Office Online preview left, field list right)
  if (isDocx) {
    return (
      <>
        {confirmSuccessModal}
        <div className="flex gap-6" style={{ minHeight: "calc(100vh - 280px)" }}>
          {/* Left: Office Online inline Word viewer */}
          <div className="hidden w-[65%] shrink-0 overflow-hidden rounded-3xl border border-slate-200 xl:flex xl:flex-col">
            <OfficeInlineViewer
              key={previewVersion}
              tokenEndpoint={`/api/templates/${template.id}/preview-token`}
              previewPublicoPath={`/api/templates/${template.id}/preview-publico`}
              extraParams="annotated=1"
              title="Pré-visualização do template"
              className="h-full"
            />
          </div>

          {/* Right: field list */}
          <div ref={panelScrollRef} className="flex-1 min-w-0 overflow-y-auto rounded-3xl border border-slate-200 bg-white p-4 [overflow-anchor:none]">
            {fieldListPanel}
          </div>
        </div>
      </>
    );
  }

  // Non-DOCX: single column
  return (
    <>
      {confirmSuccessModal}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        {fieldListPanel}
      </div>
    </>
  );
}
