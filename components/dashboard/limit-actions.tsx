"use client";

import { useState } from "react";
import { TrendingUp, Sparkles } from "lucide-react";
import { UpgradeModal } from "./upgrade-modal";
import { AvulsoModal, type AvulsoTipo } from "./avulso-modal";

interface Props {
  avulsoTipo: AvulsoTipo;
  avulsoLabel: string;
}

export function LimitActions({ avulsoTipo, avulsoLabel }: Props) {
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [showAvulso, setShowAvulso] = useState(false);

  return (
    <>
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <button
          onClick={() => setShowUpgrade(true)}
          className="flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          <TrendingUp className="h-4 w-4" />
          Fazer upgrade do plano
        </button>
        <button
          onClick={() => setShowAvulso(true)}
          className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-white"
        >
          <Sparkles className="h-4 w-4 text-violet-500" />
          {avulsoLabel}
        </button>
      </div>

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
      {showAvulso && <AvulsoModal tipo={avulsoTipo} onClose={() => setShowAvulso(false)} />}
    </>
  );
}
