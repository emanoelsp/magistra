"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Bold,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Crosshair,
  GripVertical,
  HelpCircle,
  Italic,
  Loader2,
  MousePointer2,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
  ZoomIn,
} from "lucide-react";

import type { TemplateFieldSchema, TemplateRecord } from "../../lib/types/firestore";
import { ESTADOS_BRASIL } from "../../lib/constants/estados-brasil";
import { OfficeInlineViewer } from "../shared/office-inline-viewer";
import { showMagisToast } from "../../lib/utils/magis-toast";

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

const GROUP_LABELS: Record<string, string> = {
  dados_turma: "Dados da Turma",
  objetivos: "Objetivos",
  competencias: "Competências",
  habilidades: "Habilidades",
  conteudos: "Conteúdo",
  avaliacao: "Avaliação",
  outros: "Outros",
};

const TOOLBAR_FONTS = ["Arial", "Times New Roman", "Calibri", "Georgia", "Tahoma", "Verdana"];
const TOOLBAR_SIZES = ["8", "9", "10", "11", "12", "14", "16", "18", "20", "24", "28", "36"];

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
  text: string;       // original cell text (for server-side injectAtCell fallback)
  ordinal: number;    // occurrence index among cells with same original text
  key: string;        // variable name
  role: "manual" | "ia_sugerida";
  label: string;      // human label (adjacent cell text or derived from key)
  coord?: string;     // "T{ti}R{ri}C{ci}" — preferred over text/ordinal when present
}

interface CellEdit {
  cellText: string;       // original cell text (stripped of {{key}} chips)
  ordinal: number;        // occurrence index
  newContent: string;     // full edited cell text including all {{key}} tokens
  coord?: string;         // "T{ti}R{ri}C{ci}" — preferred over text/ordinal when present
  contextBefore?: string; // text on the same visual line immediately before {{key}} — injection anchor
  replaceContent?: boolean; // true when cell has only this token (no other text) → replace instead of append
}

interface DocxInteractiveScanData {
  edits: DocxEdit[];
  scanOrder: string[];
  removedKeys: string[];
  cellEdits: CellEdit[];
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
  onSaveEdits: (edits: DocxEdit[], scanOrder: string[], removedKeys: string[], cellEdits: CellEdit[]) => void;
  placementKey?: string | null;
  onCancelPlacement?: () => void;
  onPlace?: (key: string, coord: string | undefined, cellText: string, ordinal: number) => void;
  onChipClick?: (key: string) => void;
  onDocKeysUpdate?: (keys: Set<string>) => void;
  onLiveScan?: (edits: DocxEdit[], removedKeys: string[]) => void;
  scanRef?: { current: ((() => DocxInteractiveScanData) | null) };
}

function DocxInteractive({ templateId, fields, fieldPositions, activeKey, locateKey, previewVersion = 0, zoom = 100, onZoomChange, onSaveEdits, placementKey = null, onCancelPlacement, onPlace, onChipClick, onDocKeysUpdate, onLiveScan, scanRef }: DocxInteractiveProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const bufferRef = useRef<ArrayBuffer | null>(null);
  // Original cell text (stripped of chip tokens) — used by handleSaveEdits and placement mode.
  const originalTextsRef = useRef<Map<HTMLElement, string>>(new Map());
  // Keys visible in doc at last render — used to detect user-deleted chips.
  const initialDocKeysRef = useRef<Set<string>>(new Set());
  const onChipClickRef = useRef(onChipClick);
  useEffect(() => { onChipClickRef.current = onChipClick; }, [onChipClick]);
  // Refs to avoid stale closures in MutationObserver and scanRef callbacks
  const fieldsRef = useRef(fields);
  useEffect(() => { fieldsRef.current = fields; }, [fields]);
  const onLiveScanRef = useRef(onLiveScan);
  useEffect(() => { onLiveScanRef.current = onLiveScan; }, [onLiveScan]);
  const [phase, setPhase] = useState<"loading" | "rendering" | "done" | "error">("loading");

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
          renderEndnotes: true, renderFooters: false, renderFootnotes: false, renderHeaders: true,
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
    function highlight(el: HTMLElement) {
      el.style.background = "rgba(139,92,246,0.15)";
      el.style.outline = "2px solid rgba(139,92,246,0.5)";
      el.style.borderRadius = "2px";
      el.setAttribute("data-mhl", "true");
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    // 1. Chip overlay (present when fieldPositions has the key)
    const chip = container.querySelector(`[data-field-chip="${key}"]`);
    const chipEl = chip?.closest("td") ?? chip?.closest("p") ?? chip as HTMLElement | null;
    if (chipEl) { highlight(chipEl as HTMLElement); return; }

    // 2. Raw {{key}} text in the DOCX — present right after a save when fieldPositions
    //    was cleared and the chip hasn't been re-injected yet.
    const rawEl = Array.from(container.querySelectorAll<HTMLElement>("td, p")).find(
      (el) => el.textContent?.includes(`{{${key}}}`),
    );
    if (rawEl) { highlight(rawEl); return; }

    // 3. Label / defaultValue text matching (fuzzy fallback)
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
    if (bestEl) highlight(bestEl as HTMLElement);
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

    // CHIP INVARIANT: a chip must only be created/kept for a key that exists in
    // roleMap. Every chip-creation path below MUST check roleMap.has(key) first.
    // Violating this causes ghost chips that survive field deletion.
    function chipCss(isIa: boolean) {
      return [
        "display:inline-block", "padding:2px 8px", "border-radius:6px",
        "font-family:monospace", "font-size:10px", "font-weight:700",
        "white-space:nowrap", "line-height:1.7", "cursor:pointer",
        isIa
          ? "background:rgba(139,92,246,.14);color:#6d28d9;border:1px solid rgba(139,92,246,.35)"
          : "background:rgba(245,158,11,.14);color:#b45309;border:1px solid rgba(245,158,11,.35)",
      ].join(";");
    }

    // Update color of existing chips — and remove chips for deleted fields
    container.querySelectorAll("[data-field-chip]").forEach((el) => {
      const key = el.getAttribute("data-field-chip")!;
      if (!roleMap.has(key)) {
        // Field was deleted — remove chip entirely so the {{key}} text does NOT remain
        // in the DOM. If we restore it as plain text, handleSaveEdits would pick it up
        // as a newly typed placeholder and add the field back to the schema (ghost re-add).
        el.remove();
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
          if (roleMap.has(key)) {
            const isIa = roleMap.get(key) === "ia_sugerida";
            const span = document.createElement("span");
            span.setAttribute("data-field-chip", key);
            span.style.cssText = chipCss(isIa);
            span.textContent = part;
            frag.appendChild(span);
          } else {
            frag.appendChild(document.createTextNode(part));
          }
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
        "white-space:nowrap", "line-height:1.7", "margin-left:4px", "cursor:pointer",
        isIa
          ? "background:rgba(139,92,246,.14);color:#6d28d9;border:1px solid rgba(139,92,246,.35)"
          : "background:rgba(245,158,11,.14);color:#b45309;border:1px solid rgba(245,158,11,.35)",
      ].join(";");
      chip.textContent = `{{${key}}}`;
      targetEl.appendChild(chip);
    }
  }, [phase, fieldPositions, fields]);

  // Chip mousedown → focus sidebar field card (preventDefault stops cell from entering edit mode)
  useEffect(() => {
    if (phase !== "done" || !containerRef.current) return;
    const container = containerRef.current;
    function handleMouseDown(e: MouseEvent) {
      const chip = (e.target as HTMLElement).closest<HTMLElement>("[data-field-chip]");
      if (!chip) return;
      const key = chip.getAttribute("data-field-chip");
      if (!key) return;
      e.preventDefault();
      onChipClickRef.current?.(key);
    }
    container.addEventListener("mousedown", handleMouseDown);
    return () => container.removeEventListener("mousedown", handleMouseDown);
  }, [phase]);

  // Assign XML structural coordinates to DOM cells (enables precise server-side injection).
  // Runs after chip effects so coords land on the final rendered cells.
  useEffect(() => {
    if (phase !== "done" || !containerRef.current || !bufferRef.current) return;
    let cancelled = false;
    const buf = bufferRef.current;
    const cont = containerRef.current;
    import("../../lib/utils/docx-coord")
      .then(({ assignDocxCellCoords }) => {
        if (!cancelled) return assignDocxCellCoords(buf, cont);
      })
      .catch(() => {/* non-fatal */});
    return () => { cancelled = true; };
  }, [phase]);

  // Capture original cell texts + doc-visible keys when doc finishes rendering.
  // originalTextsRef: stripped of chip tokens → used by handleSaveEdits ordinal counts
  // initialDocKeysRef: keys visible in doc → used to detect user-deleted chips
  useEffect(() => {
    if (phase !== "done" || !containerRef.current) return;
    const container = containerRef.current;
    const tds = (Array.from(container.querySelectorAll("td")) as HTMLElement[])
      .filter((td) => !td.closest("header") && !td.closest("footer"));
    const standaloneParagraphs = (Array.from(container.querySelectorAll("p")) as HTMLElement[])
      .filter((p) => !p.closest("td") && !p.closest("header") && !p.closest("footer"));
    originalTextsRef.current = new Map();
    for (const el of [...tds, ...standaloneParagraphs]) {
      const clean = (el.textContent ?? "")
        .replace(/\{\{[A-Za-z_][A-Za-z0-9_]*\}\}/g, "")
        .replace(/\s+/g, " ")
        .trim();
      originalTextsRef.current.set(el, clean);
    }
    // Snapshot keys visible in the doc (chips + raw {{}} text).
    // Deps include fieldPositions and fields so this re-captures AFTER the chip
    // injection effect (line ~320) runs — that effect shares the same deps and is
    // declared first, guaranteeing execution order. Without these deps, chips added
    // via fieldPositions would be absent from initialDocKeysRef, causing the
    // "ghost placeholder" bug (removed chips not detected as removedKeys).
    const docKeys = new Set<string>();
    for (const m of (container.textContent ?? "").matchAll(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g)) {
      docKeys.add(m[1]);
    }
    initialDocKeysRef.current = docKeys;
    onDocKeysUpdate?.(new Set(docKeys));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, fieldPositions, fields]);

  // Contenteditable — cells are editable; chips inside are atomic (non-editable)
  useEffect(() => {
    if (phase !== "done" || !containerRef.current) return;
    const container = containerRef.current;
    const tds = (Array.from(container.querySelectorAll("td")) as HTMLElement[])
      .filter((td) => !td.closest("header") && !td.closest("footer"));
    const standaloneParagraphs = (Array.from(container.querySelectorAll("p")) as HTMLElement[])
      .filter((p) => !p.closest("td") && !p.closest("header") && !p.closest("footer"));
    const editableEls = [...tds, ...standaloneParagraphs];

    // Chips must be atomic so the user can delete them whole but not type inside.
    for (const chip of Array.from(container.querySelectorAll<HTMLElement>("[data-field-chip]"))) {
      chip.setAttribute("contenteditable", "false");
    }

    // Enter → <br> (prevents browser from inserting <div>/<p> wrappers).
    // Paste → plain text only (strips HTML that would break cell structure).
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const br = document.createElement("br");
      range.insertNode(br);
      range.setStartAfter(br);
      range.setEndAfter(br);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    function onPaste(e: ClipboardEvent) {
      e.preventDefault();
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!text) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    for (const el of editableEls) {
      el.contentEditable = "true";
      el.style.cursor = "text";
      el.addEventListener("keydown", onKeyDown);
      el.addEventListener("paste", onPaste);
    }
    return () => {
      for (const el of editableEls) {
        el.contentEditable = "false";
        el.style.removeProperty("cursor");
        el.removeEventListener("keydown", onKeyDown);
        el.removeEventListener("paste", onPaste);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Expose extractDocEdits via scanRef so the parent can call it synchronously
  // (e.g. from "Verificar template") without needing an async round-trip.
  useEffect(() => {
    if (phase !== "done" || !scanRef) return;
    scanRef.current = extractDocEdits;
    return () => { if (scanRef.current === extractDocEdits) scanRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, scanRef]);

  // MutationObserver: live-scan the contenteditable doc for new/removed {{key}} patterns.
  // Fires onLiveScan so the sidebar can update immediately without a server save.
  useEffect(() => {
    if (phase !== "done" || !containerRef.current) return;
    const container = containerRef.current;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new MutationObserver((mutations) => {
      const relevant = mutations.some((m) => {
        const el = m.target instanceof Element ? m.target : (m.target as Node).parentElement;
        return !el?.closest("[data-field-chip]");
      });
      if (!relevant) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const tds = [...container.querySelectorAll<HTMLElement>("td")]
          .filter((td) => !td.closest("header") && !td.closest("footer"));
        const standalones = [...container.querySelectorAll<HTMLElement>("p")]
          .filter((p) => !p.closest("td") && !p.closest("header") && !p.closest("footer"));
        const existingKeys = new Set(fieldsRef.current.map((f) => f.key));
        const seenKeys = new Set<string>();
        const newEdits: DocxEdit[] = [];
        for (const el of [...tds, ...standalones]) {
          const currentText = el.textContent ?? "";
          for (const match of [...currentText.matchAll(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g)]) {
            const key = match[1];
            seenKeys.add(key);
            if (!existingKeys.has(key) && !newEdits.find((e) => e.key === key)) {
              const originalText = originalTextsRef.current.get(el) ?? "";
              const label = originalText.replace(/:+$/, "").trim().slice(0, 80) || key.replace(/_/g, " ");
              const role: "manual" | "ia_sugerida" =
                /habilidade|competencia|objetivo|avaliacao|conteudo|tematica|metodologia|atividade/.test(key)
                  ? "ia_sugerida" : "manual";
              const coord = el.tagName === "TD" ? (el.getAttribute("data-xml-coord") ?? undefined) : undefined;
              newEdits.push({ text: originalText, ordinal: 0, key, role, label, coord });
            }
          }
        }
        const removedKeys = [...existingKeys].filter(
          (k) => !seenKeys.has(k) && initialDocKeysRef.current.has(k),
        );
        if (newEdits.length > 0 || removedKeys.length > 0) {
          onLiveScanRef.current?.(newEdits, removedKeys);
        }
      }, 400);
    });
    observer.observe(container, { characterData: true, childList: true, subtree: true });
    return () => { observer.disconnect(); if (debounceTimer) clearTimeout(debounceTimer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // extractDocEdits: pure scan — reads DOM state, returns structured data.
  // Uses fieldsRef/originalTextsRef/initialDocKeysRef (always current) so it
  // can be called asynchronously from the parent via scanRef without stale-closure issues.
  function extractDocEdits(): DocxInteractiveScanData {
    if (!containerRef.current) return { edits: [], scanOrder: [], removedKeys: [], cellEdits: [] };
    const container = containerRef.current;
    const tds = (Array.from(container.querySelectorAll("td")) as HTMLElement[])
      .filter((td) => !td.closest("header") && !td.closest("footer"));
    const standaloneParagraphs = (Array.from(container.querySelectorAll("p")) as HTMLElement[])
      .filter((p) => !p.closest("td") && !p.closest("header") && !p.closest("footer"));
    const els = [...tds, ...standaloneParagraphs];

    const existingKeys = new Set(fieldsRef.current.map((f) => f.key));
    const textOrdinalsMap = new Map<string, number>();
    const edits: DocxEdit[] = [];
    // One cellEdit per key: newContent is ONLY "{{key}}", never full cell text.
    // safeAppendToken on the server handles the rest safely.
    const cellEdits: CellEdit[] = [];
    const scanOrder: string[] = [];
    const seenInScan = new Set<string>();

    for (const el of els) {
      const originalText = originalTextsRef.current.get(el) ?? "";
      const ordinal = textOrdinalsMap.get(originalText) ?? 0;
      textOrdinalsMap.set(originalText, ordinal + 1);
      const coord = el.tagName === "TD" ? (el.getAttribute("data-xml-coord") ?? undefined) : undefined;
      const tdIndex = el.tagName === "TD" ? tds.indexOf(el) : -1;
      const effectiveOrdinal = !originalText.trim() && tdIndex >= 0 ? tdIndex : ordinal;

      const currentText = el.textContent ?? "";
      const matches = [...currentText.matchAll(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g)];
      if (matches.length === 0) continue;

      // Register each key in scan order and detect new fields.
      for (const match of matches) {
        const key = match[1];
        if (!seenInScan.has(key)) { seenInScan.add(key); scanOrder.push(key); }
        if (!existingKeys.has(key)) {
          const label = originalText.replace(/:+$/, "").trim().slice(0, 80) || key.replace(/_/g, " ");
          const role: "manual" | "ia_sugerida" =
            /habilidade|competencia|objetivo|avaliacao|conteudo|tematica|metodologia|atividade/.test(key)
              ? "ia_sugerida" : "manual";
          edits.push({ text: originalText, ordinal: effectiveOrdinal, key, role, label, coord });
        }
      }

      // Detect whether non-token cell text was modified (user deleted or typed text).
      // If so, send the full new content as a single replace-mode cellEdit so the server
      // overwrites the cell instead of appending. This handles cases like:
      //   "PERÍODO / /2026" → "PERÍODO {{data}}" — "/ /2026" must be removed, not kept.
      const currentNonTokenText = currentText.replace(/\{\{[A-Za-z_][A-Za-z0-9_]*\}\}/g, "").replace(/\s+/g, " ").trim();
      const cellTextModified = currentNonTokenText !== originalText;

      if (cellTextModified) {
        // Full-replace path: one cellEdit with the complete new content.
        // Skipped if an identical replace edit for this cell was already queued.
        const alreadyQueued = cellEdits.some(
          (ce) => ce.replaceContent && ce.coord === coord && ce.ordinal === effectiveOrdinal,
        );
        if (!alreadyQueued) {
          cellEdits.push({
            cellText: originalText,
            ordinal: effectiveOrdinal,
            newContent: currentText,
            coord,
            replaceContent: true,
          });
        }
        continue;
      }

      // Normal path: per-token injection (non-token text unchanged, only chips added/moved).
      // contextBefore = text on the same visual line immediately before the token.
      for (const match of matches) {
        const key = match[1];
        if (!cellEdits.some((ce) => ce.newContent === `{{${key}}}`)) {
          const matchStart = match.index ?? 0;
          const rawTextBefore = currentText.slice(0, matchStart);
          const prevTokenMatches = [...rawTextBefore.matchAll(/\{\{[A-Za-z_][A-Za-z0-9_]*\}\}/g)];
          const lastPrev = prevTokenMatches[prevTokenMatches.length - 1];
          const textAfterLastToken = lastPrev
            ? rawTextBefore.slice(lastPrev.index! + lastPrev[0].length)
            : rawTextBefore;
          const contextBefore = textAfterLastToken.replace(/\s+/g, " ").trim().slice(-80);
          // replaceContent=true when the cell contains ONLY this one token and no other text.
          const cellHasOnlyThisToken = currentText.trim() === `{{${key}}}`;
          cellEdits.push({
            cellText: originalText,
            ordinal: effectiveOrdinal,
            newContent: `{{${key}}}`,
            coord,
            ...(contextBefore ? { contextBefore } : {}),
            ...(cellHasOnlyThisToken ? { replaceContent: true } : {}),
          });
        }
      }
    }

    // Detect chips the user manually removed from cells (were in doc at render, gone now)
    const removedKeys = [...existingKeys].filter(
      (k) => !seenInScan.has(k) && initialDocKeysRef.current.has(k),
    );

    return { edits, scanOrder, removedKeys, cellEdits };
  }

  function handleSaveEdits() {
    const { edits, scanOrder, removedKeys, cellEdits } = extractDocEdits();
    onSaveEdits(edits, scanOrder, removedKeys, cellEdits);
  }

  // Placement mode: suspend contenteditable, turn cells into click targets
  useEffect(() => {
    if (phase !== "done" || !containerRef.current || !placementKey) return;
    const container = containerRef.current;

    // Suspend contenteditable while in placement mode
    const editables = Array.from(container.querySelectorAll<HTMLElement>("[contenteditable='true']"));
    for (const el of editables) el.contentEditable = "false";

    const tds = (Array.from(container.querySelectorAll("td")) as HTMLElement[]).filter(
      (td) => !td.closest("header") && !td.closest("footer"),
    );

    // Build per-cell ordinal mapping for placement
    const textCounts = new Map<string, number>();
    const cellInfo = new Map<HTMLElement, { text: string; ordinal: number }>();
    for (const td of tds) {
      const text = originalTextsRef.current.get(td) ?? "";
      const ordinal = textCounts.get(text) ?? 0;
      textCounts.set(text, ordinal + 1);
      cellInfo.set(td, { text, ordinal });
    }

    function handleClick(e: Event) {
      e.stopPropagation();
      const td = e.currentTarget as HTMLElement;
      const { text, ordinal } = cellInfo.get(td) ?? { text: "", ordinal: 0 };
      const coord = td.getAttribute("data-xml-coord") ?? undefined;
      onPlace?.(placementKey!, coord, text, ordinal);
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancelPlacement?.();
    }

    container.classList.add("docx-placement-mode");
    document.addEventListener("keydown", handleKeyDown);
    for (const td of tds) td.addEventListener("click", handleClick);

    return () => {
      container.classList.remove("docx-placement-mode");
      document.removeEventListener("keydown", handleKeyDown);
      for (const td of tds) td.removeEventListener("click", handleClick);
      // Restore contenteditable
      for (const el of editables) el.contentEditable = "true";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, placementKey]);

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <style>{`
        .docx-html-preview { background: #64748b; min-width: max-content; }
        .docx-html-preview .docx-wrapper { background: #64748b !important; padding: 24px 24px 0 !important; display: flex !important; flex-flow: column !important; align-items: center !important; }
        .docx-html-preview .docx-wrapper > section.docx { background: white !important; box-shadow: 0 0 14px rgba(0,0,0,0.45) !important; margin-bottom: 24px !important; }
        .docx-html-preview table { border-collapse: collapse; }
        .docx-html-preview td, .docx-html-preview th { padding: 2px 4px; word-break: break-word; vertical-align: top; position: relative; }
        .docx-html-preview img { max-width: 100%; height: auto; }
        .docx-html-preview section { overflow: visible !important; }
        .docx-html-preview p { margin: 0.2em 0; }
        .docx-html-preview td p { text-indent: 0 !important; margin-left: 0 !important; }
        .docx-html-preview td[contenteditable='true']:focus,
        .docx-html-preview td[contenteditable='true']:focus-within,
        .docx-html-preview p[contenteditable='true']:focus {
          outline: 2px solid rgba(139,92,246,0.5) !important;
          border-radius: 2px;
        }
        .docx-placement-mode td { cursor: pointer !important; user-select: none; }
        .docx-placement-mode td:hover { background: rgba(99,102,241,0.12) !important; outline: 2px dashed rgba(99,102,241,0.5) !important; border-radius: 2px; }
        [data-field-chip] { cursor: pointer; }
        [data-field-chip]:hover { filter: brightness(0.92); }
      `}</style>

      {/* Header line */}
      {placementKey ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-indigo-200 bg-indigo-600 px-3 py-2.5">
          <MousePointer2 className="h-3.5 w-3.5 shrink-0 text-white" />
          <p className="flex-1 text-[11px] text-white">
            Clique numa célula para posicionar{" "}
            <strong>«{fields.find((f) => f.key === placementKey)?.label ?? placementKey}»</strong>
            {" "}·{" "}
            <kbd className="rounded bg-white/20 px-1 text-[10px] font-mono">Esc</kbd>{" "}
            para cancelar
          </p>
          <button
            type="button"
            onClick={onCancelPlacement}
            className="flex shrink-0 items-center justify-center rounded-lg p-1 text-white/70 hover:bg-white/20 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="shrink-0 border-b border-violet-100 bg-violet-50">
          {/* Row 1: hint + zoom + save */}
          <div className="flex items-center gap-2 px-3 pt-1.5 pb-1">
            <p className="flex-1 truncate text-[11px] text-violet-500">
              Edite as células &bull; digite{" "}
              <code className="rounded bg-violet-100 px-1 font-mono text-[10px] text-violet-700">{`{{chave}}`}</code>{" "}
              para posicionar um campo &bull; clique num chip para configurar
            </p>
            <div className="flex shrink-0 items-center gap-1.5">
              <ZoomIn className="h-3 w-3 shrink-0 text-slate-400" />
              <input
                type="range" min={70} max={150} step={5} value={zoom}
                onChange={(e) => onZoomChange?.(Number(e.target.value))}
                className="h-1 w-20 accent-violet-600"
              />
              <span className="w-7 text-right text-[10px] text-slate-500">{zoom}%</span>
            </div>
          </div>
          {/* Row 2: formatting toolbar */}
          <div className="flex items-center gap-0.5 px-3 pb-1.5">
            {/* Bold / Italic */}
            <button type="button" title="Negrito (Ctrl+B)"
              onMouseDown={(e) => { e.preventDefault(); document.execCommand("bold"); }}
              className="flex h-6 w-6 items-center justify-center rounded hover:bg-violet-200 text-slate-600">
              <Bold className="h-3 w-3" />
            </button>
            <button type="button" title="Itálico (Ctrl+I)"
              onMouseDown={(e) => { e.preventDefault(); document.execCommand("italic"); }}
              className="flex h-6 w-6 items-center justify-center rounded hover:bg-violet-200 text-slate-600">
              <Italic className="h-3 w-3" />
            </button>
            <span className="mx-1 h-4 w-px bg-violet-200" />
            {/* Alignment */}
            <button type="button" title="Alinhar à esquerda"
              onMouseDown={(e) => { e.preventDefault(); document.execCommand("justifyLeft"); }}
              className="flex h-6 w-6 items-center justify-center rounded hover:bg-violet-200 text-slate-600">
              <AlignLeft className="h-3 w-3" />
            </button>
            <button type="button" title="Centralizar"
              onMouseDown={(e) => { e.preventDefault(); document.execCommand("justifyCenter"); }}
              className="flex h-6 w-6 items-center justify-center rounded hover:bg-violet-200 text-slate-600">
              <AlignCenter className="h-3 w-3" />
            </button>
            <button type="button" title="Alinhar à direita"
              onMouseDown={(e) => { e.preventDefault(); document.execCommand("justifyRight"); }}
              className="flex h-6 w-6 items-center justify-center rounded hover:bg-violet-200 text-slate-600">
              <AlignRight className="h-3 w-3" />
            </button>
            <button type="button" title="Justificar"
              onMouseDown={(e) => { e.preventDefault(); document.execCommand("justifyFull"); }}
              className="flex h-6 w-6 items-center justify-center rounded hover:bg-violet-200 text-slate-600">
              <AlignJustify className="h-3 w-3" />
            </button>
            <span className="mx-1 h-4 w-px bg-violet-200" />
            {/* Font family */}
            <select
              defaultValue=""
              className="h-6 rounded border border-transparent bg-transparent px-1 text-[11px] text-slate-600 hover:border-violet-200 focus:border-violet-400 focus:outline-none"
              onMouseDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                document.execCommand("fontName", false, e.target.value);
                e.target.value = "";
              }}
            >
              <option value="" disabled>Fonte</option>
              {TOOLBAR_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            {/* Font size */}
            <select
              defaultValue=""
              className="h-6 rounded border border-transparent bg-transparent px-1 text-[11px] text-slate-600 hover:border-violet-200 focus:border-violet-400 focus:outline-none"
              onMouseDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                // execCommand fontSize uses 1-7; map pt sizes to closest HTML size
                const pt = parseInt(e.target.value);
                const htmlSize = pt <= 9 ? 1 : pt <= 11 ? 2 : pt <= 13 ? 3 : pt <= 15 ? 4 : pt <= 19 ? 5 : pt <= 23 ? 6 : 7;
                document.execCommand("fontSize", false, String(htmlSize));
                e.target.value = "";
              }}
            >
              <option value="" disabled>Tam.</option>
              {TOOLBAR_SIZES.map((s) => <option key={s} value={s}>{s}pt</option>)}
            </select>
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
  const [fields, setFields] = useState<TemplateFieldSchema[]>(() => {
    if (template.schema_campos.length === 0) return [];
    const escolaNome = template.escola_nome;
    if (!escolaNome) return [...template.schema_campos];
    return template.schema_campos.map((f) => {
      if (
        f.role !== "ia_sugerida" &&
        !f.defaultValue &&
        (f.key === "escola" ||
          f.key.toLowerCase().includes("escola") ||
          f.label.toLowerCase().includes("escola"))
      ) {
        return { ...f, defaultValue: escolaNome };
      }
      return f;
    });
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isReExtracting, setIsReExtracting] = useState(false);
  const [reExtractMsg, setReExtractMsg] = useState<string | null>(null);
  const [camposSemPlaceholder, setCamposSemPlaceholder] = useState<string[]>([]);
  const [camposBaixaConfianca, setCamposBaixaConfianca] = useState<string[]>(template.campos_baixa_confianca ?? []);
  const [showHelp, setShowHelp] = useState(false);
  const [activeFieldKey, setActiveFieldKey] = useState<string | null>(null);
  const [locateKey, setLocateKey] = useState<string | null>(null);
  const [expandedField, setExpandedField] = useState<string | null>(null);
  const [showConfirmSuccess, setShowConfirmSuccess] = useState(false);
  const [fieldPositions, setFieldPositions] = useState<Record<string, { cellText: string; ordinal: number; coord?: string }>>({});
  const [previewVersion, setPreviewVersion] = useState(0);
  const [viewMode, setViewMode] = useState<"preview" | "interactive">("interactive");
  const [roleFilter, setRoleFilter] = useState<"manual" | "ia_sugerida" | null>(null);
  const [showOnlyMissing, setShowOnlyMissing] = useState(false);

  // Item 5: diff modal state
  const [pendingExtract, setPendingExtract] = useState<ReExtractResult | null>(null);

  // Item 7: undo last save
  const prevFieldsRef = useRef<TemplateFieldSchema[] | null>(null);
  const [showUndoToast, setShowUndoToast] = useState(false);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Item 6: drag-and-drop
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  // Track fields that were just added and need label/role/group configuration
  const [pendingConfigKeys, setPendingConfigKeys] = useState<Set<string>>(new Set());


  // Item 13: schema version history
  const [showVersions, setShowVersions] = useState(false);
  const [versions, setVersions] = useState<SchemaVersion[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [isRestoringVersion, setIsRestoringVersion] = useState(false);

  // Item 14: mobile tab
  const [mobileTab, setMobileTab] = useState<"document" | "campos">("campos");

  // Item 15: zoom
  const [zoom, setZoom] = useState(100);

  // Anchor picker
  const [anchorList, setAnchorList] = useState<{ label: string; valuePreview: string; pattern: string }[]>([]);
  const [anchorSearch, setAnchorSearch] = useState<Record<string, string>>({});
  const latestDocKeysRef = useRef<Set<string>>(new Set());
  // Ref to DocxInteractive's extractDocEdits — used by handleAdvanceToReview to
  // collect pending doc edits without needing an extra server round-trip.
  const scanRef = useRef<(() => DocxInteractiveScanData) | null>(null);

  // Placement mode
  const [placementKey, setPlacementKey] = useState<string | null>(null);

  // Item 16: collapsible panel
  const [panelCollapsed, setPanelCollapsed] = useState(() => {
    try { return localStorage.getItem("magis_panel_collapsed") === "1"; } catch { return false; }
  });
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try { return parseInt(localStorage.getItem("magis_panel_width") ?? "326") || 326; } catch { return 326; }
  });
  const panelResizeRef = useRef<{ dragging: boolean; startX: number; startW: number }>({ dragging: false, startX: 0, startW: 0 });

  // Portal target for header action buttons (clock + help)
  const [headerActionsEl, setHeaderActionsEl] = useState<Element | null>(null);
  useEffect(() => {
    setHeaderActionsEl(document.getElementById("template-header-actions"));
  }, []);

  // Review flow
  const [reviewMode, setReviewMode] = useState(mode === "confirm");
  const [isAdvancing, setIsAdvancing] = useState(false);

  // Magis questions (after confirmation)
  const [magisQuestionsMode, setMagisQuestionsMode] = useState(false);
  const [magisStep, setMagisStep] = useState<1 | 2>(1);
  const [magisAnswers, setMagisAnswers] = useState({
    nivelEnsino: template.tipo_plano ?? "",
    estadoMagis: template.estado ?? "",
  });
  const [isSavingMagis, setIsSavingMagis] = useState(false);

  // Doc save result feedback

  const fieldListRef = useRef<HTMLDivElement>(null);
  const panelScrollRef = useRef<HTMLDivElement>(null);

  function preserveScroll(fn: () => void) {
    const el = panelScrollRef.current;
    const top = el?.scrollTop ?? 0;
    fn();
    requestAnimationFrame(() => { if (el) el.scrollTop = top; });
  }

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

  useEffect(() => {
    try { localStorage.setItem("magis_panel_width", String(panelWidth)); } catch { /* ignore */ }
  }, [panelWidth]);

  // Panel resize drag (mousemove/mouseup on document)
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!panelResizeRef.current.dragging) return;
      e.preventDefault();
      const delta = panelResizeRef.current.startX - e.clientX;
      const maxW = Math.floor(window.innerWidth * 0.35);
      const next = Math.max(240, Math.min(maxW, panelResizeRef.current.startW + delta));
      setPanelWidth(next);
    }
    function onUp() {
      if (!panelResizeRef.current.dragging) return;
      panelResizeRef.current.dragging = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);

  const isDocx = (template.arquivo_url ?? "").match(/\.(docx|doc)$/i) !== null;

  useEffect(() => {
    if (!isDocx || !template.arquivo_url) return;
    fetch(`/api/templates/${template.id}/anchors`)
      .then((r) => r.ok ? r.json() : null)
      .then((d: { anchors?: { label: string; valuePreview: string; pattern: string }[] } | null) => {
        if (d?.anchors) setAnchorList(d.anchors);
      })
      .catch(() => {/* silent */});
  }, [isDocx, template.arquivo_url, template.id]);

  // Item 6: drag-and-drop reordering
  function handleDragStart(e: React.DragEvent, key: string) {
    // setData is required by Safari and some browsers to validate the drag operation.
    e.dataTransfer.setData("text/plain", key);
    e.dataTransfer.effectAllowed = "move";
    setDraggingKey(key);
  }
  function handleDragOver(e: React.DragEvent, key: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
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
      showMagisToast("Extração concluída! Revise as mudanças antes de aplicar.", "info");
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
      const msg = err instanceof Error ? err.message : "Falha ao re-extrair campos.";
      setError(msg);
      showMagisToast("Ops! Não consegui re-extrair os campos. Tente novamente.", "error");
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
    showMagisToast(`Pronto! ${result.schema.length} campos aplicados ao template.`, "success");
    router.refresh();
  }

  function addField() {
    const f = newField();
    setFields((prev) => [...prev, f]);
    setExpandedField(f.key);
    setActiveFieldKey(f.key);
    setPendingConfigKeys((prev) => new Set([...prev, f.key]));
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

  function handleSaveDocEdits(edits: DocxEdit[], scanOrder: string[], removedKeys: string[], cellEdits: CellEdit[]) {
    const newFields: TemplateFieldSchema[] = [];
    const newPositions: Record<string, { cellText: string; ordinal: number; coord?: string }> = {};

    for (const edit of edits) {
      const f = addFieldFromEdit(edit.text, edit.ordinal, edit.key, edit.role, edit.label);
      if (!fields.find((existing) => existing.key === f.key) && !newFields.find((nf) => nf.key === f.key)) {
        newFields.push(f);
        // Store position: prefer coord (structural, unambiguous) over text/ordinal
        newPositions[f.key] = { cellText: edit.text.trim(), ordinal: edit.ordinal, ...(edit.coord ? { coord: edit.coord } : {}) };
      }
    }

    // Remove fields that are no longer present in the document (user deleted their {{placeholder}})
    const removedSet = new Set(removedKeys);
    const baseFields = fields.filter((f) => !removedSet.has(f.key));
    const basePositions: Record<string, { cellText: string; ordinal: number }> = {};
    for (const [k, v] of Object.entries(fieldPositions)) {
      if (!removedSet.has(k)) basePositions[k] = v;
    }

    if (newFields.length === 0 && removedKeys.length === 0 && cellEdits.length === 0) {
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
      showMagisToast("Documento salvo! O preview foi atualizado.", "success");
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
      // Open sidebar if collapsed so the user sees the new field config immediately
      setPanelCollapsed(false);
      setExpandedField(newFields[0].key);
      setActiveFieldKey(newFields[0].key);
      // Every newly discovered placeholder needs label/role/group configuration,
      // regardless of whether the key was auto-generated (campo_) or manually typed.
      setPendingConfigKeys((prev) => new Set([...prev, ...newFields.map((f) => f.key)]));
      // Locate the first new field in the document after the preview reloads
      setTimeout(() => setLocateKey(`${newFields[0].key}:${Date.now()}`), 800);
      // Scroll the new field card into view after the panel opens and re-renders
      requestAnimationFrame(() => {
        setTimeout(() => {
          panelScrollRef.current
            ?.querySelector<HTMLElement>(`[data-field-card="${newFields[0].key}"]`)
            ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }, 100);
      });
    }

    // Show result feedback toast
    if (newFields.length > 0 || removedKeys.length > 0) {
      const parts: string[] = [];
      if (newFields.length > 0) parts.push(`${newFields.length} campo${newFields.length > 1 ? "s" : ""} novo${newFields.length > 1 ? "s" : ""} detectado${newFields.length > 1 ? "s" : ""}`);
      if (removedKeys.length > 0) parts.push(`${removedKeys.length} removido${removedKeys.length > 1 ? "s" : ""}`);
      showMagisToast(`Documento atualizado — ${parts.join(" e ")}. Configure os novos campos no painel.`, "info");
    }

    handleSave(mergedFields, mergedPositions, true, cellEdits);
  }

  // Live sidebar reconciliation — called by MutationObserver in DocxInteractive.
  // Updates React state immediately (no server save) so new/removed fields appear
  // in the sidebar as the user types {{key}} in the document.
  function handleLiveScan(edits: DocxEdit[], removedKeys: string[]) {
    const newFields: TemplateFieldSchema[] = [];
    const newPositions: Record<string, { cellText: string; ordinal: number; coord?: string }> = {};
    for (const edit of edits) {
      const f = addFieldFromEdit(edit.text, edit.ordinal, edit.key, edit.role, edit.label);
      if (!fields.find((existing) => existing.key === f.key) && !newFields.find((nf) => nf.key === f.key)) {
        newFields.push(f);
        newPositions[f.key] = { cellText: edit.text.trim(), ordinal: edit.ordinal, ...(edit.coord ? { coord: edit.coord } : {}) };
      }
    }
    const removedSet = new Set(removedKeys);
    setFields((prev) => {
      const base = prev.filter((f) => !removedSet.has(f.key));
      const toAdd = newFields.filter((nf) => !base.find((b) => b.key === nf.key));
      return [...base, ...toAdd];
    });
    setFieldPositions((prev) => {
      const next = { ...prev };
      for (const k of removedKeys) delete next[k];
      return { ...next, ...newPositions };
    });
    if (newFields.length > 0) {
      setPanelCollapsed(false);
      setExpandedField(newFields[0].key);
      setActiveFieldKey(newFields[0].key);
      setPendingConfigKeys((prev) => new Set([...prev, ...newFields.map((f) => f.key)]));
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
    // Key rename: transfer stored position and pending state from old key to new key
    if (patch.key !== undefined) {
      const oldKey = fields[index]?.key;
      if (oldKey && patch.key !== oldKey) {
        setFieldPositions((pos) => {
          if (!pos[oldKey]) return pos;
          const next = { ...pos, [patch.key!]: pos[oldKey] };
          delete next[oldKey];
          return next;
        });
        setPendingConfigKeys((pck) => {
          if (!pck.has(oldKey)) return pck;
          const next = new Set(pck);
          next.delete(oldKey);
          next.add(patch.key!);
          return next;
        });
      }
    }

    setFields((prev) =>
      prev.map((f, i) => {
        if (i !== index) return f;
        const updated = { ...f, ...patch };
        if (patch.label !== undefined && f.key.startsWith("campo_")) {
          const newKey =
            patch.label
              .toLowerCase()
              .normalize("NFD")
              .replace(/[̀-ͯ]/g, "")
              .replace(/[^a-z0-9]+/g, "_")
              .replace(/^_|_$/g, "") || f.key;
          updated.key = newKey;
          if (patch.label.trim()) {
            setPendingConfigKeys((prev) => {
              const next = new Set(prev);
              next.delete(f.key);
              next.delete(newKey);
              return next;
            });
          }
        } else if (patch.label?.trim()) {
          // For fields with explicit keys (typed as {{minha_chave}}): clear pending
          // config as soon as the user provides a non-empty label.
          setPendingConfigKeys((prev) => {
            const next = new Set(prev);
            next.delete(f.key);
            return next;
          });
        }
        return updated;
      }),
    );
  }

  function handleSave(
    overrideFields?: TemplateFieldSchema[],
    overridePositions?: Record<string, { cellText: string; ordinal: number }>,
    switchToPreview = false,
    overrideCellEdits?: CellEdit[],
  ) {
    let fieldsToSave = overrideFields ?? fields;
    let positionsToSave = overridePositions ?? fieldPositions;

    // Ghost filter (sessão atual): remove campos cujo chip existia no doc mas foi deletado
    // pelo usuário antes de clicar Salvar (sem passar por "Salvar edições")
    if (!overrideFields && !overrideCellEdits) {
      const currentDocKeys = latestDocKeysRef.current;
      if (currentDocKeys.size > 0) {
        const sessionGhosts = new Set(
          Object.keys(positionsToSave).filter((k) => !currentDocKeys.has(k)),
        );
        if (sessionGhosts.size > 0) {
          fieldsToSave = fieldsToSave.filter((f) => !sessionGhosts.has(f.key));
          const cleanPos = { ...positionsToSave };
          for (const k of sessionGhosts) delete cleanPos[k];
          positionsToSave = cleanPos;
          setFields(fieldsToSave);
          setFieldPositions(positionsToSave);
        }
      }
    }

    setError(null);
    setSaved(false);

    // Item 11: validation
    if (!nome.trim()) { setError("Dê um nome ao template antes de salvar."); return; }
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
          ...(overrideCellEdits && overrideCellEdits.length > 0 ? { cell_edits: overrideCellEdits } : {}),
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
            setMagisQuestionsMode(true);
            setMagisStep(1);
          } else {
            setSaved(true);
            setPreviewVersion((v) => v + 1);
            setTimeout(() => setSaved(false), 2500);
            router.refresh();
            showMagisToast("Campos salvos! O template está atualizado.", "success");
            // Item 7: show undo toast
            setShowUndoToast(true);
            if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
            undoTimerRef.current = setTimeout(() => setShowUndoToast(false), 5000);
          }
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : "Falha ao salvar.";
          setError(msg);
          showMagisToast("Não consegui salvar os campos. Verifique sua conexão e tente novamente.", "error");
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

  function handlePlace(key: string, coord: string | undefined, cellText: string, ordinal: number) {
    setPlacementKey(null);
    const newPos: Record<string, { cellText: string; ordinal: number; coord?: string }> = {
      ...fieldPositions,
      [key]: { cellText, ordinal, ...(coord ? { coord } : {}) },
    };
    setFieldPositions(newPos);
    // Always use the simple token — safeAppendToken on the server handles
    // empty vs non-empty cells correctly without destroying structure.
    const cellEdit: CellEdit = {
      cellText,
      ordinal,
      newContent: `{{${key}}}`,
      coord,
    };
    handleSave(fields, newPos, true, [cellEdit]);
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
      // Collect any pending doc edits ({{keys}} typed in the doc but not yet committed via sidebar).
      // This makes "Verificar template" a unified save — no separate "Salvar edições" needed.
      const scan = scanRef.current?.();
      let finalFields = fields;
      let finalPositions = fieldPositions;
      const finalCellEdits: CellEdit[] = scan?.cellEdits ?? [];

      if (scan && (scan.edits.length > 0 || scan.removedKeys.length > 0)) {
        const { edits, scanOrder, removedKeys } = scan;
        const newFields: TemplateFieldSchema[] = [];
        const newPositions: Record<string, { cellText: string; ordinal: number; coord?: string }> = {};
        for (const edit of edits) {
          const f = addFieldFromEdit(edit.text, edit.ordinal, edit.key, edit.role, edit.label);
          if (!finalFields.find((existing) => existing.key === f.key) && !newFields.find((nf) => nf.key === f.key)) {
            newFields.push(f);
            newPositions[f.key] = { cellText: edit.text.trim(), ordinal: edit.ordinal, ...(edit.coord ? { coord: edit.coord } : {}) };
          }
        }
        const removedSet = new Set(removedKeys);
        const baseFields = finalFields.filter((f) => !removedSet.has(f.key));
        const basePositions: Record<string, { cellText: string; ordinal: number }> = {};
        for (const [k, v] of Object.entries(finalPositions)) {
          if (!removedSet.has(k)) basePositions[k] = v;
        }
        const mergedPositions = { ...basePositions, ...newPositions };
        const allFields = [...baseFields, ...newFields];
        const scanIndexOf = (key: string) => { const i = scanOrder.indexOf(key); return i === -1 ? Infinity : i; };
        finalFields = [...allFields].sort((a, b) => scanIndexOf(a.key) - scanIndexOf(b.key));
        finalPositions = mergedPositions;
      }

      const res = await fetch(`/api/templates/${template.id}/schema`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: nome.trim() || template.nome,
          estado: estado || null,
          schema_campos: finalFields,
          field_positions: finalPositions,
          ...(finalCellEdits.length > 0 ? { cell_edits: finalCellEdits } : {}),
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
      const msg = err instanceof Error ? err.message : "Falha ao salvar.";
      setError(msg);
      showMagisToast("Ops! " + msg + " Tente novamente.", "error");
    } finally {
      setIsAdvancing(false);
    }
  }

  function handleConfirmTemplate() {
    setMagisQuestionsMode(true);
    setMagisStep(1);
  }

  async function handleCompleteMagis() {
    setIsSavingMagis(true);
    try {
      await fetch(`/api/templates/${template.id}/schema`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo_plano: magisAnswers.nivelEnsino || null,
          estado: magisAnswers.estadoMagis || null,
        }),
      });
    } catch { /* não bloquear se falhar */ }
    finally { setIsSavingMagis(false); }
    setMagisQuestionsMode(false);
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
            <h2 className="text-base font-bold text-slate-950">Resultado da reanálise</h2>
            <p className="mt-0.5 text-xs text-slate-400">Revise as mudanças antes de confirmar</p>
          </div>
          <button type="button" onClick={() => setPendingExtract(null)} className="rounded-xl border border-slate-200 p-1.5 text-slate-400 hover:border-slate-950 hover:text-slate-950">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-3 gap-4">
            {/* Mantidos */}
            <div>
              <p className="mb-2 text-xs font-bold text-slate-500 uppercase tracking-wide">Sem alteração ({pendingExtract.diff.mantidos.length})</p>
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
              <p className="mb-2 text-xs font-bold text-emerald-600 uppercase tracking-wide">Novos campos ({pendingExtract.diff.adicionados.length})</p>
              <div className="space-y-1">
                {pendingExtract.diff.adicionados.map((k) => {
                  const f = pendingExtract.schema.find((s) => s.key === k);
                  return (
                    <div key={k} className={`rounded-xl border px-3 py-1.5 ${camposBaixaConfianca.includes(k) ? "border-amber-200 bg-amber-50" : "border-emerald-100 bg-emerald-50"}`}>
                      <p className="text-xs font-medium text-slate-700 truncate">{f?.label ?? k}</p>
                      <div className="flex items-center gap-1">
                        <code className="text-[10px] text-emerald-600">{`{{${k}}}`}</code>
                        {camposBaixaConfianca.includes(k) && <span className="text-[9px] text-amber-600 font-semibold">⚠ verificar posição</span>}
                      </div>
                    </div>
                  );
                })}
                {pendingExtract.diff.adicionados.length === 0 && <p className="text-xs text-slate-400 italic">Nenhum novo campo</p>}
              </div>
            </div>
            {/* Removidos */}
            <div>
              <p className="mb-2 text-xs font-bold text-rose-500 uppercase tracking-wide">Campos removidos ({pendingExtract.diff.removidos.length})</p>
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
            Confirmar ({pendingExtract.schema.length} campos)
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
        {fields.length > 0 && (
          <div className="mb-3 flex items-center gap-2 rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2">
            <div className="flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-slate-700">
                  {fields.length - camposSemPlaceholder.length} de {fields.length} campos posicionados
                </span>
                {camposSemPlaceholder.length === 0 && (
                  <span className="text-emerald-500 text-xs">✓</span>
                )}
              </div>
              {camposSemPlaceholder.length > 0 && (
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${Math.round(((fields.length - camposSemPlaceholder.length) / fields.length) * 100)}%` }}
                  />
                </div>
              )}
            </div>
            {camposSemPlaceholder.length > 0 && (
              <span className="shrink-0 rounded-lg bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                {camposSemPlaceholder.length} sem posição
              </span>
            )}
          </div>
        )}
        {progressBar}
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Campos do template ({fields.length})
          </h2>
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
                  {isReExtracting ? "Analisando…" : "Reanalisar template"}
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
                {camposSemPlaceholder.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowOnlyMissing((v) => !v)}
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition ${
                      showOnlyMissing
                        ? "bg-amber-600 text-white"
                        : "bg-amber-100 text-amber-700 hover:bg-amber-200"
                    }`}
                  >
                    ⚠ Sem posição
                  </button>
                )}
              </div>

              {template.arquivo_url && (
                <button
                  type="button"
                  onClick={() => void handleReExtract()}
                  disabled={isReExtracting}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-500 transition hover:border-slate-400 hover:text-slate-900 disabled:opacity-50"
                >
                  {isReExtracting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Reanalisar
                </button>
              )}
            </div>

            {fields.filter((f) => {
              if (roleFilter && f.role !== roleFilter) return false;
              if (showOnlyMissing && !camposSemPlaceholder.includes(f.key)) return false;
              return true;
            }).map((field) => {
              const index = fields.indexOf(field);
              const isExpanded = expandedField === field.key;
              const isActive = activeFieldKey === field.key;
              const isNew = pendingConfigKeys.has(field.key);
              const hasEmptyLabel = !field.label.trim();
              const isPlaceholderMissing = camposSemPlaceholder.includes(field.key);
              const isLowConfidence = camposBaixaConfianca.includes(field.key);
              const statusText = hasEmptyLabel
                ? "⚠ Dê um nome a este campo"
                : isPlaceholderMissing
                ? (isLowConfidence ? "⚠ Verificar posição no documento" : "⚠ Não encontrado no documento")
                : "✓ Localizado no documento";
              const statusColor = hasEmptyLabel
                ? "text-rose-500"
                : isPlaceholderMissing
                ? "text-amber-600"
                : "text-emerald-600";

              // Item 6: drag-and-drop
              const isDragging = draggingKey === field.key;
              const isDragOver = dragOverKey === field.key;

              return (
                <div
                  key={field.key}
                  data-field-card={field.key}
                  onDragOver={(e) => handleDragOver(e, field.key)}
                  onDrop={() => handleDrop(field.key)}
                  onDragEnd={handleDragEnd}
                  className={`rounded-2xl border bg-white transition-all ${
                    isDragging ? "opacity-40 scale-95" : isDragOver ? "border-violet-400 ring-2 ring-violet-200" : isNew ? "border-violet-400 ring-2 ring-violet-100" : isActive ? "border-violet-300 ring-1 ring-violet-200" : "border-slate-200"
                  }`}
                >
                  <div
                    className="flex select-none cursor-pointer items-center gap-2 px-4 py-3"
                    onClick={() => {
                      setActiveFieldKey(field.key);
                      setExpandedField(isExpanded ? null : field.key);
                    }}
                  >
                    <span
                      draggable
                      onDragStart={(e) => handleDragStart(e, field.key)}
                      className="flex shrink-0 cursor-grab active:cursor-grabbing"
                    >
                      <GripVertical className="h-4 w-4 text-slate-300" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="line-clamp-2 break-words text-sm font-semibold leading-snug text-slate-900">
                        {field.label || <span className="italic font-normal text-slate-400">sem nome</span>}
                      </p>
                      <p className={`mt-0.5 text-[11px] leading-none ${statusColor}`}>
                        {statusText}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      field.role === "ia_sugerida" ? "bg-violet-100 text-violet-700" : "bg-amber-100 text-amber-700"
                    }`}>
                      {field.role === "ia_sugerida" ? "Magis" : "Professor"}
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

                      {/* New-field notification (simplified — inputs are now always visible below) */}
                      {isNew && (
                        <div className="flex items-center justify-between gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2">
                          <p className="text-[11px] font-semibold text-violet-800">
                            Novo campo — preencha o nome abaixo
                          </p>
                          <button
                            type="button"
                            onClick={() => setPendingConfigKeys((prev) => { const next = new Set(prev); next.delete(field.key); return next; })}
                            className="shrink-0 rounded-lg p-0.5 text-violet-400 hover:text-violet-700"
                            title="Fechar"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}

                      {/* Label — always editable */}
                      <label className="block">
                        <span className="text-[11px] font-semibold text-slate-600">Nome do campo</span>
                        <input
                          type="text"
                          value={field.label}
                          onChange={(e) => updateField(index, { label: e.target.value })}
                          placeholder="Ex.: Turma, Objetivos de aprendizagem…"
                          autoFocus={isNew}
                          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-violet-400 focus:ring-1 focus:ring-violet-200"
                        />
                      </label>

                      {/* Key (placeholder) — editable */}
                      <label className="block">
                        <span className="text-[11px] font-semibold text-slate-600">Chave do placeholder</span>
                        <div className="mt-1 flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 focus-within:border-violet-400 focus-within:bg-white focus-within:ring-1 focus-within:ring-violet-200">
                          <span className="shrink-0 font-mono text-xs text-slate-400">{"{{"}</span>
                          <input
                            type="text"
                            value={field.key}
                            onChange={(e) => {
                              const raw = e.target.value
                                .toLowerCase()
                                .normalize("NFD")
                                .replace(/[̀-ͯ]/g, "")
                                .replace(/[^a-z0-9_]/g, "_");
                              if (raw) updateField(index, { key: raw });
                            }}
                            className="min-w-0 flex-1 bg-transparent font-mono text-xs text-slate-700 outline-none"
                          />
                          <span className="shrink-0 font-mono text-xs text-slate-400">{"}}"}</span>
                        </div>
                        <span className="mt-0.5 block text-[10px] text-slate-400">Usado no documento como <code className="font-mono">{`{{${field.key}}}`}</code></span>
                      </label>

                      {/* Group — always editable */}
                      <label className="block">
                        <span className="text-[11px] font-semibold text-slate-600">Categoria</span>
                        <select
                          value={field.group ?? "outros"}
                          onChange={(e) => preserveScroll(() => updateField(index, { group: e.target.value as TemplateFieldSchema["group"] }))}
                          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-200"
                        >
                          {Object.entries(GROUP_LABELS).map(([k, v]) => (
                            <option key={k} value={k}>{v}</option>
                          ))}
                        </select>
                      </label>

                      {/* Posicionar no documento (only for missing fields) */}
                      {isPlaceholderMissing && (
                        <div className="space-y-2">
                          <button
                            type="button"
                            onClick={() => { setPlacementKey(field.key); setViewMode("interactive"); setPanelCollapsed(false); }}
                            className={`flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold transition ${
                              placementKey === field.key
                                ? "border-indigo-400 bg-indigo-600 text-white"
                                : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                            }`}
                          >
                            <MousePointer2 className="h-3.5 w-3.5" />
                            {placementKey === field.key ? "Aguardando clique no documento…" : "Clicar no documento"}
                          </button>

                          {anchorList.length > 0 && (
                            <div>
                              <p className="mb-1 text-[10px] font-semibold text-slate-500">Ou ancorar próximo de:</p>
                              <input
                                type="text"
                                value={anchorSearch[field.key] ?? ""}
                                onChange={(e) => setAnchorSearch((prev) => ({ ...prev, [field.key]: e.target.value }))}
                                placeholder="Buscar texto do documento…"
                                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-700 outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-200"
                              />
                              <div className="mt-1 max-h-32 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                                {anchorList
                                  .filter((a) => {
                                    const q = (anchorSearch[field.key] ?? "").toLowerCase();
                                    return !q || a.label.toLowerCase().includes(q);
                                  })
                                  .slice(0, 12)
                                  .map((anchor) => (
                                    <button
                                      key={anchor.label}
                                      type="button"
                                      onClick={() => {
                                        const newPos = {
                                          ...fieldPositions,
                                          [field.key]: { cellText: anchor.label, ordinal: 0 },
                                        };
                                        setFieldPositions(newPos);
                                        setAnchorSearch((prev) => ({ ...prev, [field.key]: "" }));
                                        handleSave(fields, newPos, true);
                                      }}
                                      className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left hover:bg-violet-50"
                                    >
                                      <span className="mt-0.5 shrink-0 rounded bg-violet-100 px-1 py-0.5 text-[9px] font-bold uppercase text-violet-600">
                                        {anchor.pattern === "adjacent_right" ? "→" : anchor.pattern === "adjacent_below" ? "↓" : "="}
                                      </span>
                                      <span className="text-[11px] text-slate-700 line-clamp-2">{anchor.label}</span>
                                    </button>
                                  ))}
                                {anchorList.filter((a) => {
                                  const q = (anchorSearch[field.key] ?? "").toLowerCase();
                                  return !q || a.label.toLowerCase().includes(q);
                                }).length === 0 && (
                                  <p className="px-3 py-2 text-[11px] text-slate-400">Nenhuma âncora encontrada</p>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Role toggle */}
                      <div>
                        <span className="text-[11px] font-semibold text-slate-600">Quem preenche este campo?</span>
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
                            Professor preenche
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
                            Magis sugere
                          </button>
                        </div>
                      </div>

                      {/* AI instructions — ia_sugerida only */}
                      {field.role === "ia_sugerida" && (
                        <label className="block">
                          <span className="text-[11px] font-semibold text-violet-700">Contexto para a Magis</span>
                          <p className="mt-0.5 mb-1 text-[10px] leading-relaxed text-slate-400">
                            Instruções específicas para a Magis ao sugerir conteúdo neste campo.
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

                      {/* Default value — manual only */}
                      {field.role !== "ia_sugerida" && (
                        <label className="block">
                          <span className="text-[11px] font-semibold text-amber-700">Valor padrão</span>
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
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="mb-1 text-sm font-semibold text-amber-800">
            {camposSemPlaceholder.length} campo{camposSemPlaceholder.length !== 1 ? "s" : ""} não {camposSemPlaceholder.length !== 1 ? "foram encontrados" : "foi encontrado"} no documento
          </p>
          <p className="mb-3 text-xs text-amber-700">
            Clique em um campo para localizar onde ele deve aparecer no documento:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {camposSemPlaceholder.map((k) => {
              const f = fields.find((fi) => fi.key === k);
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => { setActiveFieldKey(k); setLocateKey(`${k}:${Date.now()}`); setExpandedField(k); }}
                  className="flex items-center gap-1.5 rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-800 transition hover:bg-amber-200"
                >
                  <Crosshair className="h-3 w-3 shrink-0" />
                  {f?.label || k}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {reviewMode && (
        camposSemPlaceholder.length === 0 ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-sm font-semibold text-emerald-800">✅ Template configurado com sucesso!</p>
            <p className="mt-0.5 text-xs text-emerald-600">
              Todos os {fields.length} campos foram localizados no documento. Clique em <strong>Confirmar</strong> para ativar o template.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm font-semibold text-amber-800">
              ⚠️ {camposSemPlaceholder.length} campo{camposSemPlaceholder.length !== 1 ? "s" : ""} ainda não {camposSemPlaceholder.length !== 1 ? "foram localizados" : "foi localizado"}
            </p>
            <p className="mt-0.5 text-xs text-amber-700">
              Você pode confirmar assim mesmo ou voltar e posicionar os campos manualmente no documento.
            </p>
          </div>
        )
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
              {isAdvancing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Verificar template
            </button>
          </>
        )}
      </div>
    </div>
  );

  const NIVEL_ENSINO_OPTIONS: { group: string; items: string[] }[] = [
    {
      group: "Educação Básica",
      items: ["Educação Infantil", "Ensino Fundamental I (1º ao 5º ano)", "Ensino Fundamental II (6º ao 9º ano)", "Ensino Médio"],
    },
    {
      group: "Educação Superior",
      items: ["Graduação", "Pós-graduação"],
    },
  ];

  const magisQuestionsModal = magisQuestionsMode && (
    <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/60 px-4 pb-4 pt-8 backdrop-blur-sm">
      <div className="relative flex w-full max-w-md flex-col overflow-hidden rounded-3xl shadow-2xl" style={{ maxHeight: "90vh" }}>

        {/* WhatsApp-style header */}
        <div className="flex shrink-0 items-center gap-3 bg-violet-700 px-5 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white leading-tight">Magis</p>
            <p className="text-[11px] text-violet-300">assistente de planos</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {([1, 2] as const).map((s) => (
              <div key={s} className={`h-1.5 rounded-full transition-all ${magisStep >= s ? "w-5 bg-white" : "w-2.5 bg-white/30"}`} />
            ))}
          </div>
        </div>

        {/* Chat area */}
        <div className="flex-1 overflow-y-auto bg-[#ece5dd] px-4 py-5 space-y-3">

          {/* Etapa 1 — Nível de ensino */}
          {magisStep === 1 && (
            <>
              {/* Magis bubbles */}
              <div className="flex items-end gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-600 shadow-sm mb-0.5">
                  <Sparkles className="h-3 w-3 text-white" />
                </div>
                <div className="flex max-w-[80%] flex-col gap-1">
                  <div className="rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 shadow-sm">
                    <p className="text-sm text-slate-800">Oi! Antes de a gente continuar, preciso de mais um detalhe sobre esse template 😊</p>
                  </div>
                  <div className="rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 shadow-sm">
                    <p className="text-sm text-slate-800">Para qual <strong>nível de ensino</strong> ele é?</p>
                  </div>
                </div>
              </div>

              {/* Option cards */}
              <div className="pl-9 space-y-2 pt-1">
                {NIVEL_ENSINO_OPTIONS.map(({ group, items }) => (
                  <div key={group}>
                    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 pl-1">{group}</p>
                    <div className="grid grid-cols-2 gap-2">
                      {items.map((item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() => setMagisAnswers((prev) => ({ ...prev, nivelEnsino: item }))}
                          className={`rounded-xl border px-3 py-2.5 text-sm font-medium text-left transition shadow-sm ${
                            magisAnswers.nivelEnsino === item
                              ? "border-violet-500 bg-violet-600 text-white"
                              : "border-slate-200 bg-white text-slate-700 hover:border-violet-300 hover:bg-violet-50"
                          }`}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Etapa 2 — Currículo estadual */}
          {magisStep === 2 && (
            <>
              <div className="flex items-end gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-600 shadow-sm mb-0.5">
                  <Sparkles className="h-3 w-3 text-white" />
                </div>
                <div className="flex max-w-[80%] flex-col gap-1">
                  <div className="rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 shadow-sm">
                    <p className="text-sm text-slate-800">
                      {magisAnswers.nivelEnsino ? <>Perfeito, <strong>{magisAnswers.nivelEnsino}</strong>! 👍</> : "Perfeito! 👍"}
                    </p>
                  </div>
                  <div className="rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 shadow-sm">
                    <p className="text-sm text-slate-800">Você usa <strong>currículo regional</strong> nas suas aulas?</p>
                  </div>
                  <div className="rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 shadow-sm">
                    <p className="text-sm text-slate-800">Se sim, me diz o estado — assim personalizo as sugestões certinho pra você! 🗺️</p>
                  </div>
                </div>
              </div>

              <div className="pl-9 pt-1">
                <div className="relative">
                  <select
                    value={magisAnswers.estadoMagis}
                    onChange={(e) => setMagisAnswers((prev) => ({ ...prev, estadoMagis: e.target.value }))}
                    autoFocus
                    className="w-full appearance-none rounded-2xl border border-slate-200 bg-white px-4 py-3 pr-10 text-sm shadow-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                  >
                    <option value="">Não uso currículo regional</option>
                    {ESTADOS_BRASIL.map((e) => (
                      <option key={e.uf} value={e.uf}>{e.uf} — {e.nome}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Action bar */}
        <div className="shrink-0 flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-3">
          {magisStep === 2 ? (
            <button
              type="button"
              onClick={() => setMagisStep(1)}
              className="text-xs text-slate-400 hover:text-slate-700"
            >
              ← Voltar
            </button>
          ) : <div />}

          {magisStep === 1 ? (
            <button
              type="button"
              onClick={() => setMagisStep(2)}
              disabled={!magisAnswers.nivelEnsino}
              className="rounded-2xl bg-violet-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-40"
            >
              Continuar →
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleCompleteMagis()}
              disabled={isSavingMagis}
              className="flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {isSavingMagis ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Pronto!
            </button>
          )}
        </div>
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
      <div className="flex h-full flex-col gap-4">
        {magisQuestionsModal}
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


        {/* Item 14: mobile tab switcher (visible only on < xl) */}
        <div className="shrink-0 flex xl:hidden rounded-2xl border border-slate-200 bg-white p-1 gap-1">
          <button type="button" onClick={() => setMobileTab("document")}
            className={`flex-1 rounded-xl py-2 text-xs font-semibold transition ${mobileTab === "document" ? "bg-violet-600 text-white" : "text-slate-500 hover:text-slate-800"}`}>
            Documento
          </button>
          <button type="button" onClick={() => setMobileTab("campos")}
            className={`flex-1 rounded-xl py-2 text-xs font-semibold transition ${mobileTab === "campos" ? "bg-violet-600 text-white" : "text-slate-500 hover:text-slate-800"}`}>
            Campos ({fields.length})
          </button>
        </div>

        {/* Split view — flex-1 fills all remaining height in the h-full flex-col parent */}
        <div className="flex flex-1 min-h-0" style={{ minHeight: "480px" }}>
          {/* Left: editor — hidden on mobile, shown on xl+ (or when mobile tab = document) */}
          <div className={`overflow-hidden rounded-3xl border border-slate-200 flex-1 min-w-0 ${
            mobileTab === "document" ? "flex flex-col" : "hidden xl:flex xl:flex-col"
          }`}>
            {/* Viewer content */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
                  placementKey={placementKey}
                  onCancelPlacement={() => setPlacementKey(null)}
                  onPlace={handlePlace}
                  onChipClick={(key) => {
                    setRoleFilter(null);
                    setShowOnlyMissing(false);
                    setPanelCollapsed(false);
                    setExpandedField(key);
                    setActiveFieldKey(key);
                    requestAnimationFrame(() => {
                      panelScrollRef.current
                        ?.querySelector<HTMLElement>(`[data-field-card="${key}"]`)
                        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                    });
                  }}
                  onDocKeysUpdate={(keys) => { latestDocKeysRef.current = keys; }}
                  onLiveScan={handleLiveScan}
                  scanRef={scanRef}
                />
              )}
            </div>
          </div>

          {/* Drag handle — resize only (not collapse); hidden when sidebar is collapsed */}
          {!panelCollapsed && (
            <div
              className="hidden xl:flex w-3 shrink-0 cursor-col-resize select-none items-center justify-center group relative"
              onMouseDown={(e) => {
                e.preventDefault();
                panelResizeRef.current = { dragging: true, startX: e.clientX, startW: panelWidth };
                document.body.style.cursor = "col-resize";
                document.body.style.userSelect = "none";
              }}
              title="Arrastar para redimensionar"
            >
              <div className="h-10 w-[3px] rounded-full bg-slate-300 transition-colors duration-150 group-hover:bg-violet-500" />
            </div>
          )}

          {/* Item 16: resizable right panel */}
          <div
            ref={panelScrollRef}
            style={panelCollapsed ? { display: "none" } : { width: panelWidth + "px", maxWidth: "33%" }}
            className={`min-h-0 overflow-y-auto rounded-3xl border border-slate-200 bg-white [overflow-anchor:none] shrink-0 ${
              mobileTab === "campos" ? "flex flex-col flex-1" : "hidden xl:flex xl:flex-col"
            }`}
          >
            {/* Scrollable content */}
            <div className="flex flex-col gap-0 p-4">
            {fieldsPanel}
            </div>
          </div>
        </div>
      </div>

      {headerActionsEl && createPortal(
        <>
          <button
            type="button"
            onClick={() => { setShowVersions(true); void loadVersions(); }}
            className="flex items-center justify-center rounded-xl border border-slate-200 bg-white p-2 text-slate-400 transition hover:border-slate-950 hover:text-slate-950"
            title="Histórico de versões"
          >
            <Clock className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setShowHelp(true)}
            className="flex items-center justify-center rounded-xl border border-slate-200 bg-white p-2 text-slate-400 transition hover:border-slate-950 hover:text-slate-950"
            title="Ajuda"
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (panelCollapsed) {
                setPanelWidth(Math.floor(window.innerWidth * 0.35));
                setPanelCollapsed(false);
              } else {
                setPanelCollapsed(true);
              }
            }}
            className="flex items-center justify-center rounded-xl border border-slate-200 bg-white p-2 text-slate-400 transition hover:border-slate-950 hover:text-slate-950"
            title={panelCollapsed ? "Mostrar painel de campos" : "Recolher painel de campos"}
          >
            {panelCollapsed
              ? <PanelRightOpen className="h-3.5 w-3.5" />
              : <PanelRightClose className="h-3.5 w-3.5" />}
          </button>
        </>,
        headerActionsEl,
      )}
      </>
    );
  }

  // Non-DOCX: single column with nome+estado included
  return (
    <>
      {magisQuestionsModal}
      {confirmSuccessModal}
      {diffModal}
      {versionsModal}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6 sm:w-56">
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
        {fieldsPanel}
      </div>
    </>
  );
}
