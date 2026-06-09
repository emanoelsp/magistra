"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

const PERIODOS = [
  { value: "auto",  label: "Mensal — renova automaticamente" },
  { value: "1",     label: "Mensal — só 1 mês" },
  { value: "2",     label: "Bimestral — 2 meses" },
  { value: "3",     label: "Trimestral — 3 meses" },
  { value: "6",     label: "Semestral — 6 meses" },
  { value: "12",    label: "Anual — 12 meses" },
];

export function CheckoutButton({
  plano,
  label,
  loggedIn,
}: {
  plano: string;
  label: string;
  loggedIn: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState("auto");

  async function handleClick() {
    if (!loggedIn) {
      window.location.href = "/login";
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/pagamentos/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plano, periodo }),
      });
      const data = (await res.json()) as { init_point?: string; error?: string };
      if (!res.ok || !data.init_point) throw new Error(data.error ?? "Erro ao iniciar checkout.");
      window.location.href = data.init_point;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro inesperado.");
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <select
        value={periodo}
        onChange={(e) => setPeriodo(e.target.value)}
        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none focus:border-slate-950"
      >
        {PERIODOS.map((p) => (
          <option key={p.value} value={p.value}>{p.label}</option>
        ))}
      </select>
      <button
        onClick={() => void handleClick()}
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {label}
      </button>
      {error && <p className="mt-2 text-center text-xs text-rose-600">{error}</p>}
    </div>
  );
}
