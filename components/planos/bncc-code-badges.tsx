"use client";

/**
 * Clickable BNCC/SAEB code badges. Each badge toggles the official text of
 * the habilidade/descritor, resolved server-side from the RAG context — the
 * teacher can audit any citation without leaving the editor.
 */

import { useState } from "react";
import type { CodigoOficial } from "../../lib/types/firestore";

export function BnccCodeBadges({ codigos }: { codigos?: CodigoOficial[] }) {
  const [openCodigo, setOpenCodigo] = useState<string | null>(null);

  if (!codigos || codigos.length === 0) return null;
  const aberto = codigos.find((c) => c.codigo === openCodigo);

  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap gap-1">
        {codigos.map((c) => (
          <button
            key={c.codigo}
            type="button"
            onClick={() => setOpenCodigo((cur) => (cur === c.codigo ? null : c.codigo))}
            title="Ver texto oficial"
            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide transition ${
              openCodigo === c.codigo
                ? "border-violet-400 bg-violet-600 text-white"
                : "border-violet-200 bg-violet-50 text-violet-700 hover:border-violet-400 hover:bg-violet-100"
            }`}
          >
            {c.codigo}
          </button>
        ))}
      </div>
      {aberto && (
        <div className="mt-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Texto oficial · {aberto.origem === "saeb" ? "SAEB" : "BNCC"}
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-slate-700">{aberto.texto}</p>
        </div>
      )}
    </div>
  );
}
