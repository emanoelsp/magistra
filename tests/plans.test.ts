import { describe, expect, it } from "vitest";
import { PLANS } from "../lib/services/plans";
import {
  normalizePlanKey,
  PLAN_LABELS,
  PLAN_LIMITS,
  PLAN_PRICES_BRL,
} from "../lib/services/plan-config";

// Contrato marketing × enforcement: o que a página de preços promete tem que
// ser exatamente o que plan-config.ts aplica.
describe("PLANS × PLAN_LIMITS", () => {
  it("todo plano anunciado existe no enforcement", () => {
    for (const plan of PLANS) {
      expect(PLAN_LIMITS[plan.id], `PLAN_LIMITS não tem "${plan.id}"`).toBeDefined();
    }
  });

  it("as três primeiras features refletem os limites reais (ordem fixa: templates, planos, downloads)", () => {
    for (const plan of PLANS) {
      const l = PLAN_LIMITS[plan.id];
      // upgrade-modal lê features[0] e features[1] posicionalmente
      expect(plan.features[0]).toMatch(new RegExp(`^${l.maxTemplates} template`));
      expect(plan.features[1]).toMatch(new RegExp(`^${l.maxPlanosPerMonth} plano`));
      expect(plan.features[2]).toMatch(new RegExp(`^${l.maxDownloadsPerPlano} download`));
    }
  });

  it("preço exibido bate com PLAN_PRICES_BRL", () => {
    for (const plan of PLANS) {
      const v = PLAN_PRICES_BRL[plan.id];
      const expected = v === 0 ? "R$ 0" : `R$ ${v.toFixed(2).replace(".", ",")}`;
      expect(plan.price).toBe(expected);
    }
  });

  it("nome exibido bate com PLAN_LABELS", () => {
    for (const plan of PLANS) {
      expect(plan.name).toBe(PLAN_LABELS[plan.id]);
    }
  });
});

describe("normalizePlanKey", () => {
  it("aceita chaves canônicas diretamente", () => {
    expect(normalizePlanKey("medio")).toBe("medio");
    expect(normalizePlanKey("PRO")).toBe("pro");
  });

  it("normaliza labels de exibição para a chave", () => {
    expect(normalizePlanKey("Mestre")).toBe("medio");
    expect(normalizePlanKey("educador")).toBe("starter");
  });

  it("SKUs legados existem como chaves próprias no enforcement", () => {
    // avancado/premium têm entrada própria em PLAN_LIMITS (4 downloads vs 3 do
    // pro), então normalizePlanKey preserva a chave em vez de aliasear
    expect(normalizePlanKey("avancado")).toBe("avancado");
    expect(normalizePlanKey("premium")).toBe("premium");
    expect(PLAN_LABELS["avancado"]).toBe("Regente");
  });

  it("valores desconhecidos ou vazios caem em free", () => {
    expect(normalizePlanKey("inexistente")).toBe("free");
    expect(normalizePlanKey(null)).toBe("free");
    expect(normalizePlanKey(undefined)).toBe("free");
  });
});
