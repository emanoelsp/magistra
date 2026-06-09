"use client";

import { useState } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { PLAN_LABELS } from "../../../lib/services/plan-config";

const PLANOS = ["free", "starter", "medio", "pro", "escola"];

export function PlanChanger({ uid, currentPlano }: { uid: string; currentPlano: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [plano, setPlano] = useState(currentPlano.toLowerCase());

  async function change(novo: string) {
    if (novo === plano) { setOpen(false); return; }
    setLoading(true);
    setOpen(false);
    try {
      const res = await fetch(`/api/admin/usuarios/${uid}/plano`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plano: novo }),
      });
      if (res.ok) setPlano(novo);
    } finally {
      setLoading(false);
    }
  }

  const colors: Record<string, string> = {
    free:    "bg-slate-100 text-slate-700",
    starter: "bg-blue-100 text-blue-700",
    medio:   "bg-violet-100 text-violet-700",
    pro:     "bg-amber-100 text-amber-700",
    escola:  "bg-emerald-100 text-emerald-700",
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={loading}
        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition hover:opacity-80 ${colors[plano] ?? "bg-slate-100 text-slate-700"}`}
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        {PLAN_LABELS[plano] ?? plano}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute left-0 top-7 z-10 w-36 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          {PLANOS.map((p) => (
            <button
              key={p}
              onClick={() => void change(p)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-slate-50"
            >
              <span className={p === plano ? "font-semibold text-slate-950" : "text-slate-700"}>
                {PLAN_LABELS[p] ?? p}
              </span>
              {p === plano && <Check className="h-3 w-3 text-emerald-600" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
