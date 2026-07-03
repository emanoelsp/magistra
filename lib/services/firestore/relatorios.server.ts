import "server-only";

import { getAdminDb } from "../../firebase/admin";
import type { PlanoStatus } from "../../types/firestore";

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string") return new Date(value);
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate();
  }
  return new Date();
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
}

export interface PlanoPorMes {
  key: string;
  label: string;
  gerados: number;
  rascunhos: number;
  total: number;
}

export interface TemplateUsage {
  templateId: string;
  nome: string;
  count: number;
}

export interface EscolaUsage {
  nome: string;
  count: number;
}

export interface RelatorioData {
  totalPlanos: number;
  totalGerados: number;
  totalRascunhos: number;
  tempoEconomizadoMin: number;
  tokensUsadosMes: number;
  planosPorMes: PlanoPorMes[];
  statusBreakdown: Array<{ status: string; label: string; count: number; pct: number }>;
  templatesMaisUsados: TemplateUsage[];
  escolasMaisUsadas: EscolaUsage[];
  mediaDiasPorPlano: number;
}

const STATUS_LABELS: Record<string, string> = {
  gerado:               "Gerado",
  rascunho:             "Rascunho",
  processando:          "Processando",
  aguardando_geracao:   "Aguardando geração",
  aguardando_aprovacao: "Aguardando revisão",
  erro:                 "Erro",
};

export async function getRelatorioData(
  userId: string,
  tempoEconomizadoMin: number,
  tokensUsadosMes: number,
): Promise<RelatorioData> {
  const db = getAdminDb();

  const [planosSnap, templatesSnap] = await Promise.all([
    db.collection("magins_planos_aula").where("user_id", "==", userId).get(),
    db.collection("magis_templates").where("user_id", "==", userId).get(),
  ]);

  // Map template IDs to names
  const templateNomes: Record<string, string> = {};
  for (const doc of templatesSnap.docs) {
    const d = doc.data();
    templateNomes[doc.id] = typeof d.nome === "string" ? d.nome : "Template sem nome";
  }

  // Build last 6 months skeleton
  const now = new Date();
  const monthKeys: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthKeys.push(monthKey(d));
  }

  const byMonth: Record<string, { gerados: number; rascunhos: number }> = {};
  for (const k of monthKeys) byMonth[k] = { gerados: 0, rascunhos: 0 };

  const statusCount: Record<string, number> = {};
  const templateCount: Record<string, number> = {};
  const escolaCount: Record<string, number> = {};
  let totalGerados = 0;
  let totalRascunhos = 0;
  let somaDias = 0;
  let countComData = 0;

  for (const doc of planosSnap.docs) {
    const d = doc.data();
    if (d.deleted_at) continue;
    const status = (typeof d.status === "string" ? d.status : "rascunho") as PlanoStatus;
    const dataGeracao = toDate(d.data_geracao ?? d.data_criacao);
    const templateId = typeof d.template_id === "string" ? d.template_id : "";

    // Status
    statusCount[status] = (statusCount[status] ?? 0) + 1;
    if (status === "gerado") totalGerados++;
    if (status === "rascunho") totalRascunhos++;

    // Mês
    const mk = monthKey(dataGeracao);
    if (byMonth[mk]) {
      if (status === "gerado") byMonth[mk].gerados++;
      else byMonth[mk].rascunhos++;
    }

    // Template usage
    if (templateId) {
      templateCount[templateId] = (templateCount[templateId] ?? 0) + 1;
    }

    // Escola
    const escolaNome =
      typeof d.escola_nome === "string" && d.escola_nome
        ? d.escola_nome
        : typeof d.conteudo_gerado?.escola === "string"
        ? (d.conteudo_gerado.escola as string)
        : null;
    if (escolaNome) {
      escolaCount[escolaNome] = (escolaCount[escolaNome] ?? 0) + 1;
    }

    // Tempo médio (dias entre criação e geração)
    if (status === "gerado" && d.data_criacao && d.data_geracao) {
      const dias =
        (toDate(d.data_geracao).getTime() - toDate(d.data_criacao).getTime()) / (1000 * 60 * 60 * 24);
      somaDias += dias;
      countComData++;
    }
  }

  const total = planosSnap.docs.filter((d) => !d.data().deleted_at).length;

  const planosPorMes: PlanoPorMes[] = monthKeys.map((k) => ({
    key: k,
    label: monthLabel(k),
    gerados: byMonth[k].gerados,
    rascunhos: byMonth[k].rascunhos,
    total: byMonth[k].gerados + byMonth[k].rascunhos,
  }));

  const statusBreakdown = Object.entries(statusCount)
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => ({
      status,
      label: STATUS_LABELS[status] ?? status,
      count,
      pct: total > 0 ? Math.round((count / total) * 100) : 0,
    }));

  const templatesMaisUsados: TemplateUsage[] = Object.entries(templateCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([templateId, count]) => ({
      templateId,
      nome: templateNomes[templateId] ?? "Template removido",
      count,
    }));

  const escolasMaisUsadas: EscolaUsage[] = Object.entries(escolaCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([nome, count]) => ({ nome, count }));

  const mediaDiasPorPlano =
    countComData > 0 ? Math.round((somaDias / countComData) * 10) / 10 : 0;

  return {
    totalPlanos: total,
    totalGerados,
    totalRascunhos,
    tempoEconomizadoMin,
    tokensUsadosMes,
    planosPorMes,
    statusBreakdown,
    templatesMaisUsados,
    escolasMaisUsadas,
    mediaDiasPorPlano,
  };
}
