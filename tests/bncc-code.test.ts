import { describe, expect, it } from "vitest";
import {
  decompor,
  extractAllCodes,
  extractBnccCodes,
  extractSaebCodes,
  FAIXAS_EF,
} from "../lib/utils/bncc-code";

describe("decompor — EF (Ensino Fundamental)", () => {
  it("decompõe código de faixa dupla (EF89EF03)", () => {
    const d = decompor("EF89EF03");
    expect(d).toMatchObject({
      etapa: "EF",
      anos: [8, 9],
      componente: "EF",
      seq: 3,
      valido: true,
    });
  });

  it("expande faixa multi-ano (EF15LP01 → anos 1 a 5)", () => {
    const d = decompor("EF15LP01");
    expect(d?.anos).toEqual([1, 2, 3, 4, 5]);
    expect(d?.valido).toBe(true);
  });

  it("aceita ano individual (EF01MA05)", () => {
    const d = decompor("EF01MA05");
    expect(d).toMatchObject({ etapa: "EF", anos: [1], componente: "MA", seq: 5, valido: true });
  });

  it("aceita todas as faixas publicadas da BNCC", () => {
    for (const faixa of FAIXAS_EF) {
      expect(decompor(`EF${faixa}LP01`)?.valido).toBe(true);
    }
  });

  it("rejeita componente fora da whitelist (EF05ZZ01)", () => {
    const d = decompor("EF05ZZ01");
    expect(d?.valido).toBe(false);
    expect(d?.erro).toContain("ZZ");
  });

  it("rejeita faixa de anos inexistente na BNCC (EF24LP01)", () => {
    // "24" decompõe para [2,3,4] mas nenhum código publicado usa essa faixa
    const d = decompor("EF24LP01");
    expect(d?.anos).toEqual([2, 3, 4]);
    expect(d?.valido).toBe(false);
  });

  it("rejeita faixa invertida (EF91LP01)", () => {
    const d = decompor("EF91LP01");
    expect(d?.valido).toBe(false);
  });

  it("normaliza minúsculas antes de decompor", () => {
    const d = decompor("ef89ef03");
    expect(d?.codigo).toBe("EF89EF03");
    expect(d?.valido).toBe(true);
  });
});

describe("decompor — EI (Educação Infantil)", () => {
  it("decompõe campo de experiência válido (EI03EO01)", () => {
    const d = decompor("EI03EO01");
    expect(d).toMatchObject({ etapa: "EI", anos: [3], componente: "EO", seq: 1, valido: true });
  });

  it("aceita EI02TS03", () => {
    expect(decompor("EI02TS03")?.valido).toBe(true);
  });

  it("rejeita faixa etária fora de 1–5 (EI06EO01)", () => {
    const d = decompor("EI06EO01");
    expect(d?.valido).toBe(false);
    expect(d?.erro).toContain("EI");
  });

  it("rejeita campo de experiência desconhecido (EI03ZZ01)", () => {
    expect(decompor("EI03ZZ01")?.valido).toBe(false);
  });
});

describe("decompor — EM (Ensino Médio)", () => {
  it("decompõe área integrada com seq de 3 dígitos (EM13LGG101)", () => {
    const d = decompor("EM13LGG101");
    expect(d).toMatchObject({ etapa: "EM", anos: [], componente: "LGG", seq: 101, valido: true });
  });

  it("aceita componente específico (EM13MAT305, EM13FI02)", () => {
    expect(decompor("EM13MAT305")?.valido).toBe(true);
    expect(decompor("EM13FI02")?.valido).toBe(true);
  });

  it("rejeita área desconhecida (EM13ZZZ101)", () => {
    const d = decompor("EM13ZZZ101");
    expect(d?.valido).toBe(false);
    expect(d?.erro).toContain("ZZZ");
  });

  it("só reconhece o prefixo EM13 (EM12LGG101 → null)", () => {
    expect(decompor("EM12LGG101")).toBeNull();
  });
});

describe("decompor — entradas não reconhecidas", () => {
  it.each(["D5", "EF9LP01", "ABC123", "", "EFXXLP01"])("retorna null para %j", (input) => {
    expect(decompor(input)).toBeNull();
  });
});

describe("extractBnccCodes", () => {
  it("extrai códigos de texto corrido e deduplica", () => {
    const text = "Trabalhar EF89EF03 e EF15LP01; retomar EF89EF03 na avaliação.";
    expect(extractBnccCodes(text).sort()).toEqual(["EF15LP01", "EF89EF03"]);
  });

  it("não casa minúsculas nem substrings de identificadores", () => {
    const text = "ver ef89ef03 e a var XEF89EF03_ID";
    expect(extractBnccCodes(text)).toEqual([]);
  });

  it("extrai códigos EM com seq de 3 dígitos", () => {
    expect(extractBnccCodes("Alinhado à EM13LGG101.")).toEqual(["EM13LGG101"]);
  });
});

describe("extractSaebCodes", () => {
  it("extrai descritores D maiúsculos de 1–2 dígitos", () => {
    const text = "Descritores D5 e D30; ignorar d7, D100 e T2.";
    expect(extractSaebCodes(text).sort()).toEqual(["D30", "D5"]);
  });
});

describe("extractAllCodes", () => {
  it("combina BNCC e SAEB sem duplicatas", () => {
    const text = "EF89EF03 com D5 e D5 de novo, mais EM13MAT305.";
    expect(extractAllCodes(text).sort()).toEqual(["D5", "EF89EF03", "EM13MAT305"]);
  });
});
