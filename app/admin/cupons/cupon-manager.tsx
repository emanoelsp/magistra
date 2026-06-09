"use client";

import { useState } from "react";
import { Plus, Trash2, ToggleLeft, ToggleRight, Tag, X } from "lucide-react";
import { PLAN_LABELS } from "../../../lib/services/plan-config";
import type { CouponRecord } from "../../../lib/types/firestore";

const PLANOS_PAGOS = ["starter", "medio", "pro"];

interface Props {
  initial: CouponRecord[];
}

export function CuponManager({ initial }: Props) {
  const [cupons, setCupons] = useState<CouponRecord[]>(initial);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Form state
  const [code, setCode] = useState("");
  const [type, setType] = useState<"percent" | "fixed">("percent");
  const [value, setValue] = useState("");
  const [planos, setPlanos] = useState<string[]>(["medio"]);
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10));
  const [validUntil, setValidUntil] = useState("");
  const [maxUses, setMaxUses] = useState("");

  function resetForm() {
    setCode(""); setType("percent"); setValue(""); setPlanos(["medio"]);
    setValidFrom(new Date().toISOString().slice(0, 10)); setValidUntil(""); setMaxUses("");
    setFormError("");
  }

  async function handleCreate() {
    setFormError("");
    if (!code.trim() || !value || !validFrom || !validUntil || planos.length === 0) {
      setFormError("Preencha todos os campos obrigatórios.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/cupons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: code.trim().toUpperCase(),
          type,
          value: parseFloat(value),
          planos,
          valid_from: validFrom,
          valid_until: validUntil,
          max_uses: maxUses ? parseInt(maxUses, 10) : null,
        }),
      });
      const data = (await res.json()) as CouponRecord & { error?: string };
      if (!res.ok) { setFormError(data.error ?? "Erro ao criar cupom."); return; }
      setCupons((prev) => [data, ...prev]);
      setShowForm(false);
      resetForm();
    } catch {
      setFormError("Erro de conexão.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(id: string, active: boolean) {
    await fetch(`/api/admin/cupons/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !active }),
    });
    setCupons((prev) => prev.map((c) => (c.id === id ? { ...c, active: !active } : c)));
  }

  async function handleDelete(id: string) {
    if (!confirm("Excluir este cupom permanentemente?")) return;
    await fetch(`/api/admin/cupons/${id}`, { method: "DELETE" });
    setCupons((prev) => prev.filter((c) => c.id !== id));
  }

  function togglePlano(key: string) {
    setPlanos((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key],
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-950">Cupons de desconto</h1>
          <p className="mt-1 text-sm text-slate-500">{cupons.length} cupom{cupons.length !== 1 ? "s" : ""} cadastrado{cupons.length !== 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={() => { setShowForm(true); }}
          className="flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition"
        >
          <Plus className="h-4 w-4" />
          Novo cupom
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-slate-950">Novo cupom</h2>
            <button onClick={() => { setShowForm(false); resetForm(); }} className="text-slate-400 hover:text-slate-700">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Code */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Código do cupom</label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="EX: PROMO20"
                className="w-full rounded-2xl border border-slate-300 px-4 py-2.5 font-mono text-sm uppercase tracking-wider outline-none focus:border-slate-950"
              />
            </div>

            {/* Type */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Tipo de desconto</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setType("percent")}
                  className={`flex-1 rounded-xl border py-2 text-xs font-semibold transition ${type === "percent" ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 text-slate-600 hover:border-slate-400"}`}
                >
                  Percentual (%)
                </button>
                <button
                  type="button"
                  onClick={() => setType("fixed")}
                  className={`flex-1 rounded-xl border py-2 text-xs font-semibold transition ${type === "fixed" ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 text-slate-600 hover:border-slate-400"}`}
                >
                  Valor fixo (R$)
                </button>
              </div>
            </div>

            {/* Value */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {type === "percent" ? "Desconto (%)" : "Desconto (R$)"}
              </label>
              <input
                type="number"
                min={1}
                max={type === "percent" ? 100 : undefined}
                step="0.01"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={type === "percent" ? "Ex: 20" : "Ex: 5.00"}
                className="w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-slate-950"
              />
            </div>

            {/* Plans */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Válido para os planos</label>
              <div className="flex gap-2">
                {PLANOS_PAGOS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => togglePlano(key)}
                    className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${planos.includes(key) ? "border-violet-500 bg-violet-50 text-violet-700" : "border-slate-200 text-slate-500 hover:border-slate-400"}`}
                  >
                    {PLAN_LABELS[key]}
                  </button>
                ))}
              </div>
            </div>

            {/* Valid from / until */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Válido a partir de</label>
              <input
                type="date"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
                className="w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Válido até</label>
              <input
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                min={validFrom}
                className="w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-slate-950"
              />
            </div>

            {/* Max uses */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Limite de usos (deixe vazio = ilimitado)</label>
              <input
                type="number"
                min={1}
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                placeholder="Ilimitado"
                className="w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-slate-950"
              />
            </div>
          </div>

          {formError && (
            <p className="mt-3 rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-700">{formError}</p>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setShowForm(false); resetForm(); }}
              className="rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:border-slate-400"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={saving}
              className="rounded-2xl bg-slate-950 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {saving ? "Salvando…" : "Criar cupom"}
            </button>
          </div>
        </div>
      )}

      {/* Coupon list */}
      {cupons.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-300 p-12 text-center">
          <Tag className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm text-slate-500">Nenhum cupom cadastrado.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Código</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Desconto</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Planos</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Validade</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Usos</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cupons.map((c) => {
                const expired = new Date().toISOString().slice(0, 10) > c.valid_until;
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <code className="rounded-lg bg-slate-100 px-2 py-0.5 font-mono text-xs font-bold text-slate-800">
                        {c.code}
                      </code>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-800">
                      {c.type === "percent" ? `${c.value}%` : `R$ ${c.value.toFixed(2).replace(".", ",")}`}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {c.planos.map((p) => (
                          <span key={p} className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                            {PLAN_LABELS[p] ?? p}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      <span className={expired ? "text-rose-500" : ""}>
                        {c.valid_from} → {c.valid_until}
                        {expired && " (expirado)"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {c.uses}{c.max_uses !== null ? ` / ${c.max_uses}` : ""}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => void handleToggle(c.id, c.active)}
                        className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold transition ${c.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400"}`}
                      >
                        {c.active ? (
                          <><ToggleRight className="h-3.5 w-3.5" /> Ativo</>
                        ) : (
                          <><ToggleLeft className="h-3.5 w-3.5" /> Inativo</>
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => void handleDelete(c.id)}
                        className="rounded-lg p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-500 transition"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
