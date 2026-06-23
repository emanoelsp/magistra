import { PLAN_LIMITS, PLAN_PRICES_BRL, PLAN_LABELS } from "../../lib/services/plan-config";

function formatPrice(key: string): string {
  const price = PLAN_PRICES_BRL[key] ?? 0;
  if (price === 0) return "R$ 0";
  return `R$ ${price.toFixed(2).replace(".", ",")}`;
}

function downloadLabel(max: number, docxOnly = false): string {
  if (max >= 999) return "Downloads ilimitados";
  const formats = docxOnly ? "DOCX" : "DOCX e/ou PDF";
  return `${max} download${max > 1 ? "s" : ""} por plano (${formats})`;
}

export interface LandingPlan {
  id: string;
  name: string;
  badge: string;
  price: string;
  period: string;
  desc: string;
  features: string[];
  href: string;
  cta: string;
  theme: "green" | "white" | "dark";
  featured: boolean;
}

export const LANDING_PLANS: LandingPlan[] = [
  {
    id: "free",
    name: PLAN_LABELS.free,
    badge: "Teste grátis",
    price: formatPrice("free"),
    period: "/ mês",
    desc: "Para dar os primeiros passos com a Magis sem compromisso.",
    features: [
      `${PLAN_LIMITS.free.maxTemplates} template ativo`,
      `${PLAN_LIMITS.free.maxPlanosPerMonth} plano por mês`,
      "Magis: BNCC, SAEB e currículo territorial",
      "Editor passo a passo",
      downloadLabel(PLAN_LIMITS.free.maxDownloadsPerPlano, true),
    ],
    href: "/login?mode=signup",
    cta: "Começar grátis",
    theme: "green",
    featured: false,
  },
  {
    id: "starter",
    name: PLAN_LABELS.starter,
    badge: "",
    price: formatPrice("starter"),
    period: "/ mês",
    desc: "Para professores que buscam agilidade no planejamento sem abrir mão da qualidade.",
    features: [
      `${PLAN_LIMITS.starter.maxTemplates} template ativo`,
      `${PLAN_LIMITS.starter.maxPlanosPerMonth} planos por mês`,
      downloadLabel(PLAN_LIMITS.starter.maxDownloadsPerPlano),
      "Tudo do Explorador",
      "Prioridade no suporte",
    ],
    href: "/login?mode=signup",
    cta: "Começar agora",
    theme: "white",
    featured: false,
  },
  {
    id: "medio",
    name: PLAN_LABELS.medio,
    badge: "Mais popular",
    price: formatPrice("medio"),
    period: "/ mês",
    desc: "Para o professor que não abre mão de planejamentos de qualidade.",
    features: [
      `${PLAN_LIMITS.medio.maxTemplates} templates ativos`,
      `${PLAN_LIMITS.medio.maxPlanosPerMonth} planos por mês`,
      downloadLabel(PLAN_LIMITS.medio.maxDownloadsPerPlano),
      "Tudo do Educador",
      "Histórico completo",
    ],
    href: "/login?mode=signup",
    cta: "Começar agora",
    theme: "dark",
    featured: true,
  },
  {
    id: "pro",
    name: PLAN_LABELS.pro,
    badge: "",
    price: formatPrice("pro"),
    period: "/ mês",
    desc: "Para professores com múltiplas turmas, disciplinas e templates.",
    features: [
      `${PLAN_LIMITS.pro.maxTemplates} templates ativos`,
      `${PLAN_LIMITS.pro.maxPlanosPerMonth} planos por mês`,
      downloadLabel(PLAN_LIMITS.pro.maxDownloadsPerPlano),
      "Tudo do Mestre",
      "Relatórios de uso",
    ],
    href: "/login?mode=signup",
    cta: "Começar agora",
    theme: "white",
    featured: false,
  },
];
