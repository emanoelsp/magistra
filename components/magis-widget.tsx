"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

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
    <div className="magis-widget-in fixed bottom-0 right-6 z-40 hidden items-end md:flex">
      <div
        className="magis-bubble-anim relative w-52 rounded-2xl rounded-br-none border border-violet-100 bg-white px-4 py-4 shadow-xl shadow-violet-200/60"
        style={{ marginBottom: 190, marginRight: -2 }}
      >
        <button
          type="button"
          onClick={dismiss}
          aria-label="Fechar"
          className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[10px] leading-none text-slate-500 hover:bg-slate-300"
        >
          ✕
        </button>

        <p className="text-sm font-black text-slate-950">Olá! 👋</p>
        <p className="mt-1.5 text-[13px] leading-snug text-slate-600">
          Eu sou a <span className="font-bold text-violet-700">Magis</span>, sua assistente pedagógica. Conte
          comigo!&nbsp;💜
        </p>

        <div
          aria-hidden
          className="absolute -right-[9px] bottom-4 h-4 w-4 rotate-45 border-r border-t border-violet-100 bg-white"
        />
      </div>

      <div className="magis-char-anim">
        <Image
          src="/images/magis.png"
          alt="Magis, assistente pedagógica"
          width={220}
          height={280}
          className="h-[280px] w-auto"
          draggable={false}
          priority={false}
        />
      </div>
    </div>
  );
}
