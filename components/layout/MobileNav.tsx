"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clock, FileText, LayoutDashboard, Sparkles, User2 } from "lucide-react";

interface MobileNavProps {
  profileIncomplete?: boolean;
  canAccessHistorico?: boolean;
}

export function MobileNav({ profileIncomplete = false, canAccessHistorico = true }: MobileNavProps) {
  const pathname = usePathname();

  const allLinks = [
    { href: "/dashboard",           label: "Início",    icon: LayoutDashboard, exact: true,  cta: false, show: true },
    { href: "/dashboard/templates", label: "Templates", icon: FileText,                       cta: false, show: true },
    { href: "/dashboard/gerar",     label: "Gerar",     icon: Sparkles,                       cta: true,  show: true },
    { href: "/dashboard/historico", label: "Histórico", icon: Clock,                          cta: false, show: canAccessHistorico },
    { href: "/dashboard/perfil",    label: "Perfil",    icon: User2,                          cta: false, show: true },
  ].filter((l) => l.show);

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Navegação principal"
    >
      <div className="flex items-stretch">
        {allLinks.map((item) => {
          const Icon = item.icon;
          const active = "exact" in item && item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          const showBadge = profileIncomplete && item.href === "/dashboard/perfil";

          if (item.cta) {
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
              <div className="relative">
                <Icon className={`h-5 w-5 transition ${active ? "text-slate-950" : "text-slate-400"}`} />
                {showBadge && (
                  <span className="absolute -right-2 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold leading-none text-white">
                    1
                  </span>
                )}
              </div>
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
