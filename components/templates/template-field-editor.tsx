"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  GripVertical,
  HelpCircle,
  Loader2,
  MousePointer2,
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

// ─── DocxInteractive ──────────────────────────────────────────────────────────
// mammoth/docx-preview renderer with click-to-add-field support.

interface AnnotationPopup {
  text: string;
  ordinal: number;
  inputKey: string;
  role: "manual" | "ia_sugerida";
}

interface DocxInteractiveProps {
  templateId: string;
  fields: TemplateFieldSchema[];
  fieldPositions: Record<string, { cellText: string; ordinal: number }>;
  activeKey: string | null;
  previewVersion?: number;
  onClickElement: (text: string, ordinal: number, key: string, role: "manual" | "ia_sugerida") => void;
}

function DocxInteractive({ templateId, fields, fieldPositions, activeKey, previewVersion = 0, onClickElement }: DocxInteractiveProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const bufferRef = useRef<ArrayBuffer | null>(null);
  const [phase, setPhase] = useState<"loading" | "rendering" | "done" | "error">("loading");
  const [popup, setPopup] = useState<AnnotationPopup | null>(null);

  // helper: derive a clean snake_case key from cell text
  function deriveKey(text: string): string {
    let label = text;
    const colonIdx = label.indexOf(":");
    if (colonIdx > 0 && colonIdx < label.length - 1) label = label.slice(0, colonIdx);
    return label.replace(/:+$/, "").trim()
      .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  }

  function deriveRole(key: string): "manual" | "ia_sugerida" {
    return /habilidade|competencia|objetivo|avaliacao|conteudo|tematica|metodologia|atividade|pratica/.test(key)
      ? "ia_sugerida" : "manual";
  }

  function confirmPopup() {
    if (!popup?.inputKey) return;
    onClickElement(popup.text, popup.ordinal, popup.inputKey, popup.role);
    setPopup(null);
  }

  useEffect(() => {
    setPhase("loading");
    bufferRef.current = null;
    let cancelled = false;
    fetch(`/api/templates/${templateId}/arquivo?fillable=1`)
      .then((r) => r.ok ? r : fetch(`/api/templates/${templateId}/arquivo`))
      .then((r) => { if (!r.ok) throw new Error(); return r.arrayBuffer(); })
      .then((buf) => { if (!cancelled) { bufferRef.current = buf; setPhase("rendering"); } })
      .catch(() => { if (!cancelled) setPhase("error"); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, previewVersion]);

  useEffect(() => {
    if (phase !== "rendering" || !bufferRef.current || !containerRef.current) return;
    let cancelled = false;
    const container = containerRef.current;
    import("docx-preview")
      .then(({ renderAsync }) => {
        if (cancelled || !bufferRef.current) return;
        container.innerHTML = "";
        return renderAsync(bufferRef.current, container, undefined, {
          inWrapper: true, ignoreWidth: false, ignoreHeight: true,
          ignoreFonts: false, breakPages: true, useBase64URL: true,
          renderEndnotes: true, renderFooters: true, renderFootnotes: true, renderHeaders: true,
        });
      })
      .then(() => { if (!cancelled) setPhase("done"); })
      .catch(() => { if (!cancelled) setPhase("error"); });
    return () => { cancelled = true; };
  }, [phase]);

  // Highlight the active field
  useEffect(() => {
    if (phase !== "done" || !containerRef.current) return;
    const container = containerRef.current;
    container.querySelectorAll("[data-mhl]").forEach((el) => {
      (el as HTMLElement).style.removeProperty("background");
      (el as HTMLElement).style.removeProperty("outline");
      (el as HTMLElement).style.removeProperty("border-radius");
      el.removeAttribute("data-mhl");
    });
    if (!activeKey) return;
    const field = fields.find((f) => f.key === activeKey);
    if (!field) return;
    const terms = [field.label, field.defaultValue].filter(
      (t): t is string => typeof t === "string" && t.trim().length > 2,
    );
    if (!terms.length) return;
    const candidates = Array.from(container.querySelectorAll("td, p"));
    let bestEl: Element | null = null; let bestScore = 0;
    for (const el of candidates) {
      const text = (el.textContent ?? "").trim();
      if (!text) continue;
      for (const term of terms) {
        if (text.includes(term)) {
          const score = term.length / Math.max(text.length, 1);
          if (score > bestScore) { bestScore = score; bestEl = el; }
        }
      }
    }
    if (bestEl) {
      (bestEl as HTMLElement).style.background = "rgba(139,92,246,0.15)";
      (bestEl as HTMLElement).style.outline = "2px solid rgba(139,92,246,0.5)";
      (bestEl as HTMLElement).style.borderRadius = "2px";
      bestEl.setAttribute("data-mhl", "true");
      bestEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeKey, fields, phase]);

  // Inject {{key}} chips immediately when fieldPositions changes
  useEffect(() => {
    if (phase !== "done" || !containerRef.current) return;
    const container = containerRef.current;
    const els = Array.from(container.querySelectorAll("td, p")) as HTMLElement[];
    for (const [key, pos] of Object.entries(fieldPositions)) {
      if (container.querySelector(`[data-field-chip="${key}"]`)) continue;
      const field = fields.find((f) => f.key === key);
      if (!field) continue;
      const matches = els.filter((el) => (el.textContent?.trim() ?? "") === pos.cellText);
      const targetEl = matches[pos.ordinal];
      if (!targetEl) continue;
      const isIa = field.role === "ia_sugerida";
      const chip = document.createElement("span");
      chip.setAttribute("data-field-chip", key);
      chip.style.cssText = [
        "display:inline-block", "padding:2px 8px", "border-radius:6px",
        "font-family:monospace", "font-size:10px", "font-weight:700",
        "white-space:nowrap", "line-height:1.7", "margin-left:4px",
        isIa
          ? "background:rgba(139,92,246,.14);color:#6d28d9;border:1px solid rgba(139,92,246,.35)"
          : "background:rgba(245,158,11,.14);color:#b45309;border:1px solid rgba(245,158,11,.35)",
      ].join(";");
      chip.textContent = `{{${key}}}`;
      targetEl.appendChild(chip);
    }
  }, [phase, fieldPositions, fields]);

  // Click listeners — open annotation popup instead of direct add
  useEffect(() => {
    if (phase !== "done" || !containerRef.current) return;
    const container = containerRef.current;
    const els = Array.from(container.querySelectorAll("td, p")) as HTMLElement[];
    const onEnter = (e: Event) => {
      const el = e.currentTarget as HTMLElement;
      if (!el.hasAttribute("data-mhl")) {
        el.style.cursor = "pointer";
        el.style.outline = "1.5px dashed rgba(139,92,246,0.4)";
        el.style.borderRadius = "2px";
      }
    };
    const onLeave = (e: Event) => {
      const el = e.currentTarget as HTMLElement;
      if (!el.hasAttribute("data-mhl")) {
        el.style.removeProperty("cursor");
        el.style.removeProperty("outline");
        el.style.removeProperty("border-radius");
      }
    };
    const onClick = (e: Event) => {
      e.stopPropagation();
      const el = e.currentTarget as HTMLElement;
      const text = el.textContent?.trim() ?? "";
      const ordinal = els.slice(0, els.indexOf(el)).filter((t) => t.textContent?.trim() === text).length;
      const autoKey = deriveKey(text) || `campo_${Date.now()}`;
      setPopup({ text, ordinal, inputKey: autoKey, role: deriveRole(autoKey) });
    };
    for (const el of els) {
      el.addEventListener("mouseenter", onEnter);
      el.addEventListener("mouseleave", onLeave);
      el.addEventListener("click", onClick);
    }
    return () => {
      for (const el of els) {
        el.removeEventListener("mouseenter", onEnter);
        el.removeEventListener("mouseleave", onLeave);
        el.removeEventListener("click", onClick);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <style>{`
        .docx-html-preview { background: #f1f5f9; padding: 20px 12px; min-width: max-content; }
        .docx-html-preview table { border-collapse: collapse; }
        .docx-html-preview td, .docx-html-preview th { padding: 2px 4px; word-break: break-word; }
        .docx-html-preview img { max-width: none; height: auto; }
        .docx-html-preview p { margin: 0.2em 0; }
      `}</style>
      {/* overflow-x-auto enables horizontal scroll for wide/landscape documents */}
      <div ref={scrollerRef} className={`flex-1 overflow-y-auto overflow-x-auto ${phase === "error" ? "invisible absolute" : ""}`}>
        <div ref={containerRef} className="docx-html-preview" />
      </div>
      {phase === "loading" && (
        <div className="flex h-full items-center justify-center gap-3 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin text-violet-500" />
          <span className="text-sm">Carregando documento…</span>
        </div>
      )}
      {phase === "error" && (
        <div className="flex h-full items-center justify-center px-8 text-center">
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-600">Pré-visualização indisponível.</p>
            <p className="text-xs text-slate-400">Configure os campos na lista à direita.</p>
          </div>
        </div>
      )}

      {/* Annotation popup — slides up from bottom when a cell is clicked */}
      {popup && (
        <div
          className="absolute bottom-0 left-0 right-0 z-20 border-t-2 border-violet-300 bg-white p-3 shadow-[0_-4px_20px_rgba(139,92,246,0.15)]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Context: cell text */}
          <div className="mb-2 flex items-start gap-1.5">
            <span className="mt-0.5 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Célula:</span>
            <p className="truncate text-[11px] italic text-slate-600">
              &ldquo;{popup.text.slice(0, 90)}{popup.text.length > 90 ? "…" : ""}&rdquo;
            </p>
          </div>

          {/* Variable name input */}
          <div className="mb-2.5 flex items-center gap-1">
            <span className="select-none font-mono text-base font-bold text-slate-400">{"{"+"{"}</span>
            <input
              autoFocus
              value={popup.inputKey}
              onChange={(e) => {
                const clean = e.target.value
                  .replace(/^\{\{/, "").replace(/\}\}$/, "")
                  .toLowerCase().replace(/[^a-z0-9_]/g, "_");
                setPopup((p) => p ? { ...p, inputKey: clean } : null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmPopup();
                if (e.key === "Escape") setPopup(null);
              }}
              placeholder="nome_da_variavel"
              className="flex-1 rounded-xl border border-violet-300 px-3 py-1.5 font-mono text-sm text-violet-700 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
            />
            <span className="select-none font-mono text-base font-bold text-slate-400">{"}"+"}"}</span>
          </div>

          {/* Role toggle */}
          <div className="mb-2.5 flex gap-2">
            <button
              type="button"
              onClick={() => setPopup((p) => p ? { ...p, role: "manual" } : null)}
              className={`flex-1 rounded-xl border py-1.5 text-xs font-semibold transition ${
                popup.role !== "ia_sugerida"
                  ? "border-amber-400 bg-amber-50 text-amber-800"
                  : "border-slate-200 text-slate-500 hover:border-slate-300"
              }`}
            >
              Fixo / Manual
            </button>
            <button
              type="button"
              onClick={() => setPopup((p) => p ? { ...p, role: "ia_sugerida" } : null)}
              className={`flex-1 rounded-xl border py-1.5 text-xs font-semibold transition ${
                popup.role === "ia_sugerida"
                  ? "border-violet-400 bg-violet-50 text-violet-800"
                  : "border-slate-200 text-slate-500 hover:border-slate-300"
              }`}
            >
              Sugestão / Magis
            </button>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPopup(null)}
              className="flex-1 rounded-xl border border-slate-200 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-400"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmPopup}
              disabled={!popup.inputKey}
              className="flex-1 rounded-xl bg-violet-600 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500 disabled:opacity-40"
            >
              ✓ Adicionar campo
            </button>
          </div>
        </div>
      )}
    </div>
  );
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
  const [fieldPositions, setFieldPositions] = useState<Record<string, { cellText: string; ordinal: number }>>({});
  const [previewVersion, setPreviewVersion] = useState(0);
  const [viewMode, setViewMode] = useState<"preview" | "interactive">("preview");

  const fieldListRef = useRef<HTMLDivElement>(null);
  const panelScrollRef = useRef<HTMLDivElement>(null);

  function preserveScroll(fn: () => void) {
    const el = panelScrollRef.current;
    const top = el?.scrollTop ?? 0;
    fn();
    requestAnimationFrame(() => { if (el) el.scrollTop = top; });
  }

  const isDocx = (template.arquivo_url ?? "").match(/\.(docx|doc)$/i) !== null;

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
      setPreviewVersion((v) => v + 1);
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

  function handleAddFromDoc(rawText: string, clickOrdinal: number, explicitKey: string, explicitRole: "manual" | "ia_sugerida") {
    const key = explicitKey || `campo_${Date.now()}`;

    const existing = fields.find((f) => f.key === key);
    if (existing) {
      setExpandedField(existing.key);
      setActiveFieldKey(existing.key);
      return;
    }

    const label = rawText
      .replace(/:+$/, "").trim()
      .slice(0, 80) || key.replace(/_/g, " ");

    let group: TemplateFieldSchema["group"] = explicitRole === "ia_sugerida" ? "conteudos" : "dados_turma";
    if (explicitRole === "ia_sugerida") {
      if (/habilidade|bncc|saeb/.test(key)) group = "habilidades";
      else if (/competencia/.test(key)) group = "competencias";
      else if (/objetivo/.test(key)) group = "objetivos";
      else if (/avaliacao/.test(key)) group = "avaliacao";
    }

    const f: TemplateFieldSchema = {
      key,
      label,
      type: "text",
      required: true,
      role: explicitRole,
      group,
      placeholder: "",
      helperText: "",
      aiInstructions: "",
    };

    setFields((prev) => [...prev, f]);
    setExpandedField(f.key);
    setActiveFieldKey(f.key);
    if (rawText.trim()) {
      setFieldPositions((prev) => ({ ...prev, [f.key]: { cellText: rawText.trim(), ordinal: clickOrdinal } }));
    }
  }

  function removeField(index: number) {
    const key = fields[index]?.key;
    setFields((prev) => prev.filter((_, i) => i !== index));
    if (activeFieldKey === key) setActiveFieldKey(null);
    if (expandedField === key) setExpandedField(null);
    if (key) setFieldPositions((prev) => { const next = { ...prev }; delete next[key]; return next; });
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
          field_positions: fieldPositions,
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
          setFieldPositions({});
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

  // Help modal
  const helpModal = showHelp && (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 px-4 py-8 backdrop-blur-sm"
      onClick={() => setShowHelp(false)}
    >
      <div
        className="relative flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <h2 className="text-base font-bold text-slate-950">Guia do editor de template</h2>
            <p className="mt-0.5 text-xs text-slate-400">Entenda cada tipo de campo e como configurá-los</p>
          </div>
          <button type="button" onClick={() => setShowHelp(false)} className="rounded-xl border border-slate-200 p-1.5 text-slate-400 transition hover:border-slate-950 hover:text-slate-950">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-2 p-6">
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5">
              <div className="mb-3 flex items-center gap-2.5">
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">Fixo</span>
                <h3 className="text-sm font-bold text-slate-950">Campo fixo</h3>
              </div>
              <p className="text-sm leading-relaxed text-slate-600">
                Preenchido manualmente pelo professor — a Magis <strong className="text-slate-800">não</strong> sugere conteúdo. Ideal para escola, turma, professor e período.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5">
              <div className="mb-3 flex items-center gap-2.5">
                <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-bold text-violet-700">IA</span>
                <h3 className="text-sm font-bold text-slate-950">Campo sugerido pela Magis</h3>
              </div>
              <p className="text-sm leading-relaxed text-slate-600">
                Quando o professor foca neste campo no editor, a Magis gera sugestões automáticas alinhadas à BNCC, SAEB e ao currículo territorial.
              </p>
            </div>
            <div className="rounded-2xl border border-violet-100 bg-violet-50 p-5">
              <div className="mb-3 flex items-center gap-2.5">
                <MousePointer2 className="h-4 w-4 text-violet-600" />
                <h3 className="text-sm font-bold text-slate-950">Como adicionar campos pelo documento</h3>
              </div>
              <p className="text-sm leading-relaxed text-slate-600">
                Clique na aba <strong>"Adicionar campos"</strong> no painel esquerdo. O documento ficará no modo interativo — clique em qualquer célula ou parágrafo para criar um campo associado àquela posição.
              </p>
            </div>
            {isDocx && fields.length > 0 && (
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5">
                <h3 className="mb-1 text-sm font-bold text-slate-950">Variáveis do documento</h3>
                <p className="mb-4 text-xs leading-relaxed text-slate-500">
                  Insira <code className="rounded bg-slate-200 px-1 font-mono">{"{{chave}}"}</code> no seu arquivo Word exatamente onde cada campo deve aparecer.
                </p>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {fields.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => { setExpandedField(f.key); setActiveFieldKey(f.key); setShowHelp(false); }}
                      className="flex flex-col rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left transition hover:border-violet-300 hover:bg-violet-50"
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
  );

  // Fields-only panel (no nome/estado — those live in the header bar for DOCX mode)
  const fieldsPanel = (
    <div className="flex flex-col gap-4" ref={fieldListRef}>
      {helpModal}

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
                  {isReExtracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {isReExtracting ? "Extraindo…" : "Re-extrair do arquivo"}
                </button>
              )}
              <button type="button" onClick={addField} className="text-sm font-medium text-slate-600 hover:text-slate-950">
                Adicionar campo manualmente
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {template.arquivo_url && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void handleReExtract()}
                  disabled={isReExtracting}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-500 transition hover:border-slate-400 hover:text-slate-900 disabled:opacity-50"
                >
                  {isReExtracting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
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
                    isActive ? "border-violet-300 ring-1 ring-violet-200" : "border-slate-200"
                  }`}
                >
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
                        {field.role === "ia_sugerida" ? "IA sugere" : "Manual"} · {field.group ?? "outros"}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                      field.role === "ia_sugerida" ? "bg-violet-100 text-violet-700" : "bg-amber-100 text-amber-700"
                    }`}>
                      {field.role === "ia_sugerida" ? "IA" : "Fixo"}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeField(index); }}
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

                  {isExpanded && (
                    <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-3">
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

                      <div>
                        <span className="text-xs font-medium text-slate-600">Papel</span>
                        <div className="mt-1.5 flex gap-2">
                          <button
                            type="button"
                            onClick={() => preserveScroll(() => updateField(index, { role: "manual", group: field.group ?? "dados_turma" }))}
                            className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold transition ${
                              field.role !== "ia_sugerida"
                                ? "border-amber-400 bg-amber-50 text-amber-800"
                                : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                            }`}
                          >
                            <span className={`h-3.5 w-3.5 rounded-full border-2 flex items-center justify-center ${field.role !== "ia_sugerida" ? "border-amber-500 bg-amber-500" : "border-slate-300"}`}>
                              {field.role !== "ia_sugerida" && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                            </span>
                            Fixo / Manual
                          </button>
                          <button
                            type="button"
                            onClick={() => preserveScroll(() => updateField(index, { role: "ia_sugerida", group: field.group ?? "outros" }))}
                            className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold transition ${
                              field.role === "ia_sugerida"
                                ? "border-violet-400 bg-violet-50 text-violet-800"
                                : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                            }`}
                          >
                            <span className={`h-3.5 w-3.5 rounded-full border-2 flex items-center justify-center ${field.role === "ia_sugerida" ? "border-violet-500 bg-violet-500" : "border-slate-300"}`}>
                              {field.role === "ia_sugerida" && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                            </span>
                            Sugestão / Magis
                          </button>
                        </div>
                      </div>

                      {field.role === "ia_sugerida" && (
                        <label className="block">
                          <span className="text-xs font-semibold text-violet-700">Contexto para a Magis</span>
                          <p className="mt-0.5 mb-1 text-[10px] leading-relaxed text-slate-400">
                            Dê instruções específicas para a Magis ao sugerir conteúdo neste campo.
                          </p>
                          <textarea
                            value={field.aiInstructions ?? ""}
                            onChange={(e) => updateField(index, { aiInstructions: e.target.value })}
                            rows={2}
                            placeholder="Ex.: Priorizar habilidades do 6º ano, foco em interpretação de texto…"
                            className="mt-0.5 w-full rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-violet-400 focus:bg-white"
                          />
                        </label>
                      )}

                      {field.role !== "ia_sugerida" && (
                        <label className="block">
                          <span className="text-xs font-semibold text-amber-700">Valor padrão</span>
                          <p className="mt-0.5 mb-1 text-[10px] leading-relaxed text-slate-400">
                            Aparece pré-preenchido em todos os planos gerados com este template.
                          </p>
                          <textarea
                            value={field.defaultValue ?? ""}
                            onChange={(e) => preserveScroll(() => updateField(index, { defaultValue: e.target.value || undefined }))}
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

      {error && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
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
        `}</style>
        <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-violet-600 shadow-lg shadow-violet-200">
          <Sparkles className="h-7 w-7 text-white" />
          <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500"
            style={{ animation: "magis-pop 0.4s 0.2s cubic-bezier(0.34,1.56,0.64,1) both" }}>
            <CheckCircle2 className="h-3.5 w-3.5 text-white" />
          </span>
        </div>
        <div className="w-full rounded-2xl border border-violet-100 bg-violet-50 px-5 py-4 text-center">
          <div className="mb-1.5 flex items-center justify-center gap-1.5">
            <Sparkles className="h-3 w-3 text-violet-500" />
            <span className="text-xs font-bold text-violet-700">Magis</span>
          </div>
          <p className="text-sm font-medium leading-relaxed text-slate-800">Seu template foi configurado com sucesso! 🎉</p>
          <p className="mt-1 text-xs text-slate-500">Redirecionando para Meus Templates…</p>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-violet-500" style={{ animation: "magis-progress 3s linear forwards" }} />
        </div>
        <style>{`@keyframes magis-progress { from { width: 100%; } to { width: 0%; } }`}</style>
      </div>
    </div>
  );

  // DOCX: header bar + split view (left = tabbed viewer, right = fields)
  if (isDocx) {
    return (
      <>
        {confirmSuccessModal}

        {/* Header bar: nome + estado */}
        <div className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-end sm:gap-4">
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-600">Nome do template</label>
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm text-slate-950 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </div>
          <div className="sm:w-56">
            <label className="block text-xs font-medium text-slate-600">
              Estado <span className="text-violet-600">(currículo regional)</span>
            </label>
            <div className="relative mt-1">
              <select
                value={estado}
                onChange={(e) => setEstado(e.target.value)}
                className="w-full appearance-none rounded-2xl border border-slate-300 bg-white px-4 py-2.5 pr-10 text-sm text-slate-950 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              >
                <option value="">Não especificado</option>
                {ESTADOS_BRASIL.map((e) => (
                  <option key={e.uf} value={e.uf}>{e.uf} — {e.nome}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>
          </div>
        </div>

        {/* Split view */}
        <div className="flex gap-6" style={{ minHeight: "calc(100vh - 320px)" }}>
          {/* Left: tabbed viewer — only on xl+ */}
          <div className="hidden w-[65%] shrink-0 overflow-hidden rounded-3xl border border-slate-200 xl:flex xl:flex-col">
            {/* Tab bar */}
            <div className="flex shrink-0 items-center gap-1 border-b border-slate-100 bg-white px-3 py-2">
              <button
                type="button"
                onClick={() => setViewMode("preview")}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-semibold transition ${
                  viewMode === "preview"
                    ? "bg-slate-950 text-white"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                }`}
              >
                <Eye className="h-3.5 w-3.5" />
                Preview Word
              </button>
              <button
                type="button"
                onClick={() => setViewMode("interactive")}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-semibold transition ${
                  viewMode === "interactive"
                    ? "bg-violet-600 text-white"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                }`}
              >
                <MousePointer2 className="h-3.5 w-3.5" />
                Adicionar campos
              </button>
              {viewMode === "interactive" && (
                <p className="ml-2 text-[10px] text-violet-500">Clique no texto para adicionar campo</p>
              )}
            </div>

            {/* Viewer content */}
            <div className="flex flex-1 flex-col overflow-hidden">
              {viewMode === "preview" ? (
                <OfficeInlineViewer
                  key={previewVersion}
                  tokenEndpoint={`/api/templates/${template.id}/preview-token`}
                  previewPublicoPath={`/api/templates/${template.id}/preview-publico`}
                  extraParams="annotated=1"
                  title="Pré-visualização do template"
                  className="h-full"
                />
              ) : (
                <DocxInteractive
                  templateId={template.id}
                  fields={fields}
                  fieldPositions={fieldPositions}
                  activeKey={expandedField}
                  previewVersion={previewVersion}
                  onClickElement={handleAddFromDoc}
                />
              )}
            </div>
          </div>

          {/* Right: fields panel */}
          <div ref={panelScrollRef} className="flex-1 min-w-0 overflow-y-auto rounded-3xl border border-slate-200 bg-white p-4 [overflow-anchor:none]">
            {fieldsPanel}
          </div>
        </div>
      </>
    );
  }

  // Non-DOCX: single column with nome+estado included
  return (
    <>
      {confirmSuccessModal}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:gap-6">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-700">Nome do template</label>
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="mt-1.5 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </div>
          <div className="sm:w-56">
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
        </div>
        {fieldsPanel}
      </div>
    </>
  );
}
