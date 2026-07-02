import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, UserCheck } from "lucide-react";
import { requireCurrentUserProfile } from "../../../lib/auth/session";
import { getUserEscolas, getUserTurmas } from "../../../lib/services/firestore/escolas.server";
import { getPlanCapabilities } from "../../../lib/services/plan-capabilities";
import { getAdminDb } from "../../../lib/firebase/admin";
import type { EstudanteRecord } from "../../../lib/types/firestore";
import { EstudantesManager } from "../../../components/estudantes/estudantes-manager";

export const dynamic = "force-dynamic";

async function getUserEstudantes(uid: string): Promise<EstudanteRecord[]> {
  const db = getAdminDb();
  const snap = await db.collection("magis_estudantes").where("user_id", "==", uid).get();
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() } as EstudanteRecord))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export default async function EstudantesPage() {
  const user = await requireCurrentUserProfile();
  const caps = getPlanCapabilities(user.plano ?? "free");
  if (!caps.canManageEstudantes) redirect("/dashboard");

  const [estudantes, escolas, turmas] = await Promise.all([
    getUserEstudantes(user.uid),
    getUserEscolas(user.uid),
    getUserTurmas(user.uid),
  ]);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-2 text-sm font-medium text-slate-600 transition hover:text-slate-950"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar ao dashboard
        </Link>
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-indigo-100 p-3 text-indigo-600">
            <UserCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Meus Estudantes</h1>
            <p className="text-sm text-slate-500">Alunos com necessidades especiais e seus Planos Educacionais Individualizados.</p>
          </div>
        </div>
      </header>

      <EstudantesManager
        initialEstudantes={estudantes}
        escolas={escolas}
        turmas={turmas}
      />
    </div>
  );
}
