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
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  Pin,
  Save,
  Send,
  Sparkles,
  UserCheck,
  WandSparkles,
} from "lucide-react";

import { planosService } from "../../lib/services/firestore/planos.service";
import type { DisciplinaBlock, EstudanteRecord, IaSugestao, PlanoRegenteRecord, TemplateFieldSchema, TemplateRecord } from "../../lib/types/firestore";
import { PlanoRegentePicker } from "./plano-regente-picker";
import { RichTextEditor } from "../editor/RichTextEditor";
import {
  DownloadLimitDialog,
  triggerDownload,
  type DownloadLimitInfo,
} from "./download-plan-button";
import { PlanVersionsButton } from "./plan-versions-button";
import { showMagisToast } from "../../lib/utils/magis-toast";
import { fixDocxAnchorImages } from "../../lib/utils/docx-anchor-fix";
import { GenerateReviewModal } from "./generate-review-modal";

// ── Telemetria de feedback implícito ─────────────────────────────────────────

interface InjectionRecord {
  sugestaoId: string;
  label: string;
  namespace: string;    // namespace RAG de origem — gravado no momento da injeção, não derivado depois
  injectedText: string; // label puro, sem HTML, no momento da injeção
  injectedAt: number;   // Date.now()
}

// Classificação de edição após injeção.
// Proxy leve: evita Levenshtein completo no browser para textos longos.
function classifyEdit(
  injected: string,
  final: string,
): "accepted" | "expanded" | "replaced" {
  const strip = (s: string) =>
    s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const a = strip(injected);
  const b = strip(final);
  if (!a) return "replaced";
  if (a === b) return "accepted";

  // Prefixo compartilhado: âncora para distinguir truncamento de rejeição.
  // "Identificar frações" truncado de "Identificar frações equivalentes" = accepted,
  // não replaced — o professor focou a sugestão, não a descartou.
  const prefixLen = Math.min(a.length, b.length, 50);
  const samePrefix = prefixLen > 8 && a.slice(0, prefixLen) === b.slice(0, prefixLen);

  // Levenshtein DP para strings curtas (≤ 120 chars)
  if (a.length <= 120 && b.length <= 120) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
      let prev = i;
      for (let j = 1; j <= n; j++) {
        const curr =
          a[i - 1] === b[j - 1] ? dp[j - 1]! : 1 + Math.min(prev, dp[j]!, dp[j - 1]!);
        dp[j - 1] = prev;
        prev = curr;
      }
      dp[n] = prev;
    }
    const sim = 1 - (dp[n]! / Math.max(m, n));
    if (sim >= 0.88) return "accepted";
    if (samePrefix && b.length < a.length) return "accepted"; // truncamento = foco, não rejeição
    if (b.length > a.length && sim >= 0.35) return "expanded";
    return "replaced";
  }

  // Proxy para textos longos: prefixo + comprimento relativo
  const lenRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
  if (samePrefix && lenRatio > 0.5) return "accepted"; // cobre truncamento e pequenas edições
  if (samePrefix && b.length > a.length) return "expanded";
  return "replaced";
}

export interface PlanEditorHandle {
  getCurrentValues: () => Record<string, string>;
}

interface PlanEditorProps {
  template: TemplateRecord;
  userId: string;
  userName: string;
  /** Logged-in user's email — auto-populates any schema field with key "email" on new plans. */
  userEmail?: string;
  wizardMode?: boolean;
  initialValues?: Record<string, string>;
  /** When resuming an existing draft, pass its Firestore ID so saves update instead of creating a new plan. */
  initialPlanoId?: string;
  /** When true, ia_sugerida fields are preserved from initialValues instead of being cleared. */
  resumeDraft?: boolean;
  /** Called whenever IA field completion changes — lets the wizard show a live counter. */
  onProgressChange?: (filled: number, total: number) => void;
  /** When false, hides the "Gerar tudo" bulk IA entry banner (Mestre+ only). Default true. */
  canUseBulkIa?: boolean;
  /** When true, renders an inline banner before the first 2° professor field. */
  has2prof?: boolean;
  /** Structured plans extracted from regente PDFs — enables field-level import picker. */
  planosRegente?: PlanoRegenteRecord[];
  /** Called when the library changes (plan added/removed from picker). */
  onPlanosRegenteChange?: (planos: PlanoRegenteRecord[]) => void;
  /** Name of the linked special-needs student — shown in the Magis context panel. */
  estudanteNome?: string;
  /** Full student record — used to build rich AI context for PEI suggestions. */
  estudante?: EstudanteRecord;
  /** Discipline blocks extracted from regente PDFs in the wizard flow — auto-populates SEÇÃO 3 for PEI templates. */
  disciplinaBlocks?: DisciplinaBlock[];
  /** Called when the user edits a discipline block field (updates the block state in the parent). */
  onDisciplinaBlocksChange?: (blocks: DisciplinaBlock[]) => void;
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
  docxBuf?: ArrayBuffer | null;
}

function DocView({ html, values, activeFieldKey, onFieldFocus, onFieldChange, docxBuf }: DocViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevValues = useRef<Record<string, string>>({});
  const isComposing = useRef(false);

  // Set HTML once on mount / when html prop changes; apply anchor image fix when buffer arrives
  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = html;
    if (docxBuf) {
      fixDocxAnchorImages(docxBuf, containerRef.current).catch(() => {});
    }
  }, [html, docxBuf]);

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
  docxBuf?: ArrayBuffer | null;
}

function PreviewDocView({ html, values, docxBuf }: PreviewDocViewProps) {
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
    if (docxBuf) {
      fixDocxAnchorImages(docxBuf, container).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, values, docxBuf]);

  return (
    <div className="doc-page">
      <div ref={containerRef} className="doc-view doc-view-preview" />
    </div>
  );
}

// ─── PlanEditor ───────────────────────────────────────────────────────────────

function is2profField(field: TemplateFieldSchema): boolean {
  const text = `${field.key} ${field.label}`.toLowerCase();
  return (
    text.includes("2prof") ||
    text.includes("2°") ||
    text.includes("segundo prof") ||
    text.includes("apoio") ||
    text.includes("inclusao") ||
    text.includes("inclusão") ||
    text.includes("nee") ||
    text.includes("adaptacao") ||
    text.includes("adaptação")
  );
}

export const PlanEditor = forwardRef<PlanEditorHandle, PlanEditorProps>(function PlanEditor(
  { template, userId, userName, userEmail, wizardMode = false, initialValues, initialPlanoId, resumeDraft = false, onProgressChange, canUseBulkIa = true, has2prof = false, planosRegente: initialPlanosRegente = [], onPlanosRegenteChange, estudanteNome, estudante, disciplinaBlocks: initialDisciplinaBlocks = [], onDisciplinaBlocksChange },
  ref,
) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Picker state
  const [planosRegente, setPlanosRegenteState] = useState<PlanoRegenteRecord[]>(initialPlanosRegente);
  const [pickerField, setPickerField] = useState<TemplateFieldSchema | null>(null);
  const [usedPlanIds, setUsedPlanIds] = useState<Set<string>>(new Set());

  // Discipline blocks state (PEI — SEÇÃO 3)
  const [disciplinaBlocks, setDisciplinaBlocksState] = useState<DisciplinaBlock[]>(initialDisciplinaBlocks);
  function updateDisciplinaBlocks(next: DisciplinaBlock[]) {
    setDisciplinaBlocksState(next);
    onDisciplinaBlocksChange?.(next);
  }
  // Updates a single disc_* value in both `values` and the disciplinaBlocks state
  function setDiscValue(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    const match = /^disc_(\d+)_(habilidades_estudante|objeto_conhecimento_estudante|avaliacao_estudante)$/.exec(key);
    if (match) {
      const idx = Number(match[1]);
      const field = match[2] as keyof DisciplinaBlock;
      setDisciplinaBlocksState((prev) => {
        const next = [...prev];
        if (next[idx]) next[idx] = { ...next[idx]!, [field]: value };
        return next;
      });
    }
  }
  const isPeiTemplate = template.template_type === "plano_educacional_individualizado";

  function updatePlanosRegente(next: PlanoRegenteRecord[]) {
    setPlanosRegenteState(next);
    onPlanosRegenteChange?.(next);
  }

  // Build a concise student profile string for the AI when a full record is available.
  const estudanteContexto: string | undefined = estudante
    ? [
        estudante.nome ? `Estudante: ${estudante.nome}` : null,
        estudante.cid ? `CID: ${estudante.cid}` : null,
        estudante.diagnostico ? `Diagnóstico: ${estudante.diagnostico}` : null,
        estudante.necessidades ? `Necessidades: ${estudante.necessidades}` : null,
        estudante.nivel_suporte ? `Nível de suporte: ${estudante.nivel_suporte}` : null,
        estudante.observacoes ? `Observações: ${estudante.observacoes}` : null,
      ].filter(Boolean).join(" | ") || undefined
    : undefined;

  const schema = template.schema_campos ?? [];
  const manualFields = schema.filter(
    (f) => f.role !== "ia_sugerida" && (f.role === "manual" || f.group === "dados_turma" || (!f.role && !f.group)),
  );
  const iaFields = schema.filter((f) => f.role === "ia_sugerida");
  const groupedIA = groupFields(iaFields);
  const first2profFieldKey = has2prof ? iaFields.find(is2profField)?.key : undefined;

  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of schema) init[f.key] = "";
    if (template.escola_nome) {
      const ef = manualFields.find(
        (f) => f.key.includes("escola") || f.label.toLowerCase().includes("escola"),
      );
      if (ef) init[ef.key] = template.escola_nome;
    }
    // Auto-populate email from user profile so professors don't type their own email
    if (userEmail) {
      const emailField = manualFields.find(
        (f) => f.key === "email" || f.label.toLowerCase() === "email" || f.label.toLowerCase() === "e-mail",
      );
      if (emailField) init[emailField.key] = userEmail;
    }
    // Auto-populate professor name from user profile
    if (userName && !userName.includes("@")) {
      const pf = manualFields.find(
        (f) => f.key === "professor" || f.key === "nome_prof" || f.label.toLowerCase().includes("professor"),
      );
      if (pf && !init[pf.key]) init[pf.key] = userName;
    }
    if (!initialValues) return init;
    const merged = { ...init, ...initialValues };
    // When resuming a draft, keep all existing values (including ia_sugerida).
    // In new-plan mode, clear ia_sugerida so Magis fills them fresh.
    if (!resumeDraft) {
      for (const f of schema) {
        if (f.role === "ia_sugerida") merged[f.key] = "";
      }
      // Re-apply escola even when ia_sugerida — always pre-fill from step 2 or template
      const ef = schema.find(
        (f) => f.key.includes("escola") || f.label.toLowerCase().includes("escola"),
      );
      if (ef) {
        merged[ef.key] = initialValues[ef.key] || template.escola_nome || "";
      }
    }
    // Auto-populate professor name from user profile (fallback when empty after merge)
    if (userName && !userName.includes("@")) {
      const pf = manualFields.find(
        (f) => f.key === "professor" || f.key === "nome_prof" || f.label.toLowerCase().includes("professor"),
      );
      if (pf && !merged[pf.key]) merged[pf.key] = userName;
    }
    // Discipline block student fields — initialize from passed blocks (empty by default)
    for (let i = 0; i < initialDisciplinaBlocks.length; i++) {
      const b = initialDisciplinaBlocks[i]!;
      merged[`disc_${i}_habilidades_estudante`] = b.habilidades_estudante;
      merged[`disc_${i}_objeto_conhecimento_estudante`] = b.objeto_conhecimento_estudante;
      merged[`disc_${i}_avaliacao_estudante`] = b.avaliacao_estudante;
    }
    return merged;
  });

  useImperativeHandle(ref, () => ({ getCurrentValues: () => values }));

  const iaFilledCount = iaFields.filter((f) => !!values[f.key]?.trim()).length;
  useEffect(() => {
    if (wizardMode && onProgressChange && iaFields.length > 0) {
      onProgressChange(iaFilledCount, iaFields.length);
    }
  }, [iaFilledCount, iaFields.length, wizardMode, onProgressChange]);

  const [activeFieldKey, setActiveFieldKey] = useState<string | null>(null);
  const [activeFieldMeta, setActiveFieldMeta] = useState<{ label: string; role: string } | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, IaSugestao[]>>({});
  const [loadingField, setLoadingField] = useState<string | null>(null);
  const [streamingCharCount, setStreamingCharCount] = useState(0);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [planoId, setPlanoId] = useState<string | null>(initialPlanoId ?? null);
  const [autoSuggestedOnce, setAutoSuggestedOnce] = useState(false);

  // When resuming a renewed plan, pre-seed generalContext so every Magis call
  // knows to update curriculum references for the new school year.
  const isRenewal = typeof initialValues?._renovado_de === "string" && initialValues._renovado_de.trim().length > 0;
  const renewalYear = typeof initialValues?._ano_letivo === "string" ? initialValues._ano_letivo : String(new Date().getFullYear());
  const [generalContext, setGeneralContext] = useState(
    isRenewal
      ? `Este plano é uma renovação para o ano letivo ${renewalYear}. Atualize todas as sugestões para refletir as mudanças curriculares e referências mais recentes disponíveis para ${renewalYear}.`
      : "",
  );

  // Document HTML state
  const [docHtml, setDocHtml] = useState<string | null>(null);
  const [docxBuf, setDocxBuf] = useState<ArrayBuffer | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const docContainerRef = useRef<HTMLDivElement>(null);
  const docScrolledRef = useRef(false);
  const leftPanelRef = useRef<HTMLDivElement>(null);

  // Preview mode: read-only view of filled doc
  const [previewMode, setPreviewMode] = useState(false);

  // Mobile tab: switch between document and AI chat panels on small screens
  const [mobileTab, setMobileTab] = useState<"documento" | "magis">("documento");

  // Once a plan is finalized (exported), it becomes read-only to prevent
  // users from editing and re-downloading without consuming a new plan from their limit
  const [isFinalized, setIsFinalized] = useState(false);
  const [downloadLimitInfo, setDownloadLimitInfo] = useState<DownloadLimitInfo | null>(null);
  const [downloadToast, setDownloadToast] = useState<"docx" | "pdf" | null>(null);

  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(false);
  // Always holds the latest savePlano to avoid stale closures in the debounce timer
  const latestSavePlanoRef = useRef<((status: "rascunho" | "gerado") => Promise<string>) | null>(null);

  // Rastreia o que foi injetado por campo — nunca causa re-render (ref, não state).
  // Chave: fieldKey; valor: último registro de injeção neste campo.
  const injectionTrackRef = useRef<Map<string, InjectionRecord>>(new Map());

  // Bulk generation ("Gerar com Magis") — ref tracks latest values to avoid stale closure
  const valuesRef = useRef(values);
  useEffect(() => { valuesRef.current = values; }, [values]);
  const bulkCancelRef = useRef(false);
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number; currentLabel: string } | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);

  const hasDocx =
    (template.arquivo_url ?? "").match(/\.(docx|doc)$/i) !== null;

  const activeField = schema.find((f) => f.key === activeFieldKey) ?? null;
  const activeSuggestions = activeFieldKey ? (suggestions[activeFieldKey] ?? []) : [];
  const metadata = extractMetadata(values, schema);
  const metadataComplete = isMetadataComplete(metadata);

  // Fetch annotated HTML and raw DOCX buffer together (for anchor image fix)
  useEffect(() => {
    const url = template.arquivo_url ?? "";
    const ext = url.split(".").pop()?.toLowerCase() ?? "";
    if ((ext !== "docx" && ext !== "doc") || !url) return;

    setDocLoading(true);
    Promise.all([
      fetch(`/api/templates/${template.id}/editor-html`).then((r) => r.json() as Promise<{ html?: string | null }>),
      fetch(`/api/templates/${template.id}/arquivo`).then((r) => r.arrayBuffer()),
    ])
      .then(([data, buf]) => {
        if (data.html) setDocHtml(data.html);
        setDocxBuf(buf);
      })
      .catch(() => {/* fall back to form view */})
      .finally(() => setDocLoading(false));
  }, [template.id, template.arquivo_url]);

  // In wizard mode: auto-scroll to the first IA field so the user lands on Conteúdos,
  // not on Dados fixos. Works for both the DOCX doc view and the form fallback.
  useEffect(() => {
    if (!wizardMode) return;

    if (docHtml) {
      // DOCX view: scroll the left panel to the first IA cell
      if (docScrolledRef.current) return;
      docScrolledRef.current = true;
      const timer = setTimeout(() => {
        const firstIaCell = docContainerRef.current?.querySelector<HTMLElement>(
          '[data-field-role="ia_sugerida"]',
        );
        const panel = leftPanelRef.current;
        if (firstIaCell && panel) {
          const rect = firstIaCell.getBoundingClientRect();
          const panelRect = panel.getBoundingClientRect();
          panel.scrollTop += rect.top - panelRect.top - 40;
        }
      }, 300);
      return () => clearTimeout(timer);
    } else if (!docLoading) {
      // Form fallback: scroll only the left panel to the first IA section
      const timer = setTimeout(() => {
        const el = document.getElementById("ia-section-first");
        const panel = leftPanelRef.current;
        if (el && panel) {
          const rect = el.getBoundingClientRect();
          const panelRect = panel.getBoundingClientRect();
          panel.scrollTop += rect.top - panelRect.top - 20;
        }
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
        // Include non-empty ia_sugerida field values for richer RAG context
        const filledValues = Object.fromEntries(
          schema
            .filter((f) => f.role === "ia_sugerida" && f.key !== field.key && values[f.key]?.trim())
            .map((f) => [f.key, values[f.key]!])
        );

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
            ...(Object.keys(filledValues).length > 0 ? { currentValues: filledValues } : {}),
            ...(estudanteNome ? { estudanteNome } : {}),
            ...(estudanteContexto ? { estudanteContexto } : {}),
            stream: true,
            ...(bypassCache ? { bypassCache: true } : {}),
          }),
        });

        if (!res.ok) {
          const d = (await res.json().catch(() => null)) as { error?: string; quotaRemaining?: number } | null;
          if (typeof d?.quotaRemaining === "number") setQuotaRemaining(d.quotaRemaining);
          const rawErr = (d?.error ?? "").toLowerCase();
          throw new Error(
            res.status === 429 || /quota|rate.?limit|cota/.test(rawErr)
              ? "Cota da IA atingida. Aguarde alguns minutos e tente novamente."
              : res.status === 403
                ? "Sessão expirada. Recarregue a página."
                : "Não consegui gerar sugestões. Tente novamente."
          );
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

          let parsed: { sugestoes?: IaSugestao[]; error?: string; _streamError?: string };
          try {
            parsed = JSON.parse(jsonStr) as typeof parsed;
          } catch {
            const isQuota = /quota|rate.?limit|cota|429/i.test(accumulated);
            throw new Error(
              isQuota
                ? "Cota da IA atingida. Aguarde alguns minutos e tente novamente."
                : "A IA não retornou uma resposta válida. Tente novamente."
            );
          }

          if (parsed.error || parsed._streamError) {
            const rawMsg = (parsed.error ?? parsed._streamError ?? "").toLowerCase();
            const isQuota = /quota|rate.?limit|cota|429/.test(rawMsg);
            throw new Error(
              isQuota
                ? "Cota da IA atingida. Aguarde alguns minutos e tente novamente."
                : "Não consegui gerar sugestões agora. Tente novamente."
            );
          }
          sugestoes = Array.isArray(parsed.sugestoes) ? parsed.sugestoes : [];
          const qh = res.headers.get("X-Quota-Remaining");
          if (qh !== null) setQuotaRemaining(Number(qh));
        } else {
          // Cache hit ou fallback batch — JSON response
          const d = (await res.json()) as { sugestoes: IaSugestao[]; quotaRemaining?: number };
          sugestoes = Array.isArray(d.sugestoes) ? d.sugestoes : [];
          if (typeof d.quotaRemaining === "number") setQuotaRemaining(d.quotaRemaining);
        }

        setSuggestions((prev) => ({ ...prev, [field.key]: sugestoes }));
      } catch (err) {
        const raw = err instanceof Error ? err.message : "";
        const isQuota = /quota|rate.?limit|cota|429/i.test(raw);
        const isFetch = /fetch|network|failed to fetch/i.test(raw);
        setSuggestError(
          isQuota ? "Cota da IA atingida. Aguarde alguns minutos e tente novamente."
          : isFetch ? "Falha na conexão. Verifique sua internet e tente novamente."
          : raw || "Não consegui gerar sugestões. Tente novamente."
        );
      } finally {
        setLoadingField(null);
        setStreamingCharCount(0);
      }
    },
    [template.id, loadingField, generalContext],
  );

  useEffect(() => {
    // Skip prefetch when bulk IA is available — user will generate all fields at once
    if (!metadataComplete || autoSuggestedOnce || iaFields.length === 0 || canUseBulkIa) return;
    setAutoSuggestedOnce(true);
    const first = iaFields[0];
    if (first) void fetchSuggestionsForField(first, metadata);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metadataComplete]);

  // Auto-save draft 3s after values change (prevents losing work on accidental close)
  useEffect(() => {
    if (!isMountedRef.current) { isMountedRef.current = true; return; }
    if (isFinalized) return;
    const hasContent = Object.values(values).some((v) => v.trim().length > 0);
    if (!hasContent) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      const fn = latestSavePlanoRef.current;
      if (!fn) return;
      void fn("rascunho")
        .then(() => { setSaveStatus("saved"); setTimeout(() => setSaveStatus("idle"), 2500); })
        .catch(() => {/* silent auto-save fail */});
    }, 3000);
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  async function generateAllIaFields() {
    if (bulkGenerating || loadingField) return;
    const emptyFields = iaFields.filter((f) => !valuesRef.current[f.key]?.trim());
    if (emptyFields.length === 0) {
      showMagisToast("Todos os campos já estão preenchidos!", "info");
      return;
    }
    setBulkGenerating(true);
    bulkCancelRef.current = false;
    let filled = 0;

    for (let i = 0; i < emptyFields.length; i++) {
      if (bulkCancelRef.current) break;
      const field = emptyFields[i];
      setBulkProgress({ current: i + 1, total: emptyFields.length, currentLabel: field.label });
      try {
        const currentVals = valuesRef.current;
        const res = await fetch("/api/ia/campo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            templateId: template.id,
            fieldKey: field.key,
            fieldLabel: field.label,
            fieldGroup: field.group,
            metadata,
            ...(generalContext ? { extraContext: generalContext } : {}),
            currentValues: Object.fromEntries(
              iaFields
                .filter((f) => f.key !== field.key && currentVals[f.key]?.trim())
                .map((f) => [f.key, currentVals[f.key]!]),
            ),
          }),
        });
        if (!res.ok) continue;
        const d = (await res.json()) as { sugestoes?: IaSugestao[]; quotaRemaining?: number };
        if (typeof d.quotaRemaining === "number") setQuotaRemaining(d.quotaRemaining);
        const sugestoes = Array.isArray(d.sugestoes) ? d.sugestoes : [];
        if (sugestoes.length > 0) {
          const best = sugestoes[0];
          const html = best.descricao
            ? `<p><strong>${best.label}</strong></p><p>${best.descricao}</p>`
            : `<p>${best.label}</p>`;
          const text = best.descricao ? `${best.label}: ${best.descricao}` : best.label;
          const inserted = field.role === "ia_sugerida" ? html : text;
          setValues((prev) => ({ ...prev, [field.key]: inserted }));
          setSuggestions((prev) => ({ ...prev, [field.key]: sugestoes }));
          if (docContainerRef.current) {
            const cell = docContainerRef.current.querySelector<HTMLElement>(`[data-field-key="${field.key}"]`);
            if (cell) {
              if (field.role === "ia_sugerida") cell.innerHTML = html;
              else cell.textContent = text;
            }
          }
          filled++;
        }
      } catch {
        // Continue to next field on error
      }
    }

    setBulkGenerating(false);
    setBulkProgress(null);
    if (!bulkCancelRef.current) {
      showMagisToast(
        filled > 0
          ? `Pronto! Magis preencheu ${filled} campo${filled !== 1 ? "s" : ""}. Revise e ajuste o que quiser.`
          : "Não consegui gerar sugestões agora. Tente campo a campo.",
        filled > 0 ? "success" : "error",
      );
    }
  }

  /** Applies the result from GenerateReviewModal to editor state and DOCX view. */
  function applyReviewResult(result: Record<string, { value: string; sugestoes: IaSugestao[] }>) {
    if (Object.keys(result).length === 0) return;

    setValues((prev) => {
      const next = { ...prev };
      for (const [key, { value }] of Object.entries(result)) next[key] = value;
      return next;
    });

    setSuggestions((prev) => {
      const next = { ...prev };
      for (const [key, { sugestoes }] of Object.entries(result)) next[key] = sugestoes;
      return next;
    });

    // Sync DOCX view cells
    if (docContainerRef.current) {
      for (const [key, { value }] of Object.entries(result)) {
        const cell = docContainerRef.current.querySelector<HTMLElement>(`[data-field-key="${key}"]`);
        if (!cell) continue;
        const role = schema.find((f) => f.key === key)?.role;
        if (role === "ia_sugerida") cell.innerHTML = value;
        else cell.textContent = value.replace(/<[^>]+>/g, " ").trim();
      }
    }

    const count = Object.keys(result).length;
    showMagisToast(
      `Magis inseriu ${count} campo${count !== 1 ? "s" : ""}. Revise e ajuste como quiser.`,
      "success",
    );
  }

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

    // Grava injeção para telemetria de feedback implícito.
    // O texto puro (sem HTML) é a referência para comparar com o valor final no save.
    const injectedText =
      mode === "full" && suggestion.descricao
        ? `${suggestion.label}: ${suggestion.descricao}`
        : suggestion.label;
    injectionTrackRef.current.set(activeFieldKey, {
      sugestaoId: suggestion.id,
      label: suggestion.label,
      namespace: suggestion.namespace ?? "unknown",
      injectedText,
      injectedAt: Date.now(),
    });

    const safeLabel = suggestion.label.replace(/\n/g, "<br>");
    const text =
      mode === "full" && suggestion.descricao
        ? `${suggestion.label}: ${suggestion.descricao}`
        : suggestion.label;
    const html =
      mode === "full" && suggestion.descricao
        ? `<p><strong>${safeLabel}</strong></p><p>${suggestion.descricao}</p>`
        : `<p>${safeLabel}</p>`;

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

    // Coleta feedback implícito: compara texto injetado com valor atual de cada campo.
    // Fire-and-forget — nunca bloqueia o save.
    const injections = injectionTrackRef.current;
    if (injections.size > 0) {
      const feedbackBatch = [...injections.entries()].map(([fieldKey, rec]) => {
        const finalRaw = values[fieldKey] ?? "";
        const outcome = classifyEdit(rec.injectedText, finalRaw);
        return {
          fieldKey,
          sugestaoId: rec.sugestaoId,
          namespace: rec.namespace,
          outcome,
          injectedLen: rec.injectedText.length,
          finalLen: finalRaw.replace(/<[^>]+>/g, "").trim().length,
          msSinceInject: Date.now() - rec.injectedAt,
        };
      });
      void fetch("/api/ia/aceitar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: template.id, feedback: feedbackBatch }),
      }).catch(() => {});
      injections.clear();
    }
    if (planoId) {
      await planosService.updatePlano(planoId, {
        conteudo_gerado: conteudo,
        status,
        // Snapshot file URLs when finalizing so download survives template deletion
        ...(status === "gerado" && template.arquivo_url
          ? { arquivo_url: template.arquivo_url }
          : {}),
        ...(status === "gerado" && template.arquivo_fillable_url
          ? { arquivo_fillable_url: template.arquivo_fillable_url }
          : {}),
      });
      // Snapshot version on every save (fire-and-forget)
      void fetch(`/api/planos/${planoId}/versoes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conteudo_gerado: conteudo }),
      }).catch(() => {});
      return planoId;
    }
    // Snapshot schema_campos and file URLs at creation so preview/download survive future template edits
    const id = await planosService.createPlano({
      user_id: userId,
      template_id: template.id,
      conteudo_gerado: conteudo,
      status,
      schema_campos: template.schema_campos,
      ...(template.arquivo_url ? { arquivo_url: template.arquivo_url } : {}),
      ...(template.arquivo_fillable_url ? { arquivo_fillable_url: template.arquivo_fillable_url } : {}),
    });
    setPlanoId(id);
    return id;
  }

  // Keep latestSavePlanoRef pointing to the current savePlano on every render
  latestSavePlanoRef.current = savePlano;

  function handleSaveRascunho() {
    setSaveStatus("saving");
    startTransition(() => {
      void savePlano("rascunho")
        .then(() => {
          setSaveStatus("saved");
          showMagisToast("Rascunho salvo! Pode continuar quando quiser.", "success");
          setTimeout(() => setSaveStatus("idle"), 2500);
        })
        .catch(() => {
          setSaveStatus("error");
          showMagisToast("Não consegui salvar. Verifique sua conexão e tente novamente.", "error");
          setTimeout(() => setSaveStatus("idle"), 3000);
        });
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
          showMagisToast(
            format === "pdf"
              ? "Plano finalizado! Seu PDF está sendo baixado."
              : "Plano finalizado! Seu arquivo Word está sendo baixado.",
            "success",
          );
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
          setDownloadToast(format);
          setTimeout(() => setDownloadToast(null), 4000);
          void triggerDownload(url).then((info) => {
            if (info) setDownloadLimitInfo(info);
          }).catch(() => { window.open(url, "_blank"); });
        })
        .catch(() => {
          setSaveStatus("error");
          showMagisToast("Ops! Não consegui finalizar o plano. Tente novamente.", "error");
          setTimeout(() => setSaveStatus("idle"), 3000);
        });
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
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
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
            {planoId && (
              <PlanVersionsButton
                planoId={planoId}
                onRestore={(conteudo) => setValues(conteudo)}
              />
            )}
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

      {/* Mobile tab switcher — only visible below lg */}
      {!wizardMode && !previewMode && (
        <div className="flex shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-white lg:hidden">
          <button
            type="button"
            onClick={() => setMobileTab("documento")}
            className={`flex-1 py-2.5 text-sm font-medium transition ${
              mobileTab === "documento"
                ? "bg-slate-950 text-white"
                : "text-slate-500 hover:text-slate-950"
            }`}
          >
            Documento
          </button>
          <button
            type="button"
            onClick={() => setMobileTab("magis")}
            className={`flex-1 py-2.5 text-sm font-medium transition ${
              mobileTab === "magis"
                ? "bg-violet-600 text-white"
                : "text-slate-500 hover:text-violet-600"
            }`}
          >
            Magis IA
          </button>
        </div>
      )}

      {/* Entry banner — wizardMode + Mestre+ only, shown when no IA field has been filled yet */}
      {wizardMode && canUseBulkIa && !bulkGenerating && !showReviewModal && iaFields.length > 0 && iaFilledCount === 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-600 shadow-sm shadow-violet-200">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900">Deixe a Magis preencher o plano</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {iaFields.length} campo{iaFields.length !== 1 ? "s" : ""} pedagógico{iaFields.length !== 1 ? "s" : ""} aguardando sugestões de IA.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowReviewModal(true)}
            className="shrink-0 flex items-center gap-1.5 rounded-2xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700"
          >
            <WandSparkles className="h-4 w-4" />
            Gerar tudo
          </button>
        </div>
      )}

      {/* Main split view */}
      <div
        className={`flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white lg:flex-row ${
          wizardMode ? "h-[660px]" : "flex-1"
        }`}
      >
        {/* ── Left: Document view or form fallback ── */}
        <div ref={leftPanelRef} className={`flex-1 overflow-y-auto overflow-x-auto ${!wizardMode && !previewMode && mobileTab !== "documento" ? "hidden lg:flex lg:flex-col" : ""}`}>
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
                  border:none;
                  padding:4px 8px;
                  vertical-align:top;
                  font-size:12px;
                  min-width:24px;
                }
                .doc-view th { font-weight:700; background:#f0f0f0; }
                .doc-view p { margin:2px 0; line-height:1.5; }
                .doc-view td > p, .doc-view td > div { margin-top:var(--pm-t,2px); margin-bottom:var(--pm-b,2px); }
                .doc-view h1 { font-size:15px; font-weight:700; text-align:center; margin:10px 0 6px; }
                .doc-view h2 { font-size:13px; font-weight:700; text-align:center; margin:8px 0 4px; }
                .doc-view h3 { font-size:12px; font-weight:700; margin:6px 0 3px; }
                .doc-view strong { font-weight:700; }
                .doc-view em { font-style:italic; }
                .doc-view u { text-decoration:underline; }
                .doc-view img { max-width:100%; height:auto; display:block; margin:0 auto 8px; }
                .doc-view td img, .doc-view th img { margin:0; display:inline-block; }
                .doc-view ul, .doc-view ol { padding-left:18px; margin:2px 0; }
                .doc-view li { margin:1px 0; }

                /* ── Campos editáveis — base ── */
                .doc-view td[data-field-key] {
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

                /* ── Campo manual (professor preenche) — âmbar ── */
                .doc-view td[data-field-role="manual"] {
                  background:#fffbeb !important;
                  border-left:3px solid #f59e0b !important;
                }
                .doc-view td[data-field-role="manual"]:hover {
                  background:#fef3c7 !important;
                }
                .doc-view td[data-field-role="manual"]:focus,
                .doc-view td[data-field-role="manual"]:focus-within {
                  background:#fef3c7 !important;
                  box-shadow:inset 0 0 0 2px #d97706;
                  outline:none;
                }
                .doc-view td[data-field-role="manual"]::after {
                  background:#d97706;
                }

                /* ── Campo IA (Magis sugere) — violeta ── */
                .doc-view td[data-field-role="ia_sugerida"] {
                  background:#faf5ff !important;
                  border-left:3px solid #8b5cf6 !important;
                }
                .doc-view td[data-field-role="ia_sugerida"]:hover {
                  background:#ede9fe !important;
                }
                .doc-view td[data-field-role="ia_sugerida"]:focus,
                .doc-view td[data-field-role="ia_sugerida"]:focus-within {
                  background:#ede9fe !important;
                  box-shadow:inset 0 0 0 2px #7c3aed;
                  outline:none;
                }
                .doc-view td[data-field-role="ia_sugerida"]::after {
                  background:#7c3aed;
                }

                /* ── Fallback (sem role) — cinza ── */
                .doc-view td[data-field-key]:not([data-field-role]) {
                  background:#f8fafc !important;
                  border-left:3px solid #94a3b8 !important;
                }
                .doc-view td[data-field-key]:not([data-field-role]):hover {
                  background:#f1f5f9 !important;
                }
                .doc-view td[data-field-key]:not([data-field-role]):focus,
                .doc-view td[data-field-key]:not([data-field-role]):focus-within {
                  background:#f1f5f9 !important;
                  box-shadow:inset 0 0 0 2px #64748b;
                  outline:none;
                }
                .doc-view td[data-field-key]:not([data-field-role])::after {
                  background:#64748b;
                }

                /* Badge com nome do campo (aparece no hover/foco) */
                .doc-view td[data-field-key]::after {
                  content: attr(data-field-label);
                  position:absolute;
                  top:2px;
                  right:3px;
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
              {!previewMode && (
                <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-3 w-3 rounded-sm bg-amber-400" />
                    <span className="text-slate-600">Você preenche</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-3 w-3 rounded-sm bg-violet-500" />
                    <span className="text-slate-600">Magis sugere</span>
                  </span>
                  <span className="ml-auto text-slate-400">Clique em qualquer campo colorido para editar</span>
                </div>
              )}
              <div ref={docContainerRef}>
                {previewMode ? (
                  <PreviewDocView html={docHtml} values={values} docxBuf={docxBuf} />
                ) : (
                  <DocView
                    html={docHtml}
                    values={values}
                    activeFieldKey={activeFieldKey}
                    docxBuf={docxBuf}
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
                fetchSuggestions={(field, bypass) => void fetchSuggestionsForField(field, metadata, undefined, bypass)}
                onImportFromRegente={template.template_type === "plano_educacional_individualizado" ? (field) => setPickerField(field) : undefined}
                hideManualFields={wizardMode}
                first2profFieldKey={first2profFieldKey}
              />
            </div>
          )}
        </div>

        {/* ── Right: AI chatbot panel (hidden in preview mode) ── */}
        {!previewMode && (
          bulkGenerating && bulkProgress ? (
            /* Bulk generation progress panel */
            <div className={`flex w-full shrink-0 flex-col border-t border-slate-200 bg-slate-50 lg:w-80 lg:border-l lg:border-t-0 xl:w-96 ${mobileTab !== "magis" ? "hidden lg:flex" : "flex"}`}>
              <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-600">
                  <Sparkles className="h-4 w-4 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">Magis — Gerando plano…</p>
                  <p className="text-xs text-slate-500">{bulkProgress.current} de {bulkProgress.total} campos</p>
                </div>
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-500" aria-label="Gerando campos" role="status" />
              </div>
              <div className="flex flex-1 flex-col gap-5 p-5" aria-live="polite" aria-label="Progresso de geração">
                {/* Progress bar */}
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-xs text-slate-500">
                    <span>Progresso</span>
                    <span className="font-medium text-violet-700">{Math.round((bulkProgress.current / bulkProgress.total) * 100)}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={bulkProgress.current} aria-valuemin={0} aria-valuemax={bulkProgress.total} aria-label={`Gerando campo ${bulkProgress.current} de ${bulkProgress.total}`}>
                    <div
                      className="h-full rounded-full bg-violet-500 transition-all duration-500"
                      style={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
                {/* Current field card */}
                <div className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm">
                  <div className="mb-2 flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
                    <span className="text-xs font-semibold text-violet-700">Gerando agora:</span>
                  </div>
                  <p className="text-sm font-medium text-slate-800">{bulkProgress.currentLabel}</p>
                </div>
                {/* Steps list */}
                <div className="space-y-1.5">
                  {Array.from({ length: bulkProgress.total }, (_, i) => {
                    const done = i < bulkProgress.current - 1;
                    const active = i === bulkProgress.current - 1;
                    return (
                      <div key={i} className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs transition ${active ? "bg-violet-50 font-medium text-violet-700" : done ? "text-slate-400" : "text-slate-300"}`}>
                        {done
                          ? <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">✓</span>
                          : active
                            ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-violet-500" />
                            : <span className="h-4 w-4 shrink-0 rounded-full border border-slate-200 bg-white" />
                        }
                        <span className="truncate">{iaFields[i]?.label ?? `Campo ${i + 1}`}</span>
                      </div>
                    );
                  })}
                </div>
                {/* Cancel */}
                <button
                  type="button"
                  onClick={() => { bulkCancelRef.current = true; }}
                  className="mt-auto text-xs text-slate-400 underline underline-offset-2 hover:text-slate-600"
                >
                  Cancelar geração
                </button>
              </div>
            </div>
          ) : (
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
              templateEstado={template.estado ?? null}
              templateTipoPlano={template.tipo_plano ?? null}
              onGeneralContextChange={setGeneralContext}
              onInsert={insertSuggestion}
              onGenerate={(extraContext, bypass) => {
                if (activeField) void fetchSuggestionsForField(activeField, metadata, extraContext, bypass);
              }}
              quotaRemaining={quotaRemaining}
              panelClassName={mobileTab !== "magis" ? "hidden lg:flex" : ""}
              onRegenerate={
                activeField?.role === "ia_sugerida" && activeFieldKey && values[activeFieldKey]?.trim()
                  ? async () => {
                      if (loadingField || !activeField) return;
                      setSuggestError(null);
                      setLoadingField(activeField.key);
                      setStreamingCharCount(0);
                      try {
                        const res = await fetch("/api/ia/campo", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            templateId: template.id,
                            fieldKey: activeField.key,
                            fieldLabel: activeField.label,
                            fieldGroup: activeField.group,
                            metadata,
                            bypassCache: true,
                            currentValues: Object.fromEntries(
                              iaFields
                                .filter((f) => f.key !== activeField.key && values[f.key]?.trim())
                                .map((f) => [f.key, values[f.key]!]),
                            ),
                          }),
                        });
                        if (!res.ok) {
                          const errBody = (await res.json().catch(() => null)) as { error?: string; quotaRemaining?: number } | null;
                          if (typeof errBody?.quotaRemaining === "number") setQuotaRemaining(errBody.quotaRemaining);
                          const rawErr = (errBody?.error ?? "").toLowerCase();
                          throw new Error(
                            /quota|rate.?limit|cota|429/.test(rawErr)
                              ? "Cota da IA atingida. Aguarde alguns minutos e tente novamente."
                              : "Não consegui regenerar. Tente novamente."
                          );
                        }
                        const d = (await res.json()) as { sugestoes?: IaSugestao[]; quotaRemaining?: number };
                        if (typeof d.quotaRemaining === "number") setQuotaRemaining(d.quotaRemaining);
                        const sugestoes = Array.isArray(d.sugestoes) ? d.sugestoes : [];
                        if (sugestoes.length > 0) {
                          setSuggestions((prev) => ({ ...prev, [activeField.key]: sugestoes }));
                          insertSuggestion(sugestoes[0], "full");
                          showMagisToast("Campo regenerado! Verifique o novo conteúdo.", "success");
                        }
                      } catch {
                        setSuggestError("Não consegui regenerar. Tente novamente.");
                      } finally {
                        setLoadingField(null);
                        setStreamingCharCount(0);
                      }
                    }
                  : undefined
              }
              onGenerateAll={
                wizardMode && iaFields.some((f) => !values[f.key]?.trim())
                  ? () => setShowReviewModal(true)
                  : undefined
              }
              estudanteNome={estudanteNome}
            />
          )
        )}
        {previewMode && (
          <div className="flex w-full shrink-0 flex-col items-center justify-center gap-4 border-t border-slate-100 bg-slate-50 p-6 text-center lg:w-64 lg:border-l lg:border-t-0">
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

    {/* SEÇÃO 3 — Blocos de Disciplina (PEI com planos do regente importados) */}
    {isPeiTemplate && disciplinaBlocks.length > 0 && (
      <DisciplineBlocksSection
        blocks={disciplinaBlocks}
        values={values}
        setDiscValue={setDiscValue}
        templateId={template.id}
        estudante={estudante}
        estudanteNome={estudanteNome}
        estudanteContexto={estudanteContexto}
      />
    )}

    {downloadToast && (
      <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3.5 shadow-lg">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600">
          <Download className="h-4 w-4 text-white" />
        </div>
        <div>
          <p className="text-sm font-semibold text-emerald-900">Download iniciado</p>
          <p className="text-xs text-emerald-700">
            Seu plano em {downloadToast === "pdf" ? "PDF" : "Word"} está sendo baixado.
          </p>
        </div>
      </div>
    )}

    {downloadLimitInfo && (
      <DownloadLimitDialog
        info={downloadLimitInfo}
        onClose={() => setDownloadLimitInfo(null)}
      />
    )}

    {/* Picker de plano do regente */}
    {pickerField && (
      <PlanoRegentePicker
        field={pickerField}
        planos={planosRegente}
        usedPlanIds={usedPlanIds}
        planoPeiId={planoId ?? undefined}
        onPlanosChange={updatePlanosRegente}
        onSelect={(plano, conteudo) => {
          // Pre-fill the field with the extracted regente content
          setFieldValue(pickerField.key, conteudo);
          setUsedPlanIds((prev) => new Set([...prev, plano.id]));

          // Build focused context for Magis to adapt
          const regenteCtxForField = [
            `Plano do prof. regente (${plano.disciplina}${plano.professor ? ` — ${plano.professor}` : ""}):\n${conteudo}`,
          ].join("\n\n");

          // Trigger AI suggestions so Magis adapts the imported content for the student
          void fetchSuggestionsForField(pickerField, metadata, regenteCtxForField, true);
          setActiveFieldKey(pickerField.key);
        }}
        onClose={() => setPickerField(null)}
      />
    )}

    {/* Review modal — batch generation with one Pinecone retrieval */}
    {showReviewModal && (
      <GenerateReviewModal
        templateId={template.id}
        metadata={metadata}
        estudanteNome={estudanteNome}
        estudanteContexto={
          estudante
            ? [
                estudante.diagnostico ? `Diagnóstico: ${estudante.diagnostico}` : "",
                estudante.necessidades ? `Necessidades: ${estudante.necessidades}` : "",
                estudante.nivel_suporte ? `Nível de suporte: ${estudante.nivel_suporte}` : "",
              ].filter(Boolean).join(" | ")
            : undefined
        }
        onClose={() => setShowReviewModal(false)}
        onApply={applyReviewResult}
      />
    )}
    </>
  );
});

// ─── DisciplineBlocksSection — SEÇÃO 3 do PEI, um card por disciplina ────────

interface DisciplineBlockCardProps {
  block: DisciplinaBlock;
  index: number;
  values: Record<string, string>;
  setDiscValue: (key: string, value: string) => void;
  templateId: string;
  estudante?: EstudanteRecord;
  estudanteNome?: string;
  estudanteContexto?: string;
}

function DisciplineBlockCard({ block, index, values, setDiscValue, templateId, estudante, estudanteNome, estudanteContexto }: DisciplineBlockCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [loadingAdapt, setLoadingAdapt] = useState(false);

  const habilEstudante = values[`disc_${index}_habilidades_estudante`] ?? "";
  const objetoEstudante = values[`disc_${index}_objeto_conhecimento_estudante`] ?? "";
  const avaliacaoEstudante = values[`disc_${index}_avaliacao_estudante`] ?? "";

  async function generateAdaptations() {
    setLoadingAdapt(true);
    try {
      const regenteCtx = [
        block.habilidades_turma && `Habilidades da turma:\n${block.habilidades_turma}`,
        block.objeto_conhecimento_turma && `Objeto de conhecimento da turma:\n${block.objeto_conhecimento_turma}`,
        block.competencias_turma && `Competências:\n${block.competencias_turma}`,
        block.avaliacao_turma && `Avaliação proposta pela turma:\n${block.avaliacao_turma}`,
        block.objetivos_turma && `Objetivos:\n${block.objetivos_turma}`,
      ].filter(Boolean).join("\n\n");

      const extraCtx = [
        `Componente curricular: ${block.disciplina}`,
        block.professor && `Professor regente: ${block.professor}`,
        "",
        "Planejamento do professor regente para a turma:",
        regenteCtx,
        estudanteContexto ? `\nPerfil do estudante:\n${estudanteContexto}` : "",
      ].filter((x) => x !== undefined).join("\n");

      const fields: Array<{ key: string; label: string; group: string }> = [
        { key: `disc_${index}_habilidades_estudante`, label: `Habilidades adaptadas — ${block.disciplina}`, group: "habilidades" },
        { key: `disc_${index}_objeto_conhecimento_estudante`, label: `Objeto de conhecimento adaptado — ${block.disciplina}`, group: "conteudos" },
        { key: `disc_${index}_avaliacao_estudante`, label: `Avaliação adaptada — ${block.disciplina}`, group: "avaliacao" },
      ];

      for (const f of fields) {
        const res = await fetch("/api/ia/campo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            templateId,
            fieldKey: f.key,
            fieldLabel: f.label,
            fieldGroup: f.group,
            metadata: { disciplina: block.disciplina, ...(estudanteNome ? { estudante: estudanteNome } : {}) },
            extraContext: extraCtx,
            isPeiTemplate: true,
            stream: false,
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as { sugestoes?: Array<{ texto: string }> };
          if (data.sugestoes?.[0]?.texto) {
            setDiscValue(f.key, data.sugestoes[0].texto);
          }
        }
      }
    } catch {
      // silent
    } finally {
      setLoadingAdapt(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition"
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100">
          <BookOpen className="h-3.5 w-3.5 text-indigo-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900">{block.disciplina}</p>
          {block.professor && <p className="text-xs text-slate-400">Prof. {block.professor}</p>}
        </div>
        <span className="text-[10px] text-slate-400 truncate max-w-[120px]">{block.arquivo_nome}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-4 pb-4 space-y-4">
          {/* TURMA — read-only from regente */}
          <div className="mt-3 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Da turma — plano do regente</p>
            {block.habilidades_turma && (
              <div className="rounded-xl bg-slate-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase text-slate-400 mb-1">Habilidades</p>
                <p className="text-xs text-slate-700 whitespace-pre-line">{block.habilidades_turma}</p>
              </div>
            )}
            {block.objeto_conhecimento_turma && (
              <div className="rounded-xl bg-slate-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase text-slate-400 mb-1">Objeto de conhecimento</p>
                <p className="text-xs text-slate-700 whitespace-pre-line">{block.objeto_conhecimento_turma}</p>
              </div>
            )}
            {block.competencias_turma && (
              <div className="rounded-xl bg-slate-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase text-slate-400 mb-1">Competências</p>
                <p className="text-xs text-slate-700 whitespace-pre-line">{block.competencias_turma}</p>
              </div>
            )}
          </div>

          {/* ESTUDANTE — editable + AI */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">Para o estudante — adaptar</p>
              <button
                type="button"
                onClick={() => void generateAdaptations()}
                disabled={loadingAdapt}
                className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-violet-700 disabled:opacity-50"
              >
                {loadingAdapt ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                Sugerir adaptações
              </button>
            </div>
            <label className="block">
              <span className="text-[10px] font-semibold uppercase text-slate-400">Habilidades adaptadas</span>
              <textarea
                rows={3}
                value={habilEstudante}
                onChange={(e) => setDiscValue(`disc_${index}_habilidades_estudante`, e.target.value)}
                placeholder="Habilidades adaptadas para o estudante nesta disciplina…"
                className="mt-1 w-full resize-y rounded-xl border border-slate-300 px-3 py-2 text-xs outline-none focus:border-indigo-500"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold uppercase text-slate-400">Objeto de conhecimento adaptado</span>
              <textarea
                rows={2}
                value={objetoEstudante}
                onChange={(e) => setDiscValue(`disc_${index}_objeto_conhecimento_estudante`, e.target.value)}
                placeholder="Objeto de conhecimento para o estudante…"
                className="mt-1 w-full resize-y rounded-xl border border-slate-300 px-3 py-2 text-xs outline-none focus:border-indigo-500"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold uppercase text-slate-400">Avaliação adaptada</span>
              <textarea
                rows={2}
                value={avaliacaoEstudante}
                onChange={(e) => setDiscValue(`disc_${index}_avaliacao_estudante`, e.target.value)}
                placeholder="Critérios e instrumentos avaliativos para o estudante…"
                className="mt-1 w-full resize-y rounded-xl border border-slate-300 px-3 py-2 text-xs outline-none focus:border-indigo-500"
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

interface DisciplineBlocksSectionProps {
  blocks: DisciplinaBlock[];
  values: Record<string, string>;
  setDiscValue: (key: string, value: string) => void;
  templateId: string;
  estudante?: EstudanteRecord;
  estudanteNome?: string;
  estudanteContexto?: string;
}

function DisciplineBlocksSection({ blocks, values, setDiscValue, templateId, estudante, estudanteNome, estudanteContexto }: DisciplineBlocksSectionProps) {
  return (
    <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 shadow-sm">
          <BookOpen className="h-4 w-4 text-white" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">Seção 3 — Planos de Ensino por Disciplina</p>
          <p className="text-xs text-indigo-600">
            {blocks.length} disciplina{blocks.length !== 1 ? "s" : ""} importada{blocks.length !== 1 ? "s" : ""} — blocos pré-preenchidos do regente · adapte para o estudante
          </p>
        </div>
      </div>
      <div className="space-y-2">
        {blocks.map((block, i) => (
          <DisciplineBlockCard
            key={`${block.disciplina}-${i}`}
            block={block}
            index={i}
            values={values}
            setDiscValue={setDiscValue}
            templateId={templateId}
            estudante={estudante}
            estudanteNome={estudanteNome}
            estudanteContexto={estudanteContexto}
          />
        ))}
      </div>
    </div>
  );
}

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
  fetchSuggestions: (field: TemplateFieldSchema, bypass?: boolean) => void;
  onImportFromRegente?: (field: TemplateFieldSchema) => void;
  hideManualFields?: boolean;
  first2profFieldKey?: string;
}

function FormView({
  schema, manualFields, groupedIA, values, activeFieldKey,
  loadingField, metadataComplete, suggestions,
  setActiveFieldKey, setFieldValue, fetchSuggestions,
  onImportFromRegente,
  hideManualFields = false,
  first2profFieldKey,
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
      {manualFields.length > 0 && !hideManualFields && (
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
              <div key={field.key}>
                {field.key === first2profFieldKey && (
                  <div className="mb-3 flex items-center gap-2 rounded-2xl border border-violet-100 bg-violet-50 px-4 py-2.5">
                    <Sparkles className="h-4 w-4 shrink-0 text-violet-600" />
                    <p className="text-xs font-medium text-violet-700">
                      2° Professor — o assistente vai sugerir adaptações inclusivas para os campos pedagógicos.
                    </p>
                  </div>
                )}
                <IaFieldInput
                  field={field}
                  value={values[field.key] ?? ""}
                  active={activeFieldKey === field.key}
                  hasSuggestions={(suggestions[field.key]?.length ?? 0) > 0}
                  isLoading={loadingField === field.key}
                  metadataComplete={metadataComplete}
                  onChange={(v) => setFieldValue(field.key, v)}
                  onFocus={() => setActiveFieldKey(field.key)}
                  onSuggest={(bypass) => fetchSuggestions(field, bypass)}
                  onImportFromRegente={onImportFromRegente ? () => onImportFromRegente(field) : undefined}
                />
              </div>
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
  templateEstado?: string | null;
  templateTipoPlano?: string | null;
  onGeneralContextChange: (v: string) => void;
  onInsert: (s: IaSugestao, mode: "label" | "full") => void;
  onGenerate: (extraContext?: string, bypassCache?: boolean) => void;
  /** Fetches fresh suggestion and auto-inserts best result — one-click regenerate */
  onRegenerate?: () => void;
  /** Saldo restante de chamadas mensais — null enquanto não há resposta da API */
  quotaRemaining?: number | null;
  /** When provided, shows "Gerar com Magis" button for one-click bulk generation */
  onGenerateAll?: () => void;
  /** Extra class applied to the root element — used for mobile show/hide */
  panelClassName?: string;
  /** When set, renders a 2º Professor student context bubble at the top of the panel. */
  estudanteNome?: string;
}

// Keys whose values are not relevant for pedagogical content generation.
// These are administrative/logistics fields — useful for the document but not
// for curriculum alignment or activity design.
const NON_PEDAGOGICAL_KEYS = /escola|professor|recurso|materiai|local|data_aula/i;

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
  templateEstado,
  templateTipoPlano,
  onGeneralContextChange,
  onInsert,
  onGenerate,
  onRegenerate,
  onGenerateAll,
  panelClassName,
  quotaRemaining,
  estudanteNome,
}: AIChatPanelProps) {
  const [contextInput, setContextInput] = useState("");
  const [showGeneralCtx, setShowGeneralCtx] = useState(false);
  const [editingSugId, setEditingSugId] = useState<string | null>(null);
  const [editingSugText, setEditingSugText] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Show only pedagogically relevant fields — skip escola, professor, recursos.
  // Template-level metadata (estado, tipo de ensino) is shown separately below.
  const metaEntries = Object.entries(metadata)
    .filter(([k]) => !NON_PEDAGOGICAL_KEYS.test(k))
    .slice(0, 5);
  const fieldLabel = activeField?.label ?? activeFieldMeta?.label;

  useEffect(() => {
    setContextInput("");
    setEditingSugId(null);
    setCooldown(0); // campo trocado — cooldown zera
  }, [activeField?.key]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [suggestions, isLoading]);

  function sendContext() {
    if (!contextInput.trim() || cooldown > 0) return;
    setCooldown(10);
    onGenerate(contextInput.trim(), true);
    setContextInput("");
  }

  function handleRegenerate() {
    if (cooldown > 0 || !metadataComplete) return;
    setCooldown(10);
    if (onRegenerate) onRegenerate();
    else onGenerate(undefined, true);
  }

  return (
    <div className={`flex w-full shrink-0 flex-col border-t border-slate-200 lg:w-80 lg:border-l lg:border-t-0 xl:w-96 ${panelClassName ?? ""}`}>
      {/* Header — WhatsApp style */}
      <div className="flex shrink-0 items-center gap-3 bg-violet-700 px-4 py-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20">
          <Sparkles className="h-4 w-4 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">Magis</p>
          <p className="truncate text-xs text-violet-200">
            {fieldLabel ? fieldLabel : "Selecione um campo"}
          </p>
        </div>
        {isLoading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white/70" aria-label="Gerando sugestões" role="status" />}
      </div>

      {/* Chat area — WhatsApp background */}
      <div className="flex-1 space-y-3 overflow-y-auto bg-[#ece5dd] p-4" aria-live="polite" aria-label="Painel de sugestões da Magis">
        {/* Magis intro — always visible */}
        <ChatBubble>
          <p className="text-sm text-slate-700">
            Olá! Sou a <span className="font-semibold text-violet-700">Magis</span>, sua assistente pedagógica.
            Complemente os campos ou clique no botão abaixo para preencher todo o plano de aula.
          </p>
          {onGenerateAll && metadataComplete && (
            <button
              type="button"
              onClick={onGenerateAll}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500 active:scale-[.98]"
            >
              <Sparkles className="h-4 w-4" />
              Gerar todos os campos
            </button>
          )}
        </ChatBubble>

        {/* 2º Professor student context bubble */}
        {estudanteNome && (
          <ChatBubble>
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-indigo-700">
              <UserCheck className="h-3.5 w-3.5" />
              Plano Educacional Individualizado
            </p>
            <p className="text-xs text-slate-700">
              Estou adaptando este plano para o(a) estudante{" "}
              <span className="font-semibold">{estudanteNome}</span>.
              Minhas sugestões vão priorizar adaptações inclusivas e estratégias de Educação Especial.
            </p>
          </ChatBubble>
        )}

        {/* Context bubble */}
        {(metaEntries.length > 0 || templateTipoPlano || templateEstado) && (
          <ChatBubble>
            <p className="mb-1 text-xs font-semibold text-violet-700">Tenho este contexto:</p>
            {templateTipoPlano && (
              <p className="text-xs text-slate-700">
                <span className="font-medium">Nível de ensino:</span>{" "}
                <span>{templateTipoPlano}</span>
              </p>
            )}
            {templateEstado && (
              <p className="text-xs text-slate-700">
                <span className="font-medium">Currículo base:</span>{" "}
                <span>{templateEstado}</span>
              </p>
            )}
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
              <p className="text-xs text-violet-500">
                {streamingCharCount > 0
                  ? "Magis está escrevendo…"
                  : "Consultando BNCC e currículo territorial…"}
              </p>
            </div>
          </ChatBubble>
        )}

        {/* Error */}
        {error && !isLoading && (
          <ChatBubble variant="error">
            <p className="text-xs font-semibold text-rose-700">Não consegui gerar sugestões</p>
            <p className="mt-0.5 text-xs text-rose-600">{error}</p>
            <button
              type="button"
              onClick={() => onGenerate()}
              className="mt-2 inline-flex items-center gap-1 rounded-lg bg-rose-100 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-200 transition"
            >
              Tentar novamente
            </button>
          </ChatBubble>
        )}

        {/* Suggestions */}
        {!isLoading &&
          suggestions.map((s, i) => {
            const isEditing = editingSugId === s.id;
            return (
              <ChatBubble key={s.id} animIndex={i}>
                {isEditing ? (
                  /* ── Inline edit mode ── */
                  <div className="flex flex-col gap-2">
                    <textarea
                      rows={3}
                      autoFocus
                      value={editingSugText}
                      onChange={(e) => setEditingSugText(e.target.value)}
                      className="w-full resize-none rounded-xl border border-violet-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                    />
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => setEditingSugId(null)}
                        className="flex-1 rounded-lg border border-slate-200 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-400"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onInsert({ ...s, label: editingSugText.trim() || s.label }, "label");
                          setEditingSugId(null);
                        }}
                        className="flex-1 rounded-lg bg-violet-600 py-1 text-xs font-semibold text-white transition hover:bg-violet-500"
                      >
                        Inserir editado
                      </button>
                    </div>
                  </div>
                ) : (
                  /* ── Normal display mode ── */
                  <>
                    <button
                      type="button"
                      title="Clique para editar antes de inserir"
                      onClick={() => { setEditingSugId(s.id); setEditingSugText(s.label); }}
                      className="group w-full text-left"
                    >
                      <p className="text-sm font-semibold text-slate-900 transition group-hover:text-violet-700">
                        {s.label}
                      </p>
                      <span className="mt-0.5 hidden text-[10px] text-violet-400 group-hover:inline">
                        clique para editar
                      </span>
                    </button>
                    {s.aviso && (
                      <div className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5">
                        <span className="mt-px shrink-0 text-amber-500" aria-hidden>⚠</span>
                        <p className="text-[11px] leading-snug text-amber-800">{s.aviso}</p>
                      </div>
                    )}
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
                  </>
                )}
              </ChatBubble>
            );
          })}

        <div ref={chatEndRef} />
      </div>

      {/* Action bar */}
      <div className="shrink-0 border-t border-slate-200 bg-white p-3 space-y-2">
        {quotaRemaining !== null && quotaRemaining !== undefined && quotaRemaining <= 5 && (
          <p className={`text-center text-[11px] font-medium ${quotaRemaining === 0 ? "text-red-600" : "text-amber-600"}`}>
            {quotaRemaining === 0
              ? "Limite mensal de sugestões atingido. Retorna no próximo mês."
              : `${quotaRemaining} sugestão${quotaRemaining === 1 ? "" : "ões"} restante${quotaRemaining === 1 ? "" : "s"} este mês`}
          </p>
        )}
        {fieldLabel && !isLoading && (onRegenerate || suggestions.length > 0) && (
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={!metadataComplete || cooldown > 0}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-violet-50 border border-violet-200 py-2 text-xs font-semibold text-violet-700 transition hover:bg-violet-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <WandSparkles className="h-3.5 w-3.5" />
            {cooldown > 0 ? `Aguarde ${cooldown}s…` : onRegenerate ? "Regenerar este campo" : "Pedir novas sugestões à Magis"}
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
            aria-label="Contexto adicional para a Magis"
            disabled={!fieldLabel || isLoading}
            className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={sendContext}
            disabled={!contextInput.trim() || !fieldLabel || isLoading || !metadataComplete}
            aria-label="Enviar contexto para a Magis"
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
  const wrapCls = "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition";
  const inputCls = active
    ? "w-full rounded-xl border-2 border-orange-400 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:ring-2 focus:ring-orange-100 mt-1.5 shadow-[0_0_0_3px_rgba(249,115,22,0.10)]"
    : "w-full rounded-xl border border-orange-300 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100 mt-1.5";

  return (
    <div className={wrapCls} onClick={onFocus}>
      <label className="block cursor-pointer">
        <span className="block text-sm font-medium text-slate-700">
          {field.required && <span className="mr-1 text-orange-500 font-bold">*</span>}
          {field.label}
        </span>
        {field.helperText && <span className="block text-xs text-slate-500">{field.helperText}</span>}
        {field.type === "textarea" ? (
          <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} onFocus={onFocus} placeholder={field.placeholder} className={inputCls} />
        ) : field.type === "number" ? (
          <input type="number" value={value} onChange={(e) => onChange(e.target.value)} onFocus={onFocus} className={inputCls} />
        ) : field.type === "select" && field.options ? (
          <select value={value} onChange={(e) => onChange(e.target.value)} onFocus={onFocus} className={inputCls}>
            <option value="">Selecione…</option>
            {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input type="text" value={value} onChange={(e) => onChange(e.target.value)} onFocus={onFocus} placeholder={field.placeholder} className={inputCls} />
        )}
      </label>
    </div>
  );
}

interface IaFieldInputProps extends FieldInputProps {
  hasSuggestions: boolean;
  isLoading: boolean;
  metadataComplete: boolean;
  onSuggest: (bypass?: boolean) => void;
  onImportFromRegente?: () => void;
}

function IaFieldInput({ field, value, active, hasSuggestions, isLoading, metadataComplete, onChange, onFocus, onSuggest, onImportFromRegente }: IaFieldInputProps) {
  useEffect(() => {
    if (active && !hasSuggestions && !isLoading && metadataComplete) onSuggest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-800">{field.label}</span>
        <div className="flex shrink-0 items-center gap-2">
          {field.importavel_de_regente && onImportFromRegente && (
            <button
              type="button"
              onClick={() => { onFocus(); onImportFromRegente(); }}
              disabled={isLoading}
              title="Gerar sugestão com base nos planos dos professores de área"
              className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <BookOpen className="h-3 w-3" />}
              Importar do regente
            </button>
          )}
          <button
            type="button"
            onClick={() => { onFocus(); onSuggest(hasSuggestions); }}
            disabled={isLoading || !metadataComplete}
            className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <WandSparkles className="h-3 w-3" />}
            {hasSuggestions ? "Nova sugestão" : "Perguntar à Magis"}
          </button>
        </div>
      </div>
      <RichTextEditor value={value} onChange={onChange} onFocus={onFocus} active={active} placeholder={metadataComplete ? 'Clique em "Perguntar à Magis" ou escreva aqui…' : "Preencha os dados fixos para habilitar a Magis…"} />
    </div>
  );
}
