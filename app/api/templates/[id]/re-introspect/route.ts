import "server-only";

import { NextResponse } from "next/server";
import { SchemaType } from "@google/generative-ai";
import type { ResponseSchema } from "@google/generative-ai";
import mammoth from "mammoth";
import pdf from "pdf-parse";

import { getAdminDb } from "../../../../../lib/firebase/admin";
import { downloadFile, uploadFile } from "../../../../../lib/storage/blob";
import { callAIWithFallbacks } from "../../../../../lib/ai/provider";
import {
  injectPlaceholders,
  reportInjections,
  scanDocxStructure,
  scanPlaceholders,
} from "../../../../../lib/utils/docx-filler";
import type { StructuralPair } from "../../../../../lib/utils/docx-filler";
import type { TemplateFieldSchema, TemplateRecord } from "../../../../../lib/types/firestore";

function keyToField(key: string): TemplateFieldSchema {
  const label = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  let role: TemplateFieldSchema["role"] = "manual";
  let group: TemplateFieldSchema["group"] = "dados_turma";
  if (/habilidade|competencia|objetivo|avaliacao|conteudo|tematica|metodologia|atividade|pratica/.test(key)) {
    role = "ia_sugerida";
    if (/habilidade|bncc|saeb/.test(key)) group = "habilidades";
    else if (/competencia/.test(key)) group = "competencias";
    else if (/objetivo/.test(key)) group = "objetivos";
    else if (/avaliacao/.test(key)) group = "avaliacao";
    else group = "conteudos";
  }
  return { key, label, type: "text", required: true, role, group, placeholder: "", helperText: "", aiInstructions: "" };
}


// ── Extração de conteúdo ────────────────────────────────────────────────────

async function extractDocxHtml(buffer: Buffer): Promise<string> {
  const result = await mammoth.convertToHtml(
    { buffer },
    { convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: "" })) },
  );
  return result.value.replace(/<img[^>]*>/gi, "");
}

interface ExtractedContent {
  content: string;
  isHtml: boolean;
}

async function extractContent(buffer: Buffer, url: string): Promise<ExtractedContent> {
  const lower = url.toLowerCase().split("?")[0];
  if (lower.endsWith(".docx") || lower.endsWith(".doc")) {
    const html = await extractDocxHtml(buffer);
    return { content: html, isHtml: true };
  }
  const data = await pdf(buffer);
  return { content: data.text, isHtml: false };
}

// ── Response schema ─────────────────────────────────────────────────────────

const INTROSPECT_RESPONSE_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  required: ["raciocinio", "campos"],
  properties: {
    raciocinio: { type: SchemaType.STRING },
    campos: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        required: ["key", "label", "type", "required", "role", "group"],
        properties: {
          key:            { type: SchemaType.STRING },
          label:          { type: SchemaType.STRING },
          type:           { type: SchemaType.STRING, format: "enum", enum: ["text", "textarea"] },
          required:       { type: SchemaType.BOOLEAN },
          role:           { type: SchemaType.STRING, format: "enum", enum: ["manual", "ia_sugerida"] },
          group:          { type: SchemaType.STRING, format: "enum", enum: ["dados_turma", "objetivos", "competencias", "habilidades", "conteudos", "avaliacao", "outros"] },
          defaultValue:   { type: SchemaType.STRING, nullable: true },
          aiInstructions: { type: SchemaType.STRING, nullable: true },
        },
      },
    },
  },
};

// ── System instruction ──────────────────────────────────────────────────────

const SYSTEM_INSTRUCTION = `<persona>
Você é um analista de currículo escolar sênior especializado em documentos pedagógicos brasileiros (MEC/BNCC). Você recebe o HTML semântico gerado pelo Mammoth a partir de um arquivo Word (.docx). O HTML preserva toda a topologia do documento: tabelas (<table>/<tr>/<td>), parágrafos (<p>) e listas. Sua tarefa é mapear cada campo preenchível de forma geometricamente precisa.
</persona>
<regras>
1. REGRA CRÍTICA — LABEL EXATO: O 'label' DEVE ser copiado EXATAMENTE como aparece no texto da célula rótulo — sem tradução, normalização, abreviação ou substituição. Exemplos: a célula diz "PROFESSOR (A):" → label "PROFESSOR (A)" | a célula diz "Área/Componente:" → label "Área/Componente".
2. REGRA DE TOPOLOGIA — COMO IDENTIFICAR UM CAMPO:
   • Em tabelas: o rótulo está na <td> ANTERIOR (mesma <tr>) ou na <th>/<td> do cabeçalho da coluna. A célula à direita (ou abaixo) vazia ou com valor de exemplo é o campo.
   • Em parágrafos: o padrão é "Rótulo: valor" — o rótulo é o texto antes do ":" e o valor é o campo.
   • Se a célula contiver texto não-vazio (valor preenchido), capture-o como 'defaultValue'.
3. REGRA DE CLASSIFICAÇÃO:
   • Identificação (professor, turma, escola, componente, data, carga horária) → role "manual", group "dados_turma".
   • Pedagógicos (objetivos, competências, habilidades, BNCC, SAEB, conteúdos, avaliação, metodologia) → role "ia_sugerida".
4. Grupos válidos: dados_turma | objetivos | competencias | habilidades | conteudos | avaliacao | outros.
5. O 'key' é o label em snake_case sem acentos (ex: "professor_a", "area_componente", "n_aulas_semanais").
6. type "textarea" para campos pedagógicos longos (objetivos, habilidades, conteúdos, avaliação); "text" para campos curtos (nome, turma, data).
7. NÃO inclua células que são apenas títulos de seção ou decoração visual sem campo associado.
13. TÍTULO vs. CAMPO PREENCHÍVEL — regra obrigatória. Avalie linha por linha e parágrafo por parágrafo:
   A. TUDO EM MAIÚSCULAS + termina com ":" → SEMPRE campo (ex.: "HABILIDADES:", "AVALIAÇÃO:", "TEMÁTICA ABORDADA:"). Cria variável NA MESMA CÉLULA (padrão inline_colon).
   B. TUDO EM MAIÚSCULAS + SEM ":" → SEMPRE título/subtítulo, NUNCA gera variável (ex.: "CEDUP HERMANN HERING", "PLANO DE AULA (ATÉ 30 DIAS) - 2026").
   C. Minúsculas/misto + termina com ":" → campo. Variável à direita se houver célula vazia adjacente, ou inline na mesma célula.
   D. Minúsculas/misto + SEM ":" → é campo SOMENTE SE houver célula vazia imediatamente à direita OU abaixo. Se não houver nenhuma célula vazia adjacente → título, descarta.
   E. MÚLTIPLOS RÓTULOS NA MESMA CÉLULA: quando uma célula contém vários parágrafos cada um terminando com ":" (ex.: "Professor(a):\nÁrea/Componente:\nTurma:"), cada parágrafo é um campo separado com sua própria variável.
   F. SUB-ITENS com prefixo "- " + colon (ex.: "- Carga horária prevista:", "- Data ou período de realização:") → campos independentes, cada um com sua variável.
   Exemplos de TÍTULOS (não geram variável):
     "CEDUP HERMANN HERING" (tudo maiúsculo, sem ":"), "PLANO DE AULA" (tudo maiúsculo, sem ":").
   Exemplos de CAMPOS (geram variável):
     "HABILIDADES:" → maiúsculo + ":", variável na mesma célula.
     "Professor(a):" → misto + ":", variável inline.
     "- Carga horária prevista:" → sub-item + ":", variável própria.
     "Objeto(s) de conhecimento em estudo" → sem ":", mas com célula vazia abaixo → variável nessa célula.
   G. CABEÇALHO COM IMAGENS: quando uma linha da tabela tem células com imagens (logos, brasões) intercaladas com texto institucional centralizado (ex: [logo CEDUP] [ESTADO DE SANTA CATARINA\nSECRETARIA...] [bandeira SC]), essa linha é EXCLUSIVAMENTE decorativa — NUNCA gera variável. Ignore todas as células dessa linha.
8. COLUNAS REPETIDAS: Quando o mesmo dado aparece em múltiplas colunas de uma tabela (células espelhadas), declare um ÚNICO campo — não crie chaves duplicadas. Exemplo: "Turma(s)" repetido em 9 colunas → um único campo {{turma}}.
9. PADRÃO DE PERÍODOS/TRIMESTRES: Quando uma tabela tem cabeçalhos de período (1º, 2º, 3º trimestre; ou bimestres) e MÚLTIPLAS LINHAS de dados — uma por período — crie chaves com sufixo _tr1/_tr2/_tr3 (ou _bim1/_bim2). Exemplo: coluna "HABILIDADES" com 3 linhas de dados → habilidades_tr1, habilidades_tr2, habilidades_tr3. Células de marcação de trimestre (✓, "x", texto do período) → chaves {{tr1}}, {{tr2}}, {{tr3}}. Em <estrutura_detectada>, entradas com pattern "period_column" e 'periodSuffix' indicam exatamente isso — concatene o label ao sufixo para montar o key.
10. RANGE DE DATAS: Se o valor de um campo contém um intervalo de datas ("13/07/2026 a 09/08/2026" ou similar), declare DOIS campos separados: {base}_inicio e {base}_fim. Exemplo: "Data ou período de realização: 13/07 a 09/08" → data_inicio + data_fim.
11. ESCOPO DE BLOCO: Campos do tipo textarea têm conteúdo que se estende até o próximo título em caixa alta ou próxima seção. Marque esses campos com type "textarea" — nunca "text" para seções de conteúdo pedagógico (objetivos, habilidades, metodologia, avaliação, etc.).
12. DEPENDÊNCIAS — aiInstructions: Para campos role "ia_sugerida", preencha 'aiInstructions' com 1 frase curta indicando quais outros campos do schema servem de contexto. Use o mapeamento:
   • metodologia, atividade_metodologia → "Elabore considerando os objetivos de aprendizagem e as habilidades definidas neste plano."
   • avaliacao, instrumentos_avaliativos → "Defina instrumentos alinhados às habilidades e objetivos do plano."
   • habilidades (incluindo _tr1/_tr2/_tr3) → "Selecione habilidades BNCC alinhadas ao componente curricular e ao período letivo."
   • objetivos, expectativa_aprendizagem, objetivos_aprendizagem → "Formule objetivos mensuráveis com verbos de ação no infinitivo, conectados às habilidades."
   • competencias_gerais_bncc, competencias_especificas_area → "Parafraseie competências BNCC aplicadas ao componente e nível de ensino — nunca cópia literal."
   • conteudos, conceitos_estruturantes, objeto_conhecimento, tematica_abordada → "Organize do mais básico ao mais complexo, alinhado ao período letivo e às habilidades selecionadas."
   • recuperacao_paralela → "Proponha atividades diferenciadas baseadas nas dificuldades previstas pelos objetivos e avaliação."
   • Outros campos ia_sugerida → "Seja específico ao contexto da turma, disciplina e período descritos no plano."
   Campos role "manual" → aiInstructions = "".
</regras>
<estrutura_pre_processada>
Quando a mensagem contém <estrutura_detectada>, essa seção lista os pares rótulo→valor já extraídos automaticamente via análise XML do documento — use-a como FONTE PRIMÁRIA para labels e posições. Os padrões indicam onde o valor aparece:
• "adjacent_right"  → célula imediatamente à direita do rótulo (mesma linha)
• "adjacent_below"  → primeira célula da linha seguinte
• "column_header"   → cabeçalho de coluna; valores ficam nas células abaixo
• "inline_colon"    → valor na mesma célula: ou após ":" numa linha preenchida ("Professor: João"), ou espaço em branco dentro da mesma célula abaixo do rótulo (ex.: "HABILIDADES:" com área vazia abaixo na mesma célula)
• "period_column"   → campo de tabela com múltiplos períodos; 'periodSuffix' indica o sufixo da chave (_tr1, _tr2, _tr3 para trimestres; _bim1, _bim2 para bimestres). Monte o key concatenando o label normalizado + periodSuffix.
O campo 'valuePreview' mostra o conteúdo atual da célula de valor (vazio em templates em branco).
CRÍTICO: copie o 'label' de <estrutura_detectada> VERBATIM — não normalize, não traduza.
Quando a mensagem contém <campos_confirmados>, esses campos foram confirmados pelo professor em uma extração anterior. MANTENHA seus 'key' e 'label' intactos; apenas adicione campos novos não listados.
</estrutura_pre_processada>
<raciocinio_obrigatorio>
Antes de extrair, raciocine em "raciocinio":
1. Quantas tabelas existem, quantas colunas por tabela.
2. Para cada rótulo em <estrutura_detectada>: confirme o padrão e classifique (manual/ia_sugerida, grupo).
3. Verifique campos que não aparecem em <estrutura_detectada> mas estão no HTML.
4. Confirme que cada label será copiado EXATAMENTE de <estrutura_detectada> ou do HTML.
5. Identifique colunas repetidas (→ mesmo campo único) e entradas "period_column" (→ sufixos _tr1/_tr2/_tr3). Verifique se há ranges de data para dividir em _inicio/_fim.
6. Para CADA linha/parágrafo candidato, aplique a Regra 13:
   • TUDO MAIÚSCULO + ":" → campo direto (inline_colon na mesma célula).
   • TUDO MAIÚSCULO + sem ":" → título, descarta imediatamente.
   • Misto + ":" → campo (inline ou célula adjacente).
   • Misto + sem ":" → campo SOMENTE se houver célula vazia adjacente; caso contrário, título.
   • Célula com múltiplos parágrafos terminando em ":" → múltiplos campos separados (um por parágrafo).
</raciocinio_obrigatorio>
<contrato_de_saida>
Responda com JSON: { "raciocinio": string, "campos": [...TemplateFieldSchema] }
</contrato_de_saida>`;

// ── Prompt builder ──────────────────────────────────────────────────────────

const fewShotExamples = [
  {
    descricao: "Plano de 30 dias (CEDUP/SC) — template com campos preenchidos e inline colon. Aplica Regra 10: range de datas dividido em _inicio/_fim.",
    regra: "NUNCA invente labels. Se o HTML tem <td><strong>PROFESSOR (A):</strong></td><td>Luiz Carlos</td>, o label é 'PROFESSOR (A)' e o defaultValue é 'Luiz Carlos'.",
    html_input_example: "<table><tbody><tr><td>Professor(a): Luiz Carlos Covre</td></tr><tr><td>Área/Componente: 5421 - PRÁTICAS EM D.S.I</td></tr><tr><td>Turma: 2º EMIEP</td></tr><tr><td>- Carga horária prevista: 9 aulas</td></tr><tr><td>- Data ou período de realização: 13/07/2026 a 09/08/2026</td></tr></tbody></table><p><strong>HABILIDADES:</strong></p><p>- Refatorar CSS para facilitar manutenção</p>",
    estrutura_detectada_example: [
      { label: "Professor(a)", valuePreview: "Luiz Carlos Covre", pattern: "inline_colon" },
      { label: "Área/Componente", valuePreview: "5421 - PRÁTICAS EM D.S.I", pattern: "inline_colon" },
      { label: "Turma", valuePreview: "2º EMIEP", pattern: "inline_colon" },
      { label: "Carga horária prevista", valuePreview: "9 aulas", pattern: "inline_colon" },
      { label: "Data ou período de realização", valuePreview: "13/07/2026 a 09/08/2026", pattern: "inline_colon" },
      { label: "HABILIDADES", valuePreview: "- Refatorar CSS...", pattern: "adjacent_below" },
    ],
    campos: [
      { key: "professor",         label: "Professor(a)",          type: "text",     required: true, role: "manual",      group: "dados_turma",  defaultValue: "Luiz Carlos Covre" },
      { key: "area_componente",   label: "Área/Componente",       type: "text",     required: true, role: "manual",      group: "dados_turma",  defaultValue: "5421 - PRÁTICAS EM D.S.I" },
      { key: "turma",             label: "Turma",                 type: "text",     required: true, role: "manual",      group: "dados_turma",  defaultValue: "2º EMIEP" },
      { key: "ch_prevista",       label: "Carga horária prevista",type: "text",     required: true, role: "manual",      group: "dados_turma",  defaultValue: "9 aulas" },
      { key: "data_inicio",       label: "Data ou período de realização", type: "text", required: true, role: "manual", group: "dados_turma" },
      { key: "data_fim",          label: "Data ou período de realização", type: "text", required: true, role: "manual", group: "dados_turma" },
      { key: "habilidades",       label: "HABILIDADES",           type: "textarea", required: true, role: "ia_sugerida", group: "habilidades" },
    ],
    nota: "Regra 10: 'Data ou período de realização' contém range '13/07/2026 a 09/08/2026' → declarar data_inicio + data_fim como campos separados.",
  },
  {
    descricao: "Planejamento anual (EMIEP-2026) — tabela com colunas espelhadas e 3 trimestres. Aplica Regras 8 (colunas repetidas) e 9 (períodos).",
    estrutura_detectada_example: [
      { label: "PROFESSOR (A)", valuePreview: "", pattern: "adjacent_right" },
      { label: "CURSO", valuePreview: "", pattern: "adjacent_right" },
      { label: "Área(s) do Conhecimento", valuePreview: "", pattern: "adjacent_right" },
      { label: "Turma(s)", valuePreview: "", pattern: "adjacent_right" },
      { label: "Carga horária presencial", valuePreview: "", pattern: "adjacent_right" },
      { label: "Carga horária não presencial", valuePreview: "", pattern: "adjacent_right" },
      { label: "Componente Curricular", valuePreview: "", pattern: "adjacent_right" },
      { label: "OBJETIVO GERAL DO COMPONENTE", valuePreview: "", pattern: "column_header" },
      { label: "COMPETÊNCIAS GERAIS BNCC", valuePreview: "", pattern: "column_header" },
      { label: "COMPETÊNCIAS ESPECÍFICAS DA ÁREA", valuePreview: "", pattern: "column_header" },
      { label: "CONCEITOS ESTRUTURANTES DA ÁREA", valuePreview: "", pattern: "period_column", periodSuffix: "_tr1" },
      { label: "HABILIDADES", valuePreview: "", pattern: "period_column", periodSuffix: "_tr1" },
      { label: "OBJETO DE CONHECIMENTO", valuePreview: "", pattern: "period_column", periodSuffix: "_tr1" },
      { label: "1º", valuePreview: "1º", pattern: "period_column", periodSuffix: "_tr1" },
      { label: "CONCEITOS ESTRUTURANTES DA ÁREA", valuePreview: "", pattern: "period_column", periodSuffix: "_tr2" },
      { label: "HABILIDADES", valuePreview: "", pattern: "period_column", periodSuffix: "_tr2" },
      { label: "OBJETO DE CONHECIMENTO", valuePreview: "", pattern: "period_column", periodSuffix: "_tr2" },
      { label: "2º", valuePreview: "2º", pattern: "period_column", periodSuffix: "_tr2" },
      { label: "CONCEITOS ESTRUTURANTES DA ÁREA", valuePreview: "", pattern: "period_column", periodSuffix: "_tr3" },
      { label: "HABILIDADES", valuePreview: "", pattern: "period_column", periodSuffix: "_tr3" },
      { label: "OBJETO DE CONHECIMENTO", valuePreview: "", pattern: "period_column", periodSuffix: "_tr3" },
      { label: "3º", valuePreview: "3º", pattern: "period_column", periodSuffix: "_tr3" },
    ],
    campos: [
      { key: "professor_a",                  label: "PROFESSOR (A)",                  type: "text",     required: true,  role: "manual",      group: "dados_turma" },
      { key: "nome_curso",                   label: "CURSO",                          type: "text",     required: true,  role: "manual",      group: "dados_turma" },
      { key: "area_conhecimento",            label: "Área(s) do Conhecimento",        type: "text",     required: true,  role: "manual",      group: "dados_turma" },
      { key: "turma",                        label: "Turma(s)",                       type: "text",     required: true,  role: "manual",      group: "dados_turma" },
      { key: "n_aulas_semanais",             label: "Nº aulas semanais",              type: "text",     required: false, role: "manual",      group: "dados_turma" },
      { key: "chpresencial",                 label: "Carga horária presencial",       type: "text",     required: false, role: "manual",      group: "dados_turma" },
      { key: "chnpresencial",                label: "Carga horária não presencial",   type: "text",     required: false, role: "manual",      group: "dados_turma" },
      { key: "componente_curricular",        label: "Componente Curricular",          type: "text",     required: true,  role: "manual",      group: "dados_turma" },
      { key: "objetivo_geral_componente",    label: "OBJETIVO GERAL DO COMPONENTE",   type: "textarea", required: true,  role: "ia_sugerida", group: "objetivos" },
      { key: "competencias_gerais_bncc",     label: "COMPETÊNCIAS GERAIS BNCC",       type: "textarea", required: true,  role: "ia_sugerida", group: "competencias" },
      { key: "competencias_especificas_area",label: "COMPETÊNCIAS ESPECÍFICAS DA ÁREA",type: "textarea",required: true,  role: "ia_sugerida", group: "competencias" },
      { key: "conceitos_estruturantes_tr1",  label: "CONCEITOS ESTRUTURANTES DA ÁREA",type: "textarea", required: true,  role: "ia_sugerida", group: "conteudos" },
      { key: "habilidades_tr1",              label: "HABILIDADES",                   type: "textarea", required: true,  role: "ia_sugerida", group: "habilidades" },
      { key: "objeto_conhecimento_tr1",      label: "OBJETO DE CONHECIMENTO",         type: "textarea", required: true,  role: "ia_sugerida", group: "conteudos" },
      { key: "tr1",                          label: "1º Trimestre",                   type: "text",     required: false, role: "manual",      group: "dados_turma" },
      { key: "conceitos_estruturantes_tr2",  label: "CONCEITOS ESTRUTURANTES DA ÁREA",type: "textarea", required: true,  role: "ia_sugerida", group: "conteudos" },
      { key: "habilidades_tr2",              label: "HABILIDADES",                   type: "textarea", required: true,  role: "ia_sugerida", group: "habilidades" },
      { key: "objeto_conhecimento_tr2",      label: "OBJETO DE CONHECIMENTO",         type: "textarea", required: true,  role: "ia_sugerida", group: "conteudos" },
      { key: "tr2",                          label: "2º Trimestre",                   type: "text",     required: false, role: "manual",      group: "dados_turma" },
      { key: "conceitos_estruturantes_tr3",  label: "CONCEITOS ESTRUTURANTES DA ÁREA",type: "textarea", required: true,  role: "ia_sugerida", group: "conteudos" },
      { key: "habilidades_tr3",              label: "HABILIDADES",                   type: "textarea", required: true,  role: "ia_sugerida", group: "habilidades" },
      { key: "objeto_conhecimento_tr3",      label: "OBJETO DE CONHECIMENTO",         type: "textarea", required: true,  role: "ia_sugerida", group: "conteudos" },
      { key: "tr3",                          label: "3º Trimestre",                   type: "text",     required: false, role: "manual",      group: "dados_turma" },
      { key: "articulacao_2professor",       label: "PLANO DE ARTICULAÇÃO COM 2º PROFESSORES, ADAPTAÇÕES/ADEQUAÇÕES CURRICULARES", type: "textarea", required: false, role: "manual", group: "outros" },
      { key: "projeto_integrador",           label: "PROJETOS INTEGRADORES",          type: "textarea", required: false, role: "ia_sugerida", group: "conteudos" },
      { key: "metodologia",                  label: "METODOLOGIA",                    type: "textarea", required: true,  role: "ia_sugerida", group: "conteudos" },
      { key: "avaliacao",                    label: "AVALIAÇÃO",                      type: "textarea", required: true,  role: "ia_sugerida", group: "avaliacao" },
      { key: "referencias_bibliograficas",   label: "REFERÊNCIAS BIBLIOGRÁFICAS",     type: "textarea", required: false, role: "manual",      group: "outros" },
      { key: "data_atual",                   label: "Data",                           type: "text",     required: false, role: "manual",      group: "dados_turma" },
    ],
    notas: [
      "Regra 8: PROFESSOR (A), Turma(s), Componente Curricular etc. repetem em até 10 colunas → 1 campo cada.",
      "Regra 9: period_column com periodSuffix _tr1/_tr2/_tr3 → chaves com sufixo. Ex: habilidades_tr1, habilidades_tr2, habilidades_tr3.",
      "Regra 9: marcadores de período '1º', '2º', '3º' → campos tr1, tr2, tr3 (checkbox/marcação por linha).",
    ],
  },
];

interface FieldCorrection {
  label: string;
  extracted_key: string;
  correct_key: string;
}

function buildPrompt(
  { content, isHtml }: ExtractedContent,
  structuralPairs: StructuralPair[],
  confirmedFields?: TemplateFieldSchema[],
  corrections?: FieldCorrection[],
): string {
  const docTag = isHtml ? "documento_html" : "documento";
  const instrucao = isHtml
    ? `Analise o HTML em <documento_html> e os pares rótulo→valor em <estrutura_detectada>. USE <estrutura_detectada> como FONTE PRIMÁRIA: cada item é um campo a extrair. O HTML serve como contexto complementar para classificação (manual vs ia_sugerida). CRÍTICO: copie o 'label' EXATAMENTE como aparece em <estrutura_detectada>. O 'key' é o label em snake_case sem acentos. Se 'valuePreview' não estiver vazio, inclua como 'defaultValue'.`
    : `Analise o texto em <documento> e os pares em <estrutura_detectada>. CRÍTICO: o 'label' deve ser copiado EXATAMENTE. O 'key' é o label em snake_case sem acentos. Se o campo estiver preenchido, inclua o conteúdo como 'defaultValue'.`;

  const parts: string[] = [
    `<instrucao>${instrucao}</instrucao>`,
    `<exemplos>${JSON.stringify(fewShotExamples)}</exemplos>`,
  ];

  // Feature 1: structural pre-scan — give the AI the pre-detected pairs
  if (structuralPairs.length > 0) {
    parts.push(
      `<estrutura_detectada>`,
      JSON.stringify(structuralPairs, null, 2),
      `</estrutura_detectada>`,
    );
  }

  // Feature 3: dynamic few-shot — confirmed fields from a previous extraction
  if (confirmedFields && confirmedFields.length > 0) {
    const slim = confirmedFields.map(({ key, label, role, group }) => ({ key, label, role, group }));
    parts.push(
      `<campos_confirmados>`,
      `Campos já confirmados pelo professor neste template — mantenha key/label intactos:`,
      JSON.stringify(slim, null, 2),
      `</campos_confirmados>`,
    );
  }

  // Feature 1: feedback loop — inject corrections the professor made previously
  if (corrections && corrections.length > 0) {
    parts.push(
      `<correcoes_anteriores>`,
      `O professor corrigiu as seguintes chaves geradas incorretamente pela IA — use SEMPRE as chaves corretas:`,
      corrections.map((c) => `- Rótulo "${c.label}": chave ERRADA="${c.extracted_key}", chave CORRETA="${c.correct_key}"`).join("\n"),
      `</correcoes_anteriores>`,
    );
  }

  parts.push(`<${docTag}>`, content, `</${docTag}>`);
  return parts.join("\n");
}

// ── AI generation ───────────────────────────────────────────────────────────

async function generateSchema(promptStr: string): Promise<{ text: string; provider: import("../../../../../lib/ai/provider").AiProvider }> {
  return callAIWithFallbacks({
    systemInstruction: SYSTEM_INSTRUCTION,
    prompt: promptStr,
    temperature: 0.1,
    topP: 0.6,
    geminiSchema: INTROSPECT_RESPONSE_SCHEMA,
  });
}

function parseSchema(raw: string): unknown {
  let schema: unknown;
  try {
    schema = JSON.parse(raw);
  } catch {
    const firstBracket = raw.indexOf("[");
    const lastBracket = raw.lastIndexOf("]");
    if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) {
      throw new Error("invalid_schema");
    }
    schema = JSON.parse(raw.slice(firstBracket, lastBracket + 1));
  }
  if (typeof schema === "object" && schema !== null && !Array.isArray(schema) && "campos" in schema) {
    schema = (schema as { campos: unknown }).campos;
  }
  return schema;
}

// ── Route handler ───────────────────────────────────────────────────────────

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const db = getAdminDb();
    const snap = await db.collection("magis_templates").doc(id).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
    }

    const tData = snap.data() as Omit<TemplateRecord, "id"> & {
      estrutura_docx?: StructuralPair[];
      campo_corrections?: FieldCorrection[];
    };
    const arquivoUrl = typeof tData.arquivo_url === "string" ? tData.arquivo_url : "";
    if (!arquivoUrl) {
      return NextResponse.json({ error: "Template não possui arquivo armazenado." }, { status: 400 });
    }

    // ── Item 13: schema version history — save current schema before re-extraction ──
    const currentSchema = Array.isArray(tData.schema_campos) ? tData.schema_campos : [];
    if (currentSchema.length > 0) {
      try {
        await db.collection("magis_templates").doc(id).collection("schema_versions").add({
          schema_campos: currentSchema,
          salvo_em: new Date().toISOString(),
          tipo: "pre_re_introspect",
        });
      } catch {
        // non-critical — continue even if version save fails
      }
    }

    const fileBuffer = await downloadFile(arquivoUrl);

    const lower = arquivoUrl.toLowerCase().split("?")[0];
    const isDocx = lower.endsWith(".docx") || lower.endsWith(".doc");

    // ── Feature 1: structural pre-scan ──────────────────────────────────────
    // Parse the DOCX XML directly to extract label→value pairs BEFORE calling
    // the AI. The AI receives this as structured context (not just raw HTML),
    // dramatically reducing positional errors.
    const structuralPairs = isDocx ? scanDocxStructure(fileBuffer) : [];
    console.info(`[re-introspect] Estrutura detectada: ${structuralPairs.length} pares`);

    // ── Feature 3: dynamic few-shot ─────────────────────────────────────────
    // If the professor has confirmed a schema before, use it as a few-shot
    // reference so the AI keeps confirmed keys/labels stable.
    const confirmedFields: TemplateFieldSchema[] | undefined =
      Array.isArray(tData.schema_campos) && tData.schema_campos.length > 0
        ? tData.schema_campos
        : undefined;

    // ── Item 1: feedback loop — inject previous corrections ──────────────────
    const corrections = Array.isArray(tData.campo_corrections) ? tData.campo_corrections : [];

    // ── AI extraction ────────────────────────────────────────────────────────
    const extracted = await extractContent(fileBuffer, arquivoUrl);
    const prompt = buildPrompt(extracted, structuralPairs, confirmedFields, corrections);
    const { text: raw, provider: aiProvider } = await generateSchema(prompt);

    let schema: unknown;
    try {
      schema = parseSchema(raw);
    } catch {
      return NextResponse.json({ error: "Resposta inválida do modelo ao gerar schema." }, { status: 502 });
    }

    if (!Array.isArray(schema)) {
      return NextResponse.json({ error: "Schema deve ser um array de campos." }, { status: 502 });
    }

    void import("../../../../../lib/services/usage-logger").then(({ logUsage }) => {
      void logUsage({
        userId: tData.user_id as string,
        action: "introspect",
        model: "re-introspect",
        provider: aiProvider,
        tokensInput: 0,
        tokensOutput: 0,
        metadata: { template_id: id },
      });
    });

    // Merge: pre-annotated {{key}} patterns in the DOCX take priority over AI inference
    const scannedKeys = isDocx ? scanPlaceholders(fileBuffer) : [];
    if (scannedKeys.length > 0) {
      const aiKeys = new Set((schema as TemplateFieldSchema[]).map((f) => f.key));
      const fromScan = scannedKeys.filter((k) => !aiKeys.has(k)).map(keyToField);
      (schema as TemplateFieldSchema[]).push(...fromScan);
    }

    // ── Inject placeholders into DOCX ────────────────────────────────────────
    let fillableUrl: string | null = null;
    let injectionReport: ReturnType<typeof reportInjections> | null = null;

    if (isDocx) {
      try {
        const fillableBuffer = injectPlaceholders(fileBuffer, schema as TemplateFieldSchema[]);

        // Feature 2: post-injection validation
        injectionReport = reportInjections(fillableBuffer, schema as TemplateFieldSchema[]);
        if (injectionReport.missing.length > 0) {
          console.info(
            `[re-introspect] Campos sem placeholder automático: ${injectionReport.missing.join(", ")}`,
          );
        }

        const fillablePath = `templates/${id}/fillable.docx`;
        fillableUrl = await uploadFile({
          path: fillablePath,
          buffer: fillableBuffer,
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });

        await db.collection("magis_templates").doc(id).update({
          schema_campos: schema,
          arquivo_fillable_url: fillableUrl,
          fillable_status: "pronto",
          // Store structural pairs for use in future re-extractions (feature 3)
          estrutura_docx: structuralPairs,
        });
      } catch (e) {
        console.warn("[re-introspect] Falha ao regenerar DOCX preenchível:", e);
        await db.collection("magis_templates").doc(id).update({
          schema_campos: schema,
          estrutura_docx: structuralPairs,
        });
      }
    } else {
      await db.collection("magis_templates").doc(id).update({ schema_campos: schema });
    }

    // ── Item 2: structural × AI cross-validation ────────────────────────────
    // Flag fields whose label doesn't appear in any structural pair — they were
    // inferred from HTML alone and may be positionally wrong.
    function normLabel(s: string) {
      return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").trim();
    }
    const camposBaixaConfianca: string[] = [];
    if (structuralPairs.length > 0) {
      const pairNorms = structuralPairs.map((p) => normLabel(p.label));
      for (const f of schema as TemplateFieldSchema[]) {
        const fn = normLabel(f.label);
        const found = pairNorms.some((pn) => pn.includes(fn) || fn.includes(pn));
        if (!found) camposBaixaConfianca.push(f.key);
      }
    }

    // ── Item 4: track which confirmed fields were kept vs replaced ──────────
    const oldKeys = new Set(currentSchema.map((f) => f.key));
    const newKeys = new Set((schema as TemplateFieldSchema[]).map((f) => f.key));
    const camposConfirmadosMantidos = [...oldKeys].filter((k) => newKeys.has(k));
    const camposAdicionados = [...newKeys].filter((k) => !oldKeys.has(k));
    const camposRemovidos = [...oldKeys].filter((k) => !newKeys.has(k));

    return NextResponse.json({
      ok: true,
      schema,
      totalCampos: (schema as unknown[]).length,
      arquivo_fillable_url: fillableUrl,
      // Feature 2: surface which fields need manual placement to the UI
      campos_sem_placeholder: injectionReport?.missing ?? [],
      // Item 2: fields with no structural backing
      campos_baixa_confianca: camposBaixaConfianca,
      // Item 4: incremental diff
      diff: { mantidos: camposConfirmadosMantidos, adicionados: camposAdicionados, removidos: camposRemovidos },
    });
  } catch (error) {
    console.error("[re-introspect] Erro:", error);
    const msg = (error as Error)?.message ?? "";
    return NextResponse.json(
      { error: `Falha ao re-extrair campos do template. ${msg}` },
      { status: 500 },
    );
  }
}
