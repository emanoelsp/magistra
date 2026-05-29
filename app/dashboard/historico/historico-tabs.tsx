"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FileText, FolderKanban } from "lucide-react";

interface HistoricoTabsProps {
  totalPlanos: number;
  totalTemplates: number;
}

export function HistoricoTabs({ totalPlanos, totalTemplates }: HistoricoTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") === "templates" ? "templates" : "planos";

  function go(newTab: string) {
    router.push(`/dashboard/historico?tab=${newTab}&page=1`);
  }

  return (
    <div className="flex gap-1 rounded-2xl border border-slate-200 bg-slate-100 p-1 w-fit">
      <button
        onClick={() => go("planos")}
        className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition ${
          tab === "planos"
            ? "bg-white text-slate-950 shadow-sm"
            : "text-slate-500 hover:text-slate-800"
        }`}
      >
        <FileText className="h-4 w-4" />
        Planos
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
          tab === "planos" ? "bg-slate-100 text-slate-700" : "bg-slate-200 text-slate-500"
        }`}>
          {totalPlanos}
        </span>
      </button>

      <button
        onClick={() => go("templates")}
        className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition ${
          tab === "templates"
            ? "bg-white text-slate-950 shadow-sm"
            : "text-slate-500 hover:text-slate-800"
        }`}
      >
        <FolderKanban className="h-4 w-4" />
        Templates
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
          tab === "templates" ? "bg-slate-100 text-slate-700" : "bg-slate-200 text-slate-500"
        }`}>
          {totalTemplates}
        </span>
      </button>
    </div>
  );
}
