import { getAdminDb } from "../../../lib/firebase/admin";

interface UserRow {
  uid: string;
  email: string;
  nome: string;
  plano: string;
  templates: number;
  planos: number;
  tokens: number;
  costUsd: number;
}

async function getUsers(): Promise<UserRow[]> {
  const db = getAdminDb();
  const [usersSnap, templatesSnap, planosSnap, logsSnap] = await Promise.all([
    db.collection("users").get(),
    db.collection("templates").get(),
    db.collection("planos").get(),
    db.collection("usage_logs").get(),
  ]);

  const templatesByUser: Record<string, number> = {};
  for (const d of templatesSnap.docs) {
    const uid = d.data().user_id as string;
    templatesByUser[uid] = (templatesByUser[uid] ?? 0) + 1;
  }

  const planosByUser: Record<string, number> = {};
  for (const d of planosSnap.docs) {
    const uid = d.data().user_id as string;
    planosByUser[uid] = (planosByUser[uid] ?? 0) + 1;
  }

  const costByUser: Record<string, number> = {};
  const tokensByUser: Record<string, number> = {};
  for (const d of logsSnap.docs) {
    const log = d.data();
    const uid = log.user_id as string;
    costByUser[uid] = (costByUser[uid] ?? 0) + ((log.cost_usd as number) ?? 0);
    tokensByUser[uid] = (tokensByUser[uid] ?? 0) + ((log.tokens_total as number) ?? 0);
  }

  return usersSnap.docs.map((doc) => {
    const data = doc.data();
    return {
      uid: doc.id,
      email: (data.email as string) ?? "—",
      nome: (data.nome as string) ?? "—",
      plano: (data.plano as string) ?? "—",
      templates: templatesByUser[doc.id] ?? 0,
      planos: planosByUser[doc.id] ?? 0,
      tokens: tokensByUser[doc.id] ?? 0,
      costUsd: costByUser[doc.id] ?? 0,
    };
  }).sort((a, b) => b.planos - a.planos);
}

function usd(v: number) {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 4 });
}

function num(v: number) {
  return v.toLocaleString("pt-BR");
}

export default async function UsuariosPage() {
  const users = await getUsers();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-violet-600">Admin</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-950">Usuários cadastrados</h1>
        <p className="mt-1 text-sm text-slate-500">{num(users.length)} usuários no total</p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Usuário
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Plano
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Templates
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Planos gerados
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Tokens
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Custo IA
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
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
                      <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-700">
                        {u.plano}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-slate-800">{u.templates}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-800">{u.planos}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{num(u.tokens)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-rose-600">{usd(u.costUsd)}</td>
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
