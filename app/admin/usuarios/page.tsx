export const dynamic = "force-dynamic";

import { getAdminDb } from "../../../lib/firebase/admin";
import { PLAN_PRICES_BRL, PLAN_LABELS } from "../../../lib/services/limits";
import { PlanChanger } from "./plan-changer";

const USD_BRL = 5.7;

interface UserRow {
  uid: string;
  email: string;
  nome: string;
  plano: string;
  templates: number;
  planos: number;
  planosThisMonth: number;
  tokens: number;
  costUsd: number;
  mensalidade: number;
  resultado: number;
  criadoEm?: string;
}

async function getUsers(): Promise<UserRow[]> {
  const db = getAdminDb();
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [usersSnap, templatesSnap, planosSnap, logsSnap] = await Promise.all([
    db.collection("magis_users").get(),
    db.collection("magis_templates").get(),
    db.collection("magis_planos").get(),
    db.collection("magis_usage_logs").get(),
  ]);

  const templatesByUser: Record<string, number> = {};
  for (const d of templatesSnap.docs) {
    const uid = d.data().user_id as string;
    templatesByUser[uid] = (templatesByUser[uid] ?? 0) + 1;
  }

  const planosByUser: Record<string, number> = {};
  const planosMesByUser: Record<string, number> = {};
  for (const d of planosSnap.docs) {
    const uid = d.data().user_id as string;
    planosByUser[uid] = (planosByUser[uid] ?? 0) + 1;
    if ((d.data().data_geracao as string) >= startOfMonth) {
      planosMesByUser[uid] = (planosMesByUser[uid] ?? 0) + 1;
    }
  }

  const costByUser: Record<string, number> = {};
  const tokensByUser: Record<string, number> = {};
  for (const d of logsSnap.docs) {
    const log = d.data();
    const uid = log.user_id as string;
    costByUser[uid] = (costByUser[uid] ?? 0) + ((log.cost_usd as number) ?? 0);
    tokensByUser[uid] = (tokensByUser[uid] ?? 0) + ((log.tokens_total as number) ?? 0);
  }

  return usersSnap.docs
    .map((doc) => {
      const data = doc.data();
      const plano = ((data.plano as string) ?? "free").toLowerCase();
      const mensalidade = PLAN_PRICES_BRL[plano] ?? 0;
      const costoBrl = (costByUser[doc.id] ?? 0) * USD_BRL;
      return {
        uid: doc.id,
        email: (data.email as string) ?? "—",
        nome: (data.nome as string) ?? "—",
        plano,
        templates: templatesByUser[doc.id] ?? 0,
        planos: planosByUser[doc.id] ?? 0,
        planosThisMonth: planosMesByUser[doc.id] ?? 0,
        tokens: tokensByUser[doc.id] ?? 0,
        costUsd: costByUser[doc.id] ?? 0,
        mensalidade,
        resultado: mensalidade - costoBrl,
      };
    })
    .sort((a, b) => b.mensalidade - a.mensalidade || b.planos - a.planos);
}

function brl(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function num(v: number) {
  return v.toLocaleString("pt-BR");
}

const PLAN_COLORS: Record<string, string> = {
  free:    "bg-slate-100 text-slate-700",
  starter: "bg-blue-100 text-blue-700",
  medio:   "bg-violet-100 text-violet-700",
  pro:     "bg-amber-100 text-amber-700",
  escola:  "bg-emerald-100 text-emerald-700",
};

export default async function UsuariosPage() {
  const users = await getUsers();
  const mrr = users.reduce((s, u) => s + u.mensalidade, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-violet-600">Admin</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-950">Usuários</h1>
          <p className="mt-1 text-sm text-slate-500">
            {num(users.length)} usuários · MRR {brl(mrr)}
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                {["Usuário", "Plano", "Templates", "Planos/mês", "Total planos", "Tokens", "Custo IA", "Mensalidade", "Resultado"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 first:text-left last:text-right">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-400">
                    Nenhum usuário cadastrado.
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.uid} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{u.nome}</p>
                      <p className="text-xs text-slate-500">{u.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <PlanChanger uid={u.uid} currentPlano={u.plano} />
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-slate-800">{u.templates}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{u.planosThisMonth}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-800">{u.planos}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{num(u.tokens)}</td>
                    <td className="px-4 py-3 text-right text-rose-600">{brl(u.costUsd * USD_BRL)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-700">{brl(u.mensalidade)}</td>
                    <td className="px-4 py-3 text-right font-bold">
                      <span className={u.resultado >= 0 ? "text-emerald-700" : "text-rose-600"}>
                        {brl(u.resultado)}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
