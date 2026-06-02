"use client";

import { useEffect, useState } from "react";

export default function MagisWidget() {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem("magis-dismissed")) return;
    const t = setTimeout(() => setVisible(true), 1800);
    return () => clearTimeout(t);
  }, []);

  function dismiss() {
    setDismissed(true);
    sessionStorage.setItem("magis-dismissed", "1");
  }

  if (dismissed || !visible) return null;

  return (
    <>
      <style>{`
        @keyframes magisWidgetIn {
          from { opacity: 0; transform: translateY(48px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes magisCharFloat {
          0%, 100% { transform: translateY(0px) rotate(-.6deg); }
          50%       { transform: translateY(-10px) rotate(.6deg); }
        }
        @keyframes magisBubbleIn {
          from { opacity: 0; transform: translateY(12px) scale(.94); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        .magis-char-anim  { animation: magisCharFloat 5s ease-in-out infinite; }
        .magis-bubble-anim { animation: magisBubbleIn .4s .3s cubic-bezier(.34,1.56,.64,1) both; }
      `}</style>

      {/* Container fixo colado na borda inferior direita */}
      <div
        className="fixed bottom-0 right-6 z-50 flex items-end"
        style={{ animation: "magisWidgetIn .55s cubic-bezier(.34,1.56,.64,1) both" }}
      >
        {/* ── Balão de diálogo ─── posicionado para ficar à altura do rosto */}
        <div
          className="magis-bubble-anim relative w-52 rounded-2xl rounded-br-none border border-violet-100 bg-white px-4 py-4 shadow-xl shadow-violet-200/60"
          style={{ marginBottom: 190, marginRight: -2 }}
        >
          {/* Botão fechar */}
          <button
            onClick={dismiss}
            aria-label="Fechar"
            className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[10px] leading-none text-slate-500 hover:bg-slate-300"
          >
            ✕
          </button>

          <p className="text-sm font-black text-slate-950">Olá! 👋</p>
          <p className="mt-1.5 text-[13px] leading-snug text-slate-600">
            Eu sou a{" "}
            <span className="font-bold text-violet-700">Magis</span>, sua
            assistente pedagógica. Conte comigo!&nbsp;💜
          </p>

          {/* Cauda do balão → aponta para a Magis (direita) */}
          <div
            aria-hidden
            className="absolute -right-[9px] bottom-4 h-4 w-4 rotate-45 border-r border-t border-violet-100 bg-white"
          />
        </div>

        {/* ── Personagem ── colada na borda inferior */}
        <div className="magis-char-anim">
          <img
            src="/images/magis.png"
            alt="Magis, assistente pedagógica"
            style={{ height: 280, width: "auto" }}
            draggable={false}
          />
        </div>
      </div>
    </>
  );
}
