"use client";

import { useState } from "react";
import { TrendingUp } from "lucide-react";
import { UpgradeModal } from "./upgrade-modal";

export function PerfilUpgradeButton() {
  const [showUpgrade, setShowUpgrade] = useState(false);

  return (
    <>
      <button
        onClick={() => setShowUpgrade(true)}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/10 py-3 text-sm font-semibold text-white backdrop-blur-sm transition hover:bg-white/20"
      >
        <TrendingUp className="h-4 w-4" />
        Fazer upgrade do plano
      </button>

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </>
  );
}
