import { describe, expect, it } from "vitest";
import { injectIntoParagraph } from "../lib/utils/docx-filler";
import { extractDocumentXml, makeDocx } from "./helpers/make-docx";

function doc(body: string): Buffer {
  return makeDocx(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
}

const TITULO_PPR = `<w:pPr><w:jc w:val="center"/></w:pPr>`;

describe("injectIntoParagraph — chip em parágrafo fora de tabela", () => {
  it("injeta no título com leaders de underscore (o caso real do PLANEJAMENTO MENSAL)", () => {
    // O texto do cliente vem do DOM ("PLANEJAMENTO MENSAL PERÍODO / /2026");
    // o XML tem underscores — o matching compactado ignora espaços e _.
    const body =
      `<w:p>${TITULO_PPR}<w:r><w:rPr><w:b w:val="1"/></w:rPr><w:t>PLANEJAMENTO MENSAL PERÍODO ____/____/2026</w:t></w:r></w:p>` +
      `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Professor(a):</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
    const out = extractDocumentXml(
      injectIntoParagraph(
        doc(body),
        "PLANEJAMENTO MENSAL PERÍODO / /2026",
        0,
        "PLANEJAMENTO MENSAL PERÍODO {{data_atual}}",
      ),
    );
    expect(out).toContain("{{data_atual}}");
    // Formatação preservada: pPr de centralização e negrito do run
    expect(out).toContain('<w:jc w:val="center"/>');
    expect(out).toContain('<w:b w:val="1"/>');
    // A tabela não foi tocada
    expect(out).toContain("Professor(a):");
  });

  it("respeita o ordinal entre parágrafos de texto idêntico", () => {
    const para = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
    const out = extractDocumentXml(
      injectIntoParagraph(doc(para("Período:") + para("Período:")), "Período:", 1, "Período: {{data_atual}}"),
    );
    const first = out.indexOf("Período:");
    expect(out.indexOf("{{data_atual}}")).toBeGreaterThan(first);
    expect(out.match(/\{\{data_atual\}\}/g)).toHaveLength(1);
  });

  it("ordinal fora do alcance cai na primeira ocorrência (contagem do DOM diverge)", () => {
    const body = `<w:p><w:r><w:t>Cabeçalho X</w:t></w:r></w:p>`;
    const out = extractDocumentXml(
      injectIntoParagraph(doc(body), "Cabeçalho X", 5, "Cabeçalho X {{campo}}"),
    );
    expect(out).toContain("{{campo}}");
  });

  it("sem match, devolve o buffer intacto", () => {
    const input = doc(`<w:p><w:r><w:t>Outro texto</w:t></w:r></w:p>`);
    expect(injectIntoParagraph(input, "não existe no doc", 0, "x {{y}}")).toBe(input);
  });
});
