import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, Clock, Edit2, FileText, FolderKanban } from "lucide-react";

import { requireCurrentUserProfile } from "../../../lib/auth/session";
import {
  getUserPlanosComNome,
  getUserTemplateOptions,
} from "../../../lib/services/firestore/dashboard.server";
import { HistoricoTabs } from "./historico-tabs";
import { DownloadPlanButton } from "../../../components/planos/download-plan-button";

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

function pageUrl(tab: string, page: number) {
  return `/dashboard/historico?tab=${tab}&page=${page}`;
}

interface PageProps {
  searchParams: Promise<{ tab?: string; page?: string }>;
}

export default async function HistoricoPage({ searchParams }: PageProps) {
  const user = await requireCurrentUserProfile();
  const { tab: tabParam, page: pageParam } = await searchParams;

  const tab = tabParam === "templates" ? "templates" : "planos";
  const page = Math.max(1, Number(pageParam) || 1);

  const [planosResult, templates] = await Promise.all([
    getUserPlanosComNome(user.uid, PAGE_SIZE, page),
    getUserTemplateOptions(user.uid),
  ]);

  const planos = planosResult.items;
  const totalPlanos = planosResult.total;

  const templateTotalPages = Math.max(1, Math.ceil(templates.length / PAGE_SIZE));
  const totalPages = tab === "planos"
    ? Math.max(1, Math.ceil(totalPlanos / PAGE_SIZE))
    : templateTotalPages;
  const safePage = Math.min(page, totalPages);
  const pageItems = tab === "planos"
    ? planos
    : templates.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

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

      {/* Lista */}
      {pageItems.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-12 text-center">
          {tab === "planos" ? (
            <>
              <FileText className="mx-auto h-10 w-10 text-slate-300" />
              <h2 className="mt-4 text-lg font-semibold text-slate-950">Nenhum plano ainda</h2>
              <p className="mt-2 text-sm text-slate-500">Gere seu primeiro plano no assistente.</p>
              <Link
                href="/dashboard/gerar"
                className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
              >
                Gerar plano
              </Link>
            </>
          ) : (
            <>
              <FolderKanban className="mx-auto h-10 w-10 text-slate-300" />
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
        </div>
      ) : (
        <div className="space-y-3">
          {tab === "planos"
            ? (pageItems as typeof planos).map((plano) => {
                const status =
                  STATUS_CONFIG[plano.status] ?? { label: plano.status, cls: "bg-slate-100 text-slate-600" };
                const temConteudo = Object.keys(plano.conteudo_gerado ?? {}).length > 0;
                return (
                  <div
                    key={plano.id}
                    className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 shrink-0 rounded-xl bg-violet-50 p-2 text-violet-600">
                        <FileText className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="font-semibold text-slate-950">{plano.template_nome}</p>
                        <p className="mt-0.5 text-sm text-slate-500">
                          {plano.escola_nome ? `${plano.escola_nome} · ` : ""}
                          {formatDate(plano.data_geracao)}
                        </p>
                        <span className={`mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${status.cls}`}>
                          {status.label}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {plano.status === "gerado" && temConteudo && (
                        <DownloadPlanButton
                          planoId={plano.id}
                          format="pdf"
                          label="PDF"
                          className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-60"
                        />
                      )}
                      <Link
                        href={`/dashboard/historico/${plano.id}`}
                        className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
                      >
                        Ver detalhes
                      </Link>
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
                  <div className="flex shrink-0 gap-2">
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
            href={pageUrl(tab, safePage - 1)}
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
            href={pageUrl(tab, safePage + 1)}
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
