"use client";

import { useState, useEffect, useRef } from "react";
import { X, TrendingUp, Tag, CheckCircle2, AlertCircle, Loader2, ChevronDown } from "lucide-react";
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

interface CouponResult {
  ok: boolean;
  type?: "percent" | "fixed";
  value?: number;
  basePrice?: number;
  discount?: number;
  finalPrice?: number;
  error?: string;
}

interface Props {
  onClose: () => void;
}

export function UpgradeModal({ onClose }: Props) {
  const [plano, setPlano] = useState("medio");
  const [periodo, setPeriodo] = useState("auto");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Coupon state
  const [showCupom, setShowCupom] = useState(false);
  const [cupomInput, setCupomInput] = useState("");
  const [cupomApplied, setCupomApplied] = useState("");
  const [cupomResult, setCupomResult] = useState<CouponResult | null>(null);
  const [cupomLoading, setCupomLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-validate coupon when plan changes
  useEffect(() => {
    if (!cupomApplied) return;
    void validateCupom(cupomApplied, plano);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plano]);

  async function validateCupom(code: string, targetPlano: string) {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) { setCupomResult(null); setCupomApplied(""); return; }
    setCupomLoading(true);
    try {
      const res = await fetch("/api/pagamentos/validar-cupom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed, plano: targetPlano }),
      });
      const data = (await res.json()) as CouponResult;
      setCupomResult(data);
      if (data.ok) setCupomApplied(trimmed);
      else setCupomApplied("");
    } catch {
      setCupomResult({ ok: false, error: "Não foi possível validar o cupom." });
      setCupomApplied("");
    } finally {
      setCupomLoading(false);
    }
  }

  function handleCupomChange(value: string) {
    setCupomInput(value);
    setCupomResult(null);
    setCupomApplied("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length >= 3) {
      debounceRef.current = setTimeout(() => void validateCupom(value, plano), 600);
    }
  }

  function handlePlanoChange(key: string) {
    setPlano(key);
    // Re-validation triggered by useEffect
  }

  const basePrice = PLAN_PRICES_BRL[plano] ?? 0;
  const effectivePrice = cupomResult?.ok ? (cupomResult.finalPrice ?? basePrice) : basePrice;

  async function handleCheckout() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/pagamentos/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plano, periodo, cupom: cupomApplied || undefined }),
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
          {/* Plan selector */}
          <div className="grid gap-2">
            {PLANOS_PAGOS.map((p) => (
              <button
                key={p.key}
                onClick={() => handlePlanoChange(p.key)}
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

          {/* Period selector */}
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

          {/* Coupon toggle */}
          {!showCupom ? (
            <button
              type="button"
              onClick={() => setShowCupom(true)}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-violet-600 transition"
            >
              <Tag className="h-3.5 w-3.5" />
              Tenho um cupom de desconto
            </button>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={cupomInput}
                    onChange={(e) => handleCupomChange(e.target.value.toUpperCase())}
                    placeholder="CÓDIGO DO CUPOM"
                    className={[
                      "w-full rounded-2xl border px-4 py-2.5 font-mono text-sm tracking-wider outline-none transition uppercase",
                      cupomResult?.ok
                        ? "border-emerald-400 bg-emerald-50 text-emerald-800"
                        : cupomResult && !cupomResult.ok
                          ? "border-rose-300 bg-rose-50"
                          : "border-slate-300 focus:border-slate-950",
                    ].join(" ")}
                  />
                  {cupomLoading && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-slate-400" />
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => { setShowCupom(false); setCupomInput(""); setCupomResult(null); setCupomApplied(""); }}
                  className="rounded-2xl border border-slate-200 px-3 text-slate-400 hover:text-slate-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {cupomResult?.ok && (
                <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    Desconto de{" "}
                    <strong>
                      {cupomResult.type === "percent"
                        ? `${cupomResult.value}%`
                        : `R$ ${cupomResult.value?.toFixed(2).replace(".", ",")}`}
                    </strong>{" "}
                    aplicado.
                  </span>
                </div>
              )}
              {cupomResult && !cupomResult.ok && (
                <div className="flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {cupomResult.error}
                </div>
              )}
            </div>
          )}

          {/* Price summary when coupon is applied */}
          {cupomResult?.ok && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
              <div className="flex justify-between text-slate-500">
                <span>Preço original</span>
                <span>R$ {basePrice.toFixed(2).replace(".", ",")}/mês</span>
              </div>
              <div className="flex justify-between text-emerald-700">
                <span>Desconto</span>
                <span>− R$ {cupomResult.discount?.toFixed(2).replace(".", ",")}</span>
              </div>
              <div className="mt-1 flex justify-between border-t border-emerald-200 pt-1 font-semibold text-emerald-800">
                <span>Total</span>
                <span>R$ {effectivePrice.toFixed(2).replace(".", ",")}/mês</span>
              </div>
            </div>
          )}

          {error && <p className="text-xs text-red-600">{error}</p>}

          <button
            onClick={handleCheckout}
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
          >
            <TrendingUp className="h-4 w-4" />
            {loading
              ? "Aguarde…"
              : cupomResult?.ok
                ? `Ir para o pagamento — R$ ${effectivePrice.toFixed(2).replace(".", ",")}/mês`
                : "Ir para o pagamento"}
          </button>
        </div>
      </div>
    </div>
  );
}
