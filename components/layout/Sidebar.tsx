"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clock, FileText, LayoutDashboard, Sparkles, User2, LogOut } from "lucide-react";

const links = [
  { href: "/dashboard", label: "Visão geral", icon: LayoutDashboard },
  { href: "/dashboard/templates", label: "Meus templates", icon: FileText },
  { href: "/dashboard/gerar", label: "Gerar plano", icon: Sparkles },
  { href: "/dashboard/historico", label: "Histórico", icon: Clock },
  { href: "/dashboard/perfil", label: "Perfil & assinatura", icon: User2 },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/";
  }

  return (
    <aside className="hidden w-52 flex-shrink-0 flex-col overflow-y-auto rounded-3xl border border-slate-200 bg-white p-4 shadow-sm md:flex">
      <div className="mb-6 px-2">
        <img src="/images/logo.png" alt="PlanoMagistra" className="h-8 w-auto" />
        <p className="mt-0.5 text-xs text-slate-400">Dashboard</p>
      </div>

      <nav className="flex-1 space-y-1 text-sm">
        {links.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;

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
              <Icon className="h-4 w-4" />
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

