import type { ReactNode } from "react";

import { Sidebar } from "../../components/layout/Sidebar";
import { MobileNav } from "../../components/layout/MobileNav";
import { MagisToastContainer } from "../../components/ui/MagisToastContainer";
import { requireCurrentUserProfile } from "../../lib/auth/session";

interface DashboardLayoutProps {
  children: ReactNode;
}

export default async function DashboardLayout({ children }: DashboardLayoutProps) {
  const user = await requireCurrentUserProfile();
  const profileIncomplete = !user.nome?.trim() || !user.escola_padrao?.trim();

  return (
    <div className="h-[100dvh] overflow-hidden bg-slate-50">
      <div className="flex h-full gap-4 md:px-4 md:py-5">
        <Sidebar profileIncomplete={profileIncomplete} />
        <main className="flex flex-col flex-1 min-w-0 overflow-y-auto rounded-none border-0 bg-white p-4 shadow-none md:rounded-3xl md:border md:border-slate-200 md:p-6 md:shadow-sm pb-24 md:pb-6">
          {children}
        </main>
      </div>
      <MobileNav profileIncomplete={profileIncomplete} />
      <MagisToastContainer />
    </div>
  );
}
