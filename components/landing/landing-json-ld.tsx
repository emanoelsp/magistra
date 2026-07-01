import { PLAN_LIMITS, PLAN_PRICES_BRL } from "../../lib/services/plan-config";

export function LandingJsonLd() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "PlanoMagistra",
    applicationCategory: "EducationalApplication",
    operatingSystem: "Web",
    description:
      "Reduza 70% do tempo com burocracia escolar. Suba o template da sua escola, a Magis extrai a estrutura e sugere conteúdos campo a campo — BNCC, SAEB, Currículo Digital e currículo territorial.",
    offers: {
      "@type": "Offer",
      price: PLAN_PRICES_BRL.free.toString(),
      priceCurrency: "BRL",
      description: `${PLAN_LIMITS.free.maxTemplates} template ativo, ${PLAN_LIMITS.free.maxPlanosPerMonth} plano por mês`,
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
