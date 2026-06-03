"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

interface OfficeInlineViewerProps {
  /** GET endpoint that returns { token: string; exp: number } */
  tokenEndpoint: string;
  /** Path like /api/templates/abc/preview-publico (no query string) */
  previewPublicoPath: string;
  /** Extra query params appended after token, e.g. "annotated=1" */
  extraParams?: string;
  /** Fallback iframe src shown on localhost */
  fallbackSrc?: string;
  /** iframe title for accessibility */
  title?: string;
  /** Outer container class — must include a height (e.g. "h-full" or specific height) */
  className?: string;
}

/**
 * Embeds a DOCX via Office Online in production, with the native toolbar
 * clipped so users cannot download directly from the viewer.
 * Falls back to a plain iframe on localhost (Office Online can't reach local URLs).
 */
export function OfficeInlineViewer({
  tokenEndpoint,
  previewPublicoPath,
  extraParams,
  fallbackSrc,
  title = "Documento",
  className = "h-full",
}: OfficeInlineViewerProps) {
  const [initialized, setInitialized] = useState(false);
  const [isLocalhost, setIsLocalhost] = useState(false);
  const [officeUrl, setOfficeUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const host = window.location.hostname;
    const local = host === "localhost" || host === "127.0.0.1" || host.endsWith(".local");
    setIsLocalhost(local);
    setInitialized(true);

    if (local) return;

    setLoading(true);
    fetch(tokenEndpoint)
      .then((r) => r.json())
      .then(({ token, exp }: { token: string; exp: number }) => {
        const qs = `token=${encodeURIComponent(token)}&exp=${exp}${extraParams ? `&${extraParams}` : ""}`;
        const publicUrl = `${window.location.origin}${previewPublicoPath}?${qs}`;
        setOfficeUrl(
          `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(publicUrl)}`,
        );
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tokenEndpoint, previewPublicoPath, extraParams]);

  const base = `relative overflow-hidden ${className}`;

  if (!initialized || (!isLocalhost && (loading || !officeUrl))) {
    return (
      <div className={`${base} flex items-center justify-center gap-3`}>
        <Loader2 className="h-5 w-5 animate-spin text-violet-500" />
        <span className="text-sm text-slate-500">Carregando visualizador Word…</span>
      </div>
    );
  }

  if (isLocalhost) {
    if (fallbackSrc) {
      return (
        <div className={base}>
          <iframe src={fallbackSrc} className="h-full w-full border-0" title={title} />
        </div>
      );
    }
    return (
      <div className={`${base} flex items-center justify-center`}>
        <p className="text-sm text-slate-400">Visualização Word disponível apenas em produção.</p>
      </div>
    );
  }

  // Production: clip the top toolbar (~56 px) and overlay the bottom-bar
  // icons (book menu + fullscreen) so users cannot download/print from the viewer.
  return (
    <div className={base}>
      {/* Inner div is scrollable horizontally; outer keeps overflow:hidden for toolbar clip */}
      <div style={{ position: "absolute", inset: 0, overflowX: "auto", overflowY: "hidden" }}>
        <iframe
          src={officeUrl!}
          title={title}
          allowFullScreen
          style={{
            position: "relative",
            top: "-56px",
            display: "block",
            minWidth: "960px",
            width: "100%",
            height: "calc(100% + 100px)",
            border: "none",
          }}
        />
      </div>
    </div>
  );
}
