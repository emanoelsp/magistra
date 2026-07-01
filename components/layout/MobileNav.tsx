"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  Building2,
  Clock,
  FileText,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Settings2,
  Sparkles,
  User2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// --- Types ---

interface SubLink {
  kind: "link";
  href: string;
  label: string;
  icon: LucideIcon;
}

interface SubAction {
  kind: "action";
  action: "logout";
  label: string;
  icon: LucideIcon;
}

type SubItem = SubLink | SubAction;

interface SingleLink {
  kind: "link";
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  cta?: boolean;
}

interface NavGroup {
  kind: "group";
  id: string;
  label: string;
  icon: LucideIcon;
  items: SubItem[];
}

type NavItem = SingleLink | NavGroup;

// --- Props ---

interface MobileNavProps {
  profileIncomplete?: boolean;
  canAccessHistorico?: boolean;
  canAccessEscolas?: boolean;
  canAccessBiblioteca?: boolean;
  canAccessRelatorios?: boolean;
}

// --- Nav builder: always exactly 5 items, Gerar at center ---

function buildNav(props: MobileNavProps): NavItem[] {
  const { canAccessHistorico, canAccessEscolas, canAccessBiblioteca, canAccessRelatorios } = props;

  const inicio: SingleLink = {
    kind: "link",
    href: "/dashboard",
    label: "Início",
    icon: LayoutDashboard,
    exact: true,
  };

  const gerar: SingleLink = {
    kind: "link",
    href: "/dashboard/gerar",
    label: "Gerar",
    icon: Sparkles,
    cta: true,
  };

  // Perfil sem suporte (Explorador — suporte fica separado na nav)
  const perfilGroup: NavGroup = {
    kind: "group",
    id: "perfil",
    label: "Perfil",
    icon: User2,
    items: [
      { kind: "link", href: "/dashboard/perfil", label: "Meu perfil", icon: User2 },
      { kind: "action", action: "logout", label: "Sair", icon: LogOut },
    ],
  };

  // Perfil com suporte agrupado (Educador, Mestre, Regente+)
  const perfilGroupWithSupport: NavGroup = {
    kind: "group",
    id: "perfil",
    label: "Perfil",
    icon: User2,
    items: [
      { kind: "link", href: "/dashboard/perfil", label: "Meu perfil", icon: User2 },
      { kind: "link", href: "/dashboard/suporte", label: "Suporte", icon: LifeBuoy },
      { kind: "action", action: "logout", label: "Sair", icon: LogOut },
    ],
  };

  // Explorador: Início · Templates · Gerar · Suporte · Perfil↗
  if (!canAccessEscolas && !canAccessHistorico) {
    return [
      inicio,
      { kind: "link", href: "/dashboard/templates", label: "Templates", icon: FileText },
      gerar,
      { kind: "link", href: "/dashboard/suporte", label: "Suporte", icon: LifeBuoy },
      perfilGroup,
    ];
  }

  // Educador: Início · Templates · Gerar · Histórico · Perfil↗ (com suporte)
  if (!canAccessEscolas) {
    return [
      inicio,
      { kind: "link", href: "/dashboard/templates", label: "Templates", icon: FileText },
      gerar,
      { kind: "link", href: "/dashboard/historico", label: "Histórico", icon: Clock },
      perfilGroupWithSupport,
    ];
  }

  const configGroup: NavGroup = {
    kind: "group",
    id: "config",
    label: "Config.",
    icon: Settings2,
    items: [
      { kind: "link", href: "/dashboard/escolas", label: "Minhas escolas", icon: Building2 },
      { kind: "link", href: "/dashboard/templates", label: "Meus templates", icon: FileText },
    ],
  };

  // Mestre: Início · Config.↗ · Gerar · Histórico · Perfil↗ (com suporte)
  if (!canAccessBiblioteca) {
    return [
      inicio,
      configGroup,
      gerar,
      { kind: "link", href: "/dashboard/historico", label: "Histórico", icon: Clock },
      perfilGroupWithSupport,
    ];
  }

  // Regente+: Início · Config.↗ · Gerar · Acervo↗ · Perfil↗ (com suporte)
  const acervoItems: SubLink[] = [
    { kind: "link", href: "/dashboard/historico", label: "Histórico", icon: Clock },
    { kind: "link", href: "/dashboard/biblioteca", label: "Biblioteca", icon: BookOpen },
    ...(canAccessRelatorios
      ? [{ kind: "link" as const, href: "/dashboard/relatorios", label: "Relatórios", icon: BarChart3 }]
      : []),
  ];

  return [
    inicio,
    configGroup,
    gerar,
    {
      kind: "group",
      id: "acervo",
      label: "Acervo",
      icon: BookOpen,
      items: acervoItems,
    },
    perfilGroupWithSupport,
  ];
}

// --- Component ---

export function MobileNav({
  profileIncomplete = false,
  canAccessHistorico = true,
  canAccessEscolas = false,
  canAccessBiblioteca = false,
  canAccessRelatorios = false,
}: MobileNavProps) {
  const pathname = usePathname();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);

  const navItems = buildNav({ canAccessHistorico, canAccessEscolas, canAccessBiblioteca, canAccessRelatorios });

  // Close popover on outside click
  useEffect(() => {
    if (!openGroup) return;
    function onOutside(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenGroup(null);
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [openGroup]);

  // Close popover on route change
  useEffect(() => { setOpenGroup(null); }, [pathname]);

  async function handleLogout() {
    setOpenGroup(null);
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/";
  }

  return (
    <nav
      ref={navRef}
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Navegação principal"
    >
      <div className="flex items-stretch">
        {navItems.map((item, idx) => {
          const isLast = idx === navItems.length - 1;

          // CTA link (Gerar)
          if (item.kind === "link" && item.cta) {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-1 flex-col items-center justify-center gap-0.5 px-1 py-3"
                aria-current={active ? "page" : undefined}
              >
                <span className={`flex h-12 w-12 items-center justify-center rounded-2xl transition ${
                  active ? "bg-violet-700" : "bg-violet-600"
                } shadow-md shadow-violet-300/60`}>
                  <item.icon className="h-6 w-6 text-white" />
                </span>
                <span className={`text-[10px] font-semibold ${active ? "text-violet-700" : "text-violet-600"}`}>
                  {item.label}
                </span>
              </Link>
            );
          }

          // Regular link
          if (item.kind === "link") {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
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
                <item.icon className={`h-5 w-5 transition ${active ? "text-slate-950" : "text-slate-400"}`} />
                <span className={`text-[10px] font-medium transition ${active ? "text-slate-950" : "text-slate-400"}`}>
                  {item.label}
                </span>
              </Link>
            );
          }

          // Group button with popover
          const groupActive = item.items.some(
            (sub) => sub.kind === "link" && (
              sub.href === "/dashboard/perfil"
                ? pathname === sub.href || pathname.startsWith("/dashboard/perfil")
                : pathname.startsWith(sub.href)
            )
          );
          const isOpen = openGroup === item.id;
          const showBadge = item.id === "perfil" && profileIncomplete;
          const popoverAlign = isLast ? "right-1" : "left-1/2 -translate-x-1/2";

          return (
            <div key={item.id} className="relative flex flex-1 flex-col">
              {/* Popover */}
              {isOpen && (
                <div className={`absolute bottom-full mb-2 z-50 min-w-[204px] rounded-2xl border border-slate-200 bg-white py-1.5 shadow-lg ${popoverAlign}`}>
                  {item.items.map((sub) => {
                    if (sub.kind === "action") {
                      return (
                        <button
                          key="logout"
                          type="button"
                          onClick={handleLogout}
                          className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-rose-600 transition hover:bg-rose-50"
                        >
                          <sub.icon className="h-4 w-4 shrink-0" />
                          {sub.label}
                        </button>
                      );
                    }
                    const subActive = pathname.startsWith(sub.href);
                    return (
                      <Link
                        key={sub.href}
                        href={sub.href}
                        onClick={() => setOpenGroup(null)}
                        className={`flex items-center gap-2.5 px-3.5 py-2.5 text-sm transition hover:bg-slate-50 ${
                          subActive ? "font-semibold text-slate-950" : "text-slate-700"
                        }`}
                      >
                        <sub.icon className={`h-4 w-4 shrink-0 ${subActive ? "text-slate-950" : "text-slate-400"}`} />
                        {sub.label}
                      </Link>
                    );
                  })}
                </div>
              )}

              {/* Button */}
              <button
                type="button"
                onClick={() => setOpenGroup(isOpen ? null : item.id)}
                className="relative flex flex-1 flex-col items-center justify-center gap-1 px-1 py-3 transition"
                aria-expanded={isOpen}
                aria-haspopup="menu"
              >
                {(groupActive && !isOpen) && (
                  <span className="absolute top-0 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-slate-950" aria-hidden />
                )}
                {isOpen && (
                  <span className="absolute top-0 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-violet-600" aria-hidden />
                )}
                <div className="relative">
                  <item.icon className={`h-5 w-5 transition ${isOpen ? "text-violet-600" : groupActive ? "text-slate-950" : "text-slate-400"}`} />
                  {showBadge && (
                    <span className="absolute -right-2 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold leading-none text-white">
                      1
                    </span>
                  )}
                </div>
                <span className={`text-[10px] font-medium transition ${isOpen ? "text-violet-600" : groupActive ? "text-slate-950" : "text-slate-400"}`}>
                  {item.label}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
