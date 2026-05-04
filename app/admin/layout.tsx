import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import Link from "next/link";
import { BarChart3, DollarSign, Settings, Users, Zap } from "lucide-react";
import { getCurrentSession as getSession } from "../../lib/auth/session";

function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase());
  return admins.includes(email.toLowerCase());
}

const NAV = [
  { href: "/admin", label: "Visão geral", icon: BarChart3 },
  { href: "/admin/usuarios", label: "Usuários", icon: Users },
  { href: "/admin/custos", label: "Custos & IA", icon: Zap },
  { href: "/admin/config", label: "Configuração", icon: Settings },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await getSession();

  if (!session || !isAdmin(session.email)) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-slate-200 bg-white px-4 py-6">
        <div className="mb-8">
          <span className="text-xs font-semibold uppercase tracking-widest text-violet-600">
            PlanoMestre
          </span>
          <p className="mt-0.5 text-sm font-bold text-slate-950">Backoffice Admin</p>
        </div>

        <nav className="space-y-1">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </nav>

        <div className="mt-8 border-t border-slate-100 pt-6">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-800"
          >
            ← Voltar ao app
          </Link>
        </div>

        <div className="mt-4">
          <p className="text-xs text-slate-400">{session.email}</p>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto px-8 py-8">{children}</main>
    </div>
  );
}
