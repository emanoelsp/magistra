import { describe, expect, it } from "vitest";
import type { TemplateFieldSchema } from "../lib/types/firestore";
import { injectPlaceholders } from "../lib/utils/docx-filler";
import { extractDocumentXml, makeDocx } from "./helpers/make-docx";

// Célula vazia SEM conteúdo — byte-idêntica em qualquer linha onde apareça.
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

const FIELD: TemplateFieldSchema = {
  key: "objetivos",
  label: "Objetivos",
  type: "textarea",
  required: false,
  role: "ia_sugerida",
};

describe("injeção posicional — células vazias byte-idênticas", () => {
  it("injeta na célula ao lado do LABEL, não na primeira gêmea vazia do documento", () => {
    // Linha 0: título sem label correspondente + célula vazia (gêmea byte a byte)
    // Linha 1: label "Objetivos:" + célula vazia (o alvo correto)
    // Com replaceFirst, o chip aterrissava na vazia da linha 0 — misplacement
    // silencioso que o reportInjections não detecta (verifica presença, não posição).
    const input = tableDoc([
      labelCell("CRONOGRAMA GERAL") + EMPTY_CELL,
      labelCell("Objetivos:") + EMPTY_CELL,
    ]);

    const out = injectPlaceholders(input, [FIELD]);
    const xml = extractDocumentXml(out);

    const rowsXml = [...xml.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)].map((m) => m[0]);
    expect(rowsXml).toHaveLength(2);

    const rowTitulo = rowsXml.find((r) => r.includes("CRONOGRAMA"))!;
    const rowLabel = rowsXml.find((r) => r.includes("Objetivos:"))!;

    expect(rowLabel).toContain("{{objetivos}}");
    expect(rowTitulo).not.toContain("{{objetivos}}");
  });

  it("mantém o comportamento em documento sem gêmeas (linha única)", () => {
    const input = tableDoc([labelCell("Objetivos:") + EMPTY_CELL]);
    const xml = extractDocumentXml(injectPlaceholders(input, [FIELD]));
    expect(xml).toContain("{{objetivos}}");
    expect(xml.indexOf("{{objetivos}}")).toBeGreaterThan(xml.indexOf("Objetivos:"));
  });
});
