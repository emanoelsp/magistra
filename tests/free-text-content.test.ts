import { describe, expect, it } from "vitest";
import { injectIntoParagraph, injectRawCell } from "../lib/utils/docx-filler";
import { extractDocumentXml, makeDocx } from "./helpers/make-docx";

/**
 * Cobre a capacidade nova do overlay de content-edits: escrever TEXTO LIVRE
 * (sem chip) em células/parágrafos existentes preservando a formatação.
 */

function doc(body: string): Buffer {
  return makeDocx(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
}

const STYLED_RPR = `<w:rPr><w:rFonts w:ascii="Times New Roman"/><w:b w:val="1"/><w:sz w:val="24"/></w:rPr>`;

describe("texto livre em célula existente (injectRawCell)", () => {
  it("substitui o texto de uma célula por texto livre, preservando tcPr e rPr", () => {
    const cell =
      `<w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/><w:shd w:fill="D9E2F3"/></w:tcPr>` +
      `<w:p><w:r>${STYLED_RPR}<w:t>Observações:</w:t></w:r></w:p></w:tc>`;
    const input = doc(`<w:tbl><w:tr>${cell}</w:tr></w:tbl>`);

    const out = extractDocumentXml(injectRawCell(input, "Observações:", 0, "Turma integral — período vespertino"));

    expect(out).toContain("Turma integral");
    // Formatação da célula/parágrafo preservada
    expect(out).toContain('<w:shd w:fill="D9E2F3"/>');
    expect(out).toContain('<w:b w:val="1"/>');
    expect(out).not.toContain("{{"); // texto livre, sem placeholder
  });
});

describe("texto livre em parágrafo fora de tabela (injectIntoParagraph)", () => {
  it("reescreve o parágrafo com texto livre e mantém pPr", () => {
    const input = doc(
      `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r>${STYLED_RPR}<w:t>SUBTÍTULO ANTIGO</w:t></w:r></w:p>`,
    );
    const out = extractDocumentXml(injectIntoParagraph(input, "SUBTÍTULO ANTIGO", 0, "Planejamento do 2º semestre de 2026"));

    expect(out).toContain("Planejamento do 2");
    expect(out).toContain('<w:jc w:val="center"/>'); // centralização preservada
    expect(out).not.toContain("SUBTÍTULO ANTIGO");
  });

  it("limpa o parágrafo quando o conteúdo novo é vazio (revert)", () => {
    const input = doc(`<w:p><w:r><w:t>texto que sera apagado</w:t></w:r></w:p>`);
    const out = extractDocumentXml(injectIntoParagraph(input, "texto que sera apagado", 0, ""));
    expect(out).not.toContain("texto que sera apagado");
  });
});
