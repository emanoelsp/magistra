"use client";

import { useState } from "react";
import { Download, Loader2, Sparkles, X, AlertTriangle } from "lucide-react";

export interface DownloadLimitInfo {
  error: string;
  downloads: number;
  maxDownloads: number;
}

export async function triggerDownload(url: string): Promise<DownloadLimitInfo | null> {
  const res = await fetch(url);
  if (res.ok) {
    const blob = await res.blob();
    const cd = res.headers.get("content-disposition") ?? "";
    const match = cd.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    const filename =
      match?.[1]?.replace(/['"]/g, "") ??
      (url.includes("format=pdf") ? "plano.pdf" : "plano.docx");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    return null;
  }
  if (res.status === 429) {
    return (await res.json()) as DownloadLimitInfo;
  }
  throw new Error(`Erro ${res.status}`);
}

interface DownloadPlanButtonProps {
  planoId: string;
  format?: "docx" | "pdf";
  label?: string;
  className?: string;
  iconOnly?: boolean;
}

export function DownloadPlanButton({
  planoId,
  format = "docx",
  label,
  className,
  iconOnly = false,
}: DownloadPlanButtonProps) {
  const [loading, setLoading] = useState(false);
  const [limitInfo, setLimitInfo] = useState<DownloadLimitInfo | null>(null);

  const url =
    format === "pdf"
      ? `/api/planos/${planoId}/download?format=pdf`
      : `/api/planos/${planoId}/download`;

  const displayLabel = label ?? (format === "pdf" ? "PDF" : "DOCX");

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    try {
      const info = await triggerDownload(url);
      if (info) setLimitInfo(info);
    } catch {
      // generic errors: fallback to direct link
      window.open(url, "_blank");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={loading}
        className={
          className ??
          (format === "pdf"
            ? "inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
            : "inline-flex items-center gap-2 rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950 disabled:opacity-60")
        }
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        {!iconOnly && displayLabel}
      </button>

      {limitInfo && (
        <DownloadLimitDialog
          info={limitInfo}
          onClose={() => setLimitInfo(null)}
        />
      )}
    </>
  );
}

export function DownloadLimitDialog({
  info,
  onClose,
}: {
  info: DownloadLimitInfo;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="relative flex w-full max-w-sm flex-col items-center gap-5 rounded-3xl border border-slate-200 bg-white p-8 shadow-xl"
        style={{ animation: "dl-pop 0.3s cubic-bezier(0.34,1.56,0.64,1) both" }}
      >
        <style>{`
          @keyframes dl-pop {
            from { opacity: 0; transform: scale(0.85) translateY(16px); }
            to   { opacity: 1; transform: scale(1) translateY(0); }
          }
        `}</style>

        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-xl p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Magis avatar */}
        <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-violet-600 shadow-lg shadow-violet-200">
          <Sparkles className="h-7 w-7 text-white" />
          <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500">
            <AlertTriangle className="h-3 w-3 text-white" />
          </span>
        </div>

        {/* Magis bubble */}
        <div className="w-full rounded-2xl border border-violet-100 bg-violet-50 px-5 py-4 text-center">
          <div className="mb-1.5 flex items-center justify-center gap-1.5">
            <Sparkles className="h-3 w-3 text-violet-500" />
            <span className="text-xs font-bold text-violet-700">Magis</span>
          </div>
          <p className="text-sm font-medium leading-relaxed text-slate-800">
            Você atingiu o limite de downloads para este plano.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Downloads utilizados:{" "}
            <span className="font-semibold text-slate-700">
              {info.downloads}/{info.maxDownloads}
            </span>
          </p>
        </div>

        <p className="text-center text-xs leading-relaxed text-slate-500">
          Cada plano pode ser baixado até{" "}
          <span className="font-semibold">{info.maxDownloads}×</span>. Para
          baixar novamente, crie um novo plano a partir do mesmo template.
        </p>

        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          Entendi
        </button>
      </div>
    </div>
  );
}
