"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  Pin,
  Save,
  Send,
  Sparkles,
  WandSparkles,
} from "lucide-react";

import { planosService } from "../../lib/services/firestore/planos.service";
import type { IaSugestao, TemplateFieldSchema, TemplateRecord } from "../../lib/types/firestore";
import { RichTextEditor } from "../editor/RichTextEditor";
import {
  DownloadLimitDialog,
  triggerDownload,
  type DownloadLimitInfo,
} from "./download-plan-button";

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

function extractMetadata(values: Record<string, string>, fields: TemplateFieldSchema[]) {
  const meta: Record<string, string> = {};
  for (const f of fields.filter((f) => f.role === "manual" || f.group === "dados_turma")) {
    if (values[f.key]?.trim()) meta[f.key] = values[f.key].trim();
  }
  return meta;
}

function isMetadataComplete(meta: Record<string, string>) {
  return Object.values(meta).filter((v) => v.trim().length >= 2).length >= 2;
}

// ─── DocView ──────────────────────────────────────────────────────────────────
// Renders the mammoth HTML with editable annotated cells.

interface DocViewProps {
  html: string;
  values: Record<string, string>;
  activeFieldKey: string | null;
  onFieldFocus: (key: string, label: string, role: string) => void;
  onFieldChange: (key: string, value: string) => void;
}

function DocView({ html, values, activeFieldKey, onFieldFocus, onFieldChange }: DocViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevValues = useRef<Record<string, string>>({});
  const isComposing = useRef(false);

  // Set HTML once on mount / when html prop changes
  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = html;
  }, [html]);

  // Wire up editable cells after HTML is painted
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !html) return;

    const cells = Array.from(container.querySelectorAll<HTMLElement>("[data-field-key]"));
    const cleanups: (() => void)[] = [];

    cells.forEach((cell) => {
      const key = cell.dataset.fieldKey!;
      const label = cell.dataset.fieldLabel ?? key;
      const role = cell.dataset.fieldRole ?? "";

      // Initial value
      const init = values[key] ?? "";
      if (role === "ia_sugerida") {
        cell.innerHTML = init || "<p><br></p>";
      } else {
        cell.textContent = init;
      }

      cell.contentEditable = role === "ia_sugerida" ? "true" : "plaintext-only";
      cell.spellcheck = false;
      cell.style.cssText =
        "outline:none;min-height:1.4em;cursor:text;transition:background 0.15s,box-shadow 0.15s;border-radius:2px;";

      const onFocus = () => {
        onFieldFocus(key, label, role);
        cell.style.background = "#f5f3ff";
        cell.style.boxShadow = "inset 0 0 0 2px #8b5cf6";
      };
      const onBlur = () => {
        cell.style.background = "";
        cell.style.boxShadow = "";
      };
      const onCompositionStart = () => { isComposing.current = true; };
      const onCompositionEnd = () => {
        isComposing.current = false;
        const val = role === "ia_sugerida" ? cell.innerHTML : (cell.textContent ?? "");
        onFieldChange(key, val);
        prevValues.current[key] = val;
      };
      const onInput = () => {
        if (isComposing.current) return;
        const val = role === "ia_sugerida" ? cell.innerHTML : (cell.textContent ?? "");
        onFieldChange(key, val);
        prevValues.current[key] = val;
      };

      cell.addEventListener("focus", onFocus);
      cell.addEventListener("blur", onBlur);
      cell.addEventListener("compositionstart", onCompositionStart);
      cell.addEventListener("compositionend", onCompositionEnd);
      cell.addEventListener("input", onInput);

      cleanups.push(() => {
        cell.removeEventListener("focus", onFocus);
        cell.removeEventListener("blur", onBlur);
        cell.removeEventListener("compositionstart", onCompositionStart);
        cell.removeEventListener("compositionend", onCompositionEnd);
        cell.removeEventListener("input", onInput);
      });
    });

    return () => cleanups.forEach((fn) => fn());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);

  // Sync external value changes (e.g. AI insert) without moving cursor
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    for (const [key, value] of Object.entries(values)) {
      if (prevValues.current[key] === value) continue;
      prevValues.current[key] = value;
      const cell = container.querySelector<HTMLElement>(`[data-field-key="${key}"]`);
      if (!cell) continue;
      const role = cell.dataset.fieldRole ?? "";
      const focused = document.activeElement === cell;
      if (focused) continue; // don't interrupt typing
      if (role === "ia_sugerida") {
        cell.innerHTML = value || "<p><br></p>";
      } else {
        cell.textContent = value;
      }
    }
  }, [values]);

  // Highlight active field
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.querySelectorAll<HTMLElement>("[data-field-key]").forEach((cell) => {
      if (cell.dataset.fieldKey === activeFieldKey) {
        cell.style.background = "#f5f3ff";
        cell.style.boxShadow = "inset 0 0 0 2px #8b5cf6";
      } else if (document.activeElement !== cell) {
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

// ─── PreviewDocView ───────────────────────────────────────────────────────────
// Read-only view — fills editable cells with current values, no editing UI.

interface PreviewDocViewProps {
  html: string;
  values: Record<string, string>;
}

function PreviewDocView({ html, values }: PreviewDocViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = html;
    container.querySelectorAll<HTMLElement>("[data-field-key]").forEach((cell) => {
      const key = cell.dataset.fieldKey!;
      const role = cell.dataset.fieldRole ?? "";
      const value = values[key] ?? "";
      if (role === "ia_sugerida") {
        cell.innerHTML = value || "";
      } else {
        cell.textContent = value;
      }
      cell.contentEditable = "false";
      cell.style.cssText = "cursor:default;";
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, values]);

  return (
    <div className="doc-page">
      <div ref={containerRef} className="doc-view doc-view-preview" />
    </div>
  );
}

// ─── PlanEditor ───────────────────────────────────────────────────────────────

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
    const init: Record<string, string> = {};
    for (const f of schema) init[f.key] = "";
    if (template.escola_nome) {
      const ef = manualFields.find(
        (f) => f.key.includes("escola") || f.label.toLowerCase().includes("escola"),
      );
      if (ef) init[ef.key] = template.escola_nome;
    }
    if (!initialValues) return init;
    // Apply manual/metadata values from initialValues, then unconditionally
    // clear every ia_sugerida field so Magis fills them fresh each generation.
    const merged = { ...init, ...initialValues };
    for (const f of schema) {
      if (f.role === "ia_sugerida") merged[f.key] = "";
    }
    return merged;
  });

  useImperativeHandle(ref, () => ({ getCurrentValues: () => values }));

  const [activeFieldKey, setActiveFieldKey] = useState<string | null>(null);
  const [activeFieldMeta, setActiveFieldMeta] = useState<{ label: string; role: string } | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, IaSugestao[]>>({});
  const [loadingField, setLoadingField] = useState<string | null>(null);
  const [streamingCharCount, setStreamingCharCount] = useState(0);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [planoId, setPlanoId] = useState<string | null>(null);
  const [autoSuggestedOnce, setAutoSuggestedOnce] = useState(false);
  const [generalContext, setGeneralContext] = useState("");

  // Document HTML state
  const [docHtml, setDocHtml] = useState<string | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const docContainerRef = useRef<HTMLDivElement>(null);
  const docScrolledRef = useRef(false);

  // Preview mode: read-only view of filled doc
  const [previewMode, setPreviewMode] = useState(false);

  // Once a plan is finalized (exported), it becomes read-only to prevent
  // users from editing and re-downloading without consuming a new plan from their limit
  const [isFinalized, setIsFinalized] = useState(false);
  const [downloadLimitInfo, setDownloadLimitInfo] = useState<DownloadLimitInfo | null>(null);

  const hasDocx =
    (template.arquivo_url ?? "").match(/\.(docx|doc)$/i) !== null;

  const activeField = schema.find((f) => f.key === activeFieldKey) ?? null;
  const activeSuggestions = activeFieldKey ? (suggestions[activeFieldKey] ?? []) : [];
  const metadata = extractMetadata(values, schema);
  const metadataComplete = isMetadataComplete(metadata);

  // Fetch annotated HTML from template DOCX
  useEffect(() => {
    const url = template.arquivo_url ?? "";
    const ext = url.split(".").pop()?.toLowerCase() ?? "";
    if ((ext !== "docx" && ext !== "doc") || !url) return;

    setDocLoading(true);
    fetch(`/api/templates/${template.id}/editor-html`)
      .then((r) => r.json())
      .then((data: { html?: string | null }) => {
        if (data.html) setDocHtml(data.html);
      })
      .catch(() => {/* fall back to form view */})
      .finally(() => setDocLoading(false));
  }, [template.id, template.arquivo_url]);

  // In wizard mode: auto-scroll to the first IA field so the user lands on Conteúdos,
  // not on Dados fixos. Works for both the DOCX doc view and the form fallback.
  useEffect(() => {
    if (!wizardMode) return;

    if (docHtml) {
      // DOCX view: scroll the doc container to the first IA cell
      if (docScrolledRef.current) return;
      docScrolledRef.current = true;
      const timer = setTimeout(() => {
        const firstIaCell = docContainerRef.current?.querySelector<HTMLElement>(
          '[data-field-role="ia_sugerida"]',
        );
        firstIaCell?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 300);
      return () => clearTimeout(timer);
    } else if (!docLoading) {
      // Form fallback: scroll to the ia-section anchor
      const timer = setTimeout(() => {
        document
          .getElementById("ia-section-first")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 300);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardMode, docHtml, docLoading]);

  const setFieldValue = (key: string, value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const fetchSuggestionsForField = useCallback(
    async (field: TemplateFieldSchema, meta: Record<string, string>, extraContext?: string, bypassCache?: boolean) => {
      if (loadingField) return;
      setSuggestError(null);
      setLoadingField(field.key);
      setStreamingCharCount(0);
      const combinedContext = [generalContext.trim(), extraContext?.trim()].filter(Boolean).join("\n\n");
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
            ...(combinedContext ? { extraContext: combinedContext } : {}),
            stream: true,
            ...(bypassCache ? { bypassCache: true } : {}),
          }),
        });

        if (!res.ok) {
          const d = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(d?.error ?? "Falha ao buscar sugestões.");
        }

        const contentType = res.headers.get("content-type") ?? "";
        let sugestoes: IaSugestao[] = [];

        if (contentType.includes("text/plain") && res.body) {
          // Streaming response — accumulate chunks in real time
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let accumulated = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            accumulated += decoder.decode(value, { stream: true });
            setStreamingCharCount(accumulated.length);
          }

          const firstBrace = accumulated.indexOf("{");
          const lastBrace = accumulated.lastIndexOf("}");
          const jsonStr =
            firstBrace !== -1 && lastBrace > firstBrace
              ? accumulated.slice(firstBrace, lastBrace + 1)
              : accumulated;

          const parsed = JSON.parse(jsonStr) as {
            sugestoes?: IaSugestao[];
            error?: string;
            _streamError?: string;
          };
          if (parsed.error || parsed._streamError) {
            throw new Error(parsed.error ?? parsed._streamError ?? "Erro no streaming.");
          }
          sugestoes = Array.isArray(parsed.sugestoes) ? parsed.sugestoes : [];
        } else {
          // Cache hit — regular JSON response
          const d = (await res.json()) as { sugestoes: IaSugestao[] };
          sugestoes = Array.isArray(d.sugestoes) ? d.sugestoes : [];
        }

        setSuggestions((prev) => ({ ...prev, [field.key]: sugestoes }));
      } catch (err) {
        setSuggestError(err instanceof Error ? err.message : "Erro ao gerar sugestões.");
      } finally {
        setLoadingField(null);
        setStreamingCharCount(0);
      }
    },
    [template.id, loadingField, generalContext],
  );

  useEffect(() => {
    if (!metadataComplete || autoSuggestedOnce || iaFields.length === 0) return;
    setAutoSuggestedOnce(true);
    const first = iaFields[0];
    if (first) void fetchSuggestionsForField(first, metadata);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metadataComplete]);

  function trackSugestaoAceita(sugestaoId: string, tipo: "titulo" | "completo") {
    void fetch("/api/ia/aceitar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId: template.id, fieldKey: activeFieldKey, sugestaoId, tipo }),
    }).catch(() => {});
  }

  function insertSuggestion(suggestion: IaSugestao, mode: "label" | "full" = "label") {
    if (!activeFieldKey) return;
    trackSugestaoAceita(suggestion.id, mode === "full" ? "completo" : "titulo");

    const text =
      mode === "full" && suggestion.descricao
        ? `${suggestion.label}: ${suggestion.descricao}`
        : suggestion.label;
    const html =
      mode === "full" && suggestion.descricao
        ? `<p><strong>${suggestion.label}</strong></p><p>${suggestion.descricao}</p>`
        : `<p>${suggestion.label}</p>`;

    // Document mode: insert directly into the DOM cell
    if (docHtml && docContainerRef.current) {
      const cell = docContainerRef.current.querySelector<HTMLElement>(
        `[data-field-key="${activeFieldKey}"]`,
      );
      if (cell) {
        const role = cell.dataset.fieldRole ?? "";
        const current = role === "ia_sugerida" ? cell.innerHTML : (cell.textContent ?? "");
        const empty = !current || current === "<p><br></p>";
        if (role === "ia_sugerida") {
          cell.innerHTML = empty ? html : `${current}${html}`;
          setFieldValue(activeFieldKey, cell.innerHTML);
        } else {
          cell.textContent = empty ? text : `${current}\n${text}`;
          setFieldValue(activeFieldKey, cell.textContent ?? "");
        }
        return;
      }
    }

    // Form mode fallback
    const field = schema.find((f) => f.key === activeFieldKey);
    const current = values[activeFieldKey] ?? "";
    if (field?.role === "ia_sugerida") {
      const empty = !current || current === "<p></p>";
      setFieldValue(activeFieldKey, empty ? html : `${current}${html}`);
    } else {
      const sep = current.trim() ? "\n" : "";
      setFieldValue(activeFieldKey, current + sep + text);
    }
  }

  async function savePlano(status: "rascunho" | "gerado"): Promise<string> {
    const conteudo: Record<string, unknown> = {
      criado_por: userName,
      template_nome: template.nome,
      ...values,
    };
    if (planoId) {
      await planosService.updatePlano(planoId, { conteudo_gerado: conteudo, status });
      // Snapshot version on every save (fire-and-forget)
      void fetch(`/api/planos/${planoId}/versoes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conteudo_gerado: conteudo }),
      }).catch(() => {});
      return planoId;
    }
    // Snapshot schema_campos at creation so preview/download survive future template edits
    const id = await planosService.createPlano({
      user_id: userId,
      template_id: template.id,
      conteudo_gerado: conteudo,
      status,
      schema_campos: template.schema_campos,
    });
    setPlanoId(id);
    return id;
  }

  function handleSaveRascunho() {
    setSaveStatus("saving");
    startTransition(() => {
      void savePlano("rascunho")
        .then(() => { setSaveStatus("saved"); setTimeout(() => setSaveStatus("idle"), 2500); })
        .catch(() => { setSaveStatus("error"); setTimeout(() => setSaveStatus("idle"), 3000); });
    });
  }

  function handleExport(format: "pdf" | "docx") {
    setSaveStatus("saving");
    startTransition(() => {
      void savePlano("gerado")
        .then((id) => {
          setSaveStatus("saved");
          setIsFinalized(true);
          setPreviewMode(true);
          // Update pedagogic memory in background (fire-and-forget)
          void fetch("/api/ia/memoria", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conteudo: values, metadata: extractMetadata(values, schema) }),
          }).catch(() => {});
          const url =
            format === "pdf"
              ? `/api/planos/${id}/download?format=pdf`
              : `/api/planos/${id}/download`;
          void triggerDownload(url).then((info) => {
            if (info) setDownloadLimitInfo(info);
          }).catch(() => { window.open(url, "_blank"); });
        })
        .catch(() => { setSaveStatus("error"); setTimeout(() => setSaveStatus("idle"), 3000); });
    });
  }

  const isSaving = saveStatus === "saving" || isPending;

  return (
    <>
    <div
      className="flex flex-col gap-4"
      style={wizardMode ? undefined : { height: "calc(100vh - 190px)" }}
    >
      {/* Toolbar */}
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
          </div>
          <div className="flex items-center gap-2">
            {saveStatus === "saved" && (
              <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5" /> Salvo
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
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Salvar rascunho
            </button>
            {docHtml && !isFinalized && (
              <button
                type="button"
                onClick={() => setPreviewMode((v) => !v)}
                className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
              >
                {previewMode ? (
                  <>
                    <EyeOff className="h-3.5 w-3.5" />
                    Editar
                  </>
                ) : (
                  <>
                    <Eye className="h-3.5 w-3.5" />
                    Visualizar
                  </>
                )}
              </button>
            )}
            {hasDocx && (
              <button
                type="button"
                onClick={() => handleExport("docx")}
                disabled={isSaving}
                className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950 disabled:opacity-50"
              >
                <FileText className="h-3.5 w-3.5" />
                Exportar DOCX
              </button>
            )}
            <button
              type="button"
              onClick={() => handleExport("pdf")}
              disabled={isSaving}
              className="flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              Exportar PDF
            </button>
          </div>
        </header>
      )}

      {/* Main split view */}
      <div
        className={`flex overflow-hidden rounded-2xl border border-slate-200 bg-white ${
          wizardMode ? "h-[660px]" : "flex-1"
        }`}
      >
        {/* ── Left: Document view or form fallback ── */}
        <div className="flex-1 overflow-y-auto">
          {docLoading ? (
            <div className="flex h-full items-center justify-center gap-3 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin text-violet-500" />
              <span className="text-sm">Carregando documento…</span>
            </div>
          ) : docHtml ? (
            <div className="bg-slate-100 p-6">
              <style>{`
                /* ── Página (simulação de folha Word) ── */
                .doc-page {
                  background: #fff;
                  box-shadow: 0 1px 4px rgba(0,0,0,.08), 0 6px 28px rgba(0,0,0,.07);
                  border-radius: 2px;
                  padding: 40px 48px 56px;
                  max-width: 820px;
                  margin: 0 auto;
                  font-family: "Calibri","Liberation Sans",Arial,sans-serif;
                  font-size: 12px;
                  color: #111;
                  line-height: 1.5;
                }

                /* ── Estrutura do documento ── */
                .doc-view table { width:100%; border-collapse:collapse; margin:4px 0; }
                .doc-view td, .doc-view th {
                  border:1px solid #555;
                  padding:4px 8px;
                  vertical-align:top;
                  font-size:12px;
                  min-width:24px;
                }
                .doc-view th { font-weight:700; background:#f0f0f0; }
                .doc-view p { margin:2px 0; line-height:1.5; }
                .doc-view h1 { font-size:15px; font-weight:700; text-align:center; margin:10px 0 6px; }
                .doc-view h2 { font-size:13px; font-weight:700; text-align:center; margin:8px 0 4px; }
                .doc-view h3 { font-size:12px; font-weight:700; margin:6px 0 3px; }
                .doc-view strong { font-weight:700; }
                .doc-view em { font-style:italic; }
                .doc-view u { text-decoration:underline; }
                .doc-view img { max-width:100%; height:auto; display:block; margin:0 auto 8px; }
                .doc-view ul, .doc-view ol { padding-left:18px; margin:2px 0; }
                .doc-view li { margin:1px 0; }

                /* ── Campos editáveis — sempre visíveis ── */
                .doc-view td[data-field-key] {
                  background:#faf5ff !important;
                  border-left:3px solid #8b5cf6 !important;
                  cursor:text;
                  position:relative;
                  min-height:2em;
                  transition:background .12s;
                  text-align:left !important;
                  font-weight:normal !important;
                  font-style:normal !important;
                }
                /* Preserve explicit bold/italic/list from the RichTextEditor */
                .doc-view td[data-field-key] strong,
                .doc-view td[data-field-key] b { font-weight:700; }
                .doc-view td[data-field-key] em,
                .doc-view td[data-field-key] i { font-style:italic; }
                .doc-view td[data-field-key] u { text-decoration:underline; }
                .doc-view td[data-field-key]:hover {
                  background:#ede9fe !important;
                }
                .doc-view td[data-field-key]:focus,
                .doc-view td[data-field-key]:focus-within {
                  background:#ede9fe !important;
                  box-shadow:inset 0 0 0 2px #7c3aed;
                  outline:none;
                }

                /* Badge com nome do campo (aparece no hover/foco) */
                .doc-view td[data-field-key]::after {
                  content: attr(data-field-label);
                  position:absolute;
                  top:2px;
                  right:3px;
                  background:#7c3aed;
                  color:#fff;
                  font-size:8px;
                  font-weight:700;
                  padding:1px 5px;
                  border-radius:2px;
                  white-space:nowrap;
                  pointer-events:none;
                  line-height:1.5;
                  opacity:0;
                  transition:opacity .12s;
                  text-transform:uppercase;
                  letter-spacing:.04em;
                  max-width:160px;
                  overflow:hidden;
                  text-overflow:ellipsis;
                }
                .doc-view td[data-field-key]:hover::after,
                .doc-view td[data-field-key]:focus::after,
                .doc-view td[data-field-key]:focus-within::after {
                  opacity:1;
                }

                /* ── Preview mode — clean read-only view ── */
                .doc-view-preview td[data-field-key] {
                  background:#fff !important;
                  border-left:none !important;
                  cursor:default;
                  text-align:left !important;
                  font-weight:normal !important;
                  font-style:normal !important;
                }
                .doc-view-preview td[data-field-key] strong,
                .doc-view-preview td[data-field-key] b { font-weight:700; }
                .doc-view-preview td[data-field-key] em,
                .doc-view-preview td[data-field-key] i { font-style:italic; }
                .doc-view-preview td[data-field-key] u { text-decoration:underline; }
                .doc-view-preview td[data-field-key]::after { display:none; }
              `}</style>
              <div ref={docContainerRef}>
                {previewMode ? (
                  <PreviewDocView html={docHtml} values={values} />
                ) : (
                  <DocView
                    html={docHtml}
                    values={values}
                    activeFieldKey={activeFieldKey}
                    onFieldFocus={(key, label, role) => {
                      setActiveFieldKey(key);
                      setActiveFieldMeta({ label, role });
                      const field = schema.find((f) => f.key === key);
                      if (field && !suggestions[key] && !loadingField && metadataComplete) {
                        void fetchSuggestionsForField(field, metadata);
                      }
                    }}
                    onFieldChange={setFieldValue}
                  />
                )}
              </div>
            </div>
          ) : (
            /* Form fallback */
            <div className="px-6 py-6">
              <FormView
                schema={schema}
                manualFields={manualFields}
                groupedIA={groupedIA}
                values={values}
                activeFieldKey={activeFieldKey}
                loadingField={loadingField}
                metadataComplete={metadataComplete}
                suggestions={suggestions}
                setActiveFieldKey={(key) => {
                  setActiveFieldKey(key);
                  const f = schema.find((ff) => ff.key === key);
                  if (f) setActiveFieldMeta({ label: f.label, role: f.role ?? "" });
                }}
                setFieldValue={setFieldValue}
                fetchSuggestions={(field) => void fetchSuggestionsForField(field, metadata)}
              />
            </div>
          )}
        </div>

        {/* ── Right: AI chatbot panel (hidden in preview mode) ── */}
        {!previewMode && (
          <AIChatPanel
            activeField={activeField}
            activeFieldMeta={activeFieldMeta}
            suggestions={activeSuggestions}
            isLoading={loadingField === activeFieldKey}
            streamingCharCount={loadingField === activeFieldKey ? streamingCharCount : 0}
            error={suggestError}
            metadata={metadata}
            metadataComplete={metadataComplete}
            generalContext={generalContext}
            onGeneralContextChange={setGeneralContext}
            onInsert={insertSuggestion}
            onGenerate={(extraContext, bypass) => {
              if (activeField) void fetchSuggestionsForField(activeField, metadata, extraContext, bypass);
            }}
          />
        )}
        {previewMode && (
          <div className="flex w-64 shrink-0 flex-col items-center justify-center gap-4 border-l border-slate-100 bg-slate-50 p-6 text-center">
            {isFinalized ? (
              <>
                <div className="rounded-full bg-emerald-100 p-3">
                  <CheckCircle2 className="h-7 w-7 text-emerald-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-700">Plano finalizado</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Este plano está concluído e não pode ser editado novamente. Para uma nova turma ou versão, gere um novo plano.
                  </p>
                </div>
                <a
                  href="/dashboard/gerar"
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-xs font-medium text-white transition hover:bg-slate-800"
                >
                  Gerar novo plano
                </a>
              </>
            ) : (
              <>
                <Eye className="h-8 w-8 text-slate-300" />
                <div>
                  <p className="text-sm font-semibold text-slate-700">Modo visualização</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Veja o documento preenchido. Clique em "Editar" para continuar modificando os campos.
                  </p>
                </div>
                <div className="flex flex-col gap-2 w-full">
                  {hasDocx && (
                    <button
                      type="button"
                      onClick={() => handleExport("docx")}
                      disabled={isSaving}
                      className="flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-950 disabled:opacity-50"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Exportar DOCX
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleExport("pdf")}
                    disabled={isSaving}
                    className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Exportar PDF
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>

    {downloadLimitInfo && (
      <DownloadLimitDialog
        info={downloadLimitInfo}
        onClose={() => setDownloadLimitInfo(null)}
      />
    )}
    </>
  );
});

// ─── FormView (fallback when no DOCX) ─────────────────────────────────────────

interface FormViewProps {
  schema: TemplateFieldSchema[];
  manualFields: TemplateFieldSchema[];
  groupedIA: Record<string, TemplateFieldSchema[]>;
  values: Record<string, string>;
  activeFieldKey: string | null;
  loadingField: string | null;
  metadataComplete: boolean;
  suggestions: Record<string, IaSugestao[]>;
  setActiveFieldKey: (key: string) => void;
  setFieldValue: (key: string, value: string) => void;
  fetchSuggestions: (field: TemplateFieldSchema) => void;
}

function FormView({
  schema, manualFields, groupedIA, values, activeFieldKey,
  loadingField, metadataComplete, suggestions,
  setActiveFieldKey, setFieldValue, fetchSuggestions,
}: FormViewProps) {
  if (schema.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center">
        <p className="font-medium text-slate-700">Este template não tem campos extraídos.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {manualFields.length > 0 && (
        <section>
          <div className="mb-4 flex items-center gap-2">
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
              Dados fixos
            </span>
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

      {Object.entries(groupedIA).map(([group, fields], idx) => (
        <section key={group} id={idx === 0 ? "ia-section-first" : undefined}>
          <div className="mb-4 flex items-center gap-2">
            <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-700">
              {GROUP_LABELS[group] ?? group}
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
                onSuggest={() => fetchSuggestions(field)}
              />
            ))}
          </div>
        </section>
      ))}

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
  );
}

// ─── AIChatPanel ──────────────────────────────────────────────────────────────

interface AIChatPanelProps {
  activeField: TemplateFieldSchema | null;
  activeFieldMeta: { label: string; role: string } | null;
  suggestions: IaSugestao[];
  isLoading: boolean;
  streamingCharCount: number;
  error: string | null;
  metadata: Record<string, string>;
  metadataComplete: boolean;
  generalContext: string;
  onGeneralContextChange: (v: string) => void;
  onInsert: (s: IaSugestao, mode: "label" | "full") => void;
  onGenerate: (extraContext?: string, bypassCache?: boolean) => void;
}

function AIChatPanel({
  activeField,
  activeFieldMeta,
  suggestions,
  isLoading,
  streamingCharCount,
  error,
  metadata,
  metadataComplete,
  generalContext,
  onGeneralContextChange,
  onInsert,
  onGenerate,
}: AIChatPanelProps) {
  const [contextInput, setContextInput] = useState("");
  const [showGeneralCtx, setShowGeneralCtx] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const metaEntries = Object.entries(metadata).slice(0, 5);
  const fieldLabel = activeField?.label ?? activeFieldMeta?.label;

  useEffect(() => {
    setContextInput("");
  }, [activeField?.key]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [suggestions, isLoading]);

  function sendContext() {
    if (!contextInput.trim()) return;
    onGenerate(contextInput.trim(), true);
    setContextInput("");
  }

  return (
    <div className="flex w-80 shrink-0 flex-col border-l border-slate-200 bg-slate-50 xl:w-96">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-600">
          <Sparkles className="h-4 w-4 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">Magis — Assistente Pedagógica</p>
          <p className="truncate text-xs text-slate-500">
            {fieldLabel ? `Campo: ${fieldLabel}` : "Selecione um campo"}
          </p>
        </div>
        {isLoading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-500" />}
      </div>

      {/* Chat area */}
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {/* Magis intro — always first */}
        {!fieldLabel && (
          <ChatBubble>
            <p className="text-sm text-slate-700">
              Olá! Sou a <span className="font-semibold text-violet-700">Magis</span>, sua assistente pedagógica. Clique em qualquer campo{" "}
              <span className="font-semibold text-blue-600">com borda azul</span> para
              eu sugerir conteúdo específico para ele.
            </p>
          </ChatBubble>
        )}

        {/* Context bubble */}
        {metaEntries.length > 0 && (
          <ChatBubble>
            <p className="mb-1 text-xs font-semibold text-violet-700">Tenho este contexto:</p>
            {metaEntries.map(([k, v]) => (
              <p key={k} className="text-xs text-slate-700">
                <span className="font-medium capitalize">{k.replace(/_/g, " ")}:</span>{" "}
                <span>{v}</span>
              </p>
            ))}
            {/* General context — editable inline, persists for all fields */}
            <div className="mt-2 border-t border-violet-100 pt-2">
              {generalContext.trim() && !showGeneralCtx ? (
                <div>
                  <p className="mb-0.5 flex items-center gap-1 text-xs font-semibold text-violet-700">
                    <Pin className="h-3 w-3" />
                    Contexto geral:
                  </p>
                  <p className="text-xs text-slate-700 whitespace-pre-wrap">{generalContext.trim()}</p>
                  <button
                    type="button"
                    onClick={() => setShowGeneralCtx(true)}
                    className="mt-1 text-[11px] text-violet-500 underline hover:text-violet-700"
                  >
                    Editar
                  </button>
                </div>
              ) : showGeneralCtx ? (
                <div>
                  <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-violet-700">
                    <Pin className="h-3 w-3" />
                    Contexto geral:
                  </p>
                  <textarea
                    rows={3}
                    autoFocus
                    value={generalContext}
                    onChange={(e) => onGeneralContextChange(e.target.value)}
                    placeholder="Ex: turma agitada, foco em projetos práticos…"
                    className="w-full resize-none rounded-xl border border-violet-300 bg-white px-3 py-2 text-xs outline-none transition placeholder:text-slate-400 focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                  />
                  <button
                    type="button"
                    onClick={() => setShowGeneralCtx(false)}
                    className="mt-1 text-[11px] font-medium text-violet-600 hover:text-violet-800"
                  >
                    Salvar
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowGeneralCtx(true)}
                  className="flex items-center gap-1 text-[11px] text-violet-500 hover:text-violet-700"
                >
                  <Pin className="h-3 w-3" />
                  + Adicionar contexto geral
                </button>
              )}
            </div>
            {!metadataComplete && (
              <p className="mt-1.5 text-xs text-amber-600">
                Preencha ao menos dois dados fixos para a Magis ativar sugestões.
              </p>
            )}
          </ChatBubble>
        )}

        {/* Field active — no suggestions yet and not loading */}
        {fieldLabel && !isLoading && suggestions.length === 0 && !error && (
          <ChatBubble>
            <p className="text-sm text-slate-700">
              Campo selecionado:{" "}
              <span className="font-semibold">{fieldLabel}</span>
              {metadataComplete
                ? ". A Magis está preparando sugestões para você…"
                : ". Preencha os dados fixos para a Magis auxiliar você."}
            </p>
          </ChatBubble>
        )}

        {/* Loading */}
        {isLoading && (
          <ChatBubble>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 animate-bounce rounded-full bg-violet-400"
                  style={{ animationDelay: "0ms" }}
                />
                <span
                  className="h-2 w-2 animate-bounce rounded-full bg-violet-400"
                  style={{ animationDelay: "120ms" }}
                />
                <span
                  className="h-2 w-2 animate-bounce rounded-full bg-violet-400"
                  style={{ animationDelay: "240ms" }}
                />
              </div>
              {streamingCharCount > 0 && (
                <p className="tabular-nums text-xs text-violet-500">
                  Recebendo… {streamingCharCount}c
                </p>
              )}
            </div>
          </ChatBubble>
        )}

        {/* Error */}
        {error && !isLoading && (
          <ChatBubble variant="error">
            <p className="text-xs text-rose-700">{error}</p>
            <button
              type="button"
              onClick={() => onGenerate()}
              className="mt-1.5 text-xs font-medium text-rose-600 underline hover:text-rose-800"
            >
              Tentar novamente
            </button>
          </ChatBubble>
        )}

        {/* Suggestions */}
        {!isLoading &&
          suggestions.map((s, i) => (
            <ChatBubble key={s.id} animIndex={i}>
              <p className="text-sm font-semibold text-slate-900">{s.label}</p>
              {s.descricao && (
                <p className="mt-0.5 text-xs text-slate-600">{s.descricao}</p>
              )}
              {s.fonte && (
                <span className="mt-1 inline-block rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">
                  {s.fonte}
                </span>
              )}
              <div className="mt-2 flex gap-1.5">
                <button
                  type="button"
                  onClick={() => onInsert(s, "label")}
                  className="flex-1 rounded-lg border border-violet-200 bg-violet-50 py-1 text-xs font-medium text-violet-700 transition hover:bg-violet-600 hover:text-white"
                >
                  Título
                </button>
                {s.descricao && (
                  <button
                    type="button"
                    onClick={() => onInsert(s, "full")}
                    className="flex-1 rounded-lg bg-violet-100 py-1 text-xs font-medium text-violet-700 transition hover:bg-violet-600 hover:text-white"
                  >
                    Completo
                  </button>
                )}
              </div>
            </ChatBubble>
          ))}

        <div ref={chatEndRef} />
      </div>

      {/* Action bar */}
      <div className="shrink-0 border-t border-slate-200 bg-white p-3 space-y-2">
        {fieldLabel && !isLoading && suggestions.length > 0 && (
          <button
            type="button"
            onClick={() => onGenerate(undefined, true)}
            disabled={!metadataComplete}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-violet-200 py-2 text-xs font-medium text-violet-700 transition hover:bg-violet-50 disabled:opacity-50"
          >
            <WandSparkles className="h-3.5 w-3.5" />
            Pedir novas sugestões à Magis
          </button>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={contextInput}
            onChange={(e) => setContextInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") sendContext(); }}
            placeholder={
              fieldLabel
                ? "Adicionar contexto ao campo…"
                : "Selecione um campo primeiro…"
            }
            disabled={!fieldLabel || isLoading}
            className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={sendContext}
            disabled={!contextInput.trim() || !fieldLabel || isLoading || !metadataComplete}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600 text-white transition hover:bg-violet-500 disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatBubble({
  children,
  variant = "default",
  animIndex,
}: {
  children: React.ReactNode;
  variant?: "default" | "error";
  animIndex?: number;
}) {
  return (
    <div
      className="flex gap-2"
      style={
        animIndex !== undefined
          ? {
              opacity: 0,
              animation: "chatBubbleIn 0.28s ease forwards",
              animationDelay: `${animIndex * 90}ms`,
            }
          : undefined
      }
    >
      <style>{`@keyframes chatBubbleIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <div
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
          variant === "error" ? "bg-rose-100" : "bg-violet-100"
        } mt-0.5`}
      >
        <Sparkles
          className={`h-3 w-3 ${variant === "error" ? "text-rose-500" : "text-violet-600"}`}
        />
      </div>
      <div
        className={`max-w-[85%] rounded-2xl rounded-tl-sm border px-3 py-2 ${
          variant === "error"
            ? "border-rose-200 bg-rose-50"
            : "border-slate-200 bg-white"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

// ─── FieldInput / IaFieldInput (form fallback) ───────────────────────────────

interface FieldInputProps {
  field: TemplateFieldSchema;
  value: string;
  active: boolean;
  onChange: (v: string) => void;
  onFocus: () => void;
}

function FieldInput({ field, value, active, onChange, onFocus }: FieldInputProps) {
  const base = "w-full rounded-2xl border bg-white px-4 py-3 text-sm text-slate-950 outline-none transition";
  const cls = active
    ? `${base} border-violet-400 ring-2 ring-violet-100`
    : `${base} border-slate-300 focus:border-violet-400 focus:ring-2 focus:ring-violet-100`;

  return (
    <label className="block">
      <span className="block text-sm font-medium text-slate-700">{field.label}</span>
      {field.required && <span className="text-xs text-rose-500"> *</span>}
      {field.helperText && <span className="block text-xs text-slate-500">{field.helperText}</span>}
      {field.type === "textarea" ? (
        <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} onFocus={onFocus} placeholder={field.placeholder} className={`mt-1.5 ${cls}`} />
      ) : field.type === "number" ? (
        <input type="number" value={value} onChange={(e) => onChange(e.target.value)} onFocus={onFocus} className={`mt-1.5 ${cls}`} />
      ) : field.type === "select" && field.options ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} onFocus={onFocus} className={`mt-1.5 ${cls}`}>
          <option value="">Selecione…</option>
          {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} onFocus={onFocus} placeholder={field.placeholder} className={`mt-1.5 ${cls}`} />
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

function IaFieldInput({ field, value, active, hasSuggestions, isLoading, metadataComplete, onChange, onFocus, onSuggest }: IaFieldInputProps) {
  useEffect(() => {
    if (active && !hasSuggestions && !isLoading && metadataComplete) onSuggest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <div className={`rounded-2xl border p-4 transition ${active ? "border-violet-400 bg-violet-50 shadow-sm ring-1 ring-violet-100" : "border-blue-300 bg-blue-50/40"}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-800">{field.label}</span>
        <button
          type="button"
          onClick={() => { onFocus(); onSuggest(); }}
          disabled={isLoading || !metadataComplete}
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-violet-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <WandSparkles className="h-3 w-3" />}
          {hasSuggestions ? "Nova sugestão" : "Perguntar à Magis"}
        </button>
      </div>
      <RichTextEditor value={value} onChange={onChange} onFocus={onFocus} active={active} placeholder={metadataComplete ? 'Clique em "Perguntar à Magis" ou escreva aqui…' : "Preencha os dados fixos para habilitar a Magis…"} />
    </div>
  );
}
