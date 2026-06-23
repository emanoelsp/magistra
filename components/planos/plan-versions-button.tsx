"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, Clock, History, Loader2, RotateCcw } from "lucide-react";

interface Version {
  id: string;
  saved_at: string;
}

interface PlanVersionsButtonProps {
  planoId: string;
  onRestore: (conteudo: Record<string, string>) => void;
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

export function PlanVersionsButton({ planoId, onRestore }: PlanVersionsButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [restored, setRestored] = useState<string | null>(null);
  const [versoes, setVersoes] = useState<Version[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function fetchVersoes() {
    if (versoes.length > 0) return; // already loaded
    setLoading(true);
    try {
      const res = await fetch(`/api/planos/${planoId}/versoes`);
      const data = (await res.json()) as { versoes?: Version[] };
      setVersoes(data.versoes ?? []);
    } catch {
      setVersoes([]);
    } finally {
      setLoading(false);
    }
  }

  function handleToggle() {
    const next = !open;
    setOpen(next);
    if (next) void fetchVersoes();
  }

  async function handleRestore(versaoId: string) {
    setRestoring(versaoId);
    try {
      const res = await fetch(`/api/planos/${planoId}/versoes/${versaoId}`);
      const data = (await res.json()) as { conteudo_gerado?: Record<string, unknown>; error?: string };
      if (!res.ok || !data.conteudo_gerado) throw new Error(data.error ?? "Erro ao restaurar.");

      // Convert all values to strings for the editor state
      const conteudo = Object.fromEntries(
        Object.entries(data.conteudo_gerado).map(([k, v]) => [k, typeof v === "string" ? v : String(v ?? "")]),
      );

      onRestore(conteudo);
      setRestored(versaoId);
      setTimeout(() => setRestored(null), 2500);
      setOpen(false);
    } catch {
      // silently fail — user can retry
    } finally {
      setRestoring(null);
    }
  }

  if (!planoId) return null;

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={handleToggle}
        className="flex items-center gap-1.5 rounded-2xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-slate-950 hover:text-slate-950"
        title="Ver versões salvas"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <History className="h-3.5 w-3.5" />
        Versões
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {restored && (
        <div className="absolute right-0 top-10 z-50 flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 shadow-sm">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Versão restaurada
        </div>
      )}

      {open && !restored && (
        <div
          role="listbox"
          aria-label="Versões salvas do plano"
          className="absolute right-0 top-10 z-50 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg"
        >
          <div className="border-b border-slate-100 px-4 py-2.5">
            <p className="text-xs font-semibold text-slate-700">Versões salvas</p>
            <p className="mt-0.5 text-[10px] text-slate-400">Até 5 versões mais recentes</p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando…
            </div>
          ) : versoes.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 py-6">
              <Clock className="h-5 w-5 text-slate-300" />
              <p className="text-xs text-slate-400">Nenhuma versão salva ainda.</p>
              <p className="text-[10px] text-slate-300">Salve um rascunho para criar versões.</p>
            </div>
          ) : (
            <ul className="py-1">
              {versoes.map((v, i) => (
                <li key={v.id} className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-slate-50">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-800">
                      Versão {versoes.length - i}
                    </p>
                    <p className="text-[10px] text-slate-400">{formatDate(v.saved_at)}</p>
                  </div>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => void handleRestore(v.id)}
                    disabled={restoring === v.id}
                    className="flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 px-2 py-1 text-[10px] font-medium text-slate-600 transition hover:border-violet-400 hover:text-violet-600 disabled:opacity-50"
                  >
                    {restoring === v.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3 w-3" />
                    )}
                    Restaurar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
