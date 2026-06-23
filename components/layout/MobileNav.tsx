"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clock, FileText, LayoutDashboard, Sparkles, User2 } from "lucide-react";

const NAV_LINKS = [
  { href: "/dashboard",           label: "Início",      icon: LayoutDashboard, exact: true },
  { href: "/dashboard/templates", label: "Templates",   icon: FileText },
  { href: "/dashboard/gerar",     label: "Gerar",       icon: Sparkles,        cta: true },
  { href: "/dashboard/historico", label: "Histórico",   icon: Clock },
  { href: "/dashboard/perfil",    label: "Perfil",      icon: User2 },
] as const;

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Navegação principal"
    >
      <div className="flex items-stretch">
        {NAV_LINKS.map((item) => {
          const Icon = item.icon;
          const active = "exact" in item && item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);

          if ("cta" in item && item.cta) {
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-1 flex-col items-center justify-center gap-0.5 px-1 py-3"
                aria-current={active ? "page" : undefined}
              >
                <span className={`flex h-10 w-10 items-center justify-center rounded-2xl transition ${
                  active ? "bg-violet-700" : "bg-violet-600"
                } shadow-md shadow-violet-300/60`}>
                  <Icon className="h-5 w-5 text-white" />
                </span>
                <span className={`text-[10px] font-semibold ${active ? "text-violet-700" : "text-violet-600"}`}>
                  {item.label}
                </span>
              </Link>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              className="relative flex flex-1 flex-col items-center justify-center gap-1 px-1 py-3 transition"
              aria-current={active ? "page" : undefined}
            >
              {active && (
                <span className="absolute top-0 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-slate-950" aria-hidden />
              )}
              <Icon className={`h-5 w-5 transition ${active ? "text-slate-950" : "text-slate-400"}`} />
              <span className={`text-[10px] font-medium transition ${active ? "text-slate-950" : "text-slate-400"}`}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
