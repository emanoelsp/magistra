"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, ChevronDown, GraduationCap, Loader2, Search, SlidersHorizontal, UserCheck, Users, X } from "lucide-react";

interface EscolaOption {
  id: string;
  nome: string;
  cursos?: Array<{ tipo: string; label: string }>;
}

interface TemplateOption {
  id: string;
  nome: string;
}

interface TurmaOption {
  id: string;
  nome: string;
  escola_nome: string;
  escola_id: string;
  tipo_curso?: string;
}

interface EstudanteOption {
  id: string;
  nome: string;
}

interface HistoricoFiltersProps {
  tab: "planos" | "templates";
  templates: TemplateOption[];
  turmas?: TurmaOption[];
  escolas?: EscolaOption[];
  estudantes?: EstudanteOption[];
  /** When false, hides escola/curso/turma filters (Educador plan has no org access). */
  canShowOrgFilters?: boolean;
  /** When true, shows the estudante filter (Mestre+ plans). */
  canShowEstudanteFilter?: boolean;
}

const STATUS_OPTIONS = [
  { value: "", label: "Todos os status" },
  { value: "gerado", label: "Gerado" },
  { value: "rascunho", label: "Rascunho" },
  { value: "processando", label: "Processando" },
  { value: "erro", label: "Erro" },
];

const FILLABLE_STATUS_OPTIONS = [
  { value: "", label: "Todos os status" },
  { value: "pronto", label: "DOCX pronto" },
  { value: "processando", label: "Processando" },
  { value: "erro", label: "Erro" },
];

const SELECT_CLS =
  "w-full appearance-none rounded-2xl border border-slate-300 bg-white py-2 pl-4 pr-9 text-sm text-slate-700 outline-none transition focus:border-slate-950 focus:ring-2 focus:ring-slate-100 disabled:opacity-40 disabled:cursor-not-allowed";

const SELECT_ICON_CLS =
  "w-full appearance-none rounded-2xl border border-slate-300 bg-white py-2 pl-9 pr-9 text-sm text-slate-700 outline-none transition focus:border-slate-950 focus:ring-2 focus:ring-slate-100 disabled:opacity-40 disabled:cursor-not-allowed";

export function HistoricoFilters({
  tab,
  templates,
  turmas = [],
  escolas = [],
  estudantes = [],
  canShowOrgFilters = true,
  canShowEstudanteFilter = false,
}: HistoricoFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [status, setStatus] = useState(searchParams.get("status") ?? "");
  const [fillableStatus, setFillableStatus] = useState(searchParams.get("fillableStatus") ?? "");
  const [templateId, setTemplateId] = useState(searchParams.get("templateId") ?? "");
  const [turmaId, setTurmaId] = useState(searchParams.get("turmaId") ?? "");
  const [escolaId, setEscolaId] = useState(searchParams.get("escolaId") ?? "");
  const [cursoTipo, setCursoTipo] = useState(searchParams.get("cursoTipo") ?? "");
  const [estudanteId, setEstudanteId] = useState(searchParams.get("estudanteId") ?? "");

  // Escola selecionada e seus cursos
  const selectedEscola = escolas.find((e) => e.id === escolaId);
  const availableCursos = selectedEscola?.cursos ?? [];

  // Turmas visíveis: cascata escola → curso
  const visibleTurmas = turmas.filter((t) => {
    if (escolaId && t.escola_id !== escolaId) return false;
    if (cursoTipo && t.tipo_curso !== cursoTipo) return false;
    return true;
  });

  const pushUrl = useCallback(
    (next: {
      q: string;
      status: string;
      fillableStatus: string;
      templateId: string;
      turmaId: string;
      escolaId: string;
      cursoTipo: string;
      estudanteId: string;
    }) => {
      const sp = new URLSearchParams();
      sp.set("tab", tab);
      sp.set("page", "1");
      if (next.q) sp.set("q", next.q);
      if (next.status) sp.set("status", next.status);
      if (next.fillableStatus) sp.set("fillableStatus", next.fillableStatus);
      if (next.templateId) sp.set("templateId", next.templateId);
      if (next.turmaId) sp.set("turmaId", next.turmaId);
      if (next.escolaId) sp.set("escolaId", next.escolaId);
      if (next.cursoTipo) sp.set("cursoTipo", next.cursoTipo);
      if (next.estudanteId) sp.set("estudanteId", next.estudanteId);
      startTransition(() => { router.push(`/dashboard/historico?${sp.toString()}`); });
    },
    [router, tab],
  );

  function handleQChange(value: string) {
    setQ(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pushUrl({ q: value, status, fillableStatus, templateId, turmaId, escolaId, cursoTipo, estudanteId });
    }, 350);
  }

  function handleStatusChange(value: string) {
    setStatus(value);
    pushUrl({ q, status: value, fillableStatus, templateId, turmaId, escolaId, cursoTipo, estudanteId });
  }

  function handleFillableStatusChange(value: string) {
    setFillableStatus(value);
    pushUrl({ q, status, fillableStatus: value, templateId, turmaId, escolaId, cursoTipo, estudanteId });
  }

  function handleTemplateChange(value: string) {
    setTemplateId(value);
    pushUrl({ q, status, fillableStatus, templateId: value, turmaId, escolaId, cursoTipo, estudanteId });
  }

  function handleEscolaChange(value: string) {
    setEscolaId(value);
    setCursoTipo("");
    setTurmaId("");
    pushUrl({ q, status, fillableStatus, templateId, turmaId: "", escolaId: value, cursoTipo: "", estudanteId });
  }

  function handleCursoChange(value: string) {
    setCursoTipo(value);
    const turmaStillValid = !value || turmas.some((t) => t.id === turmaId && t.tipo_curso === value);
    const nextTurmaId = turmaStillValid ? turmaId : "";
    if (!turmaStillValid) setTurmaId("");
    pushUrl({ q, status, fillableStatus, templateId, turmaId: nextTurmaId, escolaId, cursoTipo: value, estudanteId });
  }

  function handleTurmaChange(value: string) {
    setTurmaId(value);
    pushUrl({ q, status, fillableStatus, templateId, turmaId: value, escolaId, cursoTipo, estudanteId });
  }

  function handleEstudanteChange(value: string) {
    setEstudanteId(value);
    pushUrl({ q, status, fillableStatus, templateId, turmaId, escolaId, cursoTipo, estudanteId: value });
  }

  function clearAll() {
    setQ("");
    setStatus("");
    setFillableStatus("");
    setTemplateId("");
    setTurmaId("");
    setEscolaId("");
    setCursoTipo("");
    setEstudanteId("");
    startTransition(() => { router.push(`/dashboard/historico?tab=${tab}&page=1`); });
  }

  const hasFilters = !!(q || status || fillableStatus || templateId || turmaId || escolaId || cursoTipo || estudanteId);

  useEffect(() => {
    setQ(searchParams.get("q") ?? "");
    setStatus(searchParams.get("status") ?? "");
    setFillableStatus(searchParams.get("fillableStatus") ?? "");
    setTemplateId(searchParams.get("templateId") ?? "");
    setTurmaId(searchParams.get("turmaId") ?? "");
    setEscolaId(searchParams.get("escolaId") ?? "");
    setCursoTipo(searchParams.get("cursoTipo") ?? "");
    setEstudanteId(searchParams.get("estudanteId") ?? "");
  }, [searchParams]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Busca textual */}
      <div className="relative min-w-48 flex-1">
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

      {/* Status — planos */}
      {tab === "planos" && (
        <div className="relative">
          <select
            value={status}
            onChange={(e) => handleStatusChange(e.target.value)}
            aria-label="Filtrar por status"
            className={SELECT_CLS}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        </div>
      )}

      {/* Status — templates */}
      {tab === "templates" && (
        <div className="relative">
          <select
            value={fillableStatus}
            onChange={(e) => handleFillableStatusChange(e.target.value)}
            aria-label="Filtrar por status do template"
            className={SELECT_CLS}
          >
            {FILLABLE_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        </div>
      )}

      {/* Escola / Curso / Turma — Mestre+ only */}
      {canShowOrgFilters && (
        <>
          <div className="relative max-w-52">
            <Building2 className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <select
              value={escolaId}
              onChange={(e) => handleEscolaChange(e.target.value)}
              aria-label="Filtrar por escola"
              disabled={escolas.length === 0}
              className={SELECT_ICON_CLS}
            >
              <option value="">{escolas.length === 0 ? "Nenhuma escola cadastrada" : "Todas as escolas"}</option>
              {escolas.map((e) => (
                <option key={e.id} value={e.id}>{e.nome}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          </div>

          {/* Curso — aparece após escolher escola, se ela tiver modalidades */}
          {escolaId && availableCursos.length > 0 && (
            <div className="relative max-w-48">
              <GraduationCap className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <select
                value={cursoTipo}
                onChange={(e) => handleCursoChange(e.target.value)}
                aria-label="Filtrar por curso"
                className={SELECT_ICON_CLS}
              >
                <option value="">Todos os cursos</option>
                {availableCursos.map((c) => (
                  <option key={c.tipo} value={c.tipo}>{c.label}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            </div>
          )}

          {/* Turma — aparece após escola (sem cursos) ou após escolher curso */}
          {escolaId && (availableCursos.length === 0 || cursoTipo) && (
            <div className="relative max-w-52">
              <Users className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <select
                value={turmaId}
                onChange={(e) => handleTurmaChange(e.target.value)}
                aria-label="Filtrar por turma"
                disabled={visibleTurmas.length === 0}
                className={SELECT_ICON_CLS}
              >
                <option value="">{visibleTurmas.length === 0 ? "Nenhuma turma encontrada" : "Todas as turmas"}</option>
                {visibleTurmas.map((t) => (
                  <option key={t.id} value={t.id}>{t.nome}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            </div>
          )}
        </>
      )}

      {/* Template — planos only */}
      {tab === "planos" && templates.length > 0 && (
        <div className="relative max-w-48">
          <select
            value={templateId}
            onChange={(e) => handleTemplateChange(e.target.value)}
            aria-label="Filtrar por template"
            className={SELECT_CLS}
          >
            <option value="">Todos os templates</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.nome}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        </div>
      )}

      {/* Estudante — Mestre+ planos only */}
      {tab === "planos" && canShowEstudanteFilter && estudantes.length > 0 && (
        <div className="relative max-w-52">
          <UserCheck className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <select
            value={estudanteId}
            onChange={(e) => handleEstudanteChange(e.target.value)}
            aria-label="Filtrar por estudante"
            className={SELECT_ICON_CLS}
          >
            <option value="">Todos os estudantes</option>
            {estudantes.map((e) => (
              <option key={e.id} value={e.id}>{e.nome}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        </div>
      )}

      {/* Ícone decorativo quando sem filtros */}
      {!hasFilters && (
        <span className="hidden items-center gap-1.5 text-xs text-slate-400 sm:flex">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filtros
        </span>
      )}

      {/* Limpar */}
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
