"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Search, SlidersHorizontal, X } from "lucide-react";

interface TemplateOption {
  id: string;
  nome: string;
}

interface HistoricoFiltersProps {
  tab: "planos" | "templates";
  templates: TemplateOption[];
}

const STATUS_OPTIONS = [
  { value: "", label: "Todos os status" },
  { value: "gerado", label: "Gerado" },
  { value: "rascunho", label: "Rascunho" },
  { value: "processando", label: "Processando" },
  { value: "erro", label: "Erro" },
];

export function HistoricoFilters({ tab, templates }: HistoricoFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [status, setStatus] = useState(searchParams.get("status") ?? "");
  const [templateId, setTemplateId] = useState(searchParams.get("templateId") ?? "");

  const pushUrl = useCallback(
    (next: { q: string; status: string; templateId: string }) => {
      const sp = new URLSearchParams();
      sp.set("tab", tab);
      sp.set("page", "1");
      if (next.q) sp.set("q", next.q);
      if (next.status) sp.set("status", next.status);
      if (next.templateId) sp.set("templateId", next.templateId);
      startTransition(() => { router.push(`/dashboard/historico?${sp.toString()}`); });
    },
    [router, tab],
  );

  // Debounce text search
  function handleQChange(value: string) {
    setQ(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pushUrl({ q: value, status, templateId });
    }, 350);
  }

  function handleStatusChange(value: string) {
    setStatus(value);
    pushUrl({ q, status: value, templateId });
  }

  function handleTemplateChange(value: string) {
    setTemplateId(value);
    pushUrl({ q, status, templateId: value });
  }

  function clearAll() {
    setQ("");
    setStatus("");
    setTemplateId("");
    startTransition(() => { router.push(`/dashboard/historico?tab=${tab}&page=1`); });
  }

  const hasFilters = q || status || templateId;

  // Sync state if URL changes externally (e.g. tab switch)
  useEffect(() => {
    setQ(searchParams.get("q") ?? "");
    setStatus(searchParams.get("status") ?? "");
    setTemplateId(searchParams.get("templateId") ?? "");
  }, [searchParams]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Search input */}
      <div className="relative flex-1 min-w-48">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={q}
          onChange={(e) => handleQChange(e.target.value)}
          placeholder={tab === "planos" ? "Buscar por título ou template…" : "Buscar template…"}
          aria-label="Buscar no histórico"
          className="w-full rounded-2xl border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-slate-950 focus:ring-2 focus:ring-slate-100"
        />
        {isPending && (
          <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-slate-400" />
        )}
      </div>

      {/* Status filter — planos only */}
      {tab === "planos" && (
        <select
          value={status}
          onChange={(e) => handleStatusChange(e.target.value)}
          aria-label="Filtrar por status"
          className="rounded-2xl border border-slate-300 bg-white py-2 pl-3 pr-8 text-sm text-slate-700 outline-none transition focus:border-slate-950 focus:ring-2 focus:ring-slate-100"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      )}

      {/* Template filter — planos only */}
      {tab === "planos" && templates.length > 0 && (
        <select
          value={templateId}
          onChange={(e) => handleTemplateChange(e.target.value)}
          aria-label="Filtrar por template"
          className="max-w-48 rounded-2xl border border-slate-300 bg-white py-2 pl-3 pr-8 text-sm text-slate-700 outline-none transition focus:border-slate-950 focus:ring-2 focus:ring-slate-100"
        >
          <option value="">Todos os templates</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.nome}</option>
          ))}
        </select>
      )}

      {/* Filter icon (decorative) */}
      {!hasFilters && (
        <span className="hidden items-center gap-1.5 text-xs text-slate-400 sm:flex">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filtros
        </span>
      )}

      {/* Clear all */}
      {hasFilters && (
        <button
          type="button"
          onClick={clearAll}
          aria-label="Limpar filtros"
          className="flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-slate-950 hover:text-slate-950"
        >
          <X className="h-3.5 w-3.5" />
          Limpar
        </button>
      )}
    </div>
  );
}
