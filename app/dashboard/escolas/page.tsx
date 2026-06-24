import Link from "next/link";
import { ArrowLeft, Building2 } from "lucide-react";
import { requireCurrentUserProfile } from "../../../lib/auth/session";
import { getUserEscolas, getUserTurmas } from "../../../lib/services/firestore/escolas.server";
import { EscolasManager } from "../../../components/escolas/escolas-manager";

export const dynamic = "force-dynamic";

export default async function EscolasPage() {
  const user = await requireCurrentUserProfile();
  const [escolas, turmas] = await Promise.all([
    getUserEscolas(user.uid),
    getUserTurmas(user.uid),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-2 text-sm font-medium text-slate-600 transition hover:text-slate-950"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar ao dashboard
        </Link>
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-amber-100 p-3 text-amber-600">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
              Minhas Escolas
            </h1>
            <p className="text-sm text-slate-500">
              Organize escolas e turmas para agilizar o preenchimento dos seus planos.
            </p>
          </div>
        </div>
      </div>
      <EscolasManager initialEscolas={escolas} initialTurmas={turmas} initialEscolaPadrao={user.escola_padrao} />
    </div>
  );
}
