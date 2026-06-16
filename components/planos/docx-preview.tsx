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
        // inWrapper:true + ignoreHeight:false → docx-preview renders each page
        // at the DOCX's actual dimensions (A4 portrait ≈794px, landscape ≈1123px wide)
        // giving a real "sheet of paper" appearance.
        await renderAsync(buffer, containerRef.current, undefined, {
          inWrapper: true,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          ignoreFonts: false,
          ignoreHeight: false,
          ignoreWidth: false,
          useBase64URL: true,
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
    <div className="relative h-full overflow-auto bg-slate-200 px-6 py-8">
      {/* Override docx-preview wrapper styles so pages look like paper sheets */}
      <style>{`
        .docx-preview-root .docx-wrapper {
          background: transparent !important;
          padding: 0 !important;
          display: flex !important;
          flex-direction: column !important;
          align-items: center !important;
          gap: 24px !important;
        }
        .docx-preview-root .docx-wrapper > section.docx {
          background: #ffffff !important;
          box-shadow: 0 2px 8px rgba(0,0,0,.10), 0 8px 32px rgba(0,0,0,.08) !important;
          border-radius: 2px !important;
          margin: 0 !important;
        }
      `}</style>

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
        className="docx-preview-root"
        style={{ display: loading ? "none" : undefined }}
      />
    </div>
  );
}
