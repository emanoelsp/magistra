"use client";

import { useState } from "react";
import Link from "next/link";
import { Sparkles, X } from "lucide-react";

import { PlanGenerationWizard, type RecentPlano, type ResumeData } from "./plan-generation-wizard";
import type { EscolaRecord, TemplateOption, TurmaRecord } from "../../lib/types/firestore";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GerarPlanoFlowProps {
  userId: string;
  userName: string;
  templates: TemplateOption[];
  escolas: EscolaRecord[];
  turmas: TurmaRecord[];
  limitsStatus: {
    canCreatePlano: boolean;
    limits: { maxPlanosPerMonth: number };
    currentPlanosThisMonth: number;
    plano: string;
  };
  recentPlanos: RecentPlano[];
  resumeData?: ResumeData;
  preSelectedTemplateId?: string;
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

type IntroStep = "template" | "escola" | "curso" | "turma" | "nome_plano";
type Phase = "intro" | "wizard";

export function GerarPlanoFlow({
  userId,
  userName,
  templates,
  escolas,
  turmas,
  recentPlanos,
  resumeData,
  preSelectedTemplateId,
}: GerarPlanoFlowProps) {
  const skipIntro = !!resumeData || !!preSelectedTemplateId;

  const [phase, setPhase] = useState<Phase>(skipIntro ? "wizard" : "intro");
  const [introStep, setIntroStep] = useState<IntroStep>("template");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(preSelectedTemplateId ?? "");
  const [selectedEscolaId, setSelectedEscolaId] = useState<string>("");
  const [selectedCursoTipo, setSelectedCursoTipo] = useState<string>("");
  const [selectedDisciplina, setSelectedDisciplina] = useState<string>("");
  const [selectedTurmaId, setSelectedTurmaId] = useState<string>("");
  const [planoTitulo, setPlanoTitulo] = useState<string>("");
  const [templateHasEscola, setTemplateHasEscola] = useState(false);

  const activeTemplates = templates.filter((t) => !t.deletado);

  const selectedEscola = escolas.find((e) => e.id === selectedEscolaId) ?? null;
  const escolaCursos = selectedEscola?.cursos ?? [];
  const escolaTurmas = turmas.filter((t) => t.escola_id === selectedEscolaId && (
    !selectedCursoTipo || t.tipo_curso === selectedCursoTipo
  ));

  function buildSuggestedTitle() {
    const parts: string[] = ["Plano de aula"];
    const tpl = activeTemplates.find((t) => t.id === selectedTemplateId);
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
    return (
      <PlanGenerationWizard
        userId={userId}
        userName={userName}
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
      />
    );
  }

  // ---------------------------------------------------------------------------
  // Intro — Step: template
  // ---------------------------------------------------------------------------

  if (introStep === "template") {
    if (activeTemplates.length === 0) {
      return (
        <MagisModal>
          <MagisHeader onClose={() => setPhase("wizard")} />
          <div className="bg-[#ece5dd] px-4 py-5 space-y-2">
            <MagisBubble text="Você ainda não tem templates cadastrados. Vamos criar o primeiro?" />
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
          <MagisBubble text="Vi que você tem templates cadastrados! Qual deles você quer usar nesse plano?" />
        </div>
        <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 space-y-3">
          <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
            {activeTemplates.map((t) => (
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
              if (tpl?.escolaNome) {
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
