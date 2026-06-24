"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, Sparkles, X } from "lucide-react";

import { PlanGenerationWizard, type RecentPlano, type ResumeData } from "./plan-generation-wizard";
import type { EscolaRecord, TemplateOption, TurmaRecord } from "../../lib/types/firestore";
import { ESTADOS_BRASIL } from "../../lib/constants/estados-brasil";

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

// ---------------------------------------------------------------------------
// Intro steps
// ---------------------------------------------------------------------------

type IntroStep = "template" | "escola" | "nome_plano" | "curriculo";
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
  const [selectedTurmaId, setSelectedTurmaId] = useState<string>("");
  const [planoTitulo, setPlanoTitulo] = useState<string>("");
  const [selectedEstado, setSelectedEstado] = useState<string>("");

  const activeTemplates = templates.filter((t) => !t.deletado);

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
        initialEstado={skipIntro ? undefined : selectedEstado}
        initialEscolaId={skipIntro ? undefined : selectedEscolaId}
        initialTurmaId={skipIntro ? undefined : selectedTurmaId}
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
            onClick={() => { if (selectedTemplateId) setIntroStep("escola"); }}
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
  // Intro — Step: escola + turma
  // ---------------------------------------------------------------------------

  if (introStep === "escola") {
    const escolaTurmas = turmas.filter((t) => t.escola_id === selectedEscolaId);

    return (
      <MagisModal wide>
        <MagisHeader onClose={() => setPhase("wizard")} />
        <div className="bg-[#ece5dd] px-4 py-5 space-y-2">
          <MagisBubble text="Deseja associar esse plano a uma escola e turma específica?" />
          {escolas.length === 0 && (
            <MagisBubble text="Você ainda não tem escolas cadastradas." />
          )}
        </div>
        <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 space-y-3">
          {escolas.length > 0 && (
            <>
              <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
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
                      onChange={() => { setSelectedEscolaId(escola.id); setSelectedTurmaId(""); }}
                      className="h-4 w-4 accent-violet-600 shrink-0"
                    />
                    <span className="text-sm font-medium text-slate-800">{escola.nome}</span>
                  </label>
                ))}
              </div>

              {/* Turma sub-selection */}
              {selectedEscolaId && escolaTurmas.length > 0 && (
                <div className="rounded-2xl border border-violet-100 bg-violet-50 px-3 py-3">
                  <p className="mb-2 text-xs font-semibold text-violet-600">Turma (opcional)</p>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    <label className="flex items-center gap-2 rounded-xl px-2 py-1.5 cursor-pointer hover:bg-violet-100">
                      <input
                        type="radio"
                        name="turma"
                        value=""
                        checked={selectedTurmaId === ""}
                        onChange={() => setSelectedTurmaId("")}
                        className="h-3.5 w-3.5 accent-violet-600 shrink-0"
                      />
                      <span className="text-xs text-slate-500 italic">Nenhuma turma específica</span>
                    </label>
                    {escolaTurmas.map((t) => (
                      <label
                        key={t.id}
                        className="flex items-center gap-2 rounded-xl px-2 py-1.5 cursor-pointer hover:bg-violet-100"
                      >
                        <input
                          type="radio"
                          name="turma"
                          value={t.id}
                          checked={selectedTurmaId === t.id}
                          onChange={() => setSelectedTurmaId(t.id)}
                          className="h-3.5 w-3.5 accent-violet-600 shrink-0"
                        />
                        <span className="text-xs font-medium text-slate-700">
                          {t.nome}{t.disciplina ? ` · ${t.disciplina}` : ""}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </>
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
              onClick={() => setIntroStep("nome_plano")}
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
  // Intro — Step: nome do plano
  // ---------------------------------------------------------------------------

  if (introStep === "nome_plano") {
    return (
      <MagisModal>
        <MagisHeader onClose={() => setPhase("wizard")} />
        <div className="bg-[#ece5dd] px-4 py-5 space-y-2">
          <MagisBubble text="Como você quer chamar esse plano?" />
          <MagisBubble text="Esse nome vai aparecer no arquivo PDF ao baixar." />
        </div>
        <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 space-y-3">
          <input
            type="text"
            value={planoTitulo}
            onChange={(e) => setPlanoTitulo(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && planoTitulo.trim()) setIntroStep("curriculo"); }}
            placeholder="Ex.: Plano — Banco de Dados — Jun 2026"
            className="w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-slate-950"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setIntroStep("escola")}
              className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              ← Voltar
            </button>
            <button
              type="button"
              onClick={() => { if (planoTitulo.trim()) setIntroStep("curriculo"); }}
              disabled={!planoTitulo.trim()}
              className="flex-1 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              Próximo →
            </button>
          </div>
        </div>
      </MagisModal>
    );
  }

  // ---------------------------------------------------------------------------
  // Intro — Step: currículo estadual
  // ---------------------------------------------------------------------------

  return (
    <MagisModal>
      <MagisHeader onClose={() => setPhase("wizard")} />
      <div className="bg-[#ece5dd] px-4 py-5 space-y-2">
        <MagisBubble text="Seu estado usa algum currículo específico?" />
        <MagisBubble text="Vou alinhar minhas sugestões ao currículo da sua região!" />
      </div>
      <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 space-y-3">
        <div className="relative">
          <select
            value={selectedEstado}
            onChange={(e) => setSelectedEstado(e.target.value)}
            className="w-full appearance-none rounded-2xl border border-slate-300 bg-white px-4 py-2.5 pr-10 text-sm outline-none focus:border-slate-950"
          >
            <option value="">Sem currículo estadual</option>
            {ESTADOS_BRASIL.map((e) => (
              <option key={e.uf} value={e.uf}>{e.uf} — {e.nome}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setIntroStep("nome_plano")}
            className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ← Voltar
          </button>
          <button
            type="button"
            onClick={() => setPhase("wizard")}
            className="flex-1 rounded-2xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-500"
          >
            Começar ✨
          </button>
        </div>
      </div>
    </MagisModal>
  );
}
