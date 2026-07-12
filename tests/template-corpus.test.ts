/**
 * Corpus de templates escolares REAIS (template_originais/) — snapshot da
 * POSIÇÃO de cada placeholder injetado, não só da presença.
 *
 * O que cada snapshot garante:
 *  • scan  — o que o scanDocxStructure enxerga em cada template (label+pattern):
 *    mudanças no detector de labels aparecem como diff legível.
 *  • injecao — para um schema derivado deterministicamente do scan, ONDE cada
 *    chip aterrissou (coord T{ti}R{ri}C{ci} / HF:n) e quais ficaram de fora.
 *    Qualquer mudança nas heurísticas de injeção que MOVA um chip falha aqui —
 *    a classe de regressão que presença-apenas (reportInjections) não captura.
 *  • tokens — nos templates "com variáveis" (anotados à mão no Word), quais
 *    {{tokens}} o scanner encontra mesmo com a fragmentação de runs do Word.
 *
 * Para adicionar um template ao corpus: salve o .docx em template_originais/
 * e acrescente o nome do arquivo nas listas abaixo. Rode com --update-snapshots
 * e revise o snapshot novo manualmente antes de commitar.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { XMLValidator } from "fast-xml-parser";
import PizZip from "pizzip";
import { describe, expect, test } from "vitest";
import type { TemplateFieldSchema } from "../lib/types/firestore";
import {
  extractFieldCoords,
  extractHFFieldCoords,
  injectPlaceholders,
  reportInjections,
  scanDocxStructure,
  scanPlaceholders,
  wrapAllChipsInSdt,
} from "../lib/utils/docx-filler";

const CORPUS_DIR = join(__dirname, "..", "template_originais");

const TEMPLATES_EM_BRANCO = [
  "PLANEJAMENTO EMIEP 2026 CRE Em branco.docx",
  "C-Planejamento anual - EMIEP-2026 Em branco .docx",
  "Plano de aula Em branco.docx",
  "Plano_30dias_5421_13-07_a_09-08_2026 Em branco.docx",
];

const TEMPLATES_COM_VARIAVEIS = [
  "PLANEJAMENTO EMIEP 2026 CRE - com variaveis.docx",
  "C-Planejamento anual - EMIEP-2026 - com variaveis.docx",
  "Plano de aula - com variaveis.docx",
  "Plano_30dias_5421_13-07_a_09-08_2026 - com variaveis.docx",
];

function loadTemplate(name: string): Buffer {
  return readFileSync(join(CORPUS_DIR, name));
}

/** label → key snake_case sem acentos, como a introspecção instrui a IA. */
function slug(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/**
 * Schema determinístico derivado do scan estrutural — o rascunho que a IA
 * receberia para validar. Sem chamada de IA: o corpus testa scan + injeção.
 */
function schemaFromScan(buffer: Buffer): TemplateFieldSchema[] {
  const pairs = scanDocxStructure(buffer);
  const seen = new Set<string>();
  const schema: TemplateFieldSchema[] = [];
  for (const p of pairs) {
    const key = slug(p.label) + (p.periodSuffix ?? "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    schema.push({
      key,
      label: p.label,
      type: "text",
      required: false,
      injection_pattern: p.pattern,
      ai_confidence: 0.9,
    });
  }
  return schema;
}

describe("corpus — templates em branco: scan estrutural + posição de cada chip", () => {
  for (const nome of TEMPLATES_EM_BRANCO) {
    test(nome, () => {
      const buffer = loadTemplate(nome);

      const pairs = scanDocxStructure(buffer);
      const scan = pairs.map((p) => `${p.pattern}${p.periodSuffix ?? ""} :: ${p.label.slice(0, 60)}`);

      const schema = schemaFromScan(buffer);
      // Mesmo pipeline do save real: injeção + embrulho em Content Controls.
      // Todo XML tocado precisa sair BEM-FORMADO — Word abre XML inválido
      // (leniente), mas docx-preview rejeita e o Visualizar quebra.
      const injected = wrapAllChipsInSdt(injectPlaceholders(buffer, schema), new Set(schema.map((f) => f.key)));
      {
        const zip = new PizZip(injected);
        for (const p of Object.keys(zip.files).filter((f) => /^word\/(document|header\d+|footer\d+)\.xml$/.test(f))) {
          expect(XMLValidator.validate(zip.files[p].asText()), `XML malformado em ${p}`).toBe(true);
        }
      }

      const { injected: colocados, missing: faltando } = reportInjections(injected, schema);
      const coords = { ...extractFieldCoords(injected), ...extractHFFieldCoords(injected) };
      const posicoes = Object.fromEntries(
        colocados.sort().map((k) => [k, coords[k] ?? "(sem coord — fora de tabela)"]),
      );

      expect({
        campos_no_scan: scan.length,
        scan,
        colocados: colocados.length,
        faltando: faltando.sort(),
        posicoes,
      }).toMatchSnapshot();
    });
  }
});

describe("corpus — templates com variáveis: tokens sobrevivem à fragmentação do Word", () => {
  for (const nome of TEMPLATES_COM_VARIAVEIS) {
    test(nome, () => {
      const buffer = loadTemplate(nome);
      const tokens = scanPlaceholders(buffer).sort();
      expect({ total: tokens.length, tokens }).toMatchSnapshot();
    });
  }
});
