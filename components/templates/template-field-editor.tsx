"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Copy, Download, GripVertical, Plus, RefreshCw, Save, Trash2, Upload } from "lucide-react";

import { templatesService } from "../../lib/services/firestore/templates.service";
import type { TemplateFieldSchema, TemplateRecord } from "../../lib/types/firestore";

interface TemplateFieldEditorProps {
  template: TemplateRecord;
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
  { value: "manual", label: "Manual (professor preenche)" },
  { value: "ia_sugerida", label: "IA sugere" },
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
  };
}

export function TemplateFieldEditor({ template }: TemplateFieldEditorProps) {
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
  const fillableInputRef = useRef<HTMLInputElement>(null);

  const isDocx = (template.arquivo_url ?? "").match(/\.(docx|doc)$/i) !== null;

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
      const res = await fetch(`/api/templates/${template.id}/upload-fillable`, { method: "POST", body: form });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "Falha ao enviar template preparado.");
      setUploadFillableMsg("Template preparado enviado com sucesso. Ele será usado em todos os próximos downloads.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar template preparado.");
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
      const data = (await res.json().catch(() => null)) as { ok?: boolean; schema?: TemplateFieldSchema[]; totalCampos?: number; error?: string } | null;
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? "Falha ao re-extrair campos.");
      }
      setFields(Array.isArray(data.schema) ? data.schema : []);
      setReExtractMsg(`${data.totalCampos ?? 0} campos extraídos com sucesso.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao re-extrair campos.");
    } finally {
      setIsReExtracting(false);
    }
  }

  function addField() {
    setFields((prev) => [...prev, newField()]);
  }

  function removeField(index: number) {
    setFields((prev) => prev.filter((_, i) => i !== index));
  }

  function updateField(index: number, patch: Partial<TemplateFieldSchema>) {
    setFields((prev) =>
      prev.map((f, i) => {
        if (i !== index) return f;
        const updated = { ...f, ...patch };
        // Auto-generate key from label if key looks auto-generated
        if (patch.label !== undefined && f.key.startsWith("campo_")) {
          updated.key = patch.label
            .toLowerCase()
            .normalize("NFD")
            .replace(/[̀-ͯ]/g, "")
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_|_$/g, "")
            || f.key;
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
        setError("Todos os campos precisam ter um nome (label).");
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
          setSaved(true);
          setTimeout(() => setSaved(false), 2500);
          router.refresh();
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : "Falha ao salvar.");
        });
    });
  }

  return (
    <div className="space-y-6">
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

      {/* DOCX workflow panel — only shown for DOCX templates with fields */}
      {isDocx && fields.length > 0 && (
        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-violet-900">Template DOCX — Marcadores de campo</p>
              <p className="mt-0.5 text-xs leading-5 text-violet-700">
                Para fidelidade total, abra seu DOCX no Word, coloque o marcador{" "}
                <code className="rounded bg-violet-100 px-1 font-mono">{"{{chave}}"}</code>{" "}
                onde cada campo deve aparecer e faça o upload abaixo.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowKeys((v) => !v)}
              className="flex shrink-0 items-center gap-1 rounded-xl border border-violet-300 bg-white px-2.5 py-1.5 text-xs font-medium text-violet-700 transition hover:border-violet-500"
            >
              {showKeys ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {showKeys ? "Ocultar chaves" : "Ver chaves"}
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
                    {copiedKey === f.key ? "✓ copiado" : <Copy className="h-3 w-3" />}
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

            <p className="text-xs text-violet-600">
              O DOCX preparado é usado para todos os downloads. Imagens, logo e cabeçalho são preservados.
            </p>
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
              Campos ({fields.length})
            </h2>
            <p className="text-xs text-slate-500">
              Defina quais campos o professor preenche e quais a IA sugere.
            </p>
          </div>
          <button
            type="button"
            onClick={addField}
            className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar campo
          </button>
        </div>

        {fields.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center">
            <p className="text-sm text-slate-500">
              Nenhum campo ainda. Adicione campos para estruturar o template.
            </p>
            <div className="mt-4 flex flex-col items-center gap-3">
              {template.arquivo_url && (
                <button
                  type="button"
                  onClick={() => void handleReExtract()}
                  disabled={isReExtracting}
                  className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-60"
                >
                  {isReExtracting ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  {isReExtracting ? "Extraindo campos…" : "Re-extrair campos do arquivo"}
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
          <div className="space-y-3">
            {fields.map((field, index) => (
              <div
                key={field.key}
                className="rounded-2xl border border-slate-200 bg-white p-4"
              >
                <div className="flex items-center gap-2 text-slate-400">
                  <GripVertical className="h-4 w-4 shrink-0" />
                  <span className="text-xs text-slate-400">#{index + 1}</span>
                  <div className="ml-auto">
                    <button
                      type="button"
                      onClick={() => removeField(index)}
                      className="rounded-lg p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
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
                    <span className="text-xs font-medium text-slate-600">Tipo</span>
                    <select
                      value={field.type}
                      onChange={(e) =>
                        updateField(index, { type: e.target.value as TemplateFieldSchema["type"] })
                      }
                      className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-violet-400"
                    >
                      {FIELD_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-xs font-medium text-slate-600">Papel</span>
                    <select
                      value={field.role ?? "manual"}
                      onChange={(e) =>
                        updateField(index, {
                          role: e.target.value as TemplateFieldSchema["role"],
                          group:
                            e.target.value === "manual" ? "dados_turma" : field.group ?? "outros",
                        })
                      }
                      className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-violet-400"
                    >
                      {FIELD_ROLES.map((r) => (
                        <option key={r.value} value={r.value ?? ""}>{r.label}</option>
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
                        <option key={g.value} value={g.value ?? ""}>{g.label}</option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-xs font-medium text-slate-600">Placeholder</span>
                    <input
                      type="text"
                      value={field.placeholder ?? ""}
                      onChange={(e) => updateField(index, { placeholder: e.target.value })}
                      placeholder="Ex.: EF05LP01…"
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
                    {field.role === "ia_sugerida" && (
                      <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
                        IA sugere
                      </span>
                    )}
                    {(field.role === "manual" || !field.role) && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                        Manual
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}

      {reExtractMsg && (
        <p className="rounded-xl bg-violet-50 px-4 py-3 text-sm font-medium text-violet-700">
          {reExtractMsg} Salve para confirmar as alterações.
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
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
        >
          {isPending ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Salvar alterações
        </button>
      </div>
    </div>
  );
}
