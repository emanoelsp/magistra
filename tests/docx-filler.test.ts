/**
 * Snapshot regression tests for injectPlaceholders + fillDocx.
 *
 * Strategy:
 *  • Fixtures A–D  — Strategy A: synthetic DOCX with {{key}} pre-injected.
 *    Tests fillDocx in isolation — deterministic, never fails due to label matching.
 *  • Fixture E     — Strategy B: raw DOCX (no placeholders).
 *    Tests the full pipeline: injectPlaceholders → fillDocx.
 *    Guards against regressions in the label-detection engine.
 *
 * Torture overlay: applied on top of each fixture's base values to stress-test
 * edge cases that silently corrupt DOCX output without throwing errors.
 */

import { describe, expect, test } from "vitest";
import { injectPlaceholders, fillDocx } from "../lib/utils/docx-filler";
import type { TemplateFieldSchema } from "../lib/types/firestore";
import { makeDocx, extractDocumentXml } from "./helpers/make-docx";
import { formatXmlForSnapshot } from "./helpers/format-xml";

// ── Namespace wrapper for all synthetic document XML ─────────────────────────

function wrapDoc(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function tc(content: string): string {
  return `<w:tc><w:p><w:r><w:t>${content}</w:t></w:r></w:p></w:tc>`;
}

function tcEmpty(): string {
  return `<w:tc><w:p><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p></w:tc>`;
}

function tr(...cells: string[]): string {
  return `<w:tr>${cells.join("")}</w:tr>`;
}

function tbl(...rows: string[]): string {
  return `<w:tbl>${rows.join("")}</w:tbl>`;
}

function runFixtureA(xml: string, schema: TemplateFieldSchema[], values: Record<string, string>): string {
  const buf = makeDocx(xml);
  const filled = fillDocx(buf, schema, values);
  return formatXmlForSnapshot(extractDocumentXml(filled));
}

function runFixtureB(xml: string, schema: TemplateFieldSchema[], values: Record<string, string>): string {
  const buf = makeDocx(xml);
  const injected = injectPlaceholders(buf, schema);
  const filled = fillDocx(injected, schema, values);
  return formatXmlForSnapshot(extractDocumentXml(filled));
}

/**
 * Overwrites some fields with pathological strings.
 * Uses the fixture's own key names, position-indexed, so it works across all fixtures.
 */
function applyTorture(values: Record<string, string>): Record<string, string> {
  const keys = Object.keys(values);
  const out = { ...values };
  // Multiline (tests Docxtemplater linebreaks:true handling)
  if (keys[0]) out[keys[0]] = "Linha 1\nLinha 2\n\nLinha 4 após espaço vazio";
  // Empty field (tests nullGetter fallback)
  if (keys[1]) out[keys[1]] = "";
  // Long string (tests line-wrapping in cells)
  if (keys[2]) out[keys[2]] = "A".repeat(400);
  // Fake delimiters (must NOT trigger Docxtemplater parser)
  if (keys[3]) out[keys[3]] = "Texto com {{chaves_falsas}} no meio";
  // XML reserved chars (& < must be escaped by Docxtemplater)
  if (keys[4]) out[keys[4]] = "Múltiplos & caracteres e <tags> para testar escape XML";
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture A — "dados-turma"
// 4-column table, manual fields, most common school form layout.
// ═══════════════════════════════════════════════════════════════════════════════

const DADOS_TURMA_SCHEMA: TemplateFieldSchema[] = [
  { key: "escola",               label: "Escola",               type: "text",     required: true,  role: "manual",      group: "dados_turma" },
  { key: "turma",                label: "Turma",                type: "text",     required: true,  role: "manual",      group: "dados_turma" },
  { key: "professor",            label: "Professor",            type: "text",     required: true,  role: "manual",      group: "dados_turma" },
  { key: "componente_curricular",label: "Componente Curricular",type: "text",     required: true,  role: "manual",      group: "dados_turma" },
  { key: "data_realizacao",      label: "Data de Realização",   type: "date",     required: true,  role: "manual",      group: "dados_turma" },
  { key: "numero_aulas",         label: "Número de Aulas",      type: "number",   required: true,  role: "manual",      group: "dados_turma" },
];

const DADOS_TURMA_XML = wrapDoc(tbl(
  tr(tc("Escola"), tc("{{escola}}"), tc("Turma"), tc("{{turma}}")),
  tr(tc("Professor"), tc("{{professor}}"), tc("Componente Curricular"), tc("{{componente_curricular}}")),
  tr(tc("Data de Realização"), tc("{{data_realizacao}}"), tc("Número de Aulas"), tc("{{numero_aulas}}")),
));

const DADOS_TURMA_VALUES: Record<string, string> = {
  escola:               "E.M. Rui Barbosa",
  turma:                "8º Ano A",
  professor:            "Maria Fernanda Costa",
  componente_curricular:"Ciências",
  data_realizacao:      "15/06/2026",
  numero_aulas:         "2",
};

describe("Fixture A — dados-turma", () => {
  test("base values", () => {
    expect(runFixtureA(DADOS_TURMA_XML, DADOS_TURMA_SCHEMA, DADOS_TURMA_VALUES)).toMatchSnapshot();
  });

  test("torture overlay", () => {
    expect(runFixtureA(DADOS_TURMA_XML, DADOS_TURMA_SCHEMA, applyTorture(DADOS_TURMA_VALUES))).toMatchSnapshot();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture B — "campos-ia"
// 1-column table, IA fields with label above value cell (adjacent_below layout).
// Tests multiline content from Magis suggestions.
// ═══════════════════════════════════════════════════════════════════════════════

const CAMPOS_IA_SCHEMA: TemplateFieldSchema[] = [
  { key: "objetivos",      label: "Objetivos de Aprendizagem", type: "textarea", required: true,  role: "ia_sugerida", group: "objetivos"     },
  { key: "habilidades_bncc",label: "Habilidades BNCC",         type: "textarea", required: true,  role: "ia_sugerida", group: "habilidades"   },
  { key: "metodologia",    label: "Metodologia",               type: "textarea", required: false, role: "ia_sugerida", group: "conteudos"     },
  { key: "avaliacao",      label: "Avaliação",                 type: "textarea", required: false, role: "ia_sugerida", group: "avaliacao"     },
  { key: "recursos",       label: "Recursos Didáticos",        type: "textarea", required: false, role: "ia_sugerida", group: "outros"        },
];

const CAMPOS_IA_XML = wrapDoc(tbl(
  tr(tc("Objetivos de Aprendizagem")),
  tr(tc("{{objetivos}}")),
  tr(tc("Habilidades BNCC")),
  tr(tc("{{habilidades_bncc}}")),
  tr(tc("Metodologia")),
  tr(tc("{{metodologia}}")),
  tr(tc("Avaliação")),
  tr(tc("{{avaliacao}}")),
  tr(tc("Recursos Didáticos")),
  tr(tc("{{recursos}}")),
));

const CAMPOS_IA_VALUES: Record<string, string> = {
  objetivos:      "Identificar as principais causas da Revolução Industrial\nCompreender os impactos sociais e econômicos para os trabalhadores",
  habilidades_bncc: "EF08HI06 — Identificar e contextualizar o papel das Revoluções Industriais e os impactos do capitalismo sobre as relações sociais e de trabalho",
  metodologia:    "Aula expositiva com apresentação de mapas históricos\nDebate em grupos sobre as transformações sociais\nAnálise de fontes primárias",
  avaliacao:      "Produção de texto dissertativo sobre o impacto da industrialização",
  recursos:       "Livro didático, mapas históricos, vídeo documentário",
};

describe("Fixture B — campos-ia", () => {
  test("base values", () => {
    expect(runFixtureA(CAMPOS_IA_XML, CAMPOS_IA_SCHEMA, CAMPOS_IA_VALUES)).toMatchSnapshot();
  });

  test("torture overlay", () => {
    expect(runFixtureA(CAMPOS_IA_XML, CAMPOS_IA_SCHEMA, applyTorture(CAMPOS_IA_VALUES))).toMatchSnapshot();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture C — "plano-completo"
// Simulates a full plan: multiple tables covering all field groups.
// ═══════════════════════════════════════════════════════════════════════════════

const PLANO_COMPLETO_SCHEMA: TemplateFieldSchema[] = [
  { key: "turma",         label: "Turma",          type: "text",     required: true,  role: "manual",      group: "dados_turma"  },
  { key: "professor",     label: "Professor",       type: "text",     required: true,  role: "manual",      group: "dados_turma"  },
  { key: "objetivos",     label: "Objetivos",       type: "textarea", required: true,  role: "ia_sugerida", group: "objetivos"    },
  { key: "competencias",  label: "Competências",    type: "textarea", required: false, role: "ia_sugerida", group: "competencias" },
  { key: "habilidades",   label: "Habilidades",     type: "textarea", required: true,  role: "ia_sugerida", group: "habilidades"  },
  { key: "conteudos",     label: "Conteúdos",       type: "textarea", required: true,  role: "ia_sugerida", group: "conteudos"    },
  { key: "avaliacao",     label: "Avaliação",       type: "textarea", required: true,  role: "ia_sugerida", group: "avaliacao"    },
];

const PLANO_COMPLETO_XML = wrapDoc(
  tbl(
    tr(tc("Turma"), tc("{{turma}}"), tc("Professor"), tc("{{professor}}")),
  ) +
  tbl(
    tr(tc("Objetivos")),
    tr(tc("{{objetivos}}")),
    tr(tc("Competências")),
    tr(tc("{{competencias}}")),
    tr(tc("Habilidades")),
    tr(tc("{{habilidades}}")),
  ) +
  tbl(
    tr(tc("Conteúdos")),
    tr(tc("{{conteudos}}")),
    tr(tc("Avaliação")),
    tr(tc("{{avaliacao}}")),
  ),
);

const PLANO_COMPLETO_VALUES: Record<string, string> = {
  turma:       "9º Ano B",
  professor:   "Carlos Eduardo Lima",
  objetivos:   "Analisar os processos de independência das colônias americanas e suas consequências",
  competencias:"Pensamento crítico e histórico; Leitura e interpretação de fontes",
  habilidades: "EF09HI04 — Identificar as questões internas e externas sobre a independência dos Estados Unidos",
  conteudos:   "Independência dos EUA (1776)\nDeclaração de Independência\nConsequências para a América Latina",
  avaliacao:   "Seminário em grupo e produção de linha do tempo comentada",
};

describe("Fixture C — plano-completo", () => {
  test("base values", () => {
    expect(runFixtureA(PLANO_COMPLETO_XML, PLANO_COMPLETO_SCHEMA, PLANO_COMPLETO_VALUES)).toMatchSnapshot();
  });

  test("torture overlay", () => {
    expect(runFixtureA(PLANO_COMPLETO_XML, PLANO_COMPLETO_SCHEMA, applyTorture(PLANO_COMPLETO_VALUES))).toMatchSnapshot();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture D — "html-tiptap"
// Values containing HTML from TipTap editor (strong, p, br, li tags).
// Tests that fillDocx/Docxtemplater handles rich HTML values without XML corruption.
// ═══════════════════════════════════════════════════════════════════════════════

const HTML_SCHEMA: TemplateFieldSchema[] = [
  { key: "objetivos",  label: "Objetivos",  type: "textarea", required: true, role: "ia_sugerida", group: "objetivos" },
  { key: "avaliacao",  label: "Avaliação",  type: "textarea", required: true, role: "ia_sugerida", group: "avaliacao" },
];

const HTML_XML = wrapDoc(tbl(
  tr(tc("Objetivos")),
  tr(tc("{{objetivos}}")),
  tr(tc("Avaliação")),
  tr(tc("{{avaliacao}}")),
));

// These simulate values from htmlToPlainText conversion (already stripped of tags)
// to verify escaping of XML-sensitive characters that might survive stripping.
const HTML_VALUES: Record<string, string> = {
  objetivos: "Objetivo 1: entender A > B e B < C\nObjetivo 2: trabalhar com & (ampersand)\nObjetivo 3: evitar <script>alert(1)</script>",
  avaliacao: "Prova escrita com questões sobre A&B vs C<D",
};

describe("Fixture D — html-tiptap edge cases", () => {
  test("xml-reserved chars in values", () => {
    expect(runFixtureA(HTML_XML, HTML_SCHEMA, HTML_VALUES)).toMatchSnapshot();
  });

  test("torture overlay", () => {
    expect(runFixtureA(HTML_XML, HTML_SCHEMA, applyTorture(HTML_VALUES))).toMatchSnapshot();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture E — "injection-pipeline"
// Strategy B: raw DOCX with NO {{}} placeholders.
// Validates that injectPlaceholders correctly locates label cells and writes
// {{key}} tokens before fillDocx renders the values.
// This is the most critical guard: a regression in the label-detection engine
// silently produces a DOCX where the placeholder was never placed, so the value
// cell remains visually empty in the final PDF.
// ═══════════════════════════════════════════════════════════════════════════════

const PIPELINE_SCHEMA: TemplateFieldSchema[] = [
  { key: "turma",     label: "Turma",     type: "text", required: true, role: "manual", group: "dados_turma", injection_pattern: "adjacent_right" },
  { key: "professor", label: "Professor", type: "text", required: true, role: "manual", group: "dados_turma", injection_pattern: "adjacent_right" },
  { key: "escola",    label: "Escola",    type: "text", required: true, role: "manual", group: "dados_turma", injection_pattern: "adjacent_right" },
];

// Raw document: labels present, value cells are empty (single space).
// injectPlaceholders must find each label and write {{key}} into the adjacent cell.
const PIPELINE_XML = wrapDoc(tbl(
  tr(tc("Turma"), tcEmpty(), tc("Professor"), tcEmpty()),
  tr(tc("Escola"), tcEmpty(), tcEmpty(), tcEmpty()),
));

const PIPELINE_VALUES: Record<string, string> = {
  turma:     "7º Ano C",
  professor: "Joana Pereira",
  escola:    "E.E. Dom Pedro II",
};

describe("Fixture E — injection pipeline (injectPlaceholders → fillDocx)", () => {
  test("label detection places {{key}} and fill renders values", () => {
    expect(runFixtureB(PIPELINE_XML, PIPELINE_SCHEMA, PIPELINE_VALUES)).toMatchSnapshot();
  });

  test("torture overlay survives full pipeline", () => {
    expect(runFixtureB(PIPELINE_XML, PIPELINE_SCHEMA, applyTorture(PIPELINE_VALUES))).toMatchSnapshot();
  });
});
