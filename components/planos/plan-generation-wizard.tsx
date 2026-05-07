"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BookCheck,
  Check,
  Download,
  FileText,
  LoaderCircle,
  Save,
  Sparkles,
} from "lucide-react";

import { PlanEditor, type PlanEditorHandle } from "./plan-editor";
import { planosService } from "../../lib/services/firestore/planos.service";
import { templatesService } from "../../lib/services/firestore/templates.service";
import type { TemplateFieldSchema, TemplateOption, TemplateRecord } from "../../lib/types/firestore";

interface PlanGenerationWizardProps {
  userId: string;
  userName: string;
  availableTemplates: TemplateOption[];
  preSelectedTemplateId?: string;
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
  { id: 1, title: "Escolher template",   description: "Selecione o modelo base do plano." },
  { id: 2, title: "Metadados",            description: "Confirme os dados fixos do template." },
  { id: 3, title: "Preencher e sugerir", description: "Edite campos e receba sugestões da IA." },
  { id: 4, title: "Revisar e salvar",    description: "Pré-visualize e salve o plano." },
] as const;

export function PlanGenerationWizard({
  userId,
  userName,
  availableTemplates,
  preSelectedTemplateId,
}: PlanGenerationWizardProps) {
  const router = useRouter();

  // Determina passo inicial: se veio com template pré-selecionado, pula p/ step 1 (metadados)
  const initialStep = preSelectedTemplateId ? 1 : 0;
  const initialId = preSelectedTemplateId ?? availableTemplates[0]?.id ?? "";

  const [currentStep, setCurrentStep] = useState(initialStep);
  const [selectedTemplateId, setSelectedTemplateId] = useState(initialId);
  const [planoTitulo, setPlanoTitulo] = useState("");
  const [metadataValues, setMetadataValues] = useState<Record<string, string>>({});
  const [saveToTemplate, setSaveToTemplate] = useState(true);
  const [capturedEditorValues, setCapturedEditorValues] = useState<Record<string, string>>({});
  const [savedPlanoId, setSavedPlanoId] = useState<string | null>(null);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [isFinalized, setIsFinalized] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSavingMeta, startSavingMeta] = useTransition();
  const [isPending, startTransition] = useTransition();

  const editorRef = useRef<PlanEditorHandle>(null);

  const selectedTemplate = availableTemplates.find((t) => t.id === selectedTemplateId) ?? null;

  // Monta templateRecord para o PlanEditor
  const templateRecord: TemplateRecord | null = selectedTemplate
    ? {
        id: selectedTemplate.id,
        user_id: userId,
        nome: selectedTemplate.nome,
        escola_nome: selectedTemplate.escolaNome ?? null,
        tipo_plano: selectedTemplate.tipoPlano ?? null,
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

  // Quando template muda, pré-popula metadados com o que está salvo
  useEffect(() => {
    if (!selectedTemplate) return;
    const saved = selectedTemplate.metadata_padrao ?? {};
    const initial: Record<string, string> = {};

    for (const f of manualFields) {
      initial[f.key] = saved[f.key] ?? "";
    }
    // Escola já extraída do template → preenche campo de escola se existir
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

  function handleFinalize(download: boolean) {
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
          setIsFinalized(true);
          if (download) window.open(`/api/planos/${savedPlanoId}/download`, "_blank");
        })
        .catch((err) => {
          setSaveError(err instanceof Error ? err.message : "Falha ao salvar.");
        });
    });
  }

  function handleGoToHistory() {
    router.push("/dashboard/historico");
    router.refresh();
  }

  // ── Initial values para o editor ───────────────────────────────────────────

  const editorInitialValues: Record<string, string> = {
    ...metadataValues,
    ...(Object.keys(capturedEditorValues).length > 0 ? capturedEditorValues : {}),
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-3">

      {/* ── Barra de progresso ─────────────────────────────────────────────── */}
      <div className="flex gap-2">
        {STEPS.map((step, index) => {
          const isCompleted = index < currentStep;
          const isCurrent = index === currentStep;
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
                  onClick={() => setSelectedTemplateId(t.id)}
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
                  {temMetadados(selectedTemplate)
                    ? "Metadados salvos detectados — confirme ou edite antes de continuar."
                    : "Preencha os dados fixos do template. Serão reutilizados nos próximos planos."}
                </p>
              </div>
            </div>
            <span className="hidden rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-500 sm:inline">
              {selectedTemplate.nome}
            </span>
          </div>

          {/* Título do plano — usado como nome do arquivo gerado */}
          <div className="mb-5">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Título do plano</span>
              <span className="ml-1 text-xs text-rose-500">*</span>
              <p className="mt-0.5 text-xs text-slate-400">Será o nome do arquivo ao baixar o plano gerado.</p>
              <input
                type="text"
                value={planoTitulo}
                onChange={(e) => setPlanoTitulo(e.target.value)}
                placeholder="Ex.: Plano de Aula — Banco de Dados — Turma 101 — Mai 2026"
                className="mt-1.5 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-950 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              />
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
              {manualFields.map((field) => (
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
                      className="mt-1.5 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-950 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                    />
                  ) : field.type === "number" ? (
                    <input
                      type="number"
                      value={metadataValues[field.key] ?? ""}
                      onChange={(e) =>
                        setMetadataValues((p) => ({ ...p, [field.key]: e.target.value }))
                      }
                      className="mt-1.5 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-950 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                    />
                  ) : (
                    <input
                      type="text"
                      value={metadataValues[field.key] ?? ""}
                      onChange={(e) =>
                        setMetadataValues((p) => ({ ...p, [field.key]: e.target.value }))
                      }
                      placeholder={field.placeholder ?? `Ex.: ${field.label.toLowerCase()}`}
                      className="mt-1.5 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-950 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                    />
                  )}
                </label>
              ))}
            </div>
          )}

          {has2prof && (
            <div className="mt-5 flex items-start gap-3 rounded-2xl border border-violet-100 bg-violet-50 px-4 py-3">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
              <p className="text-sm text-violet-700">
                <strong>2° Professor detectado</strong> — o assistente vai incluir sugestões
                específicas de educação inclusiva (NEE, AEE e adaptações curriculares) no próximo
                passo.
              </p>
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
                <ArrowRight className="h-4 w-4" />
              )}
              {saveToTemplate ? "Salvar e continuar" : "Continuar"}
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
              Preencha os campos e use o assistente de IA para sugestões.
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
                    onClick={() => savedPlanoId && window.open(`/api/planos/${savedPlanoId}/download`, "_blank")}
                    className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-500"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Baixar PDF
                  </button>
                  <button
                    type="button"
                    onClick={handleGoToHistory}
                    className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-950"
                  >
                    Ver histórico
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={goBack}
                    disabled={isPending || isAutoSaving}
                    className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-950 disabled:opacity-50"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFinalize(false)}
                    disabled={isPending || isAutoSaving || !savedPlanoId}
                    className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-950 disabled:opacity-50"
                  >
                    {isPending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    Salvar
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFinalize(true)}
                    disabled={isPending || isAutoSaving || !savedPlanoId}
                    className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {isPending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                    Salvar e baixar PDF
                  </button>
                </>
              )}
            </div>
          </div>

          {saveError && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
              <p className="text-sm text-rose-700">{saveError}</p>
            </div>
          )}

          {/* Preview iframe — igual ao "ver detalhes do plano" */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" style={{ height: "72vh" }}>
            {isAutoSaving || !savedPlanoId ? (
              <div className="flex h-full items-center justify-center gap-3 text-slate-500">
                <LoaderCircle className="h-5 w-5 animate-spin text-violet-500" />
                <span className="text-sm">Preparando pré-visualização…</span>
              </div>
            ) : (
              <iframe
                key={savedPlanoId}
                src={`/api/planos/${savedPlanoId}/preview`}
                className="h-full w-full"
                title="Pré-visualização do plano"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
