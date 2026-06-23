import { Lock } from "lucide-react";
import { TermsLink } from "./terms-modal";

export function LandingFooter() {
  return (
    <footer className="border-t border-slate-800 bg-slate-950 py-10">
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-4 py-2">
            <Lock className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-xs font-medium text-slate-400">Dados seguros · Conformidade LGPD</span>
          </div>
          <p className="text-xs text-slate-400">© 2026 PlanoMagistra · Para professores da educação básica brasileira</p>
          <TermsLink />
          <p className="text-[10px] text-slate-600">Powered by Magis — Assistente Pedagógica IA do Plano Magistra</p>
        </div>
      </div>
    </footer>
  );
}
