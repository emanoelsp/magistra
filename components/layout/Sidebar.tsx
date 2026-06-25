"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Clock, FileText, LayoutDashboard, LifeBuoy, Sparkles, User2, LogOut } from "lucide-react";

const links = [
  { href: "/dashboard", label: "Visão geral", icon: LayoutDashboard },
  { href: "/dashboard/escolas", label: "Minhas escolas", icon: Building2 },
  { href: "/dashboard/templates", label: "Meus templates", icon: FileText },
  { href: "/dashboard/gerar", label: "Gerar plano de aula", icon: Sparkles },
  { href: "/dashboard/historico", label: "Histórico", icon: Clock },
  { href: "/dashboard/suporte", label: "Suporte", icon: LifeBuoy },
  { href: "/dashboard/perfil", label: "Perfil & assinatura", icon: User2 },
] as const;

interface SidebarProps {
  profileIncomplete?: boolean;
}

export function Sidebar({ profileIncomplete = false }: SidebarProps) {
  const pathname = usePathname();

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/";
  }

  return (
    <aside className="hidden w-[204px] flex-shrink-0 flex-col overflow-y-auto rounded-3xl border border-slate-200 bg-white p-2 shadow-sm md:flex">
      <div className="mb-6 flex justify-center">
        <img src="/images/logo.png" alt="PlanoMagistra" className="w-full object-contain max-h-28" />
      </div>

      <nav className="flex-1 space-y-1 text-sm">
        {links.map((item) => {
          const Icon = item.icon;
          const active = item.href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname.startsWith(item.href);
          const showBadge = profileIncomplete && item.href === "/dashboard/perfil";

          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                "flex items-center gap-2 rounded-xl px-3 py-2 transition-colors",
                active
                  ? "bg-slate-950 text-white"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
              ].join(" ")}
            >
              <div className="relative shrink-0">
                <Icon className="h-4 w-4" />
                {showBadge && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold leading-none text-white">
                    1
                  </span>
                )}
              </div>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={handleLogout}
        className="mt-4 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
      >
        <LogOut className="h-4 w-4" />
        Sair
      </button>
    </aside>
  );
}
