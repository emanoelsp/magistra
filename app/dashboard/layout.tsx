import type { ReactNode } from "react";

import { Sidebar } from "../../components/layout/Sidebar";
import { MagisToastContainer } from "../../components/ui/MagisToastContainer";

interface DashboardLayoutProps {
  children: ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <div className="h-screen overflow-hidden bg-slate-50">
      <div className="flex h-full gap-4 px-4 py-5">
        <Sidebar />
        <main className="flex flex-col flex-1 min-w-0 overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          {children}
        </main>
      </div>
      <MagisToastContainer />
    </div>
  );
}

