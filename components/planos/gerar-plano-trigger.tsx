"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, FileText, Loader2, Sparkles, Trash2 } from "lucide-react";
import { GerarPlanoFlow } from "./gerar-intro-modal";
import { planosService } from "../../lib/services/firestore/planos.service";
import { showMagisToast } from "../../lib/utils/magis-toast";
import type { RecentPlano, ResumeData } from "./plan-generation-wizard";
import type { EscolaRecord, EstudanteRecord, PlanoRegenteRecord, TemplateOption, TurmaRecord } from "../../lib/types/firestore";

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  gerado:               { label: "Gerado",            cls: "bg-emerald-100 text-emerald-800" },
  rascunho:             { label: "Rascunho",           cls: "bg-slate-100 text-slate-700" },
  processando:          { label: "Processando",        cls: "bg-amber-100 text-amber-800" },
  aguardando_geracao:   { label: "Aguardando geração", cls: "bg-blue-100 text-blue-700" },
  aguardando_aprovacao: { label: "Aguardando revisão", cls: "bg-violet-100 text-violet-700" },
  erro:                 { label: "Erro",               cls: "bg-rose-100 text-rose-800" },
};

interface GerarPlanoTriggerProps {
  userId: string;
  userName: string;
  userEmail?: string;
  templates: TemplateOption[];
  escolas: EscolaRecord[];
  turmas: TurmaRecord[];
  estudantes?: EstudanteRecord[];
  canManageEstudantes?: boolean;
  limitsStatus: {
    canCreatePlano: boolean;
    limits: { maxPlanosPerMonth: number; maxIaCampoCallsPerMonth?: number };
    currentPlanosThisMonth: number;
    /** Saldo de sugestões IA no mês — exibido ANTES do fluxo para evitar surpresa no meio do trabalho. */
    iaCallsRemaining?: number;
    plano: string;
  };
  recentPlanos: RecentPlano[];
  resumeData?: ResumeData;
  preSelectedTemplateId?: string;
  /** Pre-selected student coming from "Criar PEI" button on the student card. */
  peiEstudanteId?: string;
  peiEstudanteNome?: string;
  /** Library of regente plans extracted from PDFs — available in the PEI editor for field-level import. */
  planosRegente?: PlanoRegenteRecord[];
  hasTemplates?: boolean;
  hasPlanos: boolean;
  canAssociateEscola?: boolean;
  canUseBulkIa?: boolean;
}

export function GerarPlanoTrigger({
  hasTemplates = true,
  hasPlanos,
  resumeData,
  preSelectedTemplateId,
  peiEstudanteId,
  peiEstudanteNome,
  planosRegente = [],
  recentPlanos,
  canAssociateEscola = true,
  canUseBulkIa = true,
  estudantes = [],
  canManageEstudantes = false,
  ...flowProps
}: GerarPlanoTriggerProps) {
  const [open, setOpen] = useState(hasTemplates && (!!resumeData || !!preSelectedTemplateId || !!peiEstudanteId));
  const router = useRouter();
  // Soft delete otimista: some da lista na hora; router.refresh() confirma
  // contra o servidor (a query já filtra deleted_at). Confirmação inline
  // (Confirmar/Cancelar no lugar dos botões) — mesmo padrão do dashboard.
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const visiblePlanos = recentPlanos.filter((p) => !deletedIds.has(p.id));

  async function handleDeletePlano(plano: RecentPlano) {
    if (deletingId) return;
    setDeletingId(plano.id);
    try {
      await planosService.deletePlano(plano.id);
      setDeletedIds((prev) => new Set([...prev, plano.id]));
      showMagisToast("Rascunho excluído.", "success");
      router.refresh();
    } catch {
      showMagisToast("Não consegui excluir o rascunho. Tente novamente.", "error");
    } finally {
      setDeletingId(null);
      setConfirmingId(null);
    }
  }

  const { limitsStatus } = flowProps;
  const planosRestantes = Math.max(
    0,
    limitsStatus.limits.maxPlanosPerMonth - limitsStatus.currentPlanosThisMonth,
  );
  const iaRestante = limitsStatus.iaCallsRemaining;
  const maxIa = limitsStatus.limits.maxIaCampoCallsPerMonth;
  const saldoEsgotado = planosRestantes === 0 || iaRestante === 0;
  const saldoBaixo =
    planosRestantes <= 1 ||
    (typeof iaRestante === "number" && typeof maxIa === "number" && maxIa > 0 && iaRestante <= maxIa * 0.2);

  return (
    <>
      {!open && (
        <div className="flex flex-col gap-6">
          <div className="flex items-start gap-3 max-w-2xl">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-violet-600 shadow-md">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1 rounded-2xl rounded-tl-none border border-violet-100 bg-violet-50 p-4 shadow-sm">
              <div className="mb-1.5 flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-violet-600" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-violet-600">Magis</span>
              </div>
              {!hasTemplates ? (
                <p className="text-sm leading-relaxed text-slate-800">
                  Você ainda não tem nenhum template cadastrado.{" "}
                  <Link href="/dashboard/templates" className="font-semibold text-violet-700 underline underline-offset-2 hover:text-violet-900">
                    Adicione o modelo da sua escola
                  </Link>{" "}
                  para começar a gerar planos.
                </p>
              ) : hasPlanos ? (
                <p className="text-sm leading-relaxed text-slate-800">
                  Ótimo! Você já tem planos gerados. Sempre que quiser criar um novo, é só clicar no botão abaixo e eu te guio passo a passo!
                </p>
              ) : (
                <p className="text-sm leading-relaxed text-slate-800">
                  Estamos quase lá! Agora basta você gerar os planos de aulas — os templates são reaproveitados para os próximos planos de aula, então é bem rápido!
                </p>
              )}
            </div>
          </div>

          <div className="flex w-full flex-col items-center gap-2">
            <button
              type="button"
              disabled={!hasTemplates}
              onClick={() => hasTemplates && setOpen(true)}
              className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Sparkles className="h-4 w-4" />
              Criar plano de aula
              <span>→</span>
            </button>
            {hasTemplates && (
              <p
                className={`text-center text-[11px] font-medium ${
                  saldoEsgotado ? "text-red-600" : saldoBaixo ? "text-amber-600" : "text-slate-400"
                }`}
              >
                {planosRestantes === 0
                  ? "Limite de planos do mês atingido — renova no próximo mês."
                  : `${planosRestantes} plano${planosRestantes === 1 ? "" : "s"}${
                      typeof iaRestante === "number"
                        ? ` e ${iaRestante} sugest${iaRestante === 1 ? "ão" : "ões"} de IA`
                        : ""
                    } disponíve${planosRestantes === 1 && iaRestante === undefined ? "l" : "is"} este mês`}
              </p>
            )}
          </div>

          {visiblePlanos.length > 0 && (
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-4">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <FileText className="h-4 w-4 text-slate-500" />
                  Planos gerados
                </h2>
                <span className="text-xs text-slate-400">
                  {visiblePlanos.length} {visiblePlanos.length === 1 ? "plano recente" : "planos recentes"}
                </span>
              </div>

              <ul className="space-y-3">
                {visiblePlanos.map((plano) => {
                  const status = STATUS_MAP[plano.status] ?? { label: plano.status, cls: "bg-slate-100 text-slate-600" };
                  const temConteudo = Object.keys(plano.conteudo_gerado ?? {}).length > 0;
                  const titulo =
                    typeof plano.conteudo_gerado?._plano_titulo === "string" && plano.conteudo_gerado._plano_titulo.trim()
                      ? plano.conteudo_gerado._plano_titulo
                      : plano.template_nome;
                  const dateLabel = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(plano.data_geracao));
                  return (
                    <li
                      key={plano.id}
                      className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-slate-300 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 rounded-xl bg-white p-2 text-slate-500 shadow-sm">
                          <FileText className="h-4 w-4" />
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{titulo}</p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {plano.escola_nome ?? "Escola não informada"}
                          </p>
                          <div className="mt-1 flex items-center gap-2">
                            <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${status.cls}`}>
                              {status.label}
                            </span>
                            <span className="text-xs text-slate-400">{dateLabel}</span>
                          </div>
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
                        {/* Excluir só para não-finalizados: planos "gerado" contam
                            no limite mensal e não podem sair da contagem.
                            Durante a confirmação, o Continuar some — foco no
                            Confirmar/Cancelar (mesmo padrão do dashboard). */}
                        {plano.status !== "gerado" && (
                          confirmingId === plano.id ? (
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setConfirmingId(null)}
                                disabled={deletingId === plano.id}
                                className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-500 transition hover:border-slate-400 disabled:opacity-40"
                              >
                                Cancelar
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeletePlano(plano)}
                                disabled={deletingId === plano.id}
                                className="flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-100 disabled:opacity-40"
                              >
                                {deletingId === plano.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                {deletingId === plano.id ? "Excluindo…" : "Confirmar"}
                              </button>
                            </div>
                          ) : (
                            <>
                              <Link
                                href={`/dashboard/gerar?resume=${plano.id}`}
                                className="flex items-center gap-1.5 rounded-xl border border-violet-200 bg-white px-3 py-1.5 text-xs font-medium text-violet-700 transition hover:border-violet-600 hover:text-violet-800"
                              >
                                Continuar
                              </Link>
                              <button
                                type="button"
                                onClick={() => setConfirmingId(plano.id)}
                                title="Excluir rascunho"
                                className="flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:border-rose-500 hover:bg-rose-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Excluir
                              </button>
                            </>
                          )
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-4 border-t border-slate-100 pt-4 text-center">
                <Link
                  href="/dashboard/historico"
                  className="text-sm font-medium text-slate-500 transition hover:text-slate-900"
                >
                  Ver histórico de planos gerados →
                </Link>
              </div>
            </div>
          )}
        </div>
      )}

      {open && (
        <GerarPlanoFlow
          {...flowProps}
          recentPlanos={recentPlanos}
          resumeData={resumeData}
          preSelectedTemplateId={preSelectedTemplateId}
          peiEstudanteId={peiEstudanteId}
          peiEstudanteNome={peiEstudanteNome}
          planosRegente={planosRegente}
          canAssociateEscola={canAssociateEscola}
          canUseBulkIa={canUseBulkIa}
          estudantes={estudantes}
          canManageEstudantes={canManageEstudantes}
        />
      )}
    </>
  );
}
