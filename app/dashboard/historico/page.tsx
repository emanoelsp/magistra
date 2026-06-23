import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, Clock, Edit2, FileText, FolderKanban, Lock, Pencil } from "lucide-react";

import { requireCurrentUserProfile } from "../../../lib/auth/session";
import {
  getUserPlanosComNome,
  getUserTemplateOptions,
} from "../../../lib/services/firestore/dashboard.server";
import { getUserTurmas } from "../../../lib/services/firestore/escolas.server";
import { HistoricoTabs } from "./historico-tabs";
import { HistoricoFilters } from "./historico-filters";
import { DownloadPlanButton } from "../../../components/planos/download-plan-button";
import { RenovarPlanoButton } from "../../../components/planos/renovar-plano-button";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 6;

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  gerado:               { label: "Gerado",            cls: "bg-emerald-100 text-emerald-800" },
  rascunho:             { label: "Rascunho",           cls: "bg-slate-100 text-slate-700" },
  processando:          { label: "Processando",        cls: "bg-amber-100 text-amber-800" },
  aguardando_geracao:   { label: "Aguardando geração", cls: "bg-blue-100 text-blue-700" },
  aguardando_aprovacao: { label: "Aguardando revisão", cls: "bg-violet-100 text-violet-700" },
  erro:                 { label: "Erro",               cls: "bg-rose-100 text-rose-800" },
};

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
}

function pageUrl(tab: string, page: number, filters: { q?: string; status?: string; templateId?: string; turmaId?: string }) {
  const sp = new URLSearchParams({ tab, page: String(page) });
  if (filters.q) sp.set("q", filters.q);
  if (filters.status) sp.set("status", filters.status);
  if (filters.templateId) sp.set("templateId", filters.templateId);
  if (filters.turmaId) sp.set("turmaId", filters.turmaId);
  return `/dashboard/historico?${sp.toString()}`;
}

interface PageProps {
  searchParams: Promise<{ tab?: string; page?: string; q?: string; status?: string; templateId?: string; turmaId?: string }>;
}

const FREE_EXPIRY_DAYS = 90;
const CURRENT_YEAR = new Date().getFullYear();

function isPlanExpired(dataGeracao: string, userPlano: string): boolean {
  if (userPlano !== "free") return false;
  const daysOld = Math.floor((Date.now() - new Date(dataGeracao).getTime()) / (1000 * 60 * 60 * 24));
  return daysOld >= FREE_EXPIRY_DAYS;
}

function isPreviousYear(dataGeracao: string): boolean {
  return new Date(dataGeracao).getFullYear() < CURRENT_YEAR;
}

export default async function HistoricoPage({ searchParams }: PageProps) {
  const user = await requireCurrentUserProfile();
  const { tab: tabParam, page: pageParam, q, status: statusParam, templateId, turmaId } = await searchParams;

  const tab = tabParam === "templates" ? "templates" : "planos";
  const page = Math.max(1, Number(pageParam) || 1);
  const filters = { q, status: statusParam, templateId, turmaId };

  const [planosResult, templates, turmas] = await Promise.all([
    getUserPlanosComNome(user.uid, PAGE_SIZE, page, filters),
    getUserTemplateOptions(user.uid),
    getUserTurmas(user.uid),
  ]);

  const planos = planosResult.items;
  const totalPlanos = planosResult.total;

  // Filter templates by search query (client-server: filter in memory)
  const filteredTemplates = q
    ? templates.filter((t) => t.nome.toLowerCase().includes(q.toLowerCase()))
    : templates;

  const templateTotalPages = Math.max(1, Math.ceil(filteredTemplates.length / PAGE_SIZE));
  const totalPages = tab === "planos"
    ? Math.max(1, Math.ceil(totalPlanos / PAGE_SIZE))
    : templateTotalPages;
  const safePage = Math.min(page, totalPages);
  const pageItems = tab === "planos"
    ? planos
    : filteredTemplates.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-2 text-sm font-medium text-slate-600 transition hover:text-slate-950"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar ao dashboard
        </Link>
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-amber-100 p-3 text-amber-600">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Histórico</h1>
            <p className="text-sm text-slate-500">Todos os seus templates e planos gerados.</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Suspense fallback={<div className="h-11 w-64 animate-pulse rounded-2xl bg-slate-100" />}>
        <HistoricoTabs totalPlanos={totalPlanos} totalTemplates={templates.length} />
      </Suspense>

      {/* Filters */}
      <Suspense fallback={null}>
        <HistoricoFilters
          tab={tab}
          templates={templates.map((t) => ({ id: t.id, nome: t.nome }))}
          turmas={turmas.map((t) => ({ id: t.id, nome: t.nome, escola_nome: t.escola_nome }))}
        />
      </Suspense>

      {/* Lista */}
      {pageItems.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-12 text-center">
          {tab === "planos" ? (
            <>
              <FileText className="mx-auto h-10 w-10 text-slate-300" />
              {filters.q || filters.status || filters.templateId ? (
                <>
                  <h2 className="mt-4 text-lg font-semibold text-slate-950">Nenhum plano encontrado</h2>
                  <p className="mt-2 text-sm text-slate-500">Tente outros termos ou limpe os filtros.</p>
                </>
              ) : (
                <>
                  <h2 className="mt-4 text-lg font-semibold text-slate-950">Nenhum plano ainda</h2>
                  <p className="mt-2 text-sm text-slate-500">Gere seu primeiro plano no assistente.</p>
                  <Link
                    href="/dashboard/gerar"
                    className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
                  >
                    Gerar plano
                  </Link>
                </>
              )}
            </>
          ) : (
            <>
              <FolderKanban className="mx-auto h-10 w-10 text-slate-300" />
              {filters.q ? (
                <>
                  <h2 className="mt-4 text-lg font-semibold text-slate-950">Nenhum template encontrado</h2>
                  <p className="mt-2 text-sm text-slate-500">Tente outros termos de busca.</p>
                </>
              ) : (
                <>
                  <h2 className="mt-4 text-lg font-semibold text-slate-950">Nenhum template ainda</h2>
                  <p className="mt-2 text-sm text-slate-500">Suba o modelo da sua escola para começar.</p>
                  <Link
                    href="/dashboard/templates"
                    className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
                  >
                    Adicionar template
                  </Link>
                </>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {tab === "planos"
            ? (pageItems as typeof planos).map((plano) => {
                const status =
                  STATUS_CONFIG[plano.status] ?? { label: plano.status, cls: "bg-slate-100 text-slate-600" };
                const temConteudo = Object.keys(plano.conteudo_gerado ?? {}).length > 0;
                const userPlano = (user.plano ?? "free").trim().toLowerCase();
                const expired = plano.status === "gerado" && plano.data_geracao
                  ? isPlanExpired(plano.data_geracao, userPlano)
                  : false;
                const previousYear = plano.status === "gerado" && plano.data_geracao
                  ? isPreviousYear(plano.data_geracao)
                  : false;
                const planoYear = plano.data_geracao ? new Date(plano.data_geracao).getFullYear() : null;
                return (
                  <div
                    key={plano.id}
                    className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-start gap-3">
                      <span className={`mt-0.5 shrink-0 rounded-xl p-2 ${plano.template_deletado ? "bg-slate-100 text-slate-400" : expired ? "bg-slate-100 text-slate-400" : "bg-violet-50 text-violet-600"}`}>
                        {expired ? <Lock className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                      </span>
                      <div>
                        <p className={`font-semibold ${plano.template_deletado || expired ? "text-slate-400" : "text-slate-950"}`}>
                          {typeof plano.conteudo_gerado?._plano_titulo === "string" && plano.conteudo_gerado._plano_titulo.trim()
                            ? plano.conteudo_gerado._plano_titulo
                            : plano.template_nome}
                        </p>
                        <p className="mt-0.5 text-sm text-slate-500">
                          {plano.escola_nome ? `${plano.escola_nome} · ` : ""}
                          {formatDate(plano.data_geracao)}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${status.cls}`}>
                            {status.label}
                          </span>
                          {previousYear && planoYear && (
                            <span className="inline-block rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-700">
                              Ano {planoYear}
                            </span>
                          )}
                          {expired && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                              <Lock className="h-3 w-3" />
                              Expirado — plano {FREE_EXPIRY_DAYS} dias
                            </span>
                          )}
                          {plano.template_deletado && (
                            <span className="inline-block rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-500">
                              template excluído
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {plano.status === "gerado" && temConteudo && !expired && (
                        <DownloadPlanButton
                          planoId={plano.id}
                          format="pdf"
                          label="PDF"
                          className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-60"
                        />
                      )}
                      {plano.status === "gerado" && temConteudo && expired && (
                        <Link
                          href="/planos"
                          className="inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500"
                        >
                          <Lock className="h-3.5 w-3.5" />
                          Reativar acesso
                        </Link>
                      )}
                      {plano.status === "gerado" && temConteudo && previousYear && !expired && (
                        <RenovarPlanoButton planoId={plano.id} currentYear={CURRENT_YEAR} />
                      )}
                      {(plano.status === "rascunho" || plano.status === "aguardando_geracao") && (
                        <Link
                          href={`/dashboard/gerar?resume=${plano.id}`}
                          className="inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Continuar editando
                        </Link>
                      )}
                      {plano.status === "gerado" && (
                        <Link
                          href={`/dashboard/historico/${plano.id}`}
                          className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
                        >
                          Ver detalhes
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })
            : (pageItems as typeof templates).map((tpl) => (
                <div
                  key={tpl.id}
                  className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 rounded-xl bg-amber-50 p-2 text-amber-600">
                      <FolderKanban className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="font-semibold text-slate-950">{tpl.nome}</p>
                      <p className="mt-0.5 text-sm text-slate-500">
                        {tpl.escolaNome ? `${tpl.escolaNome} · ` : ""}
                        {tpl.campoCount} campos · {formatDate(tpl.criadoEm)}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/dashboard/templates/${tpl.id}/visualizar`}
                      className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
                    >
                      Visualizar
                    </Link>
                    <Link
                      href={`/dashboard/templates/${tpl.id}/editar`}
                      className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
                    >
                      <Edit2 className="h-4 w-4" />
                      Editar
                    </Link>
                  </div>
                </div>
              ))}
        </div>
      )}

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-4 pt-2">
          <Link
            href={pageUrl(tab, safePage - 1, filters)}
            aria-disabled={safePage === 1}
            className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-medium transition ${
              safePage === 1
                ? "pointer-events-none border-slate-200 text-slate-300"
                : "border-slate-300 text-slate-700 hover:border-slate-950 hover:text-slate-950"
            }`}
          >
            <ChevronLeft className="h-4 w-4" />
            Anterior
          </Link>

          <span className="text-sm text-slate-500">
            Página <strong className="text-slate-950">{safePage}</strong> de{" "}
            <strong className="text-slate-950">{totalPages}</strong>
          </span>

          <Link
            href={pageUrl(tab, safePage + 1, filters)}
            aria-disabled={safePage === totalPages}
            className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-medium transition ${
              safePage === totalPages
                ? "pointer-events-none border-slate-200 text-slate-300"
                : "border-slate-300 text-slate-700 hover:border-slate-950 hover:text-slate-950"
            }`}
          >
            Próxima
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      )}
    </div>
  );
}
