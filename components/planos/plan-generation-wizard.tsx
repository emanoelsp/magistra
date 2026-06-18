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
import type { TemplateFieldSchema, TemplateOption, TemplateRecord } from "../../lib/types/firestore";
import { ESTADOS_BRASIL } from "../../lib/constants/estados-brasil";
import {
  DownloadLimitDialog,
  triggerDownload,
  type DownloadLimitInfo,
} from "./download-plan-button";

interface RecentPlano {
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
}: PlanGenerationWizardProps) {
  const router = useRouter();

  const initialStep = resumeData ? resumeData.wizardStep
    : preSelectedTemplateId ? 1 : 0;
  const initialId = resumeData?.templateId ?? preSelectedTemplateId ?? availableTemplates[0]?.id ?? "";

  const [currentStep, setCurrentStep] = useState(initialStep);
  const [selectedTemplateId, setSelectedTemplateId] = useState(initialId);
  const [planoTitulo, setPlanoTitulo] = useState(resumeData?.planoTitulo ?? "");
  const [selectedEstado, setSelectedEstado] = useState<string>(
    availableTemplates.find((t) => t.id === initialId)?.estado ?? ""
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
  const [isSavingMeta, startSavingMeta] = useTransition();
  const [isPending, startTransition] = useTransition();
  const [downloadLimitInfo, setDownloadLimitInfo] = useState<DownloadLimitInfo | null>(null);

  const editorRef = useRef<PlanEditorHandle>(null);
  const hasAppliedResumeRef = useRef(false);


  const selectedTemplate = availableTemplates.find((t) => t.id === selectedTemplateId) ?? null;

  // Monta templateRecord para o PlanEditor
  const templateRecord: TemplateRecord | null = selectedTemplate
    ? {
        id: selectedTemplate.id,
        user_id: userId,
        nome: selectedTemplate.nome,
        escola_nome: selectedTemplate.escolaNome ?? null,
        tipo_plano: selectedTemplate.tipoPlano ?? null,
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
    if (!selectedTemplate) return;

    // On first mount when resuming: restore metadata from saved values
    if (resumeData && !hasAppliedResumeRef.current) {
      hasAppliedResumeRef.current = true;
      const initial: Record<string, string> = {};
      for (const f of manualFields) {
        initial[f.key] = resumeData.values[f.key] ?? "";
      }
      setMetadataValues(initial);
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
    setMetadataValues(initial);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplateId]);

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
        });
    void doSave
      .then((id) => { if (typeof id === "string") setSavedPlanoId(id); })
      .catch(() => { setSaveError("Falha ao preparar pré-visualização. Tente novamente."); })
      .finally(() => setIsAutoSaving(false));
  }

  function handleFinalize() {
    if (!savedPlanoId || !selectedTemplate) return;
    setSaveError(null);
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
          setShowSaveSuccess(true);
          setTimeout(() => setShowSaveSuccess(false), 3000);
          setIsFinalized(true);
          // Update pedagogic memory in background (fire-and-forget)
          void fetch("/api/ia/memoria", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conteudo: capturedEditorValues, metadata: metadataValues }),
          }).catch(() => {});
        })
        .catch((err) => {
          setSaveError(err instanceof Error ? err.message : "Falha ao salvar.");
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

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-3">

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
                  onClick={() => { setSelectedTemplateId(t.id); setSelectedEstado(t.estado ?? ""); }}
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

      {/* ── Passo 2: Metadados ─────────────────────────────────────────────── */}
      {currentStep === 1 && selectedTemplate && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-violet-50 p-3 text-violet-600">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-950">Dados do template</h3>
                <p className="text-sm text-slate-500">
                  {allPreFilled
                    ? "Campos pré-preenchidos com os dados salvos — confirme ou edite e avance."
                    : temMetadados(selectedTemplate)
                      ? "Dados salvos detectados — confirme ou edite antes de continuar."
                      : "Preencha os dados fixos do template. Serão reutilizados nos próximos planos."}
                </p>
              </div>
            </div>
            <span className="hidden rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-500 sm:inline">
              {selectedTemplate.nome}
            </span>
          </div>

          {/* Pre-fill banner */}
          {allPreFilled && (
            <div className="mb-5 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <Check className="h-4 w-4 shrink-0 text-emerald-600" />
              <p className="text-sm text-emerald-800">
                <strong>Tudo pré-preenchido!</strong> Os campos foram carregados a partir dos dados salvos no template. Edite se quiser ou clique em <strong>Preencher com a Magis</strong> para continuar.
              </p>
            </div>
          )}

          {/* Título do plano + currículo regional */}
          <div className="mb-5 grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Título do plano</span>
              <span className="ml-1 text-xs text-rose-500">*</span>
              <p className="mt-0.5 text-xs text-slate-400">Será o nome do arquivo ao baixar o plano gerado.</p>
              <input
                type="text"
                value={planoTitulo}
                onChange={(e) => setPlanoTitulo(e.target.value)}
                placeholder="Ex.: Plano de Aula — Banco de Dados — Turma 101 — Mai 2026"
                className="mt-1.5 w-full rounded-2xl border border-orange-300 px-4 py-3 text-sm text-slate-950 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Currículo regional</span>
              <p className="mt-0.5 text-xs text-slate-400">Personaliza sugestões da Magis com o currículo estadual.</p>
              <div className="relative mt-1.5">
                <select
                  value={selectedEstado}
                  onChange={(e) => setSelectedEstado(e.target.value)}
                  className="w-full appearance-none rounded-2xl border border-orange-300 bg-white px-4 py-3 pr-10 text-sm text-slate-950 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                >
                  <option value="">Sem currículo estadual</option>
                  {ESTADOS_BRASIL.map((e) => (
                    <option key={e.uf} value={e.uf}>{e.uf} — {e.nome}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              </div>
            </label>
          </div>

          {manualFields.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
              <p className="text-sm text-slate-500">
                Este template não possui campos manuais extraídos. Continue para o editor.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {manualFields.flatMap((field, idx) => {
                const first2profIdx = manualFields.findIndex(is2profField);
                const items = [];
                if (has2prof && idx === first2profIdx) {
                  items.push(
                    <div key="__2prof_banner" className="col-span-2 flex items-start gap-3 rounded-2xl border border-violet-100 bg-violet-50 px-4 py-3">
                      <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
                      <p className="text-sm text-violet-700">
                        <strong>2° Professor detectado</strong> — a Magis vai incluir sugestões
                        específicas de educação inclusiva (NEE, AEE e adaptações curriculares) no próximo
                        passo.
                      </p>
                    </div>
                  );
                }
                items.push(
                  <label key={field.key} className="block">
                    <span className="text-sm font-medium text-slate-700">{field.label}</span>
                    {field.required && <span className="ml-1 text-xs text-rose-500">*</span>}
                    {field.type === "textarea" ? (
                      <textarea
                        rows={3}
                        value={metadataValues[field.key] ?? ""}
                        onChange={(e) =>
                          setMetadataValues((p) => ({ ...p, [field.key]: e.target.value }))
                        }
                        placeholder={field.placeholder ?? field.label}
                        className="mt-1.5 w-full rounded-2xl border border-orange-300 px-4 py-3 text-sm text-slate-950 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                      />
                    ) : field.type === "number" ? (
                      <input
                        type="number"
                        value={metadataValues[field.key] ?? ""}
                        onChange={(e) =>
                          setMetadataValues((p) => ({ ...p, [field.key]: e.target.value }))
                        }
                        className="mt-1.5 w-full rounded-2xl border border-orange-300 px-4 py-3 text-sm text-slate-950 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                      />
                    ) : (
                      <input
                        type="text"
                        value={metadataValues[field.key] ?? ""}
                        onChange={(e) =>
                          setMetadataValues((p) => ({ ...p, [field.key]: e.target.value }))
                        }
                        placeholder={field.placeholder ?? `Ex.: ${field.label.toLowerCase()}`}
                        className="mt-1.5 w-full rounded-2xl border border-orange-300 px-4 py-3 text-sm text-slate-950 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                      />
                    )}
                  </label>
                );
                return items;
              })}
            </div>
          )}

          <div className="mt-5 border-t border-slate-100 pt-5">
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={saveToTemplate}
                onChange={(e) => setSaveToTemplate(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-600"
              />
              <span className="text-sm text-slate-600">
                Salvar esses dados no template para reutilizar nos próximos planos
              </span>
            </label>
          </div>

          <div className="mt-5 flex items-center justify-between gap-3">
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
              {saveToTemplate ? "Salvar e preencher com a Magis" : "Preencher com a Magis"}
            </button>
          </div>
        </div>
      )}

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
              Revisar plano
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Modal de sucesso — salvo com a Magis ─────────────────────────── */}
      {showSaveSuccess && (
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
              @keyframes magis-progress-plan {
                from { width: 100%; }
                to   { width: 0%; }
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
              <p className="text-sm font-medium leading-relaxed text-slate-800">
                Plano salvo com sucesso! 🎉
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Agora você pode baixar em PDF.
              </p>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-violet-500"
                style={{ animation: "magis-progress-plan 3s linear forwards" }} />
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
                  <button
                    type="button"
                    onClick={() => {
                      if (!savedPlanoId) return;
                      void triggerDownload(`/api/planos/${savedPlanoId}/download?format=pdf`)
                        .then((info) => { if (info) setDownloadLimitInfo(info); })
                        .catch(() => { window.open(`/api/planos/${savedPlanoId}/download?format=pdf`, "_blank"); });
                    }}
                    className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-500"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Baixar PDF
                  </button>
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
