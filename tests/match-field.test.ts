import { describe, expect, it } from "vitest";
import type { TemplateFieldSchema } from "../lib/types/firestore";
import { injectPlaceholders } from "../lib/utils/docx-filler";
import { extractDocumentXml, makeDocx } from "./helpers/make-docx";

const EMPTY_CELL = `<w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr><w:p/></w:tc>`;

function labelCell(text: string): string {
  return `<w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
}

function tableDoc(rows: string[]): Buffer {
  return makeDocx(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl>${rows
      .map((cells) => `<w:tr>${cells}</w:tr>`)
      .join("")}</w:tbl></w:body></w:document>`,
  );
}

function field(key: string, label: string, ai_confidence?: number): TemplateFieldSchema {
  return { key, label, type: "text", required: false, role: "ia_sugerida", ai_confidence };
}

describe("matchField — colisão de stems portugueses", () => {
  it("label 'COMPETÊNCIAS ESPECÍFICAS' NÃO rouba o campo 'Competências Gerais'", () => {
    // Schema só tem "gerais". Antes da guarda: stems de 6 chars colidem em
    // "compet", overlap 1/2 → score 0.4 = threshold → injetava gerais na
    // linha de específicas, silenciosamente. Match perdido é o correto:
    // vira "faltando" fail-visible na UI.
    const input = tableDoc([
      labelCell("COMPETÊNCIAS ESPECÍFICAS") + EMPTY_CELL,
    ]);
    const xml = extractDocumentXml(
      injectPlaceholders(input, [field("competencias_gerais", "Competências Gerais")]),
    );
    expect(xml).not.toContain("{{competencias_gerais}}");
  });

  it("cada label casa com o próprio campo quando ambos existem", () => {
    const input = tableDoc([
      labelCell("COMPETÊNCIAS GERAIS BNCC") + EMPTY_CELL,
      labelCell("COMPETÊNCIAS ESPECÍFICAS DA ÁREA") + EMPTY_CELL,
    ]);
    const xml = extractDocumentXml(
      injectPlaceholders(input, [
        field("competencias_gerais", "Competências Gerais BNCC"),
        field("competencias_especificas", "Competências Específicas da Área"),
      ]),
    );
    const rows = [...xml.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)].map((m) => m[0]);
    expect(rows.find((r) => r.includes("GERAIS"))).toContain("{{competencias_gerais}}");
    expect(rows.find((r) => r.includes("ESPECÍFICAS"))).toContain("{{competencias_especificas}}");
  });

  it("overlap de 2+ stems não é penalizado (variação de ordem de palavras)", () => {
    const input = tableDoc([labelCell("Geral Objetivo do Componente") + EMPTY_CELL]);
    const xml = extractDocumentXml(
      injectPlaceholders(input, [field("objetivo_geral", "Objetivo Geral")]),
    );
    expect(xml).toContain("{{objetivo_geral}}");
  });

  it("empate de score é decidido por ai_confidence, não pela ordem do array", () => {
    // Dois labels iguais em linhas distintas, dois campos homônimos no schema.
    // O de maior lastro estrutural (ai_confidence) pega a PRIMEIRA ocorrência;
    // antes, vencia a ordem do array e um match errado cascateava.
    const input = tableDoc([
      labelCell("Habilidades") + EMPTY_CELL,
      labelCell("Habilidades") + EMPTY_CELL,
    ]);
    const xml = extractDocumentXml(
      injectPlaceholders(input, [
        field("habilidades_baixa", "Habilidades", 0.3),
        field("habilidades_alta", "Habilidades", 0.9),
      ]),
    );
    const rows = [...xml.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)].map((m) => m[0]);
    expect(rows[0]).toContain("{{habilidades_alta}}");
    expect(rows[1]).toContain("{{habilidades_baixa}}");
  });
});
