"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";

interface DocxPreviewProps {
  planoId: string;
}

export function DocxPreview({ planoId }: DocxPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!planoId) return;
    let cancelled = false;

    setLoading(true);
    setError(false);

    async function render() {
      try {
        const res = await fetch(`/api/planos/${planoId}/preview-docx`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = await res.arrayBuffer();
        if (cancelled || !containerRef.current) return;

        const { renderAsync } = await import("docx-preview");
        if (cancelled || !containerRef.current) return;

        containerRef.current.innerHTML = "";
        await renderAsync(buffer, containerRef.current, undefined, {
          inWrapper: false,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          className: "docx-render",
          ignoreLastRenderedPageBreak: false,
        });
      } catch (err) {
        console.error("[DocxPreview]", err);
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void render();
    return () => { cancelled = true; };
  }, [planoId]);

  return (
    <div className="relative h-full overflow-auto bg-slate-100">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center gap-3 bg-white text-slate-500">
          <LoaderCircle className="h-5 w-5 animate-spin text-violet-500" />
          <span className="text-sm">Renderizando pré-visualização…</span>
        </div>
      )}
      {error && !loading && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
          Não foi possível gerar a pré-visualização.
        </div>
      )}
      <div
        ref={containerRef}
        className="docx-preview-container mx-auto max-w-3xl p-6"
        style={{ display: loading ? "none" : undefined }}
      />
    </div>
  );
}
