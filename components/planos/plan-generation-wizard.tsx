"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BookCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  FileText,
  LoaderCircle,
  Pencil,
  Save,
  Sparkles,
} from "lucide-react";

import { PlanEditor, type PlanEditorHandle } from "./plan-editor";
import { DocxPreview } from "./docx-preview";
import { planosService } from "../../lib/services/firestore/planos.service";
import { templatesService } from "../../lib/services/firestore/templates.service";
import type { TemplateFieldSchema, TemplateOption, TemplateRecord, TurmaRecord } from "../../lib/types/firestore";
import { ESTADOS_BRASIL } from "../../lib/constants/estados-brasil";
import {
  DownloadLimitDialog,
  triggerDownload,
  type DownloadLimitInfo,
} from "./download-plan-button";
import { showMagisToast } from "../../lib/utils/magis-toast";

export interface RecentPlano {
  id: string;
  template_nome: string;
  escola_nome: string | null;
  status: string;
  data_geracao: string;
  conteudo_gerado: Record<string, unknown>;
}

export interface ResumeData {
  planoId: string;
  templateId: string;
  /** 0-based step index to resume at (0=template, 1=metadata, 2=editor, 3=review) */
  wizardStep: number;
  planoTitulo: string;
  values: Record<string, string>;
}

interface PlanGenerationWizardProps {
  userId: string;
  userName: string;
  availableTemplates: TemplateOption[];
  preSelectedTemplateId?: string;
  recentPlanos?: RecentPlano[];
  resumeData?: ResumeData;
  turmas?: TurmaRecord[];
  fromIntroModal?: boolean;
  initialPlanoTitulo?: string;
  initialEstado?: string;
  initialEscolaId?: string;
  initialTurmaId?: string;
  initialDisciplina?: string;
  /** When false, hides turma shortcut bar (Explorador/Educador). Default true. */
  canAssociateEscola?: boolean;
  /** When false, hides "Gerar tudo" bulk IA banner (Explorador/Educador). Default true. */
  canUseBulkIa?: boolean;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(value));
}

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
    text.includes("aee") ||
    text.includes("especial")
  );
}

function temMetadados(template: TemplateOption): boolean {
  return (
    !!(template.escolaNome?.trim()) ||
    Object.values(template.metadata_padrao ?? {}).some((v) => v.trim())
  );
}

const NIVEL_ENSINO_OPTIONS = [
  { group: "Educação Básica", items: ["Educação Infantil", "Ensino Fundamental I (1º ao 5º ano)", "Ensino Fundamental II (6º ao 9º ano)", "Ensino Médio"] },
  { group: "Educação Superior", items: ["Graduação", "Pós-graduação"] },
];

const STEPS = [
  { id: 1, title: "Escolher template",      description: "Selecione o modelo base do plano." },
  { id: 2, title: "Metadados",              description: "Confirme os dados fixos do template." },
  { id: 3, title: "Preencher com a Magis", description: "Preencha campos e receba sugestões da Magis." },
  { id: 4, title: "Revisar e salvar",       description: "Pré-visualize e salve o plano." },
] as const;

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  gerado:               { label: "Gerado",            cls: "bg-emerald-100 text-emerald-800" },
  rascunho:             { label: "Rascunho",           cls: "bg-slate-100 text-slate-700" },
  processando:          { label: "Processando",        cls: "bg-amber-100 text-amber-800" },
  aguardando_geracao:   { label: "Aguardando geração", cls: "bg-blue-100 text-blue-700" },
  aguardando_aprovacao: { label: "Aguardando revisão", cls: "bg-violet-100 text-violet-700" },
  erro:                 { label: "Erro",               cls: "bg-rose-100 text-rose-800" },
};

export function PlanGenerationWizard({
  userId,
  userName,
  availableTemplates,
  preSelectedTemplateId,
  recentPlanos = [],
  resumeData,
  turmas = [],
  fromIntroModal = false,
  initialPlanoTitulo,
  initialEstado,
  initialEscolaId,
  initialTurmaId,
  initialDisciplina,
  canAssociateEscola = true,
  canUseBulkIa = true,
}: PlanGenerationWizardProps) {
  const router = useRouter();

  const initialStep = resumeData ? resumeData.wizardStep
    : preSelectedTemplateId ? 1 : 0;
  const initialId = resumeData?.templateId ?? preSelectedTemplateId ?? availableTemplates[0]?.id ?? "";

  const [currentStep, setCurrentStep] = useState(initialStep);
  const [selectedTemplateId, setSelectedTemplateId] = useState(initialId);
  const [planoTitulo, setPlanoTitulo] = useState(resumeData?.planoTitulo ?? initialPlanoTitulo ?? "");
  const [selectedEstado, setSelectedEstado] = useState<string>(
    initialEstado ?? availableTemplates.find((t) => t.id === initialId)?.estado ?? ""
  );
  const [selectedTipoPlano, setSelectedTipoPlano] = useState<string>(
    availableTemplates.find((t) => t.id === initialId)?.tipoPlano ?? ""
  );
  const [metadataValues, setMetadataValues] = useState<Record<string, string>>({});
  const [saveToTemplate, setSaveToTemplate] = useState(true);
  const [capturedEditorValues, setCapturedEditorValues] = useState<Record<string, string>>(
    resumeData?.values ?? {}
  );
  const [savedPlanoId, setSavedPlanoId] = useState<string | null>(resumeData?.planoId ?? null);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [isFinalized, setIsFinalized] = useState(false);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pdfStatus, setPdfStatus] = useState<"idle" | "gerando" | "pronto" | "erro" | "timeout">("idle");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollAttemptRef = useRef(0);
  const [isSavingMeta, startSavingMeta] = useTransition();
  const [isPending, startTransition] = useTransition();
  const [downloadLimitInfo, setDownloadLimitInfo] = useState<DownloadLimitInfo | null>(null);
  const [selectedTurmaId, setSelectedTurmaId] = useState(initialTurmaId ?? "");
  const [selectedEscolaId, setSelectedEscolaId] = useState(initialEscolaId ?? "");
  const [turmaFilterEscolaId, setTurmaFilterEscolaId] = useState("");

  const [editingField, setEditingField] = useState<{ key: string; label: string; type: string } | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [committedValues, setCommittedValues] = useState<Record<string, string>>({});
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editorRef = useRef<PlanEditorHandle>(null);
  const hasAppliedResumeRef = useRef(false);
  const hasAppliedInitialTurmaRef = useRef(false);
  const [iaProgress, setIaProgress] = useState<{ filled: number; total: number } | null>(null);
  const sessionStartRef = useRef(Date.now());
  const [tempoEconomizadoMin, setTempoEconomizadoMin] = useState<number | null>(null);


  const selectedTemplate = availableTemplates.find((t) => t.id === selectedTemplateId) ?? null;

  // Monta templateRecord para o PlanEditor
  const templateRecord: TemplateRecord | null = selectedTemplate
    ? {
        id: selectedTemplate.id,
        user_id: userId,
        nome: selectedTemplate.nome,
        escola_nome: selectedTemplate.escolaNome ?? null,
        tipo_plano: selectedTipoPlano || selectedTemplate.tipoPlano || null,
        estado: selectedEstado || null,
        schema_campos: selectedTemplate.schema_campos ?? [],
        data_criacao: selectedTemplate.criadoEm,
        metadata_padrao: selectedTemplate.metadata_padrao,
      }
    : null;

  const schema = selectedTemplate?.schema_campos ?? [];
  const manualFields = schema.filter(
    (f) => f.role === "manual" || f.group === "dados_turma" || (!f.role && !f.group),
  );
  const has2prof = schema.some(is2profField);

  const allPreFilled =
    manualFields.length > 0 &&
    manualFields.every((f) => !!(metadataValues[f.key] ?? "").trim());

  // Quando template muda, pré-popula metadados com o que está salvo
  useEffect(() => {
    return () => { if (pollTimerRef.current) clearTimeout(pollTimerRef.current); };
  }, []);

  useEffect(() => {
    if (!selectedTemplate) return;

    // On first mount when resuming: restore metadata from saved values
    if (resumeData && !hasAppliedResumeRef.current) {
      hasAppliedResumeRef.current = true;
      const initial: Record<string, string> = {};
      for (const f of manualFields) {
        initial[f.key] = resumeData.values[f.key] ?? "";
      }
      setMetadataValues(initial);
      setCommittedValues(initial);
      return;
    }

    const saved = selectedTemplate.metadata_padrao ?? {};
    const initial: Record<string, string> = {};
    for (const f of manualFields) {
      initial[f.key] = saved[f.key] ?? f.defaultValue ?? "";
    }
    if (selectedTemplate.escolaNome) {
      const escolaField = manualFields.find(
        (f) => f.key.includes("escola") || f.label.toLowerCase().includes("escola"),
      );
      if (escolaField && !initial[escolaField.key]) {
        initial[escolaField.key] = selectedTemplate.escolaNome;
      }
    }
    if (initialTurmaId && !hasAppliedInitialTurmaRef.current) {
      const t = turmas?.find((tt) => tt.id === initialTurmaId);
      if (t) {
        hasAppliedInitialTurmaRef.current = true;
        const ef = manualFields.find((f) => f.key.includes("escola") || f.label.toLowerCase().includes("escola"));
        if (ef) initial[ef.key] = t.escola_nome;
        const tf = manualFields.find((f) => f.key.includes("turma") || f.key.includes("class") || f.label.toLowerCase().includes("turma"));
        if (tf) initial[tf.key] = t.nome;
        if (t.disciplina) {
          const df = manualFields.find((f) => f.key.includes("disciplina") || f.key.includes("componente") || f.label.toLowerCase().includes("disciplina") || f.label.toLowerCase().includes("componente"));
          if (df) initial[df.key] = t.disciplina;
        }
      }
    }
    if (initialDisciplina) {
      const df = manualFields.find((f) => f.key.includes("disciplina") || f.key.includes("componente") || f.label.toLowerCase().includes("disciplina") || f.label.toLowerCase().includes("componente"));
      if (df && !initial[df.key]) initial[df.key] = initialDisciplina;
    }
    setMetadataValues(initial);
    setCommittedValues(initial);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplateId]);

  // Escolas com turmas para o seletor rápido
  const escolasComTurmas = Array.from(new Set(turmas.map((t) => t.escola_id))).map((eid) => {
    const first = turmas.find((t) => t.escola_id === eid)!;
    return { id: eid, nome: first.escola_nome };
  }).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const turmasFiltradas = turmaFilterEscolaId
    ? turmas.filter((t) => t.escola_id === turmaFilterEscolaId)
    : turmas;

  function applyTurma(turma: TurmaRecord) {
    setSelectedTurmaId(turma.id);
    setSelectedEscolaId(turma.escola_id);
    setMetadataValues((prev) => {
      const next = { ...prev };
      const escolaField = manualFields.find((f) => f.key.includes("escola") || f.label.toLowerCase().includes("escola"));
      if (escolaField) next[escolaField.key] = turma.escola_nome;
      const turmaField = manualFields.find((f) =>
        f.key.includes("turma") || f.key.includes("class") ||
        f.label.toLowerCase().includes("turma") || f.label.toLowerCase().includes("class"),
      );
      if (turmaField) next[turmaField.key] = turma.nome;
      if (turma.disciplina) {
        const discField = manualFields.find((f) =>
          f.key.includes("disciplina") || f.key.includes("componente") ||
          f.label.toLowerCase().includes("disciplina") || f.label.toLowerCase().includes("componente"),
        );
        if (discField) next[discField.key] = turma.disciplina;
      }
      return next;
    });
  }

  function commitField(key: string, value: string) {
    if (!value.trim()) return;
    setCommittedValues((p) => ({ ...p, [key]: value }));
    setMetadataValues((p) => ({ ...p, [key]: value }));
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    setHighlightedKey(key);
    highlightTimerRef.current = setTimeout(() => setHighlightedKey(null), 4000);
  }

  // ── Navegação ───────────────────────────────────────────────────────────────

  function goNext() {
    setCurrentStep((s) => s + 1);
  }

  function goBack() {
    setCurrentStep((s) => Math.max(s - 1, 0));
  }

  function handleContinueStep1() {
    if (!selectedTemplateId) return;
    setCurrentStep(1);
  }

  function handleContinueStep2() {
    if (saveToTemplate && selectedTemplate) {
      startSavingMeta(() => {
        void templatesService
          .saveMetadataPadrao(selectedTemplateId, metadataValues)
          .catch(() => {/* silently ignore — not blocking */});
      });
    }

    // Save rascunho with current step so "Continuar editando" resumes at the editor
    if (selectedTemplate) {
      const conteudo: Record<string, unknown> = {
        criado_por: userName,
        template_nome: selectedTemplate.nome,
        _plano_titulo: planoTitulo.trim(),
        _wizard_step: 2,
        ...metadataValues,
      };
      setIsAutoSaving(true);
      const doSave = savedPlanoId
        ? planosService.updatePlano(savedPlanoId, { conteudo_gerado: conteudo, status: "rascunho" }).then(() => savedPlanoId)
        : planosService.createPlano({
            user_id: userId,
            template_id: selectedTemplateId,
            status: "rascunho",
            conteudo_gerado: conteudo,
            schema_campos: selectedTemplate.schema_campos,
            turma_id: selectedTurmaId || undefined,
            escola_id: selectedEscolaId || undefined,
          });
      void doSave
        .then((id) => { if (typeof id === "string") setSavedPlanoId(id); })
        .catch(() => {})
        .finally(() => setIsAutoSaving(false));
    }

    goNext();
  }

  function handleContinueStep3() {
    const values = editorRef.current?.getCurrentValues() ?? {};
    const merged = { ...metadataValues, ...values };
    setCapturedEditorValues(merged);
    goNext();
    // Auto-save as rascunho so we have an ID for the preview iframe
    if (!selectedTemplate) return;
    const conteudo: Record<string, unknown> = {
      criado_por: userName,
      template_nome: selectedTemplate.nome,
      _plano_titulo: planoTitulo.trim(),
      _wizard_step: 3,
      ...merged,
    };
    setIsAutoSaving(true);
    setSaveError(null);
    const doSave = savedPlanoId
      ? planosService.updatePlano(savedPlanoId, { conteudo_gerado: conteudo, status: "rascunho" }).then(() => savedPlanoId)
      : planosService.createPlano({
          user_id: userId,
          template_id: selectedTemplateId,
          status: "rascunho",
          conteudo_gerado: conteudo,
          schema_campos: selectedTemplate.schema_campos,
          turma_id: selectedTurmaId || undefined,
          escola_id: selectedEscolaId || undefined,
        });
    void doSave
      .then((id) => { if (typeof id === "string") setSavedPlanoId(id); })
      .catch(() => {
        setSaveError("Falha ao preparar pré-visualização. Tente novamente.");
        showMagisToast("Não consegui salvar o plano. Verifique sua conexão e tente novamente.", "error");
      })
      .finally(() => setIsAutoSaving(false));
  }

  // Exponential-backoff polling: 2s → 3s → 5s → 8s → 10s × 4  (total ≈ 50s before timeout)
  const POLL_DELAYS = [2000, 3000, 5000, 8000, 10000, 10000, 10000, 10000];

  function startPdfPolling(planoId: string) {
    pollAttemptRef.current = 0;
    setPdfStatus("gerando");

    function scheduleNext() {
      const delay = POLL_DELAYS[pollAttemptRef.current] ?? null;
      if (delay === null) { setPdfStatus("timeout"); return; }
      pollTimerRef.current = setTimeout(async () => {
        pollAttemptRef.current++;
        try {
          const res = await fetch(`/api/planos/${planoId}/pdf-status`);
          if (!res.ok) { scheduleNext(); return; }
          const data = await res.json() as { pdf_status: string | null; pdf_url: string | null };
          if (data.pdf_status === "pronto" && data.pdf_url) {
            setPdfUrl(data.pdf_url); setPdfStatus("pronto");
          } else if (data.pdf_status === "erro") {
            setPdfStatus("erro");
          } else {
            scheduleNext();
          }
        } catch { scheduleNext(); }
      }, delay);
    }

    scheduleNext();
  }

  function countWords(html: string): number {
    if (!html) return 0;
    return html
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/gi, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
  }

  function calcTempoEconomizado(): number {
    const iaSchema = templateRecord?.schema_campos?.filter((f) => f.role === "ia_sugerida") ?? [];
    const totalWords = iaSchema.reduce((sum, f) => sum + countWords(capturedEditorValues[f.key] ?? ""), 0);
    const sessionMinutes = Math.max(1, Math.round((Date.now() - sessionStartRef.current) / 60_000));
    const estimatedMinutes = Math.round(totalWords / 40 + 15);
    return Math.max(5, estimatedMinutes - sessionMinutes);
  }

  function handleFinalize() {
    if (!savedPlanoId || !selectedTemplate) return;
    setSaveError(null);
    const economizado = calcTempoEconomizado();
    const conteudo: Record<string, unknown> = {
      criado_por: userName,
      template_nome: selectedTemplate.nome,
      _plano_titulo: planoTitulo.trim(),
      ...capturedEditorValues,
    };
    startTransition(() => {
      void planosService
        .updatePlano(savedPlanoId, { conteudo_gerado: conteudo, status: "gerado" })
        .then(() => {
          setTempoEconomizadoMin(economizado);
          setShowSaveSuccess(true);
          setTimeout(() => setShowSaveSuccess(false), 7000);
          setIsFinalized(true);
          void fetch("/api/perfil/tempo-economizado", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ minutos: economizado }),
          }).catch(() => {});
          // Trigger async PDF pre-generation (fire-and-forget — client polls for completion)
          if (savedPlanoId) {
            void fetch(`/api/planos/${savedPlanoId}/gerar-pdf`, { method: "POST" }).catch(() => {});
            startPdfPolling(savedPlanoId);
          }
          // Update pedagogic memory in background (fire-and-forget)
          void fetch("/api/ia/memoria", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conteudo: capturedEditorValues, metadata: metadataValues }),
          }).catch(() => {});
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : "Falha ao salvar.";
          setSaveError(msg);
          showMagisToast("Ops! Não consegui finalizar o plano. Tente novamente.", "error");
        });
    });
  }

  // ── Initial values para o editor ───────────────────────────────────────────

  // metadataValues (passo 2) always wins over previously captured editor values
  // so the professor's latest configuration overrides any old plan content.
  // IA fields are cleared separately inside PlanEditor regardless.
  const editorInitialValues: Record<string, string> = {
    ...(Object.keys(capturedEditorValues).length > 0 ? capturedEditorValues : {}),
    ...metadataValues,
  };

  // ── Render helpers ─────────────────────────────────────────────────────────

  function MagisChatBubble({ children }: { children: React.ReactNode }) {
    return (
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-violet-600 shadow-md">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 rounded-3xl bg-white px-5 py-4 shadow-sm ring-1 ring-slate-100">
          <div className="mb-2 flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-violet-600" />
            <span className="text-xs font-bold uppercase tracking-widest text-violet-600">Magis</span>
          </div>
          <div className="text-sm leading-relaxed text-slate-800">{children}</div>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-3">
      {/* Modal edição de campo preenchido */}
      {editingField && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setEditingField(null)}>
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="mb-3 text-sm font-semibold text-slate-900">{editingField.label}</p>
            {editingField.type === "textarea" ? (
              <textarea
                rows={3}
                value={editingValue}
                onChange={(e) => setEditingValue(e.target.value)}
                autoFocus
                className="w-full resize-none rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-violet-500 placeholder:text-slate-400"
              />
            ) : (
              <input
                type={editingField.type === "number" ? "number" : "text"}
                value={editingValue}
                onChange={(e) => setEditingValue(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    commitField(editingField.key, editingValue);
                    setEditingField(null);
                  }
                }}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-violet-500"
              />
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setEditingField(null)}
                className="flex-1 rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => { commitField(editingField.key, editingValue); setEditingField(null); }}
                className="flex-1 rounded-2xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-500"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Barra de progresso ─────────────────────────────────────────────── */}
      <div className="flex gap-2">
        {STEPS.map((step, index) => {
          const isCompleted = index < currentStep || (index === 3 && isFinalized);
          const isCurrent = index === currentStep && !(index === 3 && isFinalized);
          return (
            <div
              key={step.id}
              className={`flex flex-1 items-center gap-2 rounded-2xl border px-3 py-2 transition ${
                isCurrent
                  ? "border-slate-950 bg-slate-950 text-white"
                  : isCompleted
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-slate-200 bg-white text-slate-400"
              }`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  isCurrent
                    ? "bg-white/20 text-white"
                    : isCompleted
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-100 text-slate-500"
                }`}
              >
                {isCompleted ? <Check className="h-3 w-3" /> : step.id}
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-bold leading-tight">{step.title}</p>
                <p className="hidden truncate text-[10px] leading-tight opacity-65 sm:block">{step.description}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Passo 1: Escolher template ─────────────────────────────────────── */}
      {currentStep === 0 && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-6 flex items-center gap-3">
            <div className="rounded-2xl bg-amber-50 p-3 text-amber-600">
              <BookCheck className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-950">Escolha o template base</h3>
              <p className="text-sm text-slate-500">Selecione o documento que define a estrutura do plano.</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {availableTemplates.map((t) => {
              const isSelected = t.id === selectedTemplateId;
              const hasMeta = temMetadados(t);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { setSelectedTemplateId(t.id); setSelectedEstado(t.estado ?? ""); setSelectedTipoPlano(t.tipoPlano ?? ""); }}
                  className={`rounded-3xl border p-5 text-left transition ${
                    isSelected
                      ? "border-violet-400 bg-violet-50 shadow-sm"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h4 className="truncate text-base font-bold text-slate-950">{t.nome}</h4>
                      {t.escolaNome && (
                        <p className="mt-0.5 truncate text-xs text-slate-500">{t.escolaNome}</p>
                      )}
                      <div className="mt-2 flex items-center gap-2">
                        <p className="text-sm text-slate-500">
                          {t.campoCount > 0 ? `${t.campoCount} campos extraídos` : "Schema padrão"}
                        </p>
                        {!hasMeta && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                            Sem metadados
                          </span>
                        )}
                      </div>
                    </div>
                    <span
                      className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${
                        isSelected ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-400"
                      }`}
                    >
                      <Check className="h-4 w-4" />
                    </span>
                  </div>
                  <p className="mt-3 text-xs text-slate-400">Criado em {formatDate(t.criadoEm)}</p>
                </button>
              );
            })}
          </div>

          <div className="mt-6 flex justify-end border-t border-slate-100 pt-5">
            <button
              type="button"
              onClick={handleContinueStep1}
              disabled={!selectedTemplateId}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-6 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              Continuar
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Passo 2: Metadados — chat WhatsApp ────────────────────────────── */}
      {currentStep === 1 && selectedTemplate && (() => {
        const chatFields = fromIntroModal
          ? manualFields
          : manualFields; // sem intro: ainda mostramos os manualFields; titulo/curriculo aparecem antes

        return (
          <div className="overflow-hidden rounded-3xl border border-slate-200 shadow-sm">
            {/* Info bar: resumo do que foi escolhido no modal */}
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
              <span className="rounded-lg bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-700">
                {selectedTemplate.nome}
              </span>
              {planoTitulo && (
                <span className="text-xs text-slate-500 truncate max-w-[200px]">{planoTitulo}</span>
              )}
              {selectedEstado && (
                <span className="rounded-lg bg-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600">
                  {selectedEstado}
                </span>
              )}
            </div>

            {/* Atalho turma salva — só quando não veio do intro modal e plano permite */}
            {!fromIntroModal && canAssociateEscola && turmas.length > 0 && (
              <div className="border-b border-slate-100 bg-white px-4 py-3">
                <p className="mb-2 text-xs font-semibold text-violet-600">⚡ Atalho — selecionar turma salva</p>
                <div className="flex flex-wrap items-center gap-2">
                  {escolasComTurmas.length > 1 && (
                    <div className="relative">
                      <select
                        value={turmaFilterEscolaId}
                        onChange={(e) => setTurmaFilterEscolaId(e.target.value)}
                        aria-label="Filtrar por escola"
                        className="appearance-none rounded-xl border border-violet-300 bg-white py-1.5 pl-3 pr-7 text-sm text-slate-700 outline-none focus:border-violet-500"
                      >
                        <option value="">Todas as escolas</option>
                        {escolasComTurmas.map((e) => (
                          <option key={e.id} value={e.id}>{e.nome}</option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-violet-400" />
                    </div>
                  )}
                  <div className="relative">
                    <select
                      value={selectedTurmaId}
                      onChange={(e) => {
                        const t = turmas.find((t) => t.id === e.target.value);
                        if (t) applyTurma(t);
                      }}
                      aria-label="Selecionar turma"
                      className="appearance-none rounded-xl border border-violet-300 bg-white py-1.5 pl-3 pr-7 text-sm text-slate-700 outline-none focus:border-violet-500"
                    >
                      <option value="">Selecione a turma…</option>
                      {turmasFiltradas.map((t) => (
                        <option key={t.id} value={t.id}>
                          {escolasComTurmas.length > 1 ? `${t.escola_nome} — ` : ""}{t.nome}{t.disciplina ? ` · ${t.disciplina}` : ""}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-violet-400" />
                  </div>
                  {selectedTurmaId && (
                    <button
                      type="button"
                      onClick={() => { setSelectedTurmaId(""); setSelectedEscolaId(""); }}
                      className="text-xs text-violet-500 hover:text-violet-700"
                    >
                      Limpar
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Chat area — campos preenchidos em um único balão */}
            {(() => {
              const filledFields = chatFields.filter((f) => (committedValues[f.key] ?? "").trim());
              const emptyFields = chatFields.filter((f) => !(committedValues[f.key] ?? "").trim());
              return (
                <>
                  <div className="bg-slate-50 px-4 py-5 space-y-4">
                    <MagisChatBubble>
                      {chatFields.length > 0
                        ? "Ótimo! Confira os dados abaixo e preencha o que falta para personalizar as sugestões."
                        : "Tudo certo! Este template não tem campos manuais. Pode avançar direto para o preenchimento com a Magis."}
                    </MagisChatBubble>

                    {filledFields.length > 0 && (
                      <MagisChatBubble>
                        <div className="space-y-2.5">
                          {filledFields.map((f) => (
                            <div
                              key={f.key}
                              className={`flex items-start justify-between gap-3 rounded-lg px-2 py-1 -mx-2 transition-colors duration-700 ${highlightedKey === f.key ? "bg-emerald-100" : ""}`}
                            >
                              <div className="min-w-0">
                                <span className="font-bold text-slate-900">{f.label}:</span>
                                <span className="ml-1.5 text-slate-700 break-words">{committedValues[f.key]}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => { setEditingField({ key: f.key, label: f.label, type: f.type }); setEditingValue(committedValues[f.key] ?? ""); }}
                                className="shrink-0 rounded-lg p-1 text-violet-400 transition hover:bg-violet-50 hover:text-violet-700"
                                title="Editar"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </MagisChatBubble>
                    )}
                  </div>

                  {/* Campos vazios — inputs com borda laranja */}
                  {emptyFields.length > 0 && (
                    <div className="bg-white px-4 py-4 space-y-3 border-t border-slate-100">
                      <p className="text-xs font-semibold text-orange-600">Preencha os campos abaixo:</p>
                      {emptyFields.map((field) => (
                        <div key={field.key}>
                          <label className="mb-1 block text-xs font-medium text-slate-700">
                            {field.label}{!field.required ? <span className="ml-1 text-slate-400">(opcional)</span> : ""}
                          </label>
                          {field.type === "textarea" ? (
                            <textarea
                              rows={3}
                              value={metadataValues[field.key] ?? ""}
                              onChange={(e) => setMetadataValues((p) => ({ ...p, [field.key]: e.target.value }))}
                              onBlur={(e) => commitField(field.key, e.target.value)}
                              placeholder={field.placeholder ?? field.label}
                              className="w-full resize-none rounded-2xl border border-orange-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-orange-500 placeholder:text-slate-400"
                            />
                          ) : (
                            <input
                              type={field.type === "number" ? "number" : "text"}
                              value={metadataValues[field.key] ?? ""}
                              onChange={(e) => setMetadataValues((p) => ({ ...p, [field.key]: e.target.value }))}
                              onBlur={(e) => commitField(field.key, e.target.value)}
                              placeholder={field.placeholder ?? `Ex.: ${field.label.toLowerCase()}`}
                              className="w-full rounded-2xl border border-orange-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-orange-500 placeholder:text-slate-400"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}

            {/* Footer */}
            <div className="border-t border-slate-100 bg-white px-4 py-4">
              <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={saveToTemplate}
                  onChange={(e) => setSaveToTemplate(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-600"
                />
                Salvar dados para reutilizar nos próximos planos
              </label>
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={goBack}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-950"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={handleContinueStep2}
                  disabled={isSavingMeta}
                  className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-6 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-60"
                >
                  {isSavingMeta ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Preencher com a Magis
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Passo 3: Editor com IA ─────────────────────────────────────────── */}
      {currentStep === 2 && templateRecord && (
        <div className="flex flex-col gap-4">
          {has2prof && (
            <div className="flex items-center gap-2 rounded-2xl border border-violet-100 bg-violet-50 px-4 py-2.5">
              <Sparkles className="h-4 w-4 shrink-0 text-violet-600" />
              <p className="text-xs font-medium text-violet-700">
                2° Professor — o assistente vai sugerir adaptações inclusivas para os campos
                pedagógicos.
              </p>
            </div>
          )}

          <PlanEditor
            ref={editorRef}
            key={`${templateRecord.id}-editor`}
            template={templateRecord}
            userId={userId}
            userName={userName}
            wizardMode
            initialValues={editorInitialValues}
            resumeDraft={!!resumeData}
            onProgressChange={(filled, total) => setIaProgress({ filled, total })}
            canUseBulkIa={canUseBulkIa}
          />

          <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <button
              type="button"
              onClick={goBack}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-950"
            >
              <ArrowLeft className="h-4 w-4" />
              Voltar
            </button>
            <p className="hidden text-xs text-slate-400 sm:block">
              Preencha os campos e conte com a Magis para sugestões pedagógicas.
            </p>
            <button
              type="button"
              onClick={handleContinueStep3}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800"
            >
              Revisar plano{iaProgress && iaProgress.total > 0 ? ` (${iaProgress.filled}/${iaProgress.total})` : ""}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Modal de sucesso — salvo com a Magis ─────────────────────────── */}
      {showSaveSuccess && (
        <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/60 px-4 pb-4 pt-8 backdrop-blur-sm">
          <style>{`
            @keyframes magis-pop {
              from { opacity: 0; transform: scale(0.85) translateY(24px); }
              to   { opacity: 1; transform: scale(1) translateY(0); }
            }
            @keyframes magis-progress-plan {
              from { width: 100%; }
              to   { width: 0%; }
            }
            .magis-progress-bar { animation: magis-progress-plan 7s linear forwards; }
          `}</style>
          <div
            className="flex w-full max-w-sm flex-col overflow-hidden rounded-3xl shadow-2xl"
            style={{ animation: "magis-pop 0.35s cubic-bezier(0.34,1.56,0.64,1) both" }}
          >
            {/* Header WhatsApp */}
            <div className="flex shrink-0 items-center gap-3 bg-violet-700 px-5 py-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20">
                <Sparkles className="h-4 w-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white leading-tight">Magis</p>
                <p className="text-[11px] text-violet-300">assistente de planos</p>
              </div>
            </div>

            {/* Chat area */}
            <div className="bg-[#ece5dd] px-4 py-5 space-y-2">
              <div className="flex items-end gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-600 shadow-sm mb-0.5">
                  <Sparkles className="h-3 w-3 text-white" />
                </div>
                <div className="flex max-w-[80%] flex-col gap-1">
                  <div className="rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 shadow-sm">
                    <p className="text-sm text-slate-800">Plano salvo com sucesso! 🎉</p>
                  </div>
                  <div className="rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 shadow-sm">
                    <p className="text-sm text-slate-500">Agora você pode baixar em PDF. 📄</p>
                  </div>
                  {tempoEconomizadoMin !== null && (
                    <div className="rounded-2xl rounded-bl-sm bg-emerald-50 border border-emerald-100 px-4 py-2.5 shadow-sm">
                      <p className="text-sm font-semibold text-emerald-700">
                        ⏱ Você economizou ~{tempoEconomizadoMin >= 60
                          ? `${Math.floor(tempoEconomizadoMin / 60)}h${tempoEconomizadoMin % 60 > 0 ? ` ${tempoEconomizadoMin % 60}min` : ""}`
                          : `${tempoEconomizadoMin} min`} de trabalho!
                      </p>
                      <p className="mt-0.5 text-xs text-emerald-600">Acumulando no seu painel.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Barra de progresso auto-dismiss */}
            <div className="h-1 w-full overflow-hidden bg-violet-100">
              <div className="magis-progress-bar h-full bg-violet-500" />
            </div>
          </div>
        </div>
      )}

      {/* ── Passo 4: Revisão visual + salvar ──────────────────────────────── */}
      {currentStep === 3 && selectedTemplate && (
        <div className="flex flex-col gap-4">

          {/* Action bar — fica no topo, logo abaixo das etapas */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-950">{planoTitulo || selectedTemplate.nome}</p>
              {selectedTemplate.escolaNome && (
                <p className="truncate text-xs text-slate-400">{selectedTemplate.escolaNome}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {isFinalized ? (
                <>
                  <span className="flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-700">
                    <Check className="h-3.5 w-3.5" />
                    Salvo
                  </span>

                  {/* PDF generation state machine */}
                  {pdfStatus === "gerando" && (
                    <div className="flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2">
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin text-violet-500" />
                      <span className="text-xs font-medium text-violet-700">Preparando PDF…</span>
                    </div>
                  )}

                  {pdfStatus === "pronto" && pdfUrl && (
                    <a
                      href={pdfUrl}
                      download
                      className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-500"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Baixar PDF
                    </a>
                  )}

                  {(pdfStatus === "erro" || pdfStatus === "timeout") && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-rose-600">
                        {pdfStatus === "timeout" ? "PDF demorou mais que o esperado." : "Falha na geração."}
                      </span>
                      <button
                        type="button"
                        onClick={() => { if (savedPlanoId) { void fetch(`/api/planos/${savedPlanoId}/gerar-pdf`, { method: "POST" }).catch(() => {}); startPdfPolling(savedPlanoId); } }}
                        className="text-xs font-semibold text-violet-600 underline hover:text-violet-800"
                      >
                        Tentar novamente
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!savedPlanoId) return;
                          void triggerDownload(`/api/planos/${savedPlanoId}/download?format=pdf`)
                            .then((info) => { if (info) setDownloadLimitInfo(info); })
                            .catch(() => { window.open(`/api/planos/${savedPlanoId}/download?format=pdf`, "_blank"); });
                        }}
                        className="flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-950"
                      >
                        <Download className="h-3 w-3" />
                        Baixar agora
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleFinalize}
                  disabled={isPending || isAutoSaving || !savedPlanoId}
                  className="flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-xs font-bold text-white transition hover:bg-slate-800 disabled:opacity-50"
                >
                  {isPending || isAutoSaving
                    ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    : <Save className="h-3.5 w-3.5" />
                  }
                  {isAutoSaving ? "Preparando…" : isPending ? "Salvando…" : "Confirmar revisão e salvar"}
                </button>
              )}
            </div>
          </div>

          {saveError && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
              <p className="text-sm text-rose-700">{saveError}</p>
            </div>
          )}

          {/* Preview — renderizado com docx-preview (fidelidade total ao formato do template) */}
          <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" style={{ height: "72vh" }}>
            {isAutoSaving || !savedPlanoId ? (
              <div className="flex h-full items-center justify-center gap-3 text-slate-500">
                <LoaderCircle className="h-5 w-5 animate-spin text-violet-500" />
                <span className="text-sm">Preparando pré-visualização…</span>
              </div>
            ) : (
              <DocxPreview key={savedPlanoId} planoId={savedPlanoId} />
            )}
          </div>
        </div>
      )}

      {/* ── Planos recentes — só no step 1 ──────────────────────────────────── */}
      {currentStep === 0 && (
        <>
          <section className="rounded-3xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between gap-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <FileText className="h-4 w-4 text-slate-500" />
                Planos recentes
              </h2>
              {recentPlanos.length > 0 && (
                <p className="text-xs text-slate-500">
                  {recentPlanos.length}{" "}
                  {recentPlanos.length === 1 ? "plano recente" : "planos recentes"}
                </p>
              )}
            </div>

            {recentPlanos.length === 0 ? (
              <p className="mt-4 text-sm text-slate-600">
                Nenhum plano gerado ainda. Use o assistente acima para criar seu primeiro plano.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {recentPlanos.map((plano) => {
                  const status = STATUS_MAP[plano.status] ?? { label: plano.status, cls: "bg-slate-100 text-slate-600" };
                  const temConteudo = Object.keys(plano.conteudo_gerado ?? {}).length > 0;
                  const dateLabel = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(plano.data_geracao));
                  return (
                    <li
                      key={plano.id}
                      className="rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-slate-300"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 rounded-xl bg-white p-2 text-slate-500 shadow-sm">
                            <FileText className="h-4 w-4" />
                          </span>
                          <div>
                            <p className="font-semibold text-slate-900">
                              {typeof plano.conteudo_gerado?._plano_titulo === "string" && plano.conteudo_gerado._plano_titulo.trim()
                                ? plano.conteudo_gerado._plano_titulo
                                : plano.template_nome}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-600">
                              {plano.escola_nome ?? "Escola não informada"}
                            </p>
                            <p className="mt-1 text-xs text-slate-400">{dateLabel}</p>
                            <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${status.cls}`}>
                              {status.label}
                            </span>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {plano.status === "gerado" && temConteudo && (
                            <a
                              href={`/api/planos/${plano.id}/download`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
                            >
                              <Download className="h-3.5 w-3.5" />
                              Baixar
                            </a>
                          )}
                          {plano.status === "rascunho" ? (
                            <a
                              href={`/dashboard/gerar?resume=${plano.id}`}
                              className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-violet-500"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Continuar
                            </a>
                          ) : (
                            <a
                              href={`/dashboard/historico/${plano.id}`}
                              className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
                            >
                              Detalhes
                            </a>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <div className="text-center">
            <a
              href="/dashboard/historico"
              className="text-sm text-slate-500 underline-offset-2 hover:text-slate-950 hover:underline"
            >
              Ver histórico de planos gerados →
            </a>
          </div>
        </>
      )}

      {downloadLimitInfo && (
        <DownloadLimitDialog
          info={downloadLimitInfo}
          onClose={() => setDownloadLimitInfo(null)}
        />
      )}
    </div>
  );
}
