import { XMLValidator } from "fast-xml-parser";
import { describe, expect, it } from "vitest";
import { wrapAllChipsInSdt } from "../lib/utils/docx-filler";
import { extractDocumentXml, makeDocx } from "./helpers/make-docx";

const STYLED_RPR = `<w:rPr><w:rFonts w:ascii="Times New Roman"/><w:b w:val="1"/><w:sz w:val="22"/></w:rPr>`;

function doc(body: string): Buffer {
  return makeDocx(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
}

describe("wrapAllChipsInSdt — nunca atravessa fronteiras de run", () => {
  it("com runs estilizados ANTES do chip, o XML sai válido e o cabeçalho intacto", () => {
    // Regressão do bug real: o regex antigo casava do primeiro run estilizado
    // (cabeçalho da escola) até o chip, gerando sdts aninhados com </w:p>
    // órfão — Word abria (leniente), docx-preview rejeitava.
    const body =
      `<w:p><w:r>${STYLED_RPR}<w:t>ESTADO DE SANTA CATARINA</w:t></w:r>` +
      `<w:r>${STYLED_RPR}<w:t>SECRETARIA DE ESTADO DA EDUCAÇÃO</w:t></w:r></w:p>` +
      `<w:p><w:r>${STYLED_RPR}<w:t xml:space="preserve">{{referencias_bibliograficas}}</w:t></w:r></w:p>`;
    const out = extractDocumentXml(
      wrapAllChipsInSdt(doc(body), new Set(["referencias_bibliograficas"])),
    );

    expect(XMLValidator.validate(out)).toBe(true);
    expect(out).toContain('w:val="f_referencias_bibliograficas"');
    // O cabeçalho não pode ter sido engolido pelo sdt
    const sdtStart = out.indexOf("<w:sdt>");
    expect(out.indexOf("ESTADO DE SANTA CATARINA")).toBeLessThan(sdtStart);
    // Exatamente UM run embrulhado
    expect(out.match(/<w:sdtContent>/g)).toHaveLength(1);
  });

  it("embrulha múltiplos chips, cada um no próprio run", () => {
    const body =
      `<w:p><w:r><w:t>Título</w:t></w:r></w:p>` +
      `<w:p><w:r>${STYLED_RPR}<w:t>{{campo_a}}</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>{{campo_b}}</w:t></w:r></w:p>`;
    const out = extractDocumentXml(wrapAllChipsInSdt(doc(body), new Set(["campo_a", "campo_b"])));
    expect(XMLValidator.validate(out)).toBe(true);
    expect(out.match(/<w:sdtContent>/g)).toHaveLength(2);
    expect(out).toContain('w:val="f_campo_a"');
    expect(out).toContain('w:val="f_campo_b"');
  });

  it("não toca runs com texto misto ou chaves fora do set", () => {
    const body =
      `<w:p><w:r><w:t>Período: {{data_atual}}</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>{{fora_do_set}}</w:t></w:r></w:p>`;
    const out = extractDocumentXml(wrapAllChipsInSdt(doc(body), new Set(["data_atual"])));
    expect(out).not.toContain("<w:sdt>");
  });
});
