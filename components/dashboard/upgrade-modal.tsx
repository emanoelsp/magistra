"use client";

import { useState } from "react";
import { X, TrendingUp } from "lucide-react";
import { PLAN_LABELS, PLAN_PRICES_BRL } from "../../lib/services/plan-config";

const PLANOS_PAGOS = [
  { key: "starter", desc: "1 template · 2 planos/mês" },
  { key: "medio",   desc: "2 templates · 4 planos/mês" },
  { key: "pro",     desc: "5 templates · 10 planos/mês" },
];

const PERIODOS = [
  { value: "auto", label: "Mensal — renova automaticamente" },
  { value: "1",    label: "Mensal — 1 mês" },
  { value: "2",    label: "Bimestral — 2 meses" },
  { value: "3",    label: "Trimestral — 3 meses" },
  { value: "6",    label: "Semestral — 6 meses" },
  { value: "12",   label: "Anual — 12 meses" },
];

interface Props {
  onClose: () => void;
}

export function UpgradeModal({ onClose }: Props) {
  const [plano, setPlano] = useState("medio");
  const [periodo, setPeriodo] = useState("auto");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleCheckout() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/pagamentos/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plano, periodo }),
      });
      const data = (await res.json()) as { init_point?: string; error?: string };
      if (!res.ok || !data.init_point) throw new Error(data.error ?? "Erro ao criar checkout");
      window.location.href = data.init_point;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro inesperado");
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-3xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 pb-4">
          <h2 className="text-lg font-semibold text-slate-950">Fazer upgrade do plano</h2>
          <button onClick={onClose} className="rounded-xl p-1 text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-6 pb-6">
          <div className="grid gap-2">
            {PLANOS_PAGOS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPlano(p.key)}
                className={[
                  "flex items-center justify-between rounded-2xl border p-4 text-left transition",
                  plano === p.key
                    ? "border-slate-950 bg-slate-950 text-white"
                    : "border-slate-200 hover:border-slate-400",
                ].join(" ")}
              >
                <div>
                  <p className="text-sm font-semibold">{PLAN_LABELS[p.key]}</p>
                  <p className={["text-xs mt-0.5", plano === p.key ? "text-white/70" : "text-slate-500"].join(" ")}>
                    {p.desc}
                  </p>
                </div>
                <p className={["text-sm font-bold", plano === p.key ? "text-white" : "text-slate-950"].join(" ")}>
                  R$ {PLAN_PRICES_BRL[p.key]?.toFixed(2).replace(".", ",")}/mês
                </p>
              </button>
            ))}
          </div>

          <select
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value)}
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-950"
          >
            {PERIODOS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <button
            onClick={handleCheckout}
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
          >
            <TrendingUp className="h-4 w-4" />
            {loading ? "Aguarde…" : "Ir para o pagamento"}
          </button>
        </div>
      </div>
    </div>
  );
}
