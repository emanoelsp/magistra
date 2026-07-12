import { describe, expect, it } from "vitest";
import type { TemplateFieldSchema } from "../lib/types/firestore";
import { isCampoIa, normalizeSchemaRoles } from "../lib/utils/field-taxonomy";

function f(partial: Partial<TemplateFieldSchema>): TemplateFieldSchema {
  return { key: "campo", label: "Campo", type: "text", required: false, ...partial };
}

describe("isCampoIa — classe explícita vence, role é fallback", () => {
  it("classe pedagogico é IA mesmo com role=manual (a contradição do bug)", () => {
    expect(isCampoIa(f({ role: "manual", classe: "pedagogico" }))).toBe(true);
  });

  it("classe perfil NÃO é IA mesmo com role=ia_sugerida", () => {
    expect(isCampoIa(f({ role: "ia_sugerida", classe: "perfil" }))).toBe(false);
  });

  it("sem classe, o role legado decide (templates antigos intactos)", () => {
    expect(isCampoIa(f({ role: "ia_sugerida" }))).toBe(true);
    expect(isCampoIa(f({ role: "manual" }))).toBe(false);
    expect(isCampoIa(f({}))).toBe(false);
  });
});

describe("normalizeSchemaRoles", () => {
  it("corrige o role de campos contraditórios para os checks downstream", () => {
    const schema = normalizeSchemaRoles([
      f({ key: "recursos", role: "manual", classe: "pedagogico" }),
      f({ key: "professor", role: "manual", classe: "perfil" }),
      f({ key: "data", role: "ia_sugerida", classe: "contextual" }),
    ]);
    expect(schema.map((s) => s.role)).toEqual(["ia_sugerida", "manual", "manual"]);
  });

  it("campos coerentes saem por referência (sem clone desnecessário)", () => {
    const original = f({ role: "ia_sugerida", classe: "pedagogico" });
    const [out] = normalizeSchemaRoles([original]);
    expect(out).toBe(original);
  });

  it("não muta o array de entrada", () => {
    const input = [f({ key: "a", role: "manual", classe: "pedagogico" })];
    normalizeSchemaRoles(input);
    expect(input[0].role).toBe("manual");
  });
});
