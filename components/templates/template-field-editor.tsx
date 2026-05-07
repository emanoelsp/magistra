"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  GripVertical,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
} from "lucide-react";

import { templatesService } from "../../lib/services/firestore/templates.service";
import type { TemplateFieldSchema, TemplateRecord } from "../../lib/types/firestore";

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

// ─── DocPreview ────────────────────────────────────────────────────────────────
// Read-only view of the template document with fields highlighted.

interface DocPreviewProps {
  html: string;
  activeFieldKey: string | null;
}

function DocPreview({ html, activeFieldKey }: DocPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = html;
    // Make all annotated cells non-editable
    containerRef.current
      .querySelectorAll<HTMLElement>("[data-field-key]")
      .forEach((cell) => {
        cell.contentEditable = "false";
        cell.style.cssText =
          "cursor:default;transition:background .12s,box-shadow .12s;border-radius:2px;";
      });
  }, [html]);

  // Highlight active field
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.querySelectorAll<HTMLElement>("[data-field-key]").forEach((cell) => {
      if (cell.dataset.fieldKey === activeFieldKey) {
        cell.style.background = "#f5f3ff";
        cell.style.boxShadow = "inset 0 0 0 2px #7c3aed";
        cell.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } else {
        cell.style.background = "";
        cell.style.boxShadow = "";
      }
    });
  }, [activeFieldKey]);

  return (
    <div className="doc-page">
      <div ref={containerRef} className="doc-view" />
    </div>
  );
}

// ─── TemplateFieldEditor ──────────────────────────────────────────────────────

export function TemplateFieldEditor({ template, mode = "edit" }: TemplateFieldEditorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [nome, setNome] = useState(template.nome);
  const [fields, setFields] = useState<TemplateFieldSchema[]>(
    template.schema_campos.length > 0 ? [...template.schema_campos] : [],
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isReExtracting, setIsReExtracting] = useState(false);
  const [reExtractMsg, setReExtractMsg] = useState<string | null>(null);
  const [isUploadingFillable, setIsUploadingFillable] = useState(false);
  const [uploadFillableMsg, setUploadFillableMsg] = useState<string | null>(null);
  const [showKeys, setShowKeys] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [activeFieldKey, setActiveFieldKey] = useState<string | null>(null);
  const [expandedField, setExpandedField] = useState<string | null>(null);

  // Doc preview state
  const [docHtml, setDocHtml] = useState<string | null>(null);
  const [docLoading, setDocLoading] = useState(false);

  const fillableInputRef = useRef<HTMLInputElement>(null);
  const fieldListRef = useRef<HTMLDivElement>(null);

  const isDocx = (template.arquivo_url ?? "").match(/\.(docx|doc)$/i) !== null;
  const showDocPreview = isDocx;

  // Fetch annotated HTML when template has a DOCX file
  useEffect(() => {
    if (!showDocPreview) return;
    setDocLoading(true);
    fetch(`/api/templates/${template.id}/editor-html`)
      .then((r) => r.json())
      .then((data: { html?: string | null }) => {
        if (data.html) setDocHtml(data.html);
      })
      .catch(() => {/* ignore, preview is optional */})
      .finally(() => setDocLoading(false));
  }, [template.id, showDocPreview]);

  // Scroll to field card when activeFieldKey changes
  useEffect(() => {
    if (!activeFieldKey || !fieldListRef.current) return;
    const card = fieldListRef.current.querySelector(`[data-field-card="${activeFieldKey}"]`);
    if (card) card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeFieldKey]);

  function copyKey(key: string) {
    void navigator.clipboard.writeText(`{{${key}}}`).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    });
  }

  async function handleUploadFillable(file: File) {
    setIsUploadingFillable(true);
    setError(null);
    setUploadFillableMsg(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/templates/${template.id}/upload-fillable`, {
        method: "POST",
        body: form,
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "Falha ao enviar template.");
      setUploadFillableMsg("Template preparado enviado com sucesso.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar template.");
    } finally {
      setIsUploadingFillable(false);
    }
  }

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
      void templatesService
        .updateTemplate(template.id, {
          nome: nome.trim() || template.nome,
          schema_campos: fields,
        })
        .then(() => {
          if (mode === "confirm") {
            router.push("/dashboard/templates");
          } else {
            setSaved(true);
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

      {/* DOCX workflow panel */}
      {isDocx && fields.length > 0 && mode === "edit" && (
        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-violet-900">Marcadores de campo (DOCX)</p>
              <p className="mt-0.5 text-xs leading-5 text-violet-700">
                Coloque{" "}
                <code className="rounded bg-violet-100 px-1 font-mono">{"{{chave}}"}</code>{" "}
                no Word onde cada campo deve aparecer e suba o arquivo abaixo.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowKeys((v) => !v)}
              className="flex shrink-0 items-center gap-1 rounded-xl border border-violet-300 bg-white px-2.5 py-1.5 text-xs font-medium text-violet-700 transition hover:border-violet-500"
            >
              {showKeys ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {showKeys ? "Ocultar" : "Ver chaves"}
            </button>
          </div>

          {showKeys && (
            <div className="mb-3 grid gap-1.5 sm:grid-cols-2">
              {fields.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => copyKey(f.key)}
                  className="flex items-center justify-between gap-2 rounded-xl border border-violet-200 bg-white px-3 py-2 text-left transition hover:border-violet-400"
                >
                  <div className="min-w-0">
                    <code className="block truncate font-mono text-xs font-semibold text-violet-700">
                      {`{{${f.key}}}`}
                    </code>
                    <span className="truncate text-[10px] text-slate-500">{f.label}</span>
                  </div>
                  <span className="shrink-0 text-[10px] font-medium text-slate-400">
                    {copiedKey === f.key ? "✓" : <Copy className="h-3 w-3" />}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`/api/templates/${template.id}/arquivo?fillable=1`}
              download
              className="flex items-center gap-1.5 rounded-xl border border-violet-300 bg-white px-3 py-2 text-xs font-medium text-violet-700 transition hover:border-violet-500"
            >
              <Download className="h-3.5 w-3.5" />
              Baixar DOCX preparado
            </a>
            <button
              type="button"
              onClick={() => fillableInputRef.current?.click()}
              disabled={isUploadingFillable}
              className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-violet-500 disabled:opacity-60"
            >
              {isUploadingFillable ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/20 border-t-white" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              {isUploadingFillable ? "Enviando…" : "Upload DOCX preparado"}
            </button>
            <input
              ref={fillableInputRef}
              type="file"
              accept=".docx,.doc"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUploadFillable(f);
                e.target.value = "";
              }}
            />
          </div>
          {uploadFillableMsg && (
            <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
              {uploadFillableMsg}
            </p>
          )}
        </div>
      )}

      {/* Fields list */}
      <div>
        <div className="mb-3 flex items-center justify-between">
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
          <button
            type="button"
            onClick={addField}
            className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar
          </button>
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
                    <div className="border-t border-slate-100 px-4 pb-4 pt-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="block">
                          <span className="text-xs font-medium text-slate-600">Nome do campo *</span>
                          <input
                            type="text"
                            value={field.label}
                            onChange={(e) => updateField(index, { label: e.target.value })}
                            placeholder="Ex.: Habilidades BNCC"
                            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-violet-400"
                          />
                        </label>

                        <label className="block">
                          <span className="text-xs font-medium text-slate-600">Papel</span>
                          <select
                            value={field.role ?? "manual"}
                            onChange={(e) =>
                              updateField(index, {
                                role: e.target.value as TemplateFieldSchema["role"],
                                group:
                                  e.target.value === "manual"
                                    ? "dados_turma"
                                    : field.group ?? "outros",
                              })
                            }
                            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-violet-400"
                          >
                            {FIELD_ROLES.map((r) => (
                              <option key={r.value} value={r.value ?? ""}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="block">
                          <span className="text-xs font-medium text-slate-600">Grupo</span>
                          <select
                            value={field.group ?? "outros"}
                            onChange={(e) =>
                              updateField(index, {
                                group: e.target.value as TemplateFieldSchema["group"],
                              })
                            }
                            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-violet-400"
                          >
                            {FIELD_GROUPS.map((g) => (
                              <option key={g.value} value={g.value ?? ""}>
                                {g.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="block">
                          <span className="text-xs font-medium text-slate-600">Tipo</span>
                          <select
                            value={field.type}
                            onChange={(e) =>
                              updateField(index, {
                                type: e.target.value as TemplateFieldSchema["type"],
                              })
                            }
                            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-violet-400"
                          >
                            {FIELD_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="block">
                          <span className="text-xs font-medium text-slate-600">Placeholder</span>
                          <input
                            type="text"
                            value={field.placeholder ?? ""}
                            onChange={(e) => updateField(index, { placeholder: e.target.value })}
                            placeholder="Texto de exemplo no campo"
                            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-violet-400"
                          />
                        </label>

                        <div className="flex items-center gap-4 pt-5">
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={field.required}
                              onChange={(e) => updateField(index, { required: e.target.checked })}
                              className="h-4 w-4 rounded border-slate-300 text-violet-600"
                            />
                            <span className="text-xs font-medium text-slate-700">Obrigatório</span>
                          </label>
                        </div>
                      </div>

                      {/* AI instructions — only for ia_sugerida fields */}
                      {field.role === "ia_sugerida" && (
                        <div className="mt-3">
                          <label className="block">
                            <span className="text-xs font-medium text-violet-700">
                              Instruções para a IA
                            </span>
                            <p className="mb-1 text-[10px] text-slate-400">
                              Contexto específico deste campo. A IA usará essas instruções ao gerar
                              sugestões (ex.: "Foco em tecnologia assistiva", "Usar metodologia de
                              projetos", "Alunos com dificuldades de leitura").
                            </p>
                            <textarea
                              value={field.aiInstructions ?? ""}
                              onChange={(e) =>
                                updateField(index, { aiInstructions: e.target.value })
                              }
                              rows={2}
                              placeholder="Ex.: Priorizar habilidades de pensamento computacional para alunos do 6° ano com foco em atividades desplugadas."
                              className="mt-1 w-full rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-violet-400 focus:bg-white"
                            />
                          </label>
                        </div>
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

  const docStyles = `
    .doc-page {
      background:#fff;
      box-shadow:0 1px 4px rgba(0,0,0,.08),0 6px 28px rgba(0,0,0,.07);
      border-radius:2px;
      padding:40px 48px 56px;
      max-width:820px;
      margin:0 auto;
      font-family:"Calibri","Liberation Sans",Arial,sans-serif;
      font-size:12px;
      color:#111;
      line-height:1.5;
    }
    .doc-view table{width:100%;border-collapse:collapse;margin:4px 0;}
    .doc-view td,.doc-view th{border:1px solid #555;padding:4px 8px;vertical-align:top;font-size:12px;min-width:24px;}
    .doc-view th{font-weight:700;background:#f0f0f0;}
    .doc-view p{margin:2px 0;line-height:1.5;}
    .doc-view h1{font-size:15px;font-weight:700;text-align:center;margin:10px 0 6px;}
    .doc-view h2{font-size:13px;font-weight:700;text-align:center;margin:8px 0 4px;}
    .doc-view h3{font-size:12px;font-weight:700;margin:6px 0 3px;}
    .doc-view img{max-width:100%;height:auto;display:block;margin:0 auto 8px;}
    .doc-view td[data-field-key]{
      background:#faf5ff !important;
      border-left:3px solid #8b5cf6 !important;
      cursor:default;
      position:relative;
      min-height:2em;
      transition:background .12s,box-shadow .12s;
    }
    .doc-view td[data-field-key]::after{
      content:attr(data-field-label);
      position:absolute;
      top:2px;right:3px;
      background:#7c3aed;color:#fff;
      font-size:8px;font-weight:700;
      padding:1px 5px;border-radius:2px;
      white-space:nowrap;pointer-events:none;
      line-height:1.5;opacity:1;
      text-transform:uppercase;letter-spacing:.04em;
      max-width:160px;overflow:hidden;text-overflow:ellipsis;
    }
  `;

  // DOCX templates: always use split-view (doc preview left, field list right)
  if (isDocx) {
    return (
      <div className="flex gap-6" style={{ minHeight: "calc(100vh - 280px)" }}>
        {/* Left: document preview */}
        <div className="hidden w-[55%] shrink-0 overflow-hidden rounded-3xl border border-slate-200 bg-slate-100 xl:block">
          {docLoading ? (
            <div className="flex h-full items-center justify-center gap-3 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin text-violet-500" />
              <span className="text-sm">Carregando documento…</span>
            </div>
          ) : docHtml ? (
            <div className="h-full overflow-y-auto p-6">
              <style>{docStyles}</style>
              <DocPreview html={docHtml} activeFieldKey={activeFieldKey} />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-center">
              <div className="space-y-2 px-8">
                <p className="text-sm font-medium text-slate-600">
                  Pré-visualização do documento será exibida aqui.
                </p>
                <p className="text-xs text-slate-400">
                  Configure os campos na lista à direita.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Right: field list */}
        <div className="flex-1 overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6">
          {fieldListPanel}
        </div>
      </div>
    );
  }

  // Non-DOCX: single column
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      {fieldListPanel}
    </div>
  );
}
