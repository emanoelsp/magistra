"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Sparkles, X, XCircle } from "lucide-react";
import { MAGIS_TOAST_EVENT, type MagisToastPayload, type MagisToastVariant } from "../../lib/utils/magis-toast";

const DURATION_MS = 4000;
const MAX_TOASTS = 3;

const VARIANT_CONFIG: Record<
  MagisToastVariant,
  { avatarCls: string; bubbleCls: string; icon: React.ReactNode; tailBorder: string; tailFill: string }
> = {
  success: {
    avatarCls: "bg-emerald-100",
    bubbleCls: "border-emerald-200 bg-emerald-50",
    icon: <CheckCircle2 className="h-3 w-3 text-emerald-600" />,
    tailBorder: "#6ee7b7",
    tailFill: "#f0fdf4",
  },
  error: {
    avatarCls: "bg-rose-100",
    bubbleCls: "border-rose-200 bg-rose-50",
    icon: <XCircle className="h-3 w-3 text-rose-500" />,
    tailBorder: "#fecaca",
    tailFill: "#fff1f2",
  },
  info: {
    avatarCls: "bg-violet-100",
    bubbleCls: "border-violet-200 bg-violet-50",
    icon: <Sparkles className="h-3 w-3 text-violet-600" />,
    tailBorder: "#ddd6fe",
    tailFill: "#f5f3ff",
  },
};

interface ActiveToast extends MagisToastPayload {
  exiting: boolean;
}

export function MagisToastContainer() {
  const [toasts, setToasts] = useState<ActiveToast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  function dismiss(id: string) {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)),
    );
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 320);
    const timer = timers.current.get(id);
    if (timer) { clearTimeout(timer); timers.current.delete(id); }
  }

  useEffect(() => {
    function onToast(e: Event) {
      const payload = (e as CustomEvent<MagisToastPayload>).detail;
      setToasts((prev) => {
        const next = [...prev, { ...payload, exiting: false }];
        return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
      });
      const timer = setTimeout(() => dismiss(payload.id), DURATION_MS);
      timers.current.set(payload.id, timer);
    }
    window.addEventListener(MAGIS_TOAST_EVENT, onToast);
    return () => window.removeEventListener(MAGIS_TOAST_EVENT, onToast);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (toasts.length === 0) return null;

  return (
    <>
      <style>{`
        @keyframes magisToastIn  { from { opacity:0; transform:translateX(24px); } to { opacity:1; transform:translateX(0); } }
        @keyframes magisToastOut { from { opacity:1; transform:translateX(0);    } to { opacity:0; transform:translateX(24px); } }
      `}</style>
      <div
        className="fixed bottom-6 right-6 z-[9999] flex flex-col items-end gap-3"
        aria-live="polite"
        aria-label="Notificações da Magis"
      >
        {toasts.map((toast) => {
          const cfg = VARIANT_CONFIG[toast.variant];
          return (
            <div
              key={toast.id}
              className="flex items-start gap-2.5 max-w-xs"
              style={{
                animation: toast.exiting
                  ? "magisToastOut 0.3s ease forwards"
                  : "magisToastIn 0.3s ease forwards",
              }}
            >
              {/* Magis avatar */}
              <div
                className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full shadow-sm ${cfg.avatarCls}`}
              >
                {cfg.icon}
              </div>

              {/* Bubble */}
              <div className="relative flex-1">
                {/* Tail */}
                <div
                  style={{
                    position: "absolute",
                    left: -8,
                    top: 9,
                    width: 0,
                    height: 0,
                    borderTop: "7px solid transparent",
                    borderBottom: "7px solid transparent",
                    borderRight: `8px solid ${cfg.tailBorder}`,
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    left: -6,
                    top: 10,
                    width: 0,
                    height: 0,
                    borderTop: "6px solid transparent",
                    borderBottom: "6px solid transparent",
                    borderRight: `7px solid ${cfg.tailFill}`,
                  }}
                />

                <div className={`rounded-2xl rounded-tl-none border px-3.5 py-2.5 shadow-md ${cfg.bubbleCls}`}>
                  <div className="mb-1 flex items-center gap-1.5">
                    <Sparkles className="h-2.5 w-2.5 text-violet-500" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-violet-600">Magis</span>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-700">{toast.message}</p>
                </div>

                {/* Dismiss */}
                <button
                  type="button"
                  onClick={() => dismiss(toast.id)}
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-slate-200 text-slate-500 opacity-70 transition hover:bg-slate-300 hover:opacity-100"
                  aria-label="Fechar"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
