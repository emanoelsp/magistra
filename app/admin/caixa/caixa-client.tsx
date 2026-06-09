"use client";

import { useState } from "react";
import { Calculator, CheckCircle2, Loader2 } from "lucide-react";
import type { BalanceteRecord } from "../../../lib/types/firestore";

function brl(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function FecharCaixaButton({ tipo, label }: { tipo: "mensal" | "anual"; label: string }) {
  const [loading, setLoading] = useState(false);
  const [notas, setNotas] = useState("");
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ resultado_brl: number; saldo_final_brl: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fechar() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/caixa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, notas }),
      });
      const data = (await res.json()) as { error?: string; resultado_brl?: number; saldo_final_brl?: number };
      if (!res.ok) throw new Error(data.error ?? "Erro ao fechar caixa.");
      setResult({ resultado_brl: data.resultado_brl ?? 0, saldo_final_brl: data.saldo_final_brl ?? 0 });
      setOpen(false);
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro inesperado.");
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        <span className="text-sm font-medium text-emerald-800">
          Caixa fechado · Resultado: {brl(result.resultado_brl)} · Saldo: {brl(result.saldo_final_brl)}
        </span>
      </div>
    );
  }

  return (
    <div>
      {!open ? (
        <button onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950">
          <Calculator className="h-4 w-4" />
          {label}
        </button>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <p className="text-sm font-semibold text-slate-950">{label}</p>
          <textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            rows={3}
            placeholder="Observações opcionais para o balancete…"
            className="w-full resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950"
          />
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => void fechar()} disabled={loading}
              className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Calculator className="h-3.5 w-3.5" />}
              Confirmar fechamento
            </button>
            <button onClick={() => { setOpen(false); setError(null); }}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function BalanceteCard({ b }: { b: BalanceteRecord }) {
  const positivo = b.resultado_brl >= 0;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${b.tipo === "anual" ? "bg-violet-100 text-violet-700" : "bg-blue-100 text-blue-700"}`}>
              {b.tipo === "anual" ? "Anual" : "Mensal"}
            </span>
            <span className="font-bold text-slate-950">{b.periodo}</span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Fechado em {b.fechado_em.slice(0, 10)} · por {b.fechado_por}
          </p>
        </div>
        <span className={`text-lg font-bold ${positivo ? "text-emerald-700" : "text-rose-600"}`}>
          {brl(b.resultado_brl)}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Receita (MRR)", value: brl(b.mrr_brl), color: "text-emerald-700" },
          { label: "Custo IA", value: `$${b.custo_ia_usd.toFixed(4)}`, color: "text-rose-600" },
          { label: "Custo fixo", value: `$${b.custo_fixo_usd.toFixed(2)}`, color: "text-rose-500" },
          { label: "Saldo final", value: brl(b.saldo_final_brl), color: b.saldo_final_brl >= 0 ? "text-emerald-700" : "text-rose-600" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl bg-slate-50 px-3 py-2">
            <p className="text-xs text-slate-500">{label}</p>
            <p className={`mt-0.5 text-sm font-semibold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-400">
        <span>{b.total_usuarios} usuários</span>
        <span>{b.planos_gerados} planos gerados</span>
        <span>{b.tokens_total.toLocaleString("pt-BR")} tokens</span>
        {b.notas && <span className="italic text-slate-500">"{b.notas}"</span>}
      </div>
    </div>
  );
}
