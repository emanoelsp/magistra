"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

interface Props {
  features: readonly string[];
}

export function PlanFeaturesToggle({ features }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-500 transition hover:border-slate-400 hover:text-slate-700"
      >
        <span>{open ? "Ocultar detalhes" : `Ver ${features.length} benefícios inclusos`}</span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        )}
      </button>

      {open && (
        <ul className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              {f}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
