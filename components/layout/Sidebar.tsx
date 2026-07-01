"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, BookOpen, Building2, Clock, FileText, LayoutDashboard, LifeBuoy, Sparkles, User2, LogOut } from "lucide-react";

interface SidebarProps {
  profileIncomplete?: boolean;
  canAccessEscolas?: boolean;
  canAccessHistorico?: boolean;
  canAccessBiblioteca?: boolean;
  canAccessRelatorios?: boolean;
}

export function Sidebar({
  profileIncomplete = false,
  canAccessEscolas = true,
  canAccessHistorico = true,
  canAccessBiblioteca = false,
  canAccessRelatorios = false,
}: SidebarProps) {
  const pathname = usePathname();

  const links = [
    { href: "/dashboard",              label: "Visão geral",         icon: LayoutDashboard, show: true },
    { href: "/dashboard/escolas",      label: "Minhas escolas",      icon: Building2,       show: canAccessEscolas },
    { href: "/dashboard/templates",    label: "Meus templates",      icon: FileText,        show: true },
    { href: "/dashboard/gerar",        label: "Gerar plano de aula", icon: Sparkles,        show: true },
    { href: "/dashboard/historico",    label: "Histórico",           icon: Clock,           show: canAccessHistorico },
    { href: "/dashboard/biblioteca",   label: "Biblioteca",          icon: BookOpen,        show: canAccessBiblioteca },
    { href: "/dashboard/relatorios",   label: "Relatórios",          icon: BarChart3,       show: canAccessRelatorios },
    { href: "/dashboard/suporte",      label: "Suporte",             icon: LifeBuoy,        show: true },
    { href: "/dashboard/perfil",       label: "Perfil & assinatura", icon: User2,           show: true },
  ].filter((l) => l.show);

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/";
  }

  return (
    <aside className="group/sidebar hidden w-[56px] hover:w-[212px] flex-shrink-0 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white p-2 shadow-sm md:flex transition-[width] duration-200 ease-in-out">
      {/* Logo */}
      <div className="relative mb-2 h-10 overflow-hidden transition-[height] duration-200 ease-in-out group-hover/sidebar:h-20">
        {/* Collapsed: sparkles icon centered */}
        <div className="absolute inset-0 flex items-center justify-center opacity-100 transition-opacity duration-150 group-hover/sidebar:opacity-0">
          <Sparkles className="h-5 w-5 text-violet-600" />
        </div>
        {/* Expanded: full logo */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100 group-hover/sidebar:delay-100">
          <img src="/images/logo.png" alt="PlanoMagistra" className="h-full w-full object-contain" />
        </div>
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
              title={item.label}
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
              <span className="overflow-hidden whitespace-nowrap max-w-0 group-hover/sidebar:max-w-[160px] transition-[max-width] duration-200 group-hover/sidebar:delay-75">
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={handleLogout}
        title="Sair"
        className="mt-4 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
      >
        <LogOut className="h-4 w-4 shrink-0" />
        <span className="overflow-hidden whitespace-nowrap max-w-0 group-hover/sidebar:max-w-[160px] transition-[max-width] duration-200 group-hover/sidebar:delay-75">
          Sair
        </span>
      </button>
    </aside>
  );
}
