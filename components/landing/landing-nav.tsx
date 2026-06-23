"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { LOGIN_URL, NAV_LINKS, SIGNUP_URL } from "./constants";

export function LandingNav() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("inicio");
  // Prevents the IntersectionObserver from overriding "inicio" right after
  // the user clicks the Início button while the smooth scroll is in progress.
  const lockRef = useRef(false);
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onScroll() {
      if (window.scrollY < 80) {
        setActiveSection("inicio");
        lockRef.current = false;
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true });

    const observer = new IntersectionObserver(
      (entries) => {
        if (lockRef.current || window.scrollY < 80) return;
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target.id) setActiveSection(visible[0].target.id);
      },
      { rootMargin: "-30% 0px -55% 0px", threshold: [0, 0.25, 0.5] },
    );

    NAV_LINKS.forEach(({ href }) => {
      const el = document.getElementById(href.replace("#", ""));
      if (el) observer.observe(el);
    });

    return () => {
      window.removeEventListener("scroll", onScroll);
      observer.disconnect();
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    };
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  function scrollTop(e: React.MouseEvent) {
    e.preventDefault();
    setActiveSection("inicio");
    lockRef.current = true;
    if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    lockTimerRef.current = setTimeout(() => { lockRef.current = false; }, 900);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function linkCls(id: string) {
    const active = activeSection === id;
    return `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
      active
        ? "bg-violet-50 text-violet-700 font-semibold"
        : "text-slate-500 hover:bg-slate-50 hover:text-slate-950"
    }`;
  }

  return (
    <nav
      className="nav-glass fixed inset-x-0 top-0 z-50 border-b border-slate-100"
      aria-label="Navegação principal"
    >
      {/* ── Mobile: linha única ── */}
      <div className="flex items-center justify-between px-6 py-2.5 md:hidden">
        <Link href="/#inicio" aria-label="PlanoMagistra — Início">
          <Image src="/images/logo.png" alt="PlanoMagistra" width={160} height={56} className="h-10 w-auto" priority />
        </Link>
        <div className="flex items-center gap-2">
          <Link href={LOGIN_URL} className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500">
            Entrar
          </Link>
          <button
            type="button"
            className="rounded-xl p-2 text-slate-600 transition hover:bg-slate-100"
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            aria-label={mobileOpen ? "Fechar menu" : "Abrir menu"}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* ── Desktop: logo ocupa as duas linhas ── */}
      <div className="hidden md:grid md:grid-cols-[auto_1fr]">
        {/* Logo — row-span-2 */}
        <div className="row-span-2 flex items-center px-6 py-1">
          <Link href="/#inicio" onClick={scrollTop} aria-label="PlanoMagistra — Início">
            <Image
              src="/images/logo.png"
              alt="PlanoMagistra"
              width={240}
              height={88}
              className="h-[96px] w-auto"
              priority
            />
          </Link>
        </div>

        {/* Linha 1 direita: CTAs */}
        <div className="flex items-center justify-end gap-3 px-8 py-2.5">
          <Link
            href={LOGIN_URL}
            className="rounded-xl px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-950"
          >
            Entrar
          </Link>
          <Link
            href={SIGNUP_URL}
            className="btn-dark rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800"
          >
            Começar grátis
          </Link>
        </div>

        {/* Linha 2 direita: links de navegação */}
        <div className="flex items-center justify-center gap-0.5 px-8 py-1.5">
          <a href="#inicio" onClick={scrollTop} className={linkCls("inicio")}>
            Início
          </a>
          {NAV_LINKS.map(({ href, label }) => {
            const id = href.replace("#", "");
            return (
              <a key={href} href={href} className={linkCls(id)} aria-current={activeSection === id ? "true" : undefined}>
                {label}
              </a>
            );
          })}
        </div>
      </div>

      {/* ── Menu mobile ── */}
      {mobileOpen && (
        <div id="mobile-nav" className="border-t border-slate-100 bg-white px-6 py-4 md:hidden">
          <div className="flex flex-col gap-0.5">
            <a
              href="#inicio"
              className="rounded-xl px-3 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              onClick={(e) => { scrollTop(e); setMobileOpen(false); }}
            >
              Início
            </a>
            {NAV_LINKS.map(({ href, label }) => (
              <a
                key={href}
                href={href}
                className="rounded-xl px-3 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                onClick={() => setMobileOpen(false)}
              >
                {label}
              </a>
            ))}
            <hr className="my-2 border-slate-100" />
            <Link
              href={SIGNUP_URL}
              className="btn-dark mt-1 rounded-xl bg-slate-950 px-4 py-3 text-center text-sm font-bold text-white"
              onClick={() => setMobileOpen(false)}
            >
              Começar grátis
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}
