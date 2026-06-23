"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Loader2 } from "lucide-react";

interface Props {
  planoId: string;
  currentYear: number;
}

export function RenovarPlanoButton({ planoId, currentYear }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRenovar() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/planos/${planoId}/renovar`, { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? "Erro ao renovar.");
      router.push(`/dashboard/gerar?resume=${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro inesperado.");
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void handleRenovar()}
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-60"
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <CalendarDays className="h-3.5 w-3.5" />
        )}
        {loading ? "Preparando…" : `Renovar para ${currentYear}`}
      </button>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}
