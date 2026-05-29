import Link from "next/link";
import { ArrowLeft, LifeBuoy } from "lucide-react";

import { requireCurrentUserProfile } from "../../../lib/auth/session";
import { SuporteTabs } from "./suporte-tabs";

export const dynamic = "force-dynamic";

export default async function SuportePage() {
  const user = await requireCurrentUserProfile();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-2 text-sm font-medium text-slate-600 transition hover:text-slate-950"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar ao dashboard
        </Link>
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-emerald-100 p-3 text-emerald-600">
            <LifeBuoy className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Suporte</h1>
            <p className="text-sm text-slate-500">Abra chamados e acompanhe o atendimento da sua conta.</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <SuporteTabs
        userId={user.uid}
        userName={user.nome ?? ""}
        userEmail={user.email}
        userEscola={user.escola_padrao ?? ""}
      />
    </div>
  );
}
