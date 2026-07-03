"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit2,
  FileText,
  FolderKanban,
  Pencil,
  Trash2,
} from "lucide-react";
import type { PlanoStatus } from "../../lib/types/firestore";

const DEFAULT_PAGE_SIZE = 3;

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  gerado:               { label: "Gerado",            cls: "bg-emerald-100 text-emerald-800" },
  rascunho:             { label: "Rascunho",           cls: "bg-slate-100 text-slate-700" },
  processando:          { label: "Processando",        cls: "bg-amber-100 text-amber-800" },
  aguardando_geracao:   { label: "Aguardando geração", cls: "bg-blue-100 text-blue-700" },
  aguardando_aprovacao: { label: "Aguardando revisão", cls: "bg-violet-100 text-violet-700" },
  erro:                 { label: "Erro",               cls: "bg-rose-100 text-rose-800" },
};

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

function formatDateShort(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(iso));
}

function PaginationBar({
  page,
  total,
  pageSize,
  onPrev,
  onNext,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const totalPages = Math.ceil(total / pageSize);
  const hidden = total <= pageSize;
  return (
    <div className={`mt-auto flex items-center justify-between border-t border-slate-100 pt-3 ${hidden ? "invisible" : ""}`}>
      <button
        type="button"
        onClick={onPrev}
        disabled={page === 1}
        className="flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-950 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Anterior
      </button>
      <span className="text-xs text-slate-400">
        {page} / {totalPages}
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={page === totalPages}
        className="flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-950 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Próxima
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─── Escolas ─────────────────────────────────────────────────────────────────

export interface EscolaDashboardItem {
  id: string;
  nome: string;
  turmaCount: number;
}

export function EscolasPaginatedList({ items, pageSize = DEFAULT_PAGE_SIZE }: { items: EscolaDashboardItem[]; pageSize?: number }) {
  const [page, setPage] = useState(1);
  const totalPages = Math.ceil(items.length / pageSize);
  const start = (page - 1) * pageSize;
  const visible = items.slice(start, start + pageSize);

  return (
    <div className="flex flex-1 flex-col">
      <ul className="divide-y divide-slate-100">
        {visible.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-3 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="shrink-0 rounded-xl bg-indigo-50 p-2 text-indigo-600">
                <Building2 className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">{e.nome}</p>
                <p className="text-xs text-slate-400">
                  {e.turmaCount === 0
                    ? "Nenhuma turma"
                    : `${e.turmaCount} turma${e.turmaCount !== 1 ? "s" : ""}`}
                </p>
              </div>
            </div>
            <Link
              href="/dashboard/escolas"
              className="shrink-0 rounded-xl border border-slate-200 p-1.5 text-slate-400 transition hover:border-slate-950 hover:text-slate-950"
              title="Ver escola"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </li>
        ))}
      </ul>
      <PaginationBar
        page={page}
        total={items.length}
        pageSize={pageSize}
        onPrev={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
      />
    </div>
  );
}

// ─── Templates ───────────────────────────────────────────────────────────────

export interface TemplateDashboardItem {
  id: string;
  nome: string;
  escola_nome: string | null;
  data_criacao: string;
  deletado: boolean;
}

export function TemplatesPaginatedList({ items, pageSize = DEFAULT_PAGE_SIZE }: { items: TemplateDashboardItem[]; pageSize?: number }) {
  const [page, setPage] = useState(1);
  const totalPages = Math.ceil(items.length / pageSize);
  const start = (page - 1) * pageSize;
  const visible = items.slice(start, start + pageSize);

  return (
    <div className="flex flex-1 flex-col">
      <ul className="divide-y divide-slate-100">
        {visible.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className={`shrink-0 rounded-xl p-2 ${t.deletado ? "bg-slate-100 text-slate-400" : "bg-amber-50 text-amber-600"}`}>
                <FolderKanban className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className={`truncate text-sm font-medium ${t.deletado ? "text-slate-400 line-through" : "text-slate-900"}`}>
                  {t.nome}
                </p>
                <p className="truncate text-xs text-slate-400">
                  {t.escola_nome ? `${t.escola_nome} · ` : ""}
                  <span className="hidden sm:inline">{formatDate(t.data_criacao)}</span>
                  <span className="sm:hidden">{formatDateShort(t.data_criacao)}</span>
                  {t.deletado && <span className="ml-1.5 text-rose-400">· excluído</span>}
                </p>
              </div>
            </div>
            {t.deletado ? (
              <span className="shrink-0 rounded-xl border border-slate-100 p-1.5 text-slate-300">
                <Edit2 className="h-3.5 w-3.5" />
              </span>
            ) : (
              <Link
                href={`/dashboard/templates/${t.id}/editar`}
                className="shrink-0 rounded-xl border border-slate-200 p-1.5 text-slate-400 transition hover:border-slate-950 hover:text-slate-950"
                title="Editar template"
              >
                <Edit2 className="h-3.5 w-3.5" />
              </Link>
            )}
          </li>
        ))}
      </ul>
      <PaginationBar
        page={page}
        total={items.length}
        pageSize={pageSize}
        onPrev={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
      />
    </div>
  );
}

// ─── Planos ──────────────────────────────────────────────────────────────────

export interface PlanoDashboardItem {
  id: string;
  status: PlanoStatus;
  conteudo_gerado: Record<string, unknown>;
  data_geracao: string;
  template_nome: string;
  template_deletado: boolean;
  estudante_nome?: string;
}

export function PlanosPaginatedList({ items: initialItems, pageSize = DEFAULT_PAGE_SIZE }: { items: PlanoDashboardItem[]; pageSize?: number }) {
  const [items, setItems] = useState(initialItems);
  const [page, setPage] = useState(1);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const totalPages = Math.ceil(items.length / pageSize);
  const start = (page - 1) * pageSize;
  const visible = items.slice(start, start + pageSize);

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/planos/${id}`, { method: "DELETE" });
      if (res.ok) {
        setItems((prev) => prev.filter((p) => p.id !== id));
        setPage((p) => Math.min(p, Math.ceil((items.length - 1) / pageSize) || 1));
      }
    } finally {
      setDeletingId(null);
      setConfirmingId(null);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <ul className="divide-y divide-slate-100">
        {visible.map((plano) => {
          const status = STATUS_CONFIG[plano.status] ?? { label: plano.status, cls: "bg-slate-100 text-slate-600" };
          const temConteudo = Object.keys(plano.conteudo_gerado ?? {}).length > 0;
          const titulo =
            typeof plano.conteudo_gerado?._plano_titulo === "string" &&
            plano.conteudo_gerado._plano_titulo.trim()
              ? plano.conteudo_gerado._plano_titulo
              : plano.template_nome;
          return (
            <li key={plano.id} className="flex items-center justify-between gap-2 py-3 sm:gap-3">
              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                <span className={`shrink-0 rounded-xl p-2 ${plano.template_deletado ? "bg-slate-100 text-slate-400" : "bg-violet-50 text-violet-600"}`}>
                  <FileText className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className={`truncate text-sm font-medium ${plano.template_deletado ? "text-slate-400 line-through" : "text-slate-900"}`}>
                    {titulo}
                  </p>
                  <p className="truncate text-xs text-slate-400">
                    <span className="hidden sm:inline">{formatDate(plano.data_geracao)}</span>
                    <span className="sm:hidden">{formatDateShort(plano.data_geracao)}</span>
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${status.cls}`}>
                      {status.label}
                    </span>
                    {plano.estudante_nome && (
                      <span className="inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                        PEI · {plano.estudante_nome}
                      </span>
                    )}
                    {plano.template_deletado && (
                      <span className="inline-block rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-500">
                        template excluído
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
                {plano.status === "gerado" && temConteudo && (
                  <a
                    href={`/api/planos/${plano.id}/download`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-xl border border-slate-200 p-1.5 text-slate-400 transition hover:border-slate-950 hover:text-slate-950"
                    title="Baixar plano"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </a>
                )}
                {plano.status === "rascunho" && (
                  confirmingId === plano.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        disabled={deletingId === plano.id}
                        className="rounded-xl border border-slate-200 px-2 py-1.5 text-xs text-slate-500 transition hover:border-slate-400 disabled:opacity-40"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(plano.id)}
                        disabled={deletingId === plano.id}
                        className="rounded-xl border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-100 disabled:opacity-40"
                      >
                        {deletingId === plano.id ? "Excluindo…" : "Confirmar"}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingId(plano.id)}
                      className="rounded-xl border border-slate-200 p-1.5 text-slate-400 transition hover:border-rose-300 hover:text-rose-500"
                      title="Excluir rascunho"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )
                )}
                {(plano.status === "rascunho" || plano.status === "aguardando_geracao") && (
                  <Link
                    href={`/dashboard/gerar?resume=${plano.id}`}
                    className="flex items-center gap-1 rounded-xl border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-xs font-medium text-violet-700 transition hover:border-violet-400 hover:bg-violet-100 sm:px-3"
                    title="Continuar editando"
                  >
                    <Pencil className="h-3 w-3" />
                    <span className="hidden sm:inline">Continuar</span>
                  </Link>
                )}
                {plano.status === "gerado" && (
                  <Link
                    href={`/dashboard/historico/${plano.id}`}
                    className="rounded-xl border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-950 hover:text-slate-950 sm:px-3"
                  >
                    Detalhes
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <PaginationBar
        page={page}
        total={items.length}
        pageSize={pageSize}
        onPrev={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
      />
    </div>
  );
}
