"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Sparkles, X } from "lucide-react";

export function StickyCta() {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 520);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (dismissed) return null;

  return (
    <div
      className={[
        "fixed bottom-6 left-6 z-50 transition-all duration-300",
        visible ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0 pointer-events-none",
      ].join(" ")}
    >
      <div className="flex items-center gap-4 rounded-2xl bg-slate-950 px-5 py-3.5 shadow-2xl shadow-slate-900/50 ring-1 ring-white/10">
        <div className="hidden items-center gap-2 sm:flex">
          <Sparkles className="h-4 w-4 text-violet-400" />
          <span className="text-sm font-medium text-slate-300">
            Comece grátis — sem cartão de crédito
          </span>
        </div>
        <Link
          href="/login"
          className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-violet-500"
        >
          Começar grátis
          <ArrowRight className="h-4 w-4" />
        </Link>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="ml-1 rounded-lg p-1 text-slate-500 transition hover:text-slate-200"
          aria-label="Fechar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
