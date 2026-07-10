import { describe, expect, it } from "vitest";
import { stripPageBreaksOutsideTables } from "../lib/utils/docx-filler";
import { extractDocumentXml, makeDocx } from "./helpers/make-docx";

const PBB = "<w:pageBreakBefore/>";

function para(content: string, pPr = ""): string {
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}<w:r><w:t>${content}</w:t></w:r></w:p>`;
}

function doc(body: string): Buffer {
  return makeDocx(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
}

describe("stripPageBreaksOutsideTables", () => {
  it("remove pageBreakBefore de parágrafos fora de tabelas", () => {
    const input = doc(para("ESTADO DE SANTA CATARINA", PBB) + para("Sem quebra"));
    const { buffer, removed } = stripPageBreaksOutsideTables(input);
    expect(removed).toBe(1);
    const xml = extractDocumentXml(buffer);
    expect(xml).not.toContain("pageBreakBefore");
    expect(xml).toContain("ESTADO DE SANTA CATARINA");
  });

  it("remove a variante com atributo (w:val)", () => {
    const input = doc(para("Título", '<w:pageBreakBefore w:val="true"/>'));
    const { removed, buffer } = stripPageBreaksOutsideTables(input);
    expect(removed).toBe(1);
    expect(extractDocumentXml(buffer)).not.toContain("pageBreakBefore");
  });

  it("preserva pageBreakBefore DENTRO de tabelas", () => {
    const tabela = `<w:tbl><w:tr><w:tc>${para("Célula", PBB)}</w:tc></w:tr></w:tbl>`;
    const input = doc(para("Fora", PBB) + tabela);
    const { buffer, removed } = stripPageBreaksOutsideTables(input);
    expect(removed).toBe(1);
    const xml = extractDocumentXml(buffer);
    // A quebra da célula sobrevive; a de fora não
    expect(xml.match(/pageBreakBefore/g)).toHaveLength(1);
    expect(xml.indexOf("pageBreakBefore")).toBeGreaterThan(xml.indexOf("<w:tbl"));
  });

  it("lida com tabelas aninhadas por contagem de profundidade", () => {
    const aninhada = `<w:tbl><w:tr><w:tc>${para("Interna", PBB)}<w:tbl><w:tr><w:tc>${para("Mais interna", PBB)}</w:tc></w:tr></w:tbl></w:tc></w:tr></w:tbl>`;
    const input = doc(para("Antes", PBB) + aninhada + para("Depois", PBB));
    const { buffer, removed } = stripPageBreaksOutsideTables(input);
    expect(removed).toBe(2); // só "Antes" e "Depois"
    expect(extractDocumentXml(buffer).match(/pageBreakBefore/g)).toHaveLength(2);
  });

  it("retorna o buffer intacto quando não há nada a remover", () => {
    const input = doc(para("Documento limpo"));
    const { buffer, removed } = stripPageBreaksOutsideTables(input);
    expect(removed).toBe(0);
    expect(buffer).toBe(input);
  });
});
