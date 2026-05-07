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
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(isDocx);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isDocx) return;
    setLoading(true);
    fetch(`/api/templates/${templateId}/editor-html`)
      .then((r) => r.json())
      .then((data: { html?: string | null; reason?: string }) => {
        if (data.html) {
          setHtml(data.html);
        } else {
          setError(
            data.reason === "not_docx"
              ? "Visualização de documento não disponível para este formato."
              : "Não foi possível carregar o documento.",
          );
        }
      })
      .catch(() => setError("Erro ao carregar o documento."))
      .finally(() => setLoading(false));
  }, [templateId, isDocx]);

  // Paint HTML with read-only annotated cells
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !html) return;
    container.innerHTML = html;

    container.querySelectorAll<HTMLElement>("[data-field-key]").forEach((cell) => {
      const role = cell.dataset.fieldRole ?? "";
      const label = cell.dataset.fieldLabel ?? cell.dataset.fieldKey ?? "";

      cell.contentEditable = "false";
      cell.style.cursor = "default";
      cell.style.position = "relative";

      // Color by role
      if (role === "ia_sugerida") {
        cell.style.background = "#faf5ff";
        cell.style.borderLeft = "3px solid #8b5cf6";
      } else {
        // manual / fixed
        cell.style.background = "#fffbeb";
        cell.style.borderLeft = "3px solid #f59e0b";
      }

      // Show placeholder text (field label) when cell is empty
      if (!cell.textContent?.trim()) {
        cell.style.color = "#94a3b8";
        if (role === "ia_sugerida") {
          cell.textContent = `IA sugere: ${label}`;
        } else {
          cell.textContent = label;
        }
      }
    });
  }, [html]);

  if (!isDocx) {
    return (
      <SchemaTable schema={schema} />
    );
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-3 rounded-3xl border border-slate-200 bg-white text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin text-violet-500" />
        <span className="text-sm">Carregando documento…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center">
        <p className="text-sm text-slate-500">{error}</p>
        <SchemaTable schema={schema} />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-100">
      <style>{`
        .tpl-preview-page {
          background:#fff;
          box-shadow:0 1px 4px rgba(0,0,0,.08),0 6px 28px rgba(0,0,0,.07);
          border-radius:2px;
          padding:40px 48px 56px;
          max-width:820px;
          margin:0 auto;
          font-family:"Calibri","Liberation Sans",Arial,sans-serif;
          font-size:12px;
          color:#111;
          line-height:1.5;
        }
        .tpl-preview-view table{width:100%;border-collapse:collapse;margin:4px 0;}
        .tpl-preview-view td,.tpl-preview-view th{
          border:1px solid #555;padding:4px 8px;
          vertical-align:top;font-size:12px;min-width:24px;
        }
        .tpl-preview-view th{font-weight:700;background:#f0f0f0;}
        .tpl-preview-view p{margin:2px 0;line-height:1.5;}
        .tpl-preview-view h1{font-size:15px;font-weight:700;text-align:center;margin:10px 0 6px;}
        .tpl-preview-view h2{font-size:13px;font-weight:700;text-align:center;margin:8px 0 4px;}
        .tpl-preview-view h3{font-size:12px;font-weight:700;margin:6px 0 3px;}
        .tpl-preview-view strong{font-weight:700;}
        .tpl-preview-view em{font-style:italic;}
        .tpl-preview-view u{text-decoration:underline;}
        .tpl-preview-view img{max-width:100%;height:auto;display:block;margin:0 auto 8px;}
        .tpl-preview-view ul,.tpl-preview-view ol{padding-left:18px;margin:2px 0;}
        .tpl-preview-view li{margin:1px 0;}
      `}</style>
      <div className="overflow-y-auto p-8">
        <div className="tpl-preview-page">
          <div ref={containerRef} className="tpl-preview-view" />
        </div>
      </div>
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
