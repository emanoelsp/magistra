"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { TemplateFieldSchema } from "../../lib/types/firestore";

interface TemplatePreviewClientProps {
  templateId: string;
  schema: TemplateFieldSchema[];
  isDocx: boolean;
}

export function TemplatePreviewClient({
  templateId,
  schema,
  isDocx,
}: TemplatePreviewClientProps) {
  if (!isDocx) return <SchemaTable schema={schema} />;
  return <DocxPreview templateId={templateId} schema={schema} />;
}

// ─── DocxPreview ──────────────────────────────────────────────────────────────

function DocxPreview({ templateId, schema }: { templateId: string; schema: TemplateFieldSchema[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  // "loading" → fetching; "rendering" → renderAsync running; "done" | "error"
  const [phase, setPhase] = useState<"loading" | "rendering" | "done" | "error">("loading");
  const bufferRef = useRef<ArrayBuffer | null>(null);

  // Phase 1: fetch the DOCX file
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/templates/${templateId}/arquivo`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => {
        if (cancelled) return;
        bufferRef.current = buf;
        setPhase("rendering"); // triggers phase 2
      })
      .catch(() => { if (!cancelled) setPhase("error"); });
    return () => { cancelled = true; };
  }, [templateId]);

  // Phase 2: render — runs after "rendering" state + container is mounted
  useEffect(() => {
    if (phase !== "rendering" || !bufferRef.current) return;
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    import("docx-preview")
      .then(({ renderAsync }) => {
        if (cancelled || !bufferRef.current) return;
        container.innerHTML = "";
        return renderAsync(bufferRef.current, container, undefined, {
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: true,
          ignoreFonts: false,
          breakPages: true,
          useBase64URL: true,
          renderEndnotes: true,
          renderFooters: true,
          renderFootnotes: true,
          renderHeaders: true,
        });
      })
      .then(() => { if (!cancelled) setPhase("done"); })
      .catch(() => { if (!cancelled) setPhase("error"); });

    return () => { cancelled = true; };
  }, [phase]);

  // Phase 3: inject {{key}} chips into the value cell next to each matched label
  useEffect(() => {
    if (phase !== "done" || !containerRef.current) return;
    const container = containerRef.current;

    container.querySelectorAll("[data-field-chip]").forEach((el) => el.remove());

    const allTds = Array.from(container.querySelectorAll("td")) as HTMLElement[];
    const allPs  = Array.from(container.querySelectorAll("p"))  as HTMLElement[];
    const candidates = [...allTds, ...allPs];

    function makeChip(key: string, isIa: boolean) {
      const chip = document.createElement("span");
      chip.setAttribute("data-field-chip", key);
      chip.style.cssText = [
        "display:inline-block",
        "padding:2px 8px",
        "border-radius:6px",
        "font-family:monospace",
        "font-size:10px",
        "font-weight:700",
        "white-space:nowrap",
        "line-height:1.7",
        isIa
          ? "background:rgba(139,92,246,.14);color:#6d28d9;border:1px solid rgba(139,92,246,.35)"
          : "background:rgba(245,158,11,.14);color:#b45309;border:1px solid rgba(245,158,11,.35)",
      ].join(";");
      chip.textContent = `{{${key}}}`;
      return chip;
    }

    for (const field of schema) {
      const terms = [field.label, field.defaultValue].filter(
        (t): t is string => typeof t === "string" && t.trim().length > 2,
      );
      if (!terms.length) continue;

      // 1. Find the label cell with best match score
      let labelEl: HTMLElement | null = null;
      let bestScore = 0;
      for (const el of candidates) {
        if (el.querySelector("[data-field-chip]")) continue;
        const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
        if (!text) continue;
        for (const term of terms) {
          if (text.toLowerCase().includes(term.toLowerCase())) {
            const score = term.length / Math.max(text.length, 1);
            if (score > bestScore) { bestScore = score; labelEl = el; }
          }
        }
      }
      if (!labelEl || bestScore < 0.25) continue;

      const isIa = field.role === "ia_sugerida";

      // 2. Find the best target cell to place the chip
      let targetEl: HTMLElement | null = null;

      if (labelEl.tagName === "TD") {
        const tr = labelEl.closest("tr");
        if (tr) {
          // Try the next empty sibling td in the same row
          const tds = Array.from(tr.querySelectorAll("td")) as HTMLElement[];
          const idx = tds.indexOf(labelEl);
          for (let i = idx + 1; i < tds.length; i++) {
            if (!(tds[i].textContent ?? "").trim()) {
              targetEl = tds[i];
              break;
            }
          }
          // If no empty sibling, try the first empty td of the next row
          if (!targetEl) {
            const nextTr = tr.nextElementSibling as HTMLElement | null;
            if (nextTr) {
              const nextTds = Array.from(nextTr.querySelectorAll("td")) as HTMLElement[];
              for (const td of nextTds) {
                if (!(td.textContent ?? "").trim() && !td.querySelector("[data-field-chip]")) {
                  targetEl = td;
                  break;
                }
              }
            }
          }
        }
      }

      // 3. Fallback: append inline to the label element
      if (targetEl) {
        targetEl.appendChild(makeChip(field.key, isIa));
      } else {
        labelEl.appendChild(makeChip(field.key, isIa));
      }
    }
  }, [phase, schema]);

  const busy = phase === "loading" || phase === "rendering";

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
        <p className="text-[11px] text-slate-500">
          Pré-visualização aproximada — o arquivo gerado preserva 100% do layout original.
        </p>
      </div>
      <style>{`
        .docx-wrapper { background: #f1f5f9 !important; padding: 24px 16px !important; min-height: 300px; }
        .docx-wrapper section.docx {
          box-shadow: 0 2px 8px rgba(0,0,0,.10), 0 8px 32px rgba(0,0,0,.07) !important;
          border-radius: 3px !important;
          margin-bottom: 16px !important;
        }
      `}</style>

      {/* Container always mounted so ref is available for renderAsync */}
      <div className={`overflow-y-auto max-h-[70vh] ${busy || phase === "error" ? "hidden" : ""}`}>
        <div ref={containerRef} />
      </div>

      {busy && (
        <div className="flex h-64 items-center justify-center gap-3 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin text-violet-500" />
          <span className="text-sm">
            {phase === "loading" ? "Carregando documento…" : "Renderizando…"}
          </span>
        </div>
      )}

      {phase === "error" && (
        <div className="p-8 text-center">
          <p className="text-sm text-slate-500">Não foi possível carregar o documento.</p>
          <div className="mt-6">
            <SchemaTable schema={schema} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Fallback for PDFs or templates without arquivo ───────────────────────────

interface SchemaTableProps {
  schema: TemplateFieldSchema[];
}

function SchemaTable({ schema }: SchemaTableProps) {
  const manual = schema.filter((f) => f.role === "manual" || f.group === "dados_turma");
  const ia = schema.filter((f) => f.role === "ia_sugerida");
  const outros = schema.filter((f) => !f.role && f.group !== "dados_turma");

  if (schema.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-300 p-10 text-center">
        <p className="text-sm text-slate-500">Este template não tem campos extraídos ainda.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {manual.length > 0 && (
        <section className="rounded-3xl border border-amber-200 bg-white p-6">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-amber-600">
            Campos fixos — professor preenche
          </p>
          <ul className="space-y-2">
            {manual.map((f) => (
              <li
                key={f.key}
                className="flex items-start gap-3 rounded-xl border-l-2 border-amber-400 bg-amber-50 px-4 py-2.5"
              >
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-900">{f.label}</p>
                  {f.placeholder && (
                    <p className="text-xs text-slate-400">{f.placeholder}</p>
                  )}
                </div>
                <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                  {f.type}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {ia.length > 0 && (
        <section className="rounded-3xl border border-violet-200 bg-white p-6">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-violet-600">
            Campos IA — sugestão automática
          </p>
          <ul className="space-y-2">
            {ia.map((f) => (
              <li
                key={f.key}
                className="flex items-start gap-3 rounded-xl border-l-2 border-violet-400 bg-violet-50 px-4 py-2.5"
              >
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-900">{f.label}</p>
                  {f.aiInstructions && (
                    <p className="mt-0.5 text-xs text-violet-600">
                      Instrução IA: {f.aiInstructions}
                    </p>
                  )}
                  {f.placeholder && (
                    <p className="text-xs text-slate-400">{f.placeholder}</p>
                  )}
                </div>
                <span className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                  {f.group ?? "outros"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {outros.length > 0 && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">
            Outros campos
          </p>
          <ul className="space-y-2">
            {outros.map((f) => (
              <li
                key={f.key}
                className="flex items-start gap-3 rounded-xl border-l-2 border-slate-300 bg-slate-50 px-4 py-2.5"
              >
                <p className="flex-1 text-sm font-medium text-slate-900">{f.label}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
