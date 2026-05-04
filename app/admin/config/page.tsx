"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Save } from "lucide-react";

interface Config {
  vercel_monthly_usd: number;
  firebase_monthly_usd: number;
  other_monthly_usd: number;
  gemini_input_cost_per_1m: number;
  gemini_output_cost_per_1m: number;
}

const DEFAULTS: Config = {
  vercel_monthly_usd: 0,
  firebase_monthly_usd: 0,
  other_monthly_usd: 0,
  gemini_input_cost_per_1m: 0.075,
  gemini_output_cost_per_1m: 0.30,
};

export default function ConfigPage() {
  const [config, setConfig] = useState<Config>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/config")
      .then((r) => r.json())
      .then((d: { config: Config }) => { setConfig(d.config); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error("Falha ao salvar.");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  function field(
    key: keyof Config,
    label: string,
    help: string,
  ) {
    return (
      <label key={key} className="block">
        <span className="block text-sm font-medium text-slate-700">{label}</span>
        <span className="block text-xs text-slate-500">{help}</span>
        <input
          type="number"
          step="0.001"
          min="0"
          value={config[key]}
          onChange={(e) => setConfig((prev) => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))}
          className="mt-1.5 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-slate-950"
        />
      </label>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  return (
    <div className="max-w-xl space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-violet-600">Admin</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-950">Configuração de custos</h1>
        <p className="mt-1 text-sm text-slate-500">
          Esses valores são usados para calcular o custo real exibido no backoffice.
        </p>
      </div>

      {/* Fixed costs */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-slate-900">Custos fixos mensais (USD)</h2>
        <div className="space-y-4">
          {field("vercel_monthly_usd", "Vercel (hosting + Blob)", "Valor da fatura mensal do Vercel em USD")}
          {field("firebase_monthly_usd", "Firebase (Firestore + Auth)", "Valor da fatura mensal do Firebase. Plano Spark = $0")}
          {field("other_monthly_usd", "Outros (domínio, e-mail, etc.)", "Qualquer outro custo fixo mensal")}
        </div>
      </div>

      {/* AI pricing */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-1 text-base font-semibold text-slate-900">Tarifas de IA (USD por 1M tokens)</h2>
        <p className="mb-4 text-xs text-slate-500">
          Gemini 2.0 Flash: input $0,075 / output $0,30. Atualize se mudar de modelo.
          Consulte{" "}
          <a
            href="https://ai.google.dev/pricing"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-violet-700"
          >
            ai.google.dev/pricing
          </a>
          .
        </p>
        <div className="space-y-4">
          {field("gemini_input_cost_per_1m", "Custo por 1M tokens de input", "Tokens enviados ao modelo (prompt)")}
          {field("gemini_output_cost_per_1m", "Custo por 1M tokens de output", "Tokens gerados pelo modelo (resposta)")}
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={void handleSave}
          disabled={saving}
          className="flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar configuração
        </button>
        {saved && (
          <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-600">
            <CheckCircle2 className="h-4 w-4" /> Salvo com sucesso
          </span>
        )}
        {error && <span className="text-sm text-rose-600">{error}</span>}
      </div>

      {/* Storage migration note */}
      <div className="rounded-2xl border border-amber-100 bg-amber-50 p-5">
        <p className="text-sm font-semibold text-amber-800">Migração Vercel Blob → Cloudflare R2</p>
        <p className="mt-1 text-xs text-amber-700">
          O storage atual (Vercel Blob) tem 500 MB gratuitos. Quando se aproximar desse limite ou
          quando o custo de bandwidth aumentar com o crescimento, migre para Cloudflare R2 (10 GB
          gratuitos, zero egress). As instruções de migração estão documentadas em{" "}
          <code className="rounded bg-amber-100 px-1 text-amber-800">lib/storage/blob.ts</code>.
        </p>
      </div>
    </div>
  );
}
