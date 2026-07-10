/**
 * Marketing copy for the pricing pages (landing, onboarding, upgrade modal).
 *
 * Numeric limits and prices are DERIVED from lib/services/plan-config.ts —
 * the enforcement source of truth — so the pricing page can never promise
 * something different from what the app actually enforces.
 * tests/plans.test.ts guards this contract.
 */
import { PLAN_LIMITS, PLAN_PRICES_BRL } from "./plan-config";

function precoBRL(id: string): string {
  const v = PLAN_PRICES_BRL[id] ?? 0;
  return v === 0 ? "R$ 0" : `R$ ${v.toFixed(2).replace(".", ",")}`;
}

/**
 * First three feature lines, always in this order — upgrade-modal reads
 * features[0] (templates) and features[1] (planos) positionally.
 */
function limitesFeatures(id: string): string[] {
  const l = PLAN_LIMITS[id];
  const s = (n: number) => (n === 1 ? "" : "s");
  return [
    `${l.maxTemplates} template${s(l.maxTemplates)} ativo${s(l.maxTemplates)}`,
    `${l.maxPlanosPerMonth} plano${s(l.maxPlanosPerMonth)} por mês`,
    `${l.maxDownloadsPerPlano} download${s(l.maxDownloadsPerPlano)} PDF por plano`,
  ];
}

export const PLANS = [
  {
    id: "free",
    name: "Explorador",
    badge: "Teste grátis/90 dias",
    price: precoBRL("free"),
    period: "/ mês",
    description: "Para dar os primeiros passos com a Magis sem compromisso.",
    features: [
      ...limitesFeatures("free"),
      "Sugestões de conteúdo com Magis: BNCC, SAEB e currículo territorial",
      "Editor split-view",
      "Editor de texto livre",
    ],
    available: true,
    cta: "Começar grátis",
    theme: "green" as const,
    featured: false,
  },
  {
    id: "starter",
    name: "Educador",
    badge: "",
    price: precoBRL("starter"),
    period: "/ mês",
    description:
      "Para professores que buscam agilidade no planejamento sem abrir mão da qualidade.",
    features: [
      ...limitesFeatures("starter"),
      "Tudo do Explorador",
      "Prioridade no suporte",
      "Histórico completo",
    ],
    available: true,
    cta: "Começar agora",
    theme: "white" as const,
    featured: false,
  },
  {
    id: "medio",
    name: "Mestre",
    badge: "Mais popular",
    price: precoBRL("medio"),
    period: "/ mês",
    description: "Para o professor que não abre mão de planejamentos de qualidade.",
    features: [
      ...limitesFeatures("medio"),
      "Tudo do Educador",
      "Organização de templates por escola e turmas",
      "Capacidade aprimorada de sugestões com Magis",
    ],
    available: true,
    cta: "Começar agora",
    theme: "dark" as const,
    featured: true,
  },
  {
    id: "pro",
    name: "Regente",
    badge: "",
    price: precoBRL("pro"),
    period: "/ mês",
    description: "Para professores com múltiplas turmas, disciplinas e templates.",
    features: [
      ...limitesFeatures("pro"),
      "Tudo do Mestre",
      "Relatórios de uso",
      "Biblioteca de templates",
      "Memória de contexto ilimitada",
    ],
    available: true,
    cta: "Começar agora",
    theme: "white" as const,
    featured: false,
  },
] as const;

export type Plan = (typeof PLANS)[number];
export type PlanId = Plan["id"];
