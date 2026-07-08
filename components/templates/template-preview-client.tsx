"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { TemplateFieldSchema } from "../../lib/types/firestore";

interface TemplatePreviewClientProps {
  templateId: string;
  schema: TemplateFieldSchema[];
  isDocx: boolean;
  hasFillable?: boolean;
  fillableUrl?: string;
}

export function TemplatePreviewClient({
  templateId,
  schema,
  isDocx,
  hasFillable = false,
  fillableUrl,
}: TemplatePreviewClientProps) {
  if (!isDocx) return <SchemaTable schema={schema} />;
  return <DocxPreview templateId={templateId} schema={schema} hasFillable={hasFillable} fillableUrl={fillableUrl} />;
}

// ─── DocxPreview ──────────────────────────────────────────────────────────────

function DocxPreview({
  templateId,
  schema,
  hasFillable,
  fillableUrl,
}: {
  templateId: string;
  schema: TemplateFieldSchema[];
  hasFillable: boolean;
  fillableUrl?: string;
}) {
  const [officeUrl, setOfficeUrl] = useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [isLocalhost, setIsLocalhost] = useState(true);

  useEffect(() => {
    const host = window.location.hostname;
    const local = host === "localhost" || host === "127.0.0.1" || host.endsWith(".local");
    setIsLocalhost(local);
    if (local) return;

    setTokenLoading(true);
    fetch(`/api/templates/${templateId}/preview-token`)
      .then((r) => r.json())
      .then(({ token, exp }: { token: string; exp: number }) => {
        const previewPath = `/api/templates/${templateId}/preview-publico?token=${encodeURIComponent(token)}&exp=${exp}&annotated=1`;
        const previewUrl = `${window.location.origin}${previewPath}`;
        setOfficeUrl(
          `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(previewUrl)}`,
        );
      })
      .catch(() => {/* fallback to docx-preview */})
      .finally(() => setTokenLoading(false));
  }, [templateId, hasFillable]);

  if (!isLocalhost && (tokenLoading || officeUrl)) {
    return (
      <div className="flex flex-col gap-4">
        {/* Office Online preview */}
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white" style={{ height: "72vh" }}>
          {tokenLoading || !officeUrl ? (
            <div className="flex h-full items-center justify-center gap-3 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin text-violet-500" />
              <span className="text-sm">Carregando preview Word…</span>
            </div>
          ) : (
            /* Clip top toolbar and bottom toolbar via overflow:hidden */
            <div className="relative h-full overflow-hidden">
              <iframe
                src={officeUrl}
                title="Pré-visualização do template"
                allowFullScreen
                style={{
                  position: "absolute",
                  top: "-56px",
                  left: 0,
                  width: "100%",
                  height: "calc(100% + 100px)",
                  border: "none",
                }}
              />
            </div>
          )}
        </div>

        {/* Variable reference panel */}
        <VariablePanel schema={schema} hasFillable={hasFillable} />
      </div>
    );
  }

  // Localhost fallback — docx-preview with chip overlays.
  // key=fillableUrl forces remount (and re-fetch) whenever the template is saved,
  // so Visualizar always shows the most recently generated fillable.
  return <DocxPreviewLocal key={fillableUrl ?? templateId} templateId={templateId} schema={schema} />;
}

// ─── Variable reference panel ─────────────────────────────────────────────────

function VariablePanel({ schema, hasFillable }: { schema: TemplateFieldSchema[]; hasFillable: boolean }) {
  const manual = schema.filter((f) => f.role !== "ia_sugerida");
  const ia = schema.filter((f) => f.role === "ia_sugerida");

  if (schema.length === 0) return null;

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">Variáveis do documento</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {"As variáveis aparecem coloridas no documento acima: amber = campo fixo, violeta = IA."}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
          {schema.length} campos
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {manual.map((f) => (
          <div key={f.key} className="flex flex-col gap-1 rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-xs font-medium text-slate-700">{f.label}</p>
              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">Fixo</span>
            </div>
            <code className="truncate rounded-lg bg-white px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-700 border border-amber-200">
              {`{{${f.key}}}`}
            </code>
          </div>
        ))}
        {ia.map((f) => (
          <div key={f.key} className="flex flex-col gap-1 rounded-2xl border border-violet-100 bg-violet-50 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-xs font-medium text-slate-700">{f.label}</p>
              <span className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700">IA</span>
            </div>
            <code className="truncate rounded-lg bg-white px-2 py-0.5 font-mono text-[11px] font-semibold text-violet-700 border border-violet-200">
              {`{{${f.key}}}`}
            </code>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Localhost fallback: docx-preview with chip overlays ──────────────────────

function DocxPreviewLocal({ templateId, schema }: { templateId: string; schema: TemplateFieldSchema[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<"loading" | "rendering" | "done" | "error">("loading");
  const bufferRef = useRef<ArrayBuffer | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Use fresh-injected DOCX so {{key}} tokens are at exact positions
    fetch(`/api/templates/${templateId}/arquivo?fresh=1`)
      .then((r) => { if (!r.ok) throw new Error(); return r.arrayBuffer(); })
      .then((buf) => { if (!cancelled) { bufferRef.current = buf; setPhase("rendering"); } })
      .catch(() => { if (!cancelled) setPhase("error"); });
    return () => { cancelled = true; };
  }, [templateId]);

  useEffect(() => {
    if (phase !== "rendering" || !bufferRef.current || !containerRef.current) return;
    let cancelled = false;
    const container = containerRef.current;
    import("docx-preview")
      .then(({ renderAsync }) => {
        if (cancelled || !bufferRef.current) return;
        container.innerHTML = "";
        return renderAsync(bufferRef.current, container, undefined, {
          inWrapper: true, ignoreWidth: false, ignoreHeight: true,
          ignoreFonts: false, breakPages: true, useBase64URL: true,
          renderEndnotes: true, renderFooters: true, renderFootnotes: true, renderHeaders: true,
        });
      })
      .then(() => { if (!cancelled) setPhase("done"); })
      .catch(() => { if (!cancelled) setPhase("error"); });
    return () => { cancelled = true; };
  }, [phase]);

  // Replace {{key}} text nodes with colored chips — precise because we render
  // the fresh-injected DOCX which already contains {{key}} at the right positions.
  useEffect(() => {
    if (phase !== "done" || !containerRef.current) return;
    const container = containerRef.current;
    const roleMap = new Map(schema.map((f) => [f.key, f.role]));

    function makeChip(key: string, isIa: boolean) {
      const chip = document.createElement("span");
      chip.setAttribute("data-field-chip", key);
      chip.style.cssText = [
        "display:inline-block", "padding:2px 8px", "border-radius:6px",
        "font-family:monospace", "font-size:10px", "font-weight:700",
        "white-space:nowrap", "line-height:1.7",
        isIa
          ? "background:rgba(139,92,246,.14);color:#6d28d9;border:1px solid rgba(139,92,246,.35)"
          : "background:rgba(245,158,11,.14);color:#b45309;border:1px solid rgba(245,158,11,.35)",
      ].join(";");
      chip.textContent = `{{${key}}}`;
      return chip;
    }

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const hits: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const parent = (node as Text).parentElement;
      if (parent?.hasAttribute("data-field-chip")) continue;
      if (/\{\{[A-Za-z_][A-Za-z0-9_]*\}\}/.test((node as Text).textContent ?? "")) {
        hits.push(node as Text);
      }
    }
    for (const textNode of hits) {
      const text = textNode.textContent ?? "";
      const parts = text.split(/(\{\{[A-Za-z_][A-Za-z0-9_]*\}\})/);
      if (parts.length <= 1) continue;
      const frag = document.createDocumentFragment();
      for (const part of parts) {
        const m = part.match(/^\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}$/);
        if (m) {
          // Invariant: never create chips for keys not in the schema
          if (!roleMap.has(m[1])) {
            frag.appendChild(document.createTextNode(part));
          } else {
            const isIa = roleMap.get(m[1]) === "ia_sugerida";
            frag.appendChild(makeChip(m[1], isIa));
          }
        } else {
          frag.appendChild(document.createTextNode(part));
        }
      }
      textNode.parentNode?.replaceChild(frag, textNode);
    }
  }, [phase, schema]);

  // Fix anchor image positions after docx-preview renders
  useEffect(() => {
    if (phase !== "done" || !containerRef.current || !bufferRef.current) return;
    let cancelled = false;
    const buf = bufferRef.current;
    const cont = containerRef.current;
    import("../../lib/utils/docx-anchor-fix")
      .then(({ fixDocxAnchorImages }) => {
        if (!cancelled) return fixDocxAnchorImages(buf, cont);
      })
      .catch(() => {/* ignore */});
    return () => { cancelled = true; };
  }, [phase]);

  const busy = phase === "loading" || phase === "rendering";

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
        <p className="text-[11px] text-slate-500">
          Preview local aproximado — em produção o Word é exibido com formatação exata.
        </p>
      </div>
      <style>{`
        .docx-wrapper { background: #f1f5f9 !important; padding: 24px 16px !important; min-height: 300px; }
        .docx-wrapper section.docx { box-shadow: 0 2px 8px rgba(0,0,0,.10) !important; border-radius: 3px !important; margin-bottom: 16px !important; }
        .docx-wrapper img { max-width: 100%; height: auto; }
        .docx-wrapper section { overflow: visible !important; }
      `}</style>
      <div className={`overflow-y-auto max-h-[70vh] ${busy || phase === "error" ? "hidden" : ""}`}>
        <div ref={containerRef} />
      </div>
      {busy && (
        <div className="flex h-64 items-center justify-center gap-3 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin text-violet-500" />
          <span className="text-sm">{phase === "loading" ? "Carregando…" : "Renderizando…"}</span>
        </div>
      )}
      {phase === "error" && (
        <div className="p-8 text-center">
          <p className="text-sm text-slate-500">Não foi possível carregar o documento.</p>
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
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-amber-600">Campos fixos</p>
          <ul className="space-y-2">
            {manual.map((f) => (
              <li key={f.key} className="flex items-start gap-3 rounded-xl border-l-2 border-amber-400 bg-amber-50 px-4 py-2.5">
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-900">{f.label}</p>
                  {f.placeholder && <p className="text-xs text-slate-400">{f.placeholder}</p>}
                </div>
                <code className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-700">{`{{${f.key}}}`}</code>
              </li>
            ))}
          </ul>
        </section>
      )}
      {ia.length > 0 && (
        <section className="rounded-3xl border border-violet-200 bg-white p-6">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-violet-600">Campos IA</p>
          <ul className="space-y-2">
            {ia.map((f) => (
              <li key={f.key} className="flex items-start gap-3 rounded-xl border-l-2 border-violet-400 bg-violet-50 px-4 py-2.5">
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-900">{f.label}</p>
                  {f.aiInstructions && <p className="mt-0.5 text-xs text-violet-600">Instrução IA: {f.aiInstructions}</p>}
                </div>
                <code className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-violet-700">{`{{${f.key}}}`}</code>
              </li>
            ))}
          </ul>
        </section>
      )}
      {outros.length > 0 && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">Outros campos</p>
          <ul className="space-y-2">
            {outros.map((f) => (
              <li key={f.key} className="flex items-start gap-3 rounded-xl border-l-2 border-slate-300 bg-slate-50 px-4 py-2.5">
                <p className="flex-1 text-sm font-medium text-slate-900">{f.label}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
