"use client";

import { useState } from "react";
import { X, Sparkles, ShoppingCart } from "lucide-react";

export type AvulsoTipo = "avulso_template" | "avulso_plano";

const PRECOS: Record<AvulsoTipo, number> = {
  avulso_template: 4,
  avulso_plano: 3,
};

const QTY_OPTIONS = [1, 2, 3, 4, 5];
const DURATION_OPTIONS = [
  { value: 1, label: "1 mês" },
  { value: 2, label: "2 meses" },
  { value: 3, label: "3 meses" },
  { value: 4, label: "4 meses" },
];

interface Props {
  tipo: AvulsoTipo;
  onClose: () => void;
}

export function AvulsoModal({ tipo, onClose }: Props) {
  const [qty, setQty] = useState(1);
  const [meses, setMeses] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const precoUnit = PRECOS[tipo];
  const precoMensal = precoUnit * qty;
  const precoTotal = precoMensal * meses;
  const isTemplate = tipo === "avulso_template";
  const label = isTemplate ? "template" : "plano";
  const labelPlural = isTemplate ? "templates" : "planos";

  function fmt(n: number) {
    return n.toLocaleString("pt-BR", { minimumFractionDigits: 2 });
  }

  async function handleCheckout() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/pagamentos/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, qty, periodo: String(meses) }),
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
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 pt-8 backdrop-blur-sm"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={onClose}
    >
      <style>{`
        @keyframes magis-pop {
          from { opacity: 0; transform: scale(0.85) translateY(24px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
      <div
        className="flex w-full max-w-sm flex-col overflow-hidden rounded-3xl shadow-2xl"
        style={{ animation: "magis-pop 0.35s cubic-bezier(0.34,1.56,0.64,1) both" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header WhatsApp */}
        <div className="flex shrink-0 items-center gap-3 bg-violet-700 px-5 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white leading-tight">Magis</p>
            <p className="text-[11px] text-violet-300">assistente de planos</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/60 transition hover:bg-white/20 hover:text-white"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Chat area */}
        <div className="bg-[#ece5dd] px-4 py-5 space-y-2">
          <div className="flex items-end gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-600 shadow-sm mb-0.5">
              <Sparkles className="h-3 w-3 text-white" />
            </div>
            <div className="flex max-w-[85%] flex-col gap-1">
              <div className="rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 shadow-sm">
                <p className="text-sm text-slate-800">
                  Quer mais {labelPlural} sem mudar de plano? 🎯
                </p>
              </div>
              <div className="rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 shadow-sm">
                <p className="text-sm text-slate-700">
                  Cada {label} extra custa{" "}
                  <strong>R$ {fmt(precoUnit)}/mês</strong>. Escolha a quantidade e por quantos meses — sem compromisso depois disso!
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Config + CTA */}
        <div className="shrink-0 flex flex-col gap-4 border-t border-slate-200 bg-white px-5 py-5">

          {/* Quantidade */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Quantos {labelPlural} extras?
            </p>
            <div className="flex gap-2">
              {QTY_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setQty(n)}
                  className={`flex h-10 flex-1 items-center justify-center rounded-xl text-sm font-semibold transition ${
                    qty === n
                      ? "bg-violet-600 text-white shadow-sm"
                      : "border border-slate-200 bg-slate-50 text-slate-700 hover:border-violet-300 hover:bg-violet-50"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Duração */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Por quanto tempo?
            </p>
            <div className="grid grid-cols-4 gap-2">
              {DURATION_OPTIONS.map(({ value, label: dlabel }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMeses(value)}
                  className={`flex h-10 items-center justify-center rounded-xl text-xs font-semibold transition ${
                    meses === value
                      ? "bg-violet-600 text-white shadow-sm"
                      : "border border-slate-200 bg-slate-50 text-slate-700 hover:border-violet-300 hover:bg-violet-50"
                  }`}
                >
                  {dlabel}
                </button>
              ))}
            </div>
          </div>

          {/* Resumo de preço */}
          <div className="rounded-2xl border border-violet-100 bg-violet-50 px-4 py-3">
            <div className="flex items-baseline justify-between">
              <p className="text-xs text-slate-500">
                {qty} {qty === 1 ? label : labelPlural} × {meses} {meses === 1 ? "mês" : "meses"}
              </p>
              <p className="text-lg font-bold text-slate-950">
                R$ {fmt(precoTotal)}
              </p>
            </div>
            {meses > 1 && (
              <p className="mt-0.5 text-[11px] text-slate-400">
                R$ {fmt(precoMensal)}/mês • cobrado mensalmente • cancela automaticamente após {meses} meses
              </p>
            )}
            {meses === 1 && (
              <p className="mt-0.5 text-[11px] text-slate-400">
                Cobrança única • sem renovação automática
              </p>
            )}
          </div>

          {error && (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>
          )}

          <button
            type="button"
            onClick={() => void handleCheckout()}
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 py-3 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:opacity-60"
          >
            <ShoppingCart className="h-4 w-4" />
            {loading ? "Aguarde…" : `Contratar ${qty} ${qty === 1 ? label : labelPlural} por ${meses} ${meses === 1 ? "mês" : "meses"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
