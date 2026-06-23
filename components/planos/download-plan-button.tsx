"use client";

import Link from "next/link";
import { useState } from "react";
import { Download, Loader2, Sparkles, X } from "lucide-react";

export interface DownloadLimitInfo {
  error: string;
  downloads: number;
  maxDownloads: number;
}

export interface PlanExpiredInfo {
  error: "PLAN_EXPIRED";
  daysOld: number;
  expiryDays: number;
  data_geracao: string;
}

type BlockedInfo = { kind: "limit"; data: DownloadLimitInfo } | { kind: "expired"; data: PlanExpiredInfo };

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
  if (res.status === 403 || res.status === 429) {
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
  const [blocked, setBlocked] = useState<BlockedInfo | null>(null);

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
      if (info) {
        if ((info as unknown as PlanExpiredInfo).error === "PLAN_EXPIRED") {
          setBlocked({ kind: "expired", data: info as unknown as PlanExpiredInfo });
        } else {
          setBlocked({ kind: "limit", data: info });
        }
      }
    } catch {
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

      {blocked?.kind === "limit" && (
        <DownloadLimitDialog info={blocked.data} onClose={() => setBlocked(null)} />
      )}
      {blocked?.kind === "expired" && (
        <PlanExpiredDialog info={blocked.data} onClose={() => setBlocked(null)} />
      )}
    </>
  );
}

/* ── Shared modal shell ─────────────────────────────────────────────────── */

function MagisModalShell({
  onClose,
  children,
  footer,
}: {
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 pt-8 backdrop-blur-sm"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <style>{`
        @keyframes magis-pop {
          from { opacity: 0; transform: scale(0.85) translateY(24px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
      <div
        className="flex w-full max-w-sm flex-col overflow-hidden rounded-3xl shadow-2xl"
        style={{ animation: "magis-pop 0.35s cubic-bezier(0.34,1.56,0.64,1) both" }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 bg-violet-700 px-5 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white leading-tight">Magis</p>
            <p className="text-[11px] text-violet-300">assistente de planos</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/60 transition hover:bg-white/20 hover:text-white"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Chat area */}
        <div className="bg-[#ece5dd] px-4 py-5 space-y-2">
          <div className="flex items-end gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-600 shadow-sm mb-0.5">
              <Sparkles className="h-3 w-3 text-white" />
            </div>
            <div className="flex max-w-[80%] flex-col gap-1">
              {children}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4">
          {footer}
        </div>
      </div>
    </div>
  );
}

/* ── Limite de downloads ────────────────────────────────────────────────── */

export function DownloadLimitDialog({
  info,
  onClose,
}: {
  info: DownloadLimitInfo;
  onClose: () => void;
}) {
  return (
    <MagisModalShell
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          Entendi
        </button>
      }
    >
      <div className="rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 shadow-sm">
        <p className="text-sm text-slate-800">Você atingiu o limite de downloads para este plano. ⚠️</p>
      </div>
      <div className="rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 shadow-sm">
        <p className="text-sm text-slate-700">
          Downloads usados: <strong>{info.downloads}/{info.maxDownloads}</strong>
        </p>
      </div>
      <div className="rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 shadow-sm">
        <p className="text-sm text-slate-500">
          Para baixar novamente, gere um novo plano a partir do mesmo template. 📄
        </p>
      </div>
    </MagisModalShell>
  );
}

/* ── Plano expirado (free > 90 dias) ───────────────────────────────────── */

export function PlanExpiredDialog({
  info,
  onClose,
}: {
  info: PlanExpiredInfo;
  onClose: () => void;
}) {
  const geradoEm = new Date(info.data_geracao).toLocaleDateString("pt-BR", { dateStyle: "long" });
  const diasRestantes = info.expiryDays - info.daysOld;

  return (
    <MagisModalShell
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          <Link
            href="/planos"
            onClick={onClose}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-700"
          >
            <Sparkles className="h-4 w-4" />
            Ver planos disponíveis
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-2xl border border-slate-200 px-5 py-2.5 text-sm font-medium text-slate-600 transition hover:border-slate-400"
          >
            Fechar
          </button>
        </div>
      }
    >
      <div className="rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 shadow-sm">
        <p className="text-sm text-slate-800">
          Este plano foi gerado em <strong>{geradoEm}</strong> e expirou no plano Explorador. 🔒
        </p>
      </div>
      <div className="rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 shadow-sm">
        <p className="text-sm text-slate-700">
          O plano gratuito permite baixar planos por até <strong>{info.expiryDays} dias</strong> após a geração.{" "}
          {diasRestantes < 0
            ? `Este plano expirou há ${Math.abs(diasRestantes)} dias.`
            : ""}
        </p>
      </div>
      <div className="rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 shadow-sm">
        <p className="text-sm text-slate-500">
          Com um plano pago você acessa todos os planos sem limite de tempo — e pode regerar com as atualizações do currículo do próximo ano! 🗓️
        </p>
      </div>
    </MagisModalShell>
  );
}
