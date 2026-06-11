import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import Link from "next/link";
import { Activity, BarChart3, BookOpen, DollarSign, Inbox, Settings, Tag, Users, Zap, Gauge } from "lucide-react";
import { getCurrentSession as getSession, getCurrentUserProfile } from "../../lib/auth/session";

function isEmailAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase());
  return admins.includes(email.toLowerCase());
}

const NAV = [
  { href: "/admin",           label: "Visão geral",  icon: BarChart3 },
  { href: "/admin/usuarios",  label: "Usuários",     icon: Users },
  { href: "/admin/custos",    label: "Custos & IA",  icon: Zap },
  { href: "/admin/uso-ia",   label: "Uso de APIs",  icon: Gauge },
  { href: "/admin/mensagens", label: "Mensagens",    icon: Inbox },
  { href: "/admin/saude",     label: "Saúde APIs",   icon: Activity },
  { href: "/admin/caixa",     label: "Caixa",        icon: BookOpen },
  { href: "/admin/cupons",    label: "Cupons",       icon: Tag },
  { href: "/admin/config",    label: "Configuração", icon: Settings },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  const profile = await getCurrentUserProfile();

  // Gate duplo: email na whitelist de env vars E role=admin no Firestore
  if (!session || !isEmailAllowed(session.email) || profile?.role !== "admin") {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-slate-200 bg-white px-4 py-6">
        <div className="mb-8">
          <span className="text-xs font-semibold uppercase tracking-widest text-violet-600">
            PlanoMagistra
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

        <div className="mt-8 border-t border-slate-100 pt-6 space-y-3">
          <Link
            href="/planos"
            className="flex items-center gap-2 text-xs text-violet-600 hover:text-violet-800"
          >
            <DollarSign className="h-3.5 w-3.5" />
            Página de planos
          </Link>
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
