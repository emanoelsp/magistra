"use client";

import { useState } from "react";
import { X, Sparkles, ChevronDown } from "lucide-react";

export type AvulsoTipo = "avulso_template" | "avulso_plano";

const PERIODOS = [
  { value: "auto", label: "Mensal — renova automaticamente" },
  { value: "1",    label: "Mensal — 1 mês" },
  { value: "2",    label: "Bimestral — 2 meses" },
  { value: "3",    label: "Trimestral — 3 meses" },
  { value: "6",    label: "Semestral — 6 meses" },
  { value: "12",   label: "Anual — 12 meses" },
];

interface Props {
  tipo: AvulsoTipo;
  onClose: () => void;
}

export function AvulsoModal({ tipo, onClose }: Props) {
  const [periodo, setPeriodo] = useState("1");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const preco = tipo === "avulso_template" ? 4 : 3;
  const label = tipo === "avulso_template" ? "template extra" : "plano extra";
  const descricao = tipo === "avulso_template"
    ? "Adiciona +1 slot de template ao seu plano atual."
    : "Adiciona +1 plano por mês ao seu plano atual.";

  async function handleCheckout() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/pagamentos/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, periodo }),
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
        className="w-full max-w-sm rounded-3xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 pb-4">
          <h2 className="text-lg font-semibold text-slate-950">Contratar {label}</h2>
          <button onClick={onClose} className="rounded-xl p-1 text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-6 pb-6">
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-sm text-slate-700">{descricao}</p>
            <p className="mt-2 text-2xl font-bold text-slate-950">
              R$ {preco},00
              <span className="text-sm font-normal text-slate-500">/mês</span>
            </p>
          </div>

          <div className="relative">
            <select
              value={periodo}
              onChange={(e) => setPeriodo(e.target.value)}
              className="w-full appearance-none rounded-2xl border border-slate-300 bg-white px-4 py-3 pr-10 text-sm text-slate-950 outline-none transition focus:border-slate-950 focus:ring-2 focus:ring-slate-100"
            >
              {PERIODOS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <button
            onClick={handleCheckout}
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 py-3 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:opacity-60"
          >
            <Sparkles className="h-4 w-4" />
            {loading ? "Aguarde…" : "Ir para o pagamento"}
          </button>
        </div>
      </div>
    </div>
  );
}
