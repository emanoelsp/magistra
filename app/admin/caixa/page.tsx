export const dynamic = "force-dynamic";

import { getAdminDb } from "../../../lib/firebase/admin";
import type { BalanceteRecord } from "../../../lib/types/firestore";
import { BalanceteCard, FecharCaixaButton } from "./caixa-client";
import { BookOpen } from "lucide-react";

async function getBalancetes(): Promise<BalanceteRecord[]> {
  const db = getAdminDb();
  const snap = await db.collection("magis_balancetes").orderBy("periodo", "desc").limit(60).get();
  return snap.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      tipo: d.tipo as "mensal" | "anual",
      periodo: d.periodo as string,
      mrr_brl: (d.mrr_brl as number) ?? 0,
      custo_ia_usd: (d.custo_ia_usd as number) ?? 0,
      custo_fixo_usd: (d.custo_fixo_usd as number) ?? 0,
      custo_total_usd: (d.custo_total_usd as number) ?? 0,
      resultado_brl: (d.resultado_brl as number) ?? 0,
      saldo_anterior_brl: (d.saldo_anterior_brl as number) ?? 0,
      saldo_final_brl: (d.saldo_final_brl as number) ?? 0,
      fechado_em: d.fechado_em as string,
      fechado_por: d.fechado_por as string,
      notas: d.notas as string | undefined,
      usuarios_por_plano: (d.usuarios_por_plano as Record<string, number>) ?? {},
      total_usuarios: (d.total_usuarios as number) ?? 0,
      planos_gerados: (d.planos_gerados as number) ?? 0,
      tokens_total: (d.tokens_total as number) ?? 0,
    };
  });
}

export default async function CaixaPage() {
  const balancetes = await getBalancetes();
  const ultimo = balancetes[0];
  const saldoAtual = ultimo?.saldo_final_brl ?? 0;

  const mensais = balancetes.filter((b) => b.tipo === "mensal");
  const anuais = balancetes.filter((b) => b.tipo === "anual");

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-violet-600">Admin</p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-slate-950">
            <BookOpen className="h-6 w-6" />
            Caixa & Balancetes
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Saldo acumulado atual:{" "}
            <span className={`font-bold ${saldoAtual >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
              {saldoAtual.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <FecharCaixaButton tipo="mensal" label="Fechar caixa mensal" />
          <FecharCaixaButton tipo="anual" label="Fechar caixa anual" />
        </div>
      </div>

      {balancetes.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center">
          <BookOpen className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm text-slate-500">Nenhum balancete registrado. Feche o primeiro caixa acima.</p>
        </div>
      )}

      {mensais.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-slate-950">Balancetes mensais</h2>
          {mensais.map((b) => <BalanceteCard key={b.id} b={b} />)}
        </div>
      )}

      {anuais.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-slate-950">Balancetes anuais</h2>
          {anuais.map((b) => <BalanceteCard key={b.id} b={b} />)}
        </div>
      )}
    </div>
  );
}
