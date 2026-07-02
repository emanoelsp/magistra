"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { BookOpen, Check, Paperclip, Sparkles, Trash2, X } from "lucide-react";

import { PlanGenerationWizard, type RecentPlano, type ResumeData } from "./plan-generation-wizard";
import type { DisciplinaBlock, EscolaRecord, EstudanteRecord, PlanoRegenteRecord, TemplateOption, TurmaRecord } from "../../lib/types/firestore";
import { showMagisToast } from "../../lib/utils/magis-toast";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GerarPlanoFlowProps {
  userId: string;
  userName: string;
  userEmail?: string;
  templates: TemplateOption[];
  escolas: EscolaRecord[];
  turmas: TurmaRecord[];
  estudantes?: EstudanteRecord[];
  canManageEstudantes?: boolean;
  /** Pre-selected student from "Criar PEI" shortcut — auto-selects student and filters to PEI templates. */
  peiEstudanteId?: string;
  peiEstudanteNome?: string;
  /** Pre-loaded library of regente plans (from server or previous session) — kept for the picker inside the editor. */
  planosRegente?: PlanoRegenteRecord[];
  limitsStatus: {
    canCreatePlano: boolean;
    limits: { maxPlanosPerMonth: number };
    currentPlanosThisMonth: number;
    plano: string;
  };
  recentPlanos: RecentPlano[];
  resumeData?: ResumeData;
  preSelectedTemplateId?: string;
  canAssociateEscola?: boolean;
  canUseBulkIa?: boolean;
}

// ---------------------------------------------------------------------------
// Magis modal shell
// ---------------------------------------------------------------------------

function MagisModal({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 pt-8 backdrop-blur-sm"
      style={{ background: "rgba(0,0,0,0.55)" }}
    >
      <style>{`@keyframes magis-pop { from { opacity:0;transform:scale(.85) translateY(24px)} to { opacity:1;transform:scale(1) translateY(0)} }`}</style>
      <div
        className={`flex w-full flex-col overflow-hidden rounded-3xl shadow-2xl ${wide ? "max-w-md" : "max-w-sm"}`}
        style={{ animation: "magis-pop 0.35s cubic-bezier(0.34,1.56,0.64,1) both" }}
      >
        {children}
      </div>
    </div>
  );
}

function MagisHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-3 bg-violet-700 px-5 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20">
        <Sparkles className="h-4 w-4 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white leading-tight">Magis</p>
        <p className="text-[11px] text-violet-300">assistente de planos</p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="flex h-7 w-7 items-center justify-center rounded-full text-white/60 hover:bg-white/20 hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function MagisBubble({ text }: { text: string }) {
  return (
    <div className="flex items-end gap-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-600 shadow-sm mb-0.5">
        <Sparkles className="h-3 w-3 text-white" />
      </div>
      <div className="max-w-[82%]">
        <div className="rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 shadow-sm">
          <p className="text-sm leading-snug text-slate-800">{text}</p>
        </div>
      </div>
    </div>
  );
}

const CURSO_LABELS: Record<string, string> = {
  fundamental: "Ensino Fundamental",
  medio: "Ensino Médio",
  medio_tecnico: "Ensino Médio Técnico",
  superior: "Ensino Superior",
};

// ---------------------------------------------------------------------------
// Intro steps
// ---------------------------------------------------------------------------

type IntroStep = "template" | "estudante" | "regente_planos" | "escola" | "curso" | "turma" | "nome_plano";
type Phase = "intro" | "wizard";

export function GerarPlanoFlow({
  userId,
  userName,
  userEmail,
  templates,
  escolas,
  turmas,
  estudantes = [],
  canManageEstudantes = false,
  peiEstudanteId,
  peiEstudanteNome,
  planosRegente: initialPlanosRegenteFromProps = [],
  recentPlanos,
  resumeData,
  preSelectedTemplateId,
  canAssociateEscola = true,
  canUseBulkIa = true,
}: GerarPlanoFlowProps) {
  const skipIntro = !!resumeData || !!preSelectedTemplateId;
  const hasPeiShortcut = !!peiEstudanteId;

  const [phase, setPhase] = useState<Phase>(skipIntro ? "wizard" : "intro");
  const [introStep, setIntroStep] = useState<IntroStep>("template");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(preSelectedTemplateId ?? "");
  const [selectedEscolaId, setSelectedEscolaId] = useState<string>("");
  const [selectedCursoTipo, setSelectedCursoTipo] = useState<string>("");
  const [selectedDisciplina, setSelectedDisciplina] = useState<string>("");
  const [selectedTurmaId, setSelectedTurmaId] = useState<string>("");
  const [selectedEstudanteId, setSelectedEstudanteId] = useState<string>(peiEstudanteId ?? "");
  const [planosRegente, setPlanosRegente] = useState<PlanoRegenteRecord[]>(initialPlanosRegenteFromProps);
  const [disciplinaBlocks, setDisciplinaBlocks] = useState<DisciplinaBlock[]>([]);
  const [uploadingRegente, setUploadingRegente] = useState(false);
  const regenteInputRef = useRef<HTMLInputElement>(null);
  const [planoTitulo, setPlanoTitulo] = useState<string>("");
  const [templateHasEscola, setTemplateHasEscola] = useState(false);

  const activeTemplates = templates.filter((t) => !t.deletado);
  const visibleTemplates = hasPeiShortcut
    ? activeTemplates.filter((t) => t.template_type === "plano_educacional_individualizado")
    : activeTemplates;

  const selectedEscola = escolas.find((e) => e.id === selectedEscolaId) ?? null;
  const escolaCursos = selectedEscola?.cursos ?? [];
  const escolaTurmas = turmas.filter((t) => t.escola_id === selectedEscolaId && (
    !selectedCursoTipo || t.tipo_curso === selectedCursoTipo
  ));

  function buildSuggestedTitle() {
    const tpl = activeTemplates.find((t) => t.id === selectedTemplateId);
    const isPei = tpl?.template_type === "plano_educacional_individualizado";
    const estudante = estudantes.find((e) => e.id === selectedEstudanteId);
    const estudanteNome = estudante?.nome ?? peiEstudanteNome;
    if (isPei && estudanteNome) {
      return `Plano Educacional Individualizado - ${estudanteNome}`;
    }
    const parts: string[] = ["Plano de aula"];
    const escolaNome = tpl?.escolaNome || selectedEscola?.nome;
    if (escolaNome) parts.push(escolaNome);
    const disc = selectedDisciplina || turmas.find((t) => t.id === selectedTurmaId)?.disciplina;
    if (disc) parts.push(disc);
    const turma = turmas.find((t) => t.id === selectedTurmaId);
    if (turma) parts.push(turma.nome);
    return parts.join(" - ");
  }

  function goToNomePlano() {
    setPlanoTitulo(buildSuggestedTitle());
    setIntroStep("nome_plano");
  }

  function afterEscolaNext(escolaId: string) {
    if (!escolaId) {
      goToNomePlano();
      return;
    }
    const escola = escolas.find((e) => e.id === escolaId);
    if (escola?.cursos?.length) {
      setIntroStep("curso");
    } else {
      setIntroStep("turma");
    }
  }

  // ---------------------------------------------------------------------------
  // Wizard phase
  // ---------------------------------------------------------------------------

  if (phase === "wizard") {
    const estudante = estudantes.find((e) => e.id === selectedEstudanteId);
    return (
      <PlanGenerationWizard
        userId={userId}
        userName={userName}
        userEmail={userEmail}
        availableTemplates={templates}
        preSelectedTemplateId={selectedTemplateId || undefined}
        recentPlanos={recentPlanos}
        resumeData={resumeData}
        turmas={turmas}
        fromIntroModal={!skipIntro}
        initialPlanoTitulo={skipIntro ? undefined : planoTitulo}
        initialEscolaId={skipIntro ? undefined : selectedEscolaId}
        initialTurmaId={skipIntro ? undefined : selectedTurmaId}
        initialDisciplina={skipIntro ? undefined : selectedDisciplina}
        initialEstudanteId={skipIntro ? undefined : (selectedEstudanteId || undefined)}
        initialEstudanteNome={skipIntro ? undefined : (estudante?.nome ?? peiEstudanteNome ?? undefined)}
        initialEstudante={skipIntro ? undefined : (estudante ?? undefined)}
        estudantes={estudantes}
        initialPlanosRegente={planosRegente.length > 0 ? planosRegente : undefined}
        disciplinaBlocks={disciplinaBlocks.length > 0 ? disciplinaBlocks : undefined}
        canAssociateEscola={canAssociateEscola}
        canUseBulkIa={canUseBulkIa}
      />
    );
  }

  // ---------------------------------------------------------------------------
  // Intro — Step: template
  // ---------------------------------------------------------------------------

  if (introStep === "template") {
    if (visibleTemplates.length === 0) {
      return (
        <MagisModal>
          <MagisHeader onClose={() => setPhase("wizard")} />
          <div className="bg-[#ece5dd] px-4 py-5 space-y-2">
            {hasPeiShortcut ? (
              <MagisBubble text="Você ainda não tem templates de Plano Educacional Individualizado. Cadastre um template PEI primeiro." />
            ) : (
              <MagisBubble text="Você ainda não tem templates cadastrados. Vamos criar o primeiro?" />
            )}
          </div>
          <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 space-y-2">
            <Link
              href="/dashboard/templates"
              className="flex w-full items-center justify-center rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Ir para Meus templates →
            </Link>
            <Link
              href="/dashboard"
              className="flex w-full items-center justify-center rounded-2xl border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Voltar ao dashboard
            </Link>
          </div>
        </MagisModal>
      );
    }

    return (
      <MagisModal>
        <MagisHeader onClose={() => setPhase("wizard")} />
        <div className="bg-[#ece5dd] px-4 py-5 space-y-2">
          {hasPeiShortcut ? (
            <MagisBubble text={`Vou criar um Plano Educacional Individualizado para ${peiEstudanteNome ?? "o estudante"}. Qual template PEI você quer usar?`} />
          ) : (
            <MagisBubble text="Vi que você tem templates cadastrados! Qual deles você quer usar nesse plano?" />
          )}
        </div>
        <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 space-y-3">
          <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
            {visibleTemplates.map((t) => (
              <label
                key={t.id}
                className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-2.5 cursor-pointer hover:bg-slate-50"
              >
                <input
                  type="radio"
                  name="template"
                  value={t.id}
                  checked={selectedTemplateId === t.id}
                  onChange={() => setSelectedTemplateId(t.id)}
                  className="h-4 w-4 accent-violet-600 shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{t.nome}</p>
                  {t.escolaNome && (
                    <p className="text-xs text-slate-400 truncate">{t.escolaNome}</p>
                  )}
                </div>
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              if (!selectedTemplateId) return;
              const tpl = activeTemplates.find((t) => t.id === selectedTemplateId);
              // When coming from PEI shortcut, student already selected — skip estudante step
              if (tpl?.template_type === "plano_educacional_individualizado" && canManageEstudantes) {
                if (hasPeiShortcut) {
                  setIntroStep("regente_planos");
                } else {
                  setIntroStep("estudante");
                }
                return;
              }
              if (!canAssociateEscola) {
                setTemplateHasEscola(false);
                goToNomePlano();
              } else if (tpl?.escolaNome) {
                const match = escolas.find((e) => e.nome === tpl.escolaNome);
                const newEscolaId = match?.id ?? "";
                if (match) setSelectedEscolaId(newEscolaId);
                setTemplateHasEscola(true);
                afterEscolaNext(newEscolaId);
              } else {
                setTemplateHasEscola(false);
                setIntroStep("escola");
              }
            }}
            disabled={!selectedTemplateId}
            className="w-full rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            Próximo →
          </button>
        </div>
      </MagisModal>
    );
  }

  // ---------------------------------------------------------------------------
  // Intro — Step: estudante (PEI flow — B-12)
  // ---------------------------------------------------------------------------

  if (introStep === "estudante") {
    const NIVEL_LABELS: Record<string, string> = { baixo: "Baixo suporte", medio: "Médio suporte", alto: "Alto suporte" };
    return (
      <MagisModal wide>
        <MagisHeader onClose={() => setPhase("wizard")} />
        <div className="bg-[#ece5dd] px-4 py-5 space-y-2">
          <MagisBubble text="Este é um Plano Educacional Individualizado (2º Professor). Para qual estudante você vai criar o plano?" />
          {estudantes.length === 0 && (
            <MagisBubble text="Você ainda não tem estudantes cadastrados. Cadastre o aluno antes de criar o plano." />
          )}
        </div>
        <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 space-y-3">
          {estudantes.length > 0 ? (
            <>
              <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                {estudantes.map((est) => (
                  <label
                    key={est.id}
                    className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-2.5 cursor-pointer hover:bg-slate-50"
                  >
                    <input
                      type="radio"
                      name="estudante"
                      value={est.id}
                      checked={selectedEstudanteId === est.id}
                      onChange={() => setSelectedEstudanteId(est.id)}
                      className="h-4 w-4 accent-indigo-600 shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{est.nome}</p>
                      <div className="flex flex-wrap gap-1.5 mt-0.5">
                        {est.nivel_suporte && (
                          <span className="text-xs text-slate-400">{NIVEL_LABELS[est.nivel_suporte] ?? est.nivel_suporte}</span>
                        )}
                        {est.cid && (
                          <span className="text-xs text-slate-400">· CID {est.cid}</span>
                        )}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!selectedEstudanteId) return;
                  setIntroStep("regente_planos");
                }}
                disabled={!selectedEstudanteId}
                className="w-full rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50 hover:bg-indigo-500 transition"
              >
                Próximo →
              </button>
            </>
          ) : (
            <Link
              href="/dashboard/estudantes"
              className="flex w-full items-center justify-center rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-500 transition"
            >
              Cadastrar estudante →
            </Link>
          )}
          <button
            type="button"
            onClick={() => setIntroStep("template")}
            className="w-full rounded-2xl border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ← Voltar
          </button>
        </div>
      </MagisModal>
    );
  }

  // ---------------------------------------------------------------------------
  // Intro — Step: regente_planos (PEI — upload + IA extração por disciplina)
  // ---------------------------------------------------------------------------

  if (introStep === "regente_planos") {
    async function handleRegenteUpload(files: File[]) {
      if (!files.length) return;
      setUploadingRegente(true);
      try {
        const fd = new FormData();
        files.forEach((f) => fd.append("files", f));
        const res = await fetch("/api/planos-regente?nosave=true", { method: "POST", body: fd });
        const data = (await res.json()) as { ok?: boolean; blocos?: DisciplinaBlock[]; errors?: { arquivo: string; erro: string }[] };
        if (data.blocos?.length) {
          setDisciplinaBlocks((prev) => {
            const existingNames = new Set(prev.map((b) => b.arquivo_nome));
            const novos = (data.blocos ?? []).filter((b) => !existingNames.has(b.arquivo_nome));
            return [...prev, ...novos];
          });
          showMagisToast(`${data.blocos.length} plano(s) extraído(s)!`, "success");
        }
        if (data.errors?.length) {
          data.errors.forEach((e) => showMagisToast(`${e.arquivo}: ${e.erro}`, "error"));
        }
      } catch {
        showMagisToast("Erro ao processar arquivos.", "error");
      } finally {
        setUploadingRegente(false);
      }
    }

    return (
      <MagisModal wide>
        <MagisHeader onClose={() => setPhase("wizard")} />
        <div className="bg-[#ece5dd] px-4 py-5 space-y-2">
          <MagisBubble text="Envie os planos de ensino dos professores regentes (PDF ou DOCX). Podem ser vários de uma vez." />
          <MagisBubble text="A IA extrai os campos por disciplina e já monta os blocos da Seção 3 no editor do PEI — um bloco por disciplina, com habilidades e conteúdo da turma pré-preenchidos." />
        </div>
        <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 space-y-3">
          {/* Drop zone */}
          <div
            className="relative flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition"
            onClick={() => regenteInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const dropped = Array.from(e.dataTransfer.files).filter((f) =>
                /\.(pdf|docx|doc)$/i.test(f.name)
              );
              if (dropped.length) void handleRegenteUpload(dropped);
            }}
          >
            <input
              ref={regenteInputRef}
              type="file"
              accept=".pdf,.docx,.doc"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length) void handleRegenteUpload(files);
                e.target.value = "";
              }}
            />
            <Paperclip className="h-5 w-5 text-slate-400" />
            <p className="text-sm font-medium text-slate-600">
              {uploadingRegente ? "Extraindo conteúdo com IA…" : "Arraste ou clique · vários arquivos de uma vez"}
            </p>
            <p className="text-xs text-slate-400">PDF, DOCX · máx. 10 MB cada</p>
          </div>

          {/* Extracted discipline blocks list */}
          {disciplinaBlocks.length > 0 && (
            <ul className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
              {disciplinaBlocks.map((b, i) => (
                <li key={`${b.arquivo_nome}-${i}`} className="flex items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs">
                  <BookOpen className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
                  <span className="font-semibold text-indigo-700">{b.disciplina}</span>
                  {b.professor && <span className="text-slate-500">· {b.professor}</span>}
                  <span className="truncate text-slate-400 ml-auto">{b.arquivo_nome}</span>
                  <span className="shrink-0 flex items-center gap-0.5 text-emerald-600">
                    <Check className="h-3 w-3" />
                    extraído
                  </span>
                  <button
                    type="button"
                    onClick={() => setDisciplinaBlocks((prev) => prev.filter((_, j) => j !== i))}
                    className="shrink-0 text-slate-400 hover:text-rose-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={() => goToNomePlano()}
            className="w-full rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 transition"
          >
            {disciplinaBlocks.length > 0 ? `Continuar com ${disciplinaBlocks.length} disciplina(s) →` : "Pular →"}
          </button>
          <button
            type="button"
            onClick={() => setIntroStep(hasPeiShortcut ? "template" : "estudante")}
            className="w-full rounded-2xl border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ← Voltar
          </button>
        </div>
      </MagisModal>
    );
  }

  // ---------------------------------------------------------------------------
  // Intro — Step: escola
  // ---------------------------------------------------------------------------

  if (introStep === "escola") {
    return (
      <MagisModal wide>
        <MagisHeader onClose={() => setPhase("wizard")} />
        <div className="bg-[#ece5dd] px-4 py-5 space-y-2">
          <MagisBubble text="Deseja associar esse plano a uma escola?" />
          {escolas.length === 0 && (
            <MagisBubble text="Você ainda não tem escolas cadastradas." />
          )}
        </div>
        <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 space-y-3">
          {escolas.length > 0 && (
            <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
              <label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-2.5 cursor-pointer hover:bg-slate-50">
                <input
                  type="radio"
                  name="escola"
                  value=""
                  checked={selectedEscolaId === ""}
                  onChange={() => { setSelectedEscolaId(""); setSelectedTurmaId(""); }}
                  className="h-4 w-4 accent-violet-600 shrink-0"
                />
                <span className="text-sm font-medium text-slate-500 italic">Sem escola específica</span>
              </label>
              {escolas.map((escola) => (
                <label
                  key={escola.id}
                  className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-2.5 cursor-pointer hover:bg-slate-50"
                >
                  <input
                    type="radio"
                    name="escola"
                    value={escola.id}
                    checked={selectedEscolaId === escola.id}
                    onChange={() => { setSelectedEscolaId(escola.id); setSelectedTurmaId(""); setSelectedCursoTipo(""); }}
                    className="h-4 w-4 accent-violet-600 shrink-0"
                  />
                  <span className="text-sm font-medium text-slate-800">{escola.nome}</span>
                </label>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setIntroStep("template")}
              className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              ← Voltar
            </button>
            <button
              type="button"
              onClick={() => afterEscolaNext(selectedEscolaId)}
              className="flex-1 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-medium text-white"
            >
              {escolas.length === 0 ? "Pular →" : "Próximo →"}
            </button>
          </div>
        </div>
      </MagisModal>
    );
  }

  // ---------------------------------------------------------------------------
  // Intro — Step: curso
  // ---------------------------------------------------------------------------

  if (introStep === "curso") {
    return (
      <MagisModal wide>
        <MagisHeader onClose={() => setPhase("wizard")} />
        <div className="bg-[#ece5dd] px-4 py-5 space-y-2">
          <MagisBubble text={`Qual curso está relacionado a essa aula em ${selectedEscola?.nome ?? "sua escola"}?`} />
        </div>
        <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 space-y-3">
          <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
            <label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-2.5 cursor-pointer hover:bg-slate-50">
              <input
                type="radio"
                name="curso"
                value=""
                checked={selectedCursoTipo === ""}
                onChange={() => setSelectedCursoTipo("")}
                className="h-4 w-4 accent-violet-600 shrink-0"
              />
              <span className="text-sm font-medium text-slate-500 italic">Sem curso específico</span>
            </label>
            {escolaCursos.map((curso, i) => {
              const label = CURSO_LABELS[curso.tipo] ?? curso.tipo;
              const display = curso.nome ? `${label} — ${curso.nome}` : label;
              return (
                <label
                  key={i}
                  className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-2.5 cursor-pointer hover:bg-slate-50"
                >
                  <input
                    type="radio"
                    name="curso"
                    value={curso.tipo}
                    checked={selectedCursoTipo === curso.tipo}
                    onChange={() => setSelectedCursoTipo(curso.tipo)}
                    className="h-4 w-4 accent-violet-600 shrink-0"
                  />
                  <span className="text-sm font-medium text-slate-800">{display}</span>
                </label>
              );
            })}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setIntroStep(templateHasEscola ? "template" : "escola")}
              className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              ← Voltar
            </button>
            <button
              type="button"
              onClick={() => setIntroStep("turma")}
              className="flex-1 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-medium text-white"
            >
              Próximo →
            </button>
          </div>
        </div>
      </MagisModal>
    );
  }

  // ---------------------------------------------------------------------------
  // Intro — Step: turma
  // ---------------------------------------------------------------------------

  if (introStep === "turma") {
    return (
      <MagisModal wide>
        <MagisHeader onClose={() => setPhase("wizard")} />
        <div className="bg-[#ece5dd] px-4 py-5 space-y-2">
          <MagisBubble text="Para qual turma é esse plano?" />
          {escolaTurmas.length === 0 && selectedEscolaId && (
            <MagisBubble text="Nenhuma turma cadastrada para esta escola ainda." />
          )}
        </div>
        <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 space-y-3">
          <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
            <label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-2.5 cursor-pointer hover:bg-slate-50">
              <input
                type="radio"
                name="turma"
                value=""
                checked={selectedTurmaId === ""}
                onChange={() => setSelectedTurmaId("")}
                className="h-4 w-4 accent-violet-600 shrink-0"
              />
              <span className="text-sm font-medium text-slate-500 italic">Sem turma específica</span>
            </label>
            {escolaTurmas.map((t) => (
              <label
                key={t.id}
                className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-2.5 cursor-pointer hover:bg-slate-50"
              >
                <input
                  type="radio"
                  name="turma"
                  value={t.id}
                  checked={selectedTurmaId === t.id}
                  onChange={() => {
                    setSelectedTurmaId(t.id);
                    setSelectedDisciplina(t.disciplina ?? "");
                  }}
                  className="h-4 w-4 accent-violet-600 shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{t.nome}</p>
                  {t.disciplina && <p className="text-xs text-slate-400 truncate">{t.disciplina}</p>}
                </div>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setIntroStep(escolaCursos.length > 0 ? "curso" : templateHasEscola ? "template" : "escola")}
              className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              ← Voltar
            </button>
            <button
              type="button"
              onClick={goToNomePlano}
              className="flex-1 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-medium text-white"
            >
              {selectedTurmaId ? "Próximo →" : "Pular →"}
            </button>
          </div>
        </div>
      </MagisModal>
    );
  }

  // ---------------------------------------------------------------------------
  // Intro — Step: nome do plano
  // ---------------------------------------------------------------------------

  return (
    <MagisModal>
      <MagisHeader onClose={() => setPhase("wizard")} />
      <div className="bg-[#ece5dd] px-4 py-5 space-y-2">
        <MagisBubble text="Vou criar o plano com esse nome — se desejar alterar, é só editar abaixo!" />
      </div>
      <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 space-y-3">
        <input
          type="text"
          value={planoTitulo}
          onChange={(e) => setPlanoTitulo(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && planoTitulo.trim()) setPhase("wizard"); }}
          placeholder="Ex.: Plano de aula - Escola - Turma"
          className="w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-slate-950"
          autoFocus
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setIntroStep("turma")}
            className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ← Voltar
          </button>
          <button
            type="button"
            onClick={() => { if (planoTitulo.trim()) setPhase("wizard"); }}
            disabled={!planoTitulo.trim()}
            className="flex-1 rounded-2xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
          >
            Começar ✨
          </button>
        </div>
      </div>
    </MagisModal>
  );
}
