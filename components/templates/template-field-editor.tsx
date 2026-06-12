"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  ArrowRight,
  Bold,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  Clock,
  Crosshair,
  GripVertical,
  HelpCircle,
  Italic,
  List,
  ListOrdered,
  Loader2,
  MousePointer2,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  X,
  ZoomIn,
} from "lucide-react";

import type { TemplateFieldSchema, TemplateRecord } from "../../lib/types/firestore";
import { ESTADOS_BRASIL } from "../../lib/constants/estados-brasil";
import { OfficeInlineViewer } from "../shared/office-inline-viewer";

interface TemplateFieldEditorProps {
  template: TemplateRecord;
  mode?: "edit" | "confirm";
}

interface ReExtractResult {
  schema: TemplateFieldSchema[];
  campos_sem_placeholder: string[];
  campos_baixa_confianca: string[];
  diff: { mantidos: string[]; adicionados: string[]; removidos: string[] };
  arquivo_fillable_url?: string;
}

interface SchemaVersion {
  id: string;
  schema_campos: TemplateFieldSchema[];
  salvo_em: string;
  tipo: string;
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
// mammoth/docx-preview renderer with inline-edit support.

interface DocxEdit {
  text: string;       // original cell text (for server-side injectAtCell)
  ordinal: number;    // occurrence index among cells with same original text
  key: string;        // variable name
  role: "manual" | "ia_sugerida";
  label: string;      // human label (adjacent cell text or derived from key)
}

interface DocxInteractiveProps {
  templateId: string;
  fields: TemplateFieldSchema[];
  fieldPositions: Record<string, { cellText: string; ordinal: number }>;
  activeKey: string | null;
  locateKey?: string | null;
  previewVersion?: number;
  zoom?: number;
  onZoomChange?: (z: number) => void;
  onSaveEdits: (edits: DocxEdit[], scanOrder: string[], removedKeys: string[]) => void;
}

const TOOLBAR_FONTS = ["Arial", "Times New Roman", "Georgia", "Courier New", "Verdana"];
const TOOLBAR_SIZES = ["8", "10", "11", "12", "14", "16", "18", "20", "24", "28", "32", "36"];

function DocxInteractive({ templateId, fields, fieldPositions, activeKey, locateKey, previewVersion = 0, zoom = 100, onZoomChange, onSaveEdits }: DocxInteractiveProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const bufferRef = useRef<ArrayBuffer | null>(null);
  const originalTextsRef = useRef<Map<HTMLElement, string>>(new Map());
  const savedSelRef = useRef<Range | null>(null);
  const [phase, setPhase] = useState<"loading" | "rendering" | "done" | "error">("loading");
  const [saveCount, setSaveCount] = useState(0);

  function saveSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) savedSelRef.current = sel.getRangeAt(0).cloneRange();
  }

  function restoreSelection() {
    const sel = window.getSelection();
    if (sel && savedSelRef.current) { sel.removeAllRanges(); sel.addRange(savedSelRef.current); }
  }

  function fmt(cmd: string, val?: string) {
    restoreSelection();
    document.execCommand(cmd, false, val ?? "");
  }

  function fmtSize(pt: string) {
    restoreSelection();
    // Use styleWithCSS + fontSize maps to avoid the 1-7 limitation
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand("fontSize", false, "7");
    const container = containerRef.current;
    if (!container) return;
    container.querySelectorAll("font[size='7']").forEach((el) => {
      (el as HTMLElement).removeAttribute("size");
      (el as HTMLElement).style.fontSize = `${pt}pt`;
    });
  }

  function fmtFont(name: string) {
    restoreSelection();
    document.execCommand("fontName", false, name);
  }

  function deriveRole(key: string): "manual" | "ia_sugerida" {
    return /habilidade|competencia|objetivo|avaliacao|conteudo|tematica|metodologia|atividade|pratica/.test(key)
      ? "ia_sugerida" : "manual";
  }

  function handleSaveEdits() {
    if (!containerRef.current) return;
    const container = containerRef.current;

    // Mirror the same selector logic used in the contenteditable setup effect
    const tds = Array.from(container.querySelectorAll("td")) as HTMLElement[];
    const standaloneParagraphs = (
      Array.from(container.querySelectorAll("p")) as HTMLElement[]
    ).filter((p) => !p.closest("td"));
    const els = [...tds, ...standaloneParagraphs];

    const existingKeys = new Set(fields.map((f) => f.key));
    const textOrdinalsMap = new Map<string, number>();
    const edits: DocxEdit[] = [];
    const processedKeys = new Set<string>();
    const scanOrder: string[] = [];
    const seenInScan = new Set<string>();

    // For cells the user typed into (empty originalText), try to infer a human
    // label from the sibling/parent cell that describes the row.
    function adjacentLabel(el: HTMLElement): string {
      if (el.tagName !== "TD") return "";
      const row = el.closest("tr");
      if (!row) return "";
      const rowTds = Array.from(row.querySelectorAll("td")) as HTMLElement[];
      const idx = rowTds.indexOf(el);
      if (idx > 0) {
        const lbl = (rowTds[idx - 1]?.textContent ?? "").trim().slice(0, 80);
        if (lbl) return lbl;
      }
      const prevRow = row.previousElementSibling as Element | null;
      if (prevRow) {
        const prevTds = Array.from(prevRow.querySelectorAll("td")) as HTMLElement[];
        const lbl = (prevTds[idx]?.textContent ?? prevTds[0]?.textContent ?? "").trim().slice(0, 80);
        if (lbl) return lbl;
      }
      return "";
    }

    for (const el of els) {
      const originalText = originalTextsRef.current.get(el) ?? "";
      const ordinal = textOrdinalsMap.get(originalText) ?? 0;
      textOrdinalsMap.set(originalText, ordinal + 1);

      // When the cell was empty, use the global <td> index as ordinal so the
      // server can find the exact cell by position (injectAtCell empty-cell mode).
      // For cells with text, use the text-occurrence ordinal (existing behaviour).
      const tdGlobalIndex = el.tagName === "TD" ? tds.indexOf(el) : -1;
      const effectiveOrdinal = !originalText.trim() && tdGlobalIndex >= 0
        ? tdGlobalIndex
        : ordinal;

      const currentText = el.textContent ?? "";

      // Detect {{key}} patterns
      const matches = [...currentText.matchAll(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g)];
      for (const match of matches) {
        const key = match[1];
        if (!seenInScan.has(key)) { seenInScan.add(key); scanOrder.push(key); }
        if (existingKeys.has(key) || processedKeys.has(key)) continue;
        processedKeys.add(key);
        const label = !originalText.trim()
          ? (adjacentLabel(el) || key.replace(/_/g, " "))
          : (originalText.replace(/:+$/, "").trim().slice(0, 80) || key.replace(/_/g, " "));
        edits.push({ text: originalText, ordinal: effectiveOrdinal, key, role: deriveRole(key), label });
      }

      // Detect bare snake_case identifiers typed without {{ }} (must contain underscore)
      if (matches.length === 0) {
        const bare = currentText.trim().match(/^([a-z][a-z0-9]*(?:_[a-z0-9]+)+)$/);
        if (bare) {
          const key = bare[1];
          if (!seenInScan.has(key)) { seenInScan.add(key); scanOrder.push(key); }
          if (!existingKeys.has(key) && !processedKeys.has(key)) {
            processedKeys.add(key);
            const label = adjacentLabel(el) || key.replace(/_/g, " ");
            edits.push({ text: originalText, ordinal: effectiveOrdinal, key, role: deriveRole(key), label });
          }
        }
      }
    }

    // Fields that existed before but are no longer found anywhere in the document
    const removedKeys = [...existingKeys].filter((k) => !seenInScan.has(k));

    onSaveEdits(edits, scanOrder, removedKeys);
    if (edits.length > 0) setSaveCount((n) => n + edits.length);
  }

  useEffect(() => {
    setPhase("loading");
    bufferRef.current = null;
    let cancelled = false;
    fetch(`/api/templates/${templateId}/arquivo?fresh=1&v=${previewVersion}`)
      .then((r) => r.ok ? r : fetch(`/api/templates/${templateId}/arquivo?v=${previewVersion}`))
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

  // Item 8: locate helper — finds and scrolls to the cell containing the key's placeholder or label
  const locateFieldInDoc = useCallback((key: string) => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    container.querySelectorAll("[data-mhl]").forEach((el) => {
      (el as HTMLElement).style.removeProperty("background");
      (el as HTMLElement).style.removeProperty("outline");
      (el as HTMLElement).style.removeProperty("border-radius");
      el.removeAttribute("data-mhl");
    });
    const field = fields.find((f) => f.key === key);
    if (!field) return;
    // First try to find the {{key}} chip
    const chip = container.querySelector(`[data-field-chip="${key}"]`);
    const chipEl = chip?.closest("td") ?? chip?.closest("p") ?? chip as HTMLElement | null;
    if (chipEl) {
      (chipEl as HTMLElement).style.background = "rgba(139,92,246,0.15)";
      (chipEl as HTMLElement).style.outline = "2px solid rgba(139,92,246,0.5)";
      (chipEl as HTMLElement).style.borderRadius = "2px";
      chipEl.setAttribute("data-mhl", "true");
      chipEl.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    // Fall back to label matching
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
  }, [fields]);

  // Highlight the active field
  useEffect(() => {
    if (phase !== "done" || !activeKey) return;
    locateFieldInDoc(activeKey);
  }, [activeKey, phase, locateFieldInDoc]);

  // Item 8: explicit locate trigger (fires even when key doesn't change)
  // locateKey format: "fieldKey:timestamp" so changing timestamp re-triggers effect
  useEffect(() => {
    if (phase !== "done" || !locateKey) return;
    const key = locateKey.split(":")[0];
    if (key) locateFieldInDoc(key);
  }, [locateKey, phase, locateFieldInDoc]);

  // Colorize {{key}} patterns already in the rendered DOCX text (from re-extract or pre-annotated files)
  useEffect(() => {
    if (phase !== "done" || !containerRef.current) return;
    const container = containerRef.current;
    const roleMap = new Map(fields.map((f) => [f.key, f.role]));

    function chipCss(isIa: boolean) {
      return [
        "display:inline-block", "padding:2px 8px", "border-radius:6px",
        "font-family:monospace", "font-size:10px", "font-weight:700",
        "white-space:nowrap", "line-height:1.7",
        isIa
          ? "background:rgba(139,92,246,.14);color:#6d28d9;border:1px solid rgba(139,92,246,.35)"
          : "background:rgba(245,158,11,.14);color:#b45309;border:1px solid rgba(245,158,11,.35)",
      ].join(";");
    }

    // Update color of existing chips — and remove chips for deleted fields
    container.querySelectorAll("[data-field-chip]").forEach((el) => {
      const key = el.getAttribute("data-field-chip")!;
      if (!roleMap.has(key)) {
        // Field was deleted — restore plain text so the user sees it was removed
        el.parentNode?.replaceChild(document.createTextNode(`{{${key}}}`), el);
        return;
      }
      const isIa = roleMap.get(key) === "ia_sugerida";
      (el as HTMLElement).style.cssText = chipCss(isIa);
    });

    // Walk text nodes and replace {{key}} patterns with colored chips.
    // IMPORTANT: skip text nodes that are already inside a chip span — they are
    // the span's own textContent, NOT document text, and re-processing them would
    // create nested chips (the "duplication" visual artifact).
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const hits: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const parent = (node as Text).parentElement;
      if (parent?.hasAttribute("data-field-chip")) continue; // already a chip — skip
      if (/\{\{[A-Za-z_][A-Za-z0-9_]*\}\}/.test((node as Text).textContent ?? "")) {
        hits.push(node as Text);
      }
    }
    for (const textNode of hits) {
      const text = textNode.textContent ?? "";
      const parts = text.split(/(\{\{[A-Za-z_][A-Za-z0-9_]*\}\})/);
      if (parts.length <= 1) continue;
      const frag = document.createDocumentFragment();
      for (const part of parts) {
        const m = part.match(/^\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}$/);
        if (m) {
          const key = m[1];
          const isIa = (roleMap.get(key) ?? "manual") === "ia_sugerida";
          const span = document.createElement("span");
          span.setAttribute("data-field-chip", key);
          span.style.cssText = chipCss(isIa);
          span.textContent = part;
          frag.appendChild(span);
        } else {
          frag.appendChild(document.createTextNode(part));
        }
      }
      textNode.parentNode?.replaceChild(frag, textNode);
    }
  }, [phase, fields]);

  // Fix anchor image positions after docx-preview renders
  useEffect(() => {
    if (phase !== "done" || !containerRef.current || !bufferRef.current) return;
    let cancelled = false;
    const buf = bufferRef.current;
    const cont = containerRef.current;
    import("../../lib/utils/docx-anchor-fix")
      .then(({ fixDocxAnchorImages }) => {
        if (!cancelled) return fixDocxAnchorImages(buf, cont);
      })
      .catch(() => {/* ignore positioning errors */});
    return () => { cancelled = true; };
  }, [phase]);

  // Inject {{key}} chips when fieldPositions changes (only for non-empty cellText
  // positions — if cellText is empty the chip was typed directly and the
  // colorization effect above already handles it)
  useEffect(() => {
    if (phase !== "done" || !containerRef.current) return;
    const container = containerRef.current;
    const els = Array.from(container.querySelectorAll("td, p")) as HTMLElement[];
    for (const [key, pos] of Object.entries(fieldPositions)) {
      if (!pos.cellText.trim()) continue; // typed directly — colorization handles it
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

  // Contenteditable — make cells editable, avoiding nested contenteditable
  useEffect(() => {
    if (phase !== "done" || !containerRef.current) return;
    const container = containerRef.current;

    // Only td elements + standalone p elements (not inside td) become contenteditable.
    // Nested contenteditable (td AND p inside td) causes browser to render stacked
    // focus rings at every level, creating the "concentric rings" visual artifact.
    const tds = Array.from(container.querySelectorAll("td")) as HTMLElement[];
    const standaloneParagraphs = (
      Array.from(container.querySelectorAll("p")) as HTMLElement[]
    ).filter((p) => !p.closest("td"));
    const editableEls = [...tds, ...standaloneParagraphs];

    // Store original text content BEFORE user edits
    originalTextsRef.current = new Map();
    for (const el of editableEls) {
      originalTextsRef.current.set(el, el.textContent?.trim() ?? "");
    }

    for (const el of editableEls) {
      el.contentEditable = "true";
      el.style.cursor = "text";
    }

    return () => {
      for (const el of editableEls) {
        el.contentEditable = "false";
        el.style.removeProperty("cursor");
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <style>{`
        .docx-html-preview { background: #f1f5f9; padding: 20px 12px; min-width: max-content; }
        .docx-html-preview table { border-collapse: collapse; }
        .docx-html-preview td, .docx-html-preview th { padding: 2px 4px; word-break: break-word; vertical-align: top; position: relative; }
        .docx-html-preview img { max-width: 100%; height: auto; }
        .docx-html-preview section { overflow: visible !important; }
        .docx-html-preview p { margin: 0.2em 0; }
        .docx-html-preview td[contenteditable]:focus,
        .docx-html-preview td[contenteditable]:focus-within,
        .docx-html-preview p[contenteditable]:focus {
          outline: 2px solid rgba(139,92,246,0.6) !important;
          border-radius: 2px;
        }
      `}</style>

      {/* Header line */}
      <div className="flex shrink-0 items-center gap-2 border-b border-violet-100 bg-violet-50 px-3 py-2">
        <p className="flex-1 text-[11px] text-violet-600">
          <span className="font-semibold">Editor de campos:</span> clique em qualquer célula, insira valor ou{" "}
          <code className="rounded bg-violet-100 px-1 font-mono text-violet-700">{`{{variavel}}`}</code>
        </p>
        {saveCount > 0 && (
          <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
            {saveCount} campo{saveCount !== 1 ? "s" : ""} adicionado{saveCount !== 1 ? "s" : ""}
          </span>
        )}
        <button
          type="button"
          onClick={handleSaveEdits}
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-violet-500"
        >
          <Save className="h-3 w-3" />
          Salvar edições
        </button>
      </div>

      {/* Rich-text formatting toolbar + zoom (single row) */}
      {phase === "done" && (
        <div
          className="flex shrink-0 items-center gap-0.5 border-b border-slate-100 bg-white px-2 py-1"
          onMouseDown={(e) => e.preventDefault()}
        >
          {/* Font family */}
          <select
            className="h-6 rounded border border-slate-200 bg-white px-1 text-[10px] text-slate-700 focus:outline-none"
            defaultValue="Arial"
            onFocus={saveSelection}
            onChange={(e) => fmtFont(e.target.value)}
          >
            {TOOLBAR_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>

          {/* Font size */}
          <select
            className="h-6 w-14 rounded border border-slate-200 bg-white px-1 text-[10px] text-slate-700 focus:outline-none"
            defaultValue="12"
            onFocus={saveSelection}
            onChange={(e) => fmtSize(e.target.value)}
          >
            {TOOLBAR_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>

          <div className="mx-0.5 h-4 w-px bg-slate-200" />

          {/* Bold / Italic */}
          <button type="button" title="Negrito" onClick={() => fmt("bold")}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100">
            <Bold className="h-3.5 w-3.5 text-slate-700" />
          </button>
          <button type="button" title="Itálico" onClick={() => fmt("italic")}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100">
            <Italic className="h-3.5 w-3.5 text-slate-700" />
          </button>

          <div className="mx-0.5 h-4 w-px bg-slate-200" />

          {/* Alignment */}
          <button type="button" title="Alinhar à esquerda" onClick={() => fmt("justifyLeft")}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100">
            <AlignLeft className="h-3.5 w-3.5 text-slate-700" />
          </button>
          <button type="button" title="Centralizar" onClick={() => fmt("justifyCenter")}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100">
            <AlignCenter className="h-3.5 w-3.5 text-slate-700" />
          </button>
          <button type="button" title="Alinhar à direita" onClick={() => fmt("justifyRight")}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100">
            <AlignRight className="h-3.5 w-3.5 text-slate-700" />
          </button>
          <button type="button" title="Justificar" onClick={() => fmt("justifyFull")}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100">
            <AlignJustify className="h-3.5 w-3.5 text-slate-700" />
          </button>

          <div className="mx-0.5 h-4 w-px bg-slate-200" />

          {/* Lists */}
          <button type="button" title="Lista com marcadores" onClick={() => fmt("insertUnorderedList")}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100">
            <List className="h-3.5 w-3.5 text-slate-700" />
          </button>
          <button type="button" title="Lista numerada" onClick={() => fmt("insertOrderedList")}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100">
            <ListOrdered className="h-3.5 w-3.5 text-slate-700" />
          </button>

          {/* Item 15: zoom — right-aligned in the same toolbar row */}
          <div className="ml-auto flex items-center gap-1.5">
            <div className="mr-0.5 h-4 w-px bg-slate-200" />
            <ZoomIn className="h-3 w-3 shrink-0 text-slate-400" />
            <input
              type="range"
              min={70}
              max={150}
              step={5}
              value={zoom}
              onChange={(e) => onZoomChange?.(Number(e.target.value))}
              onMouseDown={(e) => e.stopPropagation()}
              className="h-1 w-20 accent-violet-600"
            />
            <span className="w-7 text-right text-[10px] text-slate-500">{zoom}%</span>
          </div>
        </div>
      )}

      {/* overflow-x-auto enables horizontal scroll for wide/landscape documents */}
      <div ref={scrollerRef} className={`flex-1 overflow-y-auto overflow-x-auto ${phase === "error" ? "invisible absolute" : ""}`}>
        <div
          ref={containerRef}
          className="docx-html-preview"
          style={zoom !== 100 ? {
            transform: `scale(${zoom / 100})`,
            transformOrigin: "top left",
            width: `${Math.round(10000 / zoom)}%`,
          } : undefined}
        />
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
  const [camposSemPlaceholder, setCamposSemPlaceholder] = useState<string[]>([]);
  const [camposBaixaConfianca, setCamposBaixaConfianca] = useState<string[]>([]);
  const [showHelp, setShowHelp] = useState(false);
  const [activeFieldKey, setActiveFieldKey] = useState<string | null>(null);
  const [locateKey, setLocateKey] = useState<string | null>(null);
  const [expandedField, setExpandedField] = useState<string | null>(null);
  const [showConfirmSuccess, setShowConfirmSuccess] = useState(false);
  const [fieldPositions, setFieldPositions] = useState<Record<string, { cellText: string; ordinal: number }>>({});
  const [previewVersion, setPreviewVersion] = useState(0);
  const [viewMode, setViewMode] = useState<"preview" | "interactive">("interactive");
  const [roleFilter, setRoleFilter] = useState<"manual" | "ia_sugerida" | null>(null);

  // Item 5: diff modal state
  const [pendingExtract, setPendingExtract] = useState<ReExtractResult | null>(null);

  // Item 7: undo last save
  const prevFieldsRef = useRef<TemplateFieldSchema[] | null>(null);
  const [showUndoToast, setShowUndoToast] = useState(false);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Item 6: drag-and-drop
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  // Item 12: auto-save debounce
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(false);
  const [autoSaving, setAutoSaving] = useState(false);

  // Item 13: schema version history
  const [showVersions, setShowVersions] = useState(false);
  const [versions, setVersions] = useState<SchemaVersion[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [isRestoringVersion, setIsRestoringVersion] = useState(false);

  // Item 14: mobile tab
  const [mobileTab, setMobileTab] = useState<"document" | "campos">("campos");

  // Item 15: zoom
  const [zoom, setZoom] = useState(100);

  // Item 16: collapsible panel
  const [panelCollapsed, setPanelCollapsed] = useState(() => {
    try { return localStorage.getItem("magis_panel_collapsed") === "1"; } catch { return false; }
  });

  // Review flow
  const [reviewMode, setReviewMode] = useState(mode === "confirm");
  const [isAdvancing, setIsAdvancing] = useState(false);

  const fieldListRef = useRef<HTMLDivElement>(null);
  const panelScrollRef = useRef<HTMLDivElement>(null);

  function preserveScroll(fn: () => void) {
    const el = panelScrollRef.current;
    const top = el?.scrollTop ?? 0;
    fn();
    requestAnimationFrame(() => { if (el) el.scrollTop = top; });
  }

  // Item 12: auto-save with 3s debounce (only triggers after first render)
  useEffect(() => {
    if (!isMountedRef.current) { isMountedRef.current = true; return; }
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      setAutoSaving(true);
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
        .then((r) => r.json())
        .then((d: { campos_sem_placeholder?: string[] }) => {
          if (d.campos_sem_placeholder) setCamposSemPlaceholder(d.campos_sem_placeholder);
          setPreviewVersion((v) => v + 1);
        })
        .catch(() => { /* silent auto-save fail */ })
        .finally(() => setAutoSaving(false));
    }, 3000);
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields]);

  // Item 13: load schema versions
  async function loadVersions() {
    setIsLoadingVersions(true);
    try {
      const res = await fetch(`/api/templates/${template.id}/schema-versions`);
      const d = await res.json() as { ok?: boolean; versions?: SchemaVersion[] };
      if (d.ok) setVersions(d.versions ?? []);
    } catch { /* ignore */ }
    finally { setIsLoadingVersions(false); }
  }

  async function restoreVersion(versionId: string) {
    setIsRestoringVersion(true);
    try {
      const res = await fetch(`/api/templates/${template.id}/schema-versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version_id: versionId }),
      });
      const d = await res.json() as { ok?: boolean; schema_campos?: TemplateFieldSchema[] };
      if (d.ok && d.schema_campos) {
        setFields(d.schema_campos);
        setShowVersions(false);
        setPreviewVersion((v) => v + 1);
        router.refresh();
      }
    } catch { /* ignore */ }
    finally { setIsRestoringVersion(false); }
  }

  // Item 16: persist panel collapse state
  useEffect(() => {
    try { localStorage.setItem("magis_panel_collapsed", panelCollapsed ? "1" : "0"); } catch { /* ignore */ }
  }, [panelCollapsed]);

  const isDocx = (template.arquivo_url ?? "").match(/\.(docx|doc)$/i) !== null;

  // Item 6: drag-and-drop reordering
  function handleDragStart(key: string) { setDraggingKey(key); }
  function handleDragOver(e: React.DragEvent, key: string) {
    e.preventDefault();
    if (key !== draggingKey) setDragOverKey(key);
  }
  function handleDrop(targetKey: string) {
    if (!draggingKey || draggingKey === targetKey) { setDraggingKey(null); setDragOverKey(null); return; }
    const from = fields.findIndex((f) => f.key === draggingKey);
    const to = fields.findIndex((f) => f.key === targetKey);
    if (from === -1 || to === -1) { setDraggingKey(null); setDragOverKey(null); return; }
    const next = [...fields];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setFields(next);
    setDraggingKey(null);
    setDragOverKey(null);
  }
  function handleDragEnd() { setDraggingKey(null); setDragOverKey(null); }

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
        campos_sem_placeholder?: string[];
        campos_baixa_confianca?: string[];
        diff?: { mantidos: string[]; adicionados: string[]; removidos: string[] };
        arquivo_fillable_url?: string;
        error?: string;
      } | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "Falha ao re-extrair campos.");
      // Item 5: show diff modal before applying
      const result: ReExtractResult = {
        schema: Array.isArray(data.schema) ? data.schema : [],
        campos_sem_placeholder: data.campos_sem_placeholder ?? [],
        campos_baixa_confianca: data.campos_baixa_confianca ?? [],
        diff: data.diff ?? { mantidos: [], adicionados: [], removidos: [] },
        arquivo_fillable_url: data.arquivo_fillable_url,
      };
      setPendingExtract(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao re-extrair campos.");
    } finally {
      setIsReExtracting(false);
    }
  }

  function applyExtractResult(result: ReExtractResult) {
    setFields(result.schema);
    setCamposSemPlaceholder(result.campos_sem_placeholder);
    setCamposBaixaConfianca(result.campos_baixa_confianca);
    setReExtractMsg(`${result.schema.length} campos extraídos.`);
    setPreviewVersion((v) => v + 1);
    setPendingExtract(null);
    router.refresh();
  }

  function addField() {
    const f = newField();
    setFields((prev) => [...prev, f]);
    setExpandedField(f.key);
    setActiveFieldKey(f.key);
  }

  function addFieldFromEdit(rawText: string, ordinal: number, explicitKey: string, explicitRole: "manual" | "ia_sugerida", explicitLabel?: string) {
    const key = explicitKey || `campo_${Date.now()}`;

    const existing = fields.find((f) => f.key === key);
    if (existing) return existing;

    const label = explicitLabel?.trim()
      ? explicitLabel.trim().slice(0, 80)
      : (rawText.replace(/:+$/, "").trim().slice(0, 80) || key.replace(/_/g, " "));

    let group: TemplateFieldSchema["group"] = explicitRole === "ia_sugerida" ? "conteudos" : "dados_turma";
    if (explicitRole === "ia_sugerida") {
      if (/habilidade|bncc|saeb/.test(key)) group = "habilidades";
      else if (/competencia/.test(key)) group = "competencias";
      else if (/objetivo/.test(key)) group = "objetivos";
      else if (/avaliacao/.test(key)) group = "avaliacao";
    }

    return {
      key,
      label,
      type: "text" as const,
      required: true,
      role: explicitRole,
      group,
      placeholder: "",
      helperText: "",
      aiInstructions: "",
    };
  }

  function handleSaveDocEdits(edits: DocxEdit[], scanOrder: string[], removedKeys: string[]) {
    const newFields: TemplateFieldSchema[] = [];
    const newPositions: Record<string, { cellText: string; ordinal: number }> = {};

    for (const edit of edits) {
      const f = addFieldFromEdit(edit.text, edit.ordinal, edit.key, edit.role, edit.label);
      if (!fields.find((existing) => existing.key === f.key) && !newFields.find((nf) => nf.key === f.key)) {
        newFields.push(f);
        // Store position using cell text as anchor; for empty cells use ordinal alone
        newPositions[f.key] = { cellText: edit.text.trim(), ordinal: edit.ordinal };
      }
    }

    // Remove fields that are no longer present in the document (user deleted their {{placeholder}})
    const removedSet = new Set(removedKeys);
    const baseFields = fields.filter((f) => !removedSet.has(f.key));
    const basePositions: Record<string, { cellText: string; ordinal: number }> = {};
    for (const [k, v] of Object.entries(fieldPositions)) {
      if (!removedSet.has(k)) basePositions[k] = v;
    }

    if (newFields.length === 0 && removedKeys.length === 0) {
      // No structural changes — metadata-only save. Still refresh the preview so
      // any positional edits the user made in the Word editor become visible.
      void fetch(`/api/templates/${template.id}/schema`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: nome.trim() || template.nome,
          estado: estado || null,
          schema_campos: fields,
          field_positions: {},
        }),
      })
        .then(() => { setPreviewVersion((v) => v + 1); })
        .catch(() => { /* silent */ });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      return;
    }

    const mergedPositions = { ...basePositions, ...newPositions };

    const allFields = [...baseFields, ...newFields];
    const scanIndexOf = (key: string) => {
      const i = scanOrder.indexOf(key);
      return i === -1 ? Infinity : i;
    };
    const mergedFields = [...allFields].sort((a, b) => scanIndexOf(a.key) - scanIndexOf(b.key));

    setFields(mergedFields);
    setFieldPositions(mergedPositions);
    if (newFields.length > 0) {
      setExpandedField(newFields[0].key);
      setActiveFieldKey(newFields[0].key);
    }

    handleSave(mergedFields, mergedPositions, true);
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

  function handleSave(
    overrideFields?: TemplateFieldSchema[],
    overridePositions?: Record<string, { cellText: string; ordinal: number }>,
    switchToPreview = false,
  ) {
    const fieldsToSave = overrideFields ?? fields;
    const positionsToSave = overridePositions ?? fieldPositions;

    setError(null);
    setSaved(false);

    // Item 11: validation
    const emptyLabel = fieldsToSave.find((f) => !f.label.trim());
    if (emptyLabel) { setError("Todos os campos precisam ter um nome."); return; }
    const keysSeen = new Set<string>();
    for (const f of fieldsToSave) {
      if (keysSeen.has(f.key)) { setError(`Chave duplicada: {{${f.key}}}. Renomeie um dos campos.`); return; }
      keysSeen.add(f.key);
    }

    // Item 7: save previous state for undo
    prevFieldsRef.current = [...fields];

    startTransition(() => {
      void fetch(`/api/templates/${template.id}/schema`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: nome.trim() || template.nome,
          estado: estado || null,
          schema_campos: fieldsToSave,
          field_positions: positionsToSave,
        }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const d = await res.json().catch(() => null) as { error?: string } | null;
            throw new Error(d?.error ?? "Falha ao salvar.");
          }
          return res.json() as Promise<{ campos_sem_placeholder?: string[] }>;
        })
        .then((d) => {
          setCamposSemPlaceholder(d.campos_sem_placeholder ?? []);
          setFieldPositions({});
          if (switchToPreview) {
            setPreviewVersion((v) => v + 1);
          } else if (mode === "confirm") {
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
            // Item 7: show undo toast
            setShowUndoToast(true);
            if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
            undoTimerRef.current = setTimeout(() => setShowUndoToast(false), 5000);
          }
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : "Falha ao salvar.");
        });
    });
  }

  function handleUndo() {
    if (!prevFieldsRef.current) return;
    setShowUndoToast(false);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    const prev = prevFieldsRef.current;
    prevFieldsRef.current = null;
    setFields(prev);
    handleSave(prev, undefined, true);
  }

  async function handleAdvanceToReview() {
    setError(null);
    const emptyLabel = fields.find((f) => !f.label.trim());
    if (emptyLabel) { setError("Todos os campos precisam ter um nome."); return; }
    const keysSeen = new Set<string>();
    for (const f of fields) {
      if (keysSeen.has(f.key)) { setError(`Chave duplicada: {{${f.key}}}. Renomeie um dos campos.`); return; }
      keysSeen.add(f.key);
    }
    setIsAdvancing(true);
    try {
      const res = await fetch(`/api/templates/${template.id}/schema`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: nome.trim() || template.nome,
          estado: estado || null,
          schema_campos: fields,
          field_positions: fieldPositions,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(d?.error ?? "Falha ao salvar.");
      }
      const d = await res.json() as { campos_sem_placeholder?: string[] };
      setCamposSemPlaceholder(d.campos_sem_placeholder ?? []);
      setFieldPositions({});
      setPreviewVersion((v) => v + 1);
      setReviewMode(true);
      setPanelCollapsed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setIsAdvancing(false);
    }
  }

  function handleConfirmTemplate() {
    setShowConfirmSuccess(true);
    setTimeout(() => {
      setShowConfirmSuccess(false);
      router.push("/dashboard/templates");
    }, 3000);
  }

  // Item 5: diff modal
  const diffModal = pendingExtract && (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 px-4 py-8 backdrop-blur-sm">
      <div className="relative flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-base font-bold text-slate-950">Resultado da re-extração</h2>
            <p className="mt-0.5 text-xs text-slate-400">Revise as mudanças antes de aplicar</p>
          </div>
          <button type="button" onClick={() => setPendingExtract(null)} className="rounded-xl border border-slate-200 p-1.5 text-slate-400 hover:border-slate-950 hover:text-slate-950">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-3 gap-4">
            {/* Mantidos */}
            <div>
              <p className="mb-2 text-xs font-bold text-slate-500 uppercase tracking-wide">Mantidos ({pendingExtract.diff.mantidos.length})</p>
              <div className="space-y-1">
                {pendingExtract.diff.mantidos.map((k) => {
                  const f = pendingExtract.schema.find((s) => s.key === k);
                  return (
                    <div key={k} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-1.5">
                      <p className="text-xs font-medium text-slate-700 truncate">{f?.label ?? k}</p>
                      <code className="text-[10px] text-slate-400">{`{{${k}}}`}</code>
                    </div>
                  );
                })}
              </div>
            </div>
            {/* Adicionados */}
            <div>
              <p className="mb-2 text-xs font-bold text-emerald-600 uppercase tracking-wide">Adicionados ({pendingExtract.diff.adicionados.length})</p>
              <div className="space-y-1">
                {pendingExtract.diff.adicionados.map((k) => {
                  const f = pendingExtract.schema.find((s) => s.key === k);
                  return (
                    <div key={k} className={`rounded-xl border px-3 py-1.5 ${camposBaixaConfianca.includes(k) ? "border-amber-200 bg-amber-50" : "border-emerald-100 bg-emerald-50"}`}>
                      <p className="text-xs font-medium text-slate-700 truncate">{f?.label ?? k}</p>
                      <div className="flex items-center gap-1">
                        <code className="text-[10px] text-emerald-600">{`{{${k}}}`}</code>
                        {camposBaixaConfianca.includes(k) && <span className="text-[9px] text-amber-600 font-semibold">⚠ baixa confiança</span>}
                      </div>
                    </div>
                  );
                })}
                {pendingExtract.diff.adicionados.length === 0 && <p className="text-xs text-slate-400 italic">Nenhum novo campo</p>}
              </div>
            </div>
            {/* Removidos */}
            <div>
              <p className="mb-2 text-xs font-bold text-rose-500 uppercase tracking-wide">Removidos ({pendingExtract.diff.removidos.length})</p>
              <div className="space-y-1">
                {pendingExtract.diff.removidos.map((k) => {
                  const f = fields.find((s) => s.key === k);
                  return (
                    <div key={k} className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-1.5">
                      <p className="text-xs font-medium text-slate-700 truncate line-through opacity-60">{f?.label ?? k}</p>
                      <code className="text-[10px] text-rose-400">{`{{${k}}}`}</code>
                    </div>
                  );
                })}
                {pendingExtract.diff.removidos.length === 0 && <p className="text-xs text-slate-400 italic">Nenhum campo removido</p>}
              </div>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={() => setPendingExtract(null)} className="rounded-2xl border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 hover:border-slate-950">
            Cancelar
          </button>
          <button type="button" onClick={() => applyExtractResult(pendingExtract)}
            className="flex items-center gap-2 rounded-2xl bg-violet-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-500">
            <CheckCircle2 className="h-4 w-4" />
            Aplicar ({pendingExtract.schema.length} campos)
          </button>
        </div>
      </div>
    </div>
  );

  // Item 13: versions modal
  const versionsModal = showVersions && (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 px-4 py-8 backdrop-blur-sm" onClick={() => setShowVersions(false)}>
      <div className="relative flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-base font-bold text-slate-950">Histórico de versões</h2>
          <button type="button" onClick={() => setShowVersions(false)} className="rounded-xl border border-slate-200 p-1.5 text-slate-400 hover:border-slate-950 hover:text-slate-950">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {isLoadingVersions ? (
            <div className="flex items-center justify-center py-8 gap-2 text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Carregando versões…</span>
            </div>
          ) : versions.length === 0 ? (
            <p className="text-center text-sm text-slate-400 py-8">Nenhuma versão salva ainda. Versões são criadas automaticamente antes de cada re-extração.</p>
          ) : (
            <div className="space-y-2">
              {versions.map((v) => (
                <div key={v.id} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <div>
                    <p className="text-xs font-semibold text-slate-700">{v.schema_campos.length} campos</p>
                    <p className="text-[11px] text-slate-400">{new Date(v.salvo_em).toLocaleString("pt-BR")} · {v.tipo === "pre_re_introspect" ? "antes da re-extração" : v.tipo}</p>
                  </div>
                  <button
                    type="button"
                    disabled={isRestoringVersion}
                    onClick={() => void restoreVersion(v.id)}
                    className="flex items-center gap-1 rounded-xl border border-violet-200 bg-white px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                  >
                    {isRestoringVersion ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                    Restaurar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

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

  // Item 10: progress bar
  const progressSteps = [
    { label: "Upload", done: !!template.arquivo_url },
    { label: "Extração", done: fields.length > 0 },
    { label: "Revisão", done: mode === "confirm" },
    { label: "Confirmado", done: false },
  ];
  const currentStep = progressSteps.findLastIndex((s) => s.done) + 1;
  const progressBar = (
    <div className="mb-4 flex items-center gap-0">
      {progressSteps.map((step, i) => (
        <div key={step.label} className="flex flex-1 items-center">
          <div className="flex flex-col items-center gap-0.5">
            <div className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
              i < currentStep ? "bg-violet-600 text-white" : i === currentStep ? "bg-violet-100 text-violet-600 ring-2 ring-violet-400" : "bg-slate-100 text-slate-400"
            }`}>
              {i < currentStep ? "✓" : i + 1}
            </div>
            <span className={`text-[9px] font-medium whitespace-nowrap ${i <= currentStep ? "text-violet-600" : "text-slate-400"}`}>{step.label}</span>
          </div>
          {i < progressSteps.length - 1 && (
            <div className={`mx-1 h-0.5 flex-1 ${i < currentStep ? "bg-violet-500" : "bg-slate-200"}`} />
          )}
        </div>
      ))}
    </div>
  );

  // Fields-only panel (no nome/estado — those live in the header bar for DOCX mode)
  const fieldsPanel = (
    <div className="flex flex-col gap-4" ref={fieldListRef}>
      {helpModal}

      <div>
        {progressBar}
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Campos detectados ({fields.length})
              {autoSaving && <span className="ml-2 text-[10px] font-normal text-slate-400">salvando…</span>}
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
              onClick={() => { setShowVersions(true); void loadVersions(); }}
              className="flex items-center justify-center rounded-xl border border-slate-200 p-2 text-slate-400 transition hover:border-slate-950 hover:text-slate-950"
              title="Histórico de versões"
            >
              <Clock className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setShowHelp(true)}
              className="flex items-center justify-center rounded-xl border border-slate-200 p-2 text-slate-400 transition hover:border-slate-950 hover:text-slate-950"
              title="Ajuda"
            >
              <HelpCircle className="h-3.5 w-3.5" />
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
            <div className="flex items-center justify-between gap-2">
              {/* Filter chips */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-medium text-slate-400">Campos:</span>
                <button
                  type="button"
                  onClick={() => setRoleFilter(roleFilter === "manual" ? null : "manual")}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition ${
                    roleFilter === "manual"
                      ? "bg-amber-400 text-white"
                      : "bg-amber-100 text-amber-700 hover:bg-amber-200"
                  }`}
                >
                  Fixo
                </button>
                <button
                  type="button"
                  onClick={() => setRoleFilter(roleFilter === "ia_sugerida" ? null : "ia_sugerida")}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition ${
                    roleFilter === "ia_sugerida"
                      ? "bg-violet-600 text-white"
                      : "bg-violet-100 text-violet-700 hover:bg-violet-200"
                  }`}
                >
                  Magis
                </button>
              </div>

              {template.arquivo_url && (
                <button
                  type="button"
                  onClick={() => void handleReExtract()}
                  disabled={isReExtracting}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-500 transition hover:border-slate-400 hover:text-slate-900 disabled:opacity-50"
                >
                  {isReExtracting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Re-extrair
                </button>
              )}
            </div>

            {fields.filter((f) => !roleFilter || f.role === roleFilter).map((field) => {
              const index = fields.indexOf(field);
              const isExpanded = expandedField === field.key;
              const isActive = activeFieldKey === field.key;
              // Item 17: status badge
              const hasEmptyLabel = !field.label.trim();
              const isPlaceholderMissing = camposSemPlaceholder.includes(field.key);
              const isLowConfidence = camposBaixaConfianca.includes(field.key);
              const statusDot = hasEmptyLabel
                ? "bg-rose-500"
                : isPlaceholderMissing
                ? "bg-amber-400"
                : "bg-emerald-400";
              const statusTitle = hasEmptyLabel ? "Campo sem nome" : isPlaceholderMissing ? "Sem placeholder no documento" : "Placeholder encontrado no documento";

              // Item 6: drag-and-drop
              const isDragging = draggingKey === field.key;
              const isDragOver = dragOverKey === field.key;

              return (
                <div
                  key={field.key}
                  data-field-card={field.key}
                  draggable
                  onDragStart={() => handleDragStart(field.key)}
                  onDragOver={(e) => handleDragOver(e, field.key)}
                  onDrop={() => handleDrop(field.key)}
                  onDragEnd={handleDragEnd}
                  className={`rounded-2xl border bg-white transition-all ${
                    isDragging ? "opacity-40 scale-95" : isDragOver ? "border-violet-400 ring-2 ring-violet-200" : isActive ? "border-violet-300 ring-1 ring-violet-200" : "border-slate-200"
                  }`}
                >
                  <div
                    className="flex cursor-pointer items-center gap-2 px-4 py-3"
                    onClick={() => {
                      setActiveFieldKey(field.key);
                      setExpandedField(isExpanded ? null : field.key);
                    }}
                  >
                    <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-slate-300 active:cursor-grabbing" />
                    {/* Item 17: status dot */}
                    <div className={`h-2 w-2 shrink-0 rounded-full ${statusDot}`} title={statusTitle} />
                    {isLowConfidence && (
                      <span className="shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold text-amber-700" title="Sem respaldo estrutural — verifique">⚠</span>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="line-clamp-2 break-words text-sm font-medium leading-snug text-slate-900">
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
                    {/* Item 8: locate in document */}
                    <button
                      type="button"
                      title="Localizar no documento"
                      onClick={(e) => { e.stopPropagation(); setActiveFieldKey(field.key); setLocateKey(`${field.key}:${Date.now()}`); }}
                      className="rounded-lg p-1 text-slate-300 transition hover:bg-violet-50 hover:text-violet-500"
                    >
                      <Crosshair className="h-3.5 w-3.5" />
                    </button>
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
      {camposSemPlaceholder.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="mb-2 font-semibold">
            {camposSemPlaceholder.length} campo{camposSemPlaceholder.length !== 1 ? "s" : ""} sem placeholder no documento:
          </p>
          <p className="mb-2 text-xs text-amber-700">
            Clique em uma variável abaixo para copiar e cole na célula correta do documento.
          </p>
          {/* Item 9: clickable copy buttons */}
          <div className="flex flex-wrap gap-1.5">
            {camposSemPlaceholder.map((k) => (
              <button
                key={k}
                type="button"
                title="Clique para copiar"
                onClick={() => { void navigator.clipboard.writeText(`{{${k}}}`); }}
                className="flex items-center gap-1 rounded-lg bg-amber-100 px-2 py-1 font-mono text-[11px] text-amber-800 hover:bg-amber-200 transition"
              >
                <ClipboardCopy className="h-2.5 w-2.5" />
                {`{{${k}}}`}
              </button>
            ))}
          </div>
        </div>
      )}
      {saved && (
        <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          Template salvo com sucesso!
        </p>
      )}

      {reviewMode && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-sm font-semibold text-emerald-800">Documento preparado — revise e confirme</p>
          <p className="mt-0.5 text-xs text-emerald-600">Confira o documento à esquerda com os placeholders inseridos. Clicando em Confirmar o template fica ativo para uso nos planos de aula.</p>
        </div>
      )}

      <div className="flex justify-end gap-3">
        {mode === "confirm" ? (
          <>
            <button
              type="button"
              onClick={() => router.back()}
              className="rounded-2xl border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-950"
            >
              Pular
            </button>
            <button
              type="button"
              onClick={() => handleSave()}
              disabled={isPending}
              className="flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Confirmar template
            </button>
          </>
        ) : reviewMode ? (
          <>
            <button
              type="button"
              onClick={() => { setReviewMode(false); setPanelCollapsed(false); }}
              className="flex items-center gap-2 rounded-2xl border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-950"
            >
              <ArrowLeft className="h-4 w-4" />
              Editar campos
            </button>
            <button
              type="button"
              onClick={handleConfirmTemplate}
              className="flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700"
            >
              <CheckCircle2 className="h-4 w-4" />
              Confirmar template
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => router.back()}
              className="rounded-2xl border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-950"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void handleAdvanceToReview()}
              disabled={isAdvancing}
              className="flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {isAdvancing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              Avançar para revisão
            </button>
          </>
        )}
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
        {diffModal}
        {versionsModal}

        {/* Item 7: undo toast */}
        {showUndoToast && (
          <div className="fixed bottom-6 left-1/2 z-[9998] flex -translate-x-1/2 items-center gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl">
            <span>Salvo com sucesso.</span>
            <button type="button" onClick={handleUndo}
              className="flex items-center gap-1 rounded-xl bg-white/10 px-3 py-1 text-xs font-semibold hover:bg-white/20">
              <RotateCcw className="h-3 w-3" /> Desfazer
            </button>
            <button type="button" onClick={() => setShowUndoToast(false)} className="text-white/50 hover:text-white">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Header bar: nome + estado */}
        <div className="rounded-3xl border border-violet-200 bg-gradient-to-r from-violet-50 to-slate-50 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-600 text-[10px] font-bold text-white">1</span>
            <p className="text-xs font-semibold text-violet-700">Preencha os dados do template antes de configurar os campos</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
            <div className="flex-1">
              <label className="block text-xs font-bold text-slate-700">
                Nome do template <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex.: Plano de aula semanal — Ensino Médio"
                className={`mt-1.5 w-full rounded-2xl border px-4 py-2.5 text-sm text-slate-950 outline-none transition focus:ring-2 focus:ring-violet-100 ${
                  !nome.trim()
                    ? "border-amber-300 bg-amber-50 placeholder:text-amber-400 focus:border-violet-400"
                    : "border-slate-300 bg-white focus:border-violet-400"
                }`}
              />
            </div>
            <div className="sm:w-60">
              <label className="block text-xs font-bold text-slate-700">
                Estado <span className="text-xs font-normal text-violet-600">(currículo regional da IA)</span>
              </label>
              <div className="relative mt-1.5">
                <select
                  value={estado}
                  onChange={(e) => setEstado(e.target.value)}
                  className={`w-full appearance-none rounded-2xl border px-4 py-2.5 pr-10 text-sm outline-none transition focus:ring-2 focus:ring-violet-100 ${
                    !estado
                      ? "border-amber-300 bg-amber-50 text-slate-500 focus:border-violet-400"
                      : "border-slate-300 bg-white text-slate-950 focus:border-violet-400"
                  }`}
                >
                  <option value="">— Selecione o estado —</option>
                  {ESTADOS_BRASIL.map((e) => (
                    <option key={e.uf} value={e.uf}>{e.uf} — {e.nome}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              </div>
            </div>
          </div>
        </div>

        {/* Item 14: mobile tab switcher (visible only on < xl) */}
        <div className="flex xl:hidden rounded-2xl border border-slate-200 bg-white p-1 gap-1">
          <button type="button" onClick={() => setMobileTab("document")}
            className={`flex-1 rounded-xl py-2 text-xs font-semibold transition ${mobileTab === "document" ? "bg-violet-600 text-white" : "text-slate-500 hover:text-slate-800"}`}>
            Documento
          </button>
          <button type="button" onClick={() => setMobileTab("campos")}
            className={`flex-1 rounded-xl py-2 text-xs font-semibold transition ${mobileTab === "campos" ? "bg-violet-600 text-white" : "text-slate-500 hover:text-slate-800"}`}>
            Campos ({fields.length})
          </button>
        </div>

        {/* Split view */}
        <div className="flex gap-6" style={{ minHeight: "calc(100vh - 320px)" }}>
          {/* Left: editor — hidden on mobile, shown on xl+ (or when mobile tab = document) */}
          <div className={`overflow-hidden rounded-3xl border border-slate-200 ${
            mobileTab === "document" ? "flex flex-col w-full xl:w-auto" : "hidden xl:flex xl:flex-col"
          } ${panelCollapsed ? "xl:flex-1" : "xl:w-[62%] xl:shrink-0"}`}>
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
                  locateKey={locateKey}
                  previewVersion={previewVersion}
                  zoom={zoom}
                  onZoomChange={setZoom}
                  onSaveEdits={handleSaveDocEdits}
                />
              )}
            </div>
          </div>

          {/* Item 16: collapsible right panel */}
          {!panelCollapsed ? (
            <div ref={panelScrollRef} className={`min-w-0 overflow-y-auto rounded-3xl border border-slate-200 bg-white p-4 [overflow-anchor:none] ${
              mobileTab === "campos" ? "flex-1 flex flex-col" : "hidden xl:flex xl:flex-col xl:flex-1"
            }`}>
              {/* Collapse button */}
              <div className="flex justify-end mb-2">
                <button type="button" onClick={() => setPanelCollapsed(true)} title="Recolher painel"
                  className="flex items-center gap-1 rounded-xl border border-slate-200 px-2 py-1 text-[10px] text-slate-400 hover:border-slate-400 hover:text-slate-700">
                  <PanelRightClose className="h-3 w-3" />
                  Recolher
                </button>
              </div>
              {fieldsPanel}
            </div>
          ) : (
            /* Collapsed: just show expand button */
            <div className="hidden xl:flex xl:flex-col xl:items-center xl:pt-4">
              <button type="button" onClick={() => setPanelCollapsed(false)} title="Expandir painel de campos"
                className="flex flex-col items-center gap-1 rounded-2xl border border-slate-200 bg-white p-3 text-slate-400 hover:border-violet-400 hover:text-violet-600 transition">
                <PanelRightOpen className="h-4 w-4" />
                <span className="text-[9px] font-medium writing-mode-vertical" style={{ writingMode: "vertical-rl" }}>Campos</span>
              </button>
            </div>
          )}
        </div>
      </>
    );
  }

  // Non-DOCX: single column with nome+estado included
  return (
    <>
      {confirmSuccessModal}
      {diffModal}
      {versionsModal}
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
