import "server-only";

import { NextResponse } from "next/server";
import { SchemaType } from "@google/generative-ai";
import type { ResponseSchema } from "@google/generative-ai";
import pdf from "pdf-parse";
import PizZip from "pizzip";

import { getAdminDb } from "../../../../lib/firebase/admin";
import { requireCurrentUserProfile } from "../../../../lib/auth/session";
import { getLimitsStatus } from "../../../../lib/services/limits";
import { callAIWithFallbacks } from "../../../../lib/ai/provider";
import { scanDocxStructure, scanPlaceholders } from "../../../../lib/utils/docx-filler";
import { structuralPairsToSchema, keyToField } from "../../../../lib/utils/docx-schema-mapper";

const MODEL_NAME = process.env.GOOGLE_GEMINI_MODEL ?? "gemini-2.0-flash";

function extractDocxText(buffer: Buffer): string {
  const zip = new PizZip(buffer);
  const xmlFile = zip.files["word/document.xml"];
  if (!xmlFile) return "";
  const xml = xmlFile.asText();
  return xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

async function extractFileText(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();
  if (name.endsWith(".docx") || name.endsWith(".doc")) {
    return extractDocxText(buffer);
  }
  const data = await pdf(buffer);
  return data.text;
}

// ── Response schema — restringe role, group e type aos valores válidos ─────
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
          key:               { type: SchemaType.STRING },
          label:             { type: SchemaType.STRING },
          type:              { type: SchemaType.STRING, format: "enum", enum: ["text", "textarea"] },
          required:          { type: SchemaType.BOOLEAN },
          role:              { type: SchemaType.STRING, format: "enum", enum: ["manual", "ia_sugerida"] },
          group:             { type: SchemaType.STRING, format: "enum", enum: ["dados_turma", "objetivos", "competencias", "habilidades", "conteudos", "avaliacao", "outros"] },
          defaultValue:      { type: SchemaType.STRING, nullable: true },
          aiInstructions:    { type: SchemaType.STRING, nullable: true },
          injection_pattern: { type: SchemaType.STRING, nullable: true, format: "enum", enum: ["adjacent_right", "adjacent_below", "inline_colon", "column_header", "period_column"] },
        },
      },
    },
  },
};

const SYSTEM_INSTRUCTION = `<persona>
Você é um analista de currículo escolar sênior, especializado em estruturar documentos pedagógicos brasileiros segundo as normas do MEC e a BNCC. Tem expertise em identificar a arquitetura de planos de aula — distinguindo campos de identificação de campos pedagógicos — e em extrair sua estrutura com precisão absoluta, sem inferências ou normalizações.
</persona>
<regras>
1. REGRA CRÍTICA: O campo 'label' DEVE ser copiado EXATAMENTE como aparece no documento — sem tradução, normalização, abreviação ou substituição.
   Exemplos: 'Área/Componente:' → label 'Área/Componente' | 'HABILIDADES:' → label 'HABILIDADES' | 'Professor(a):' → label 'Professor(a)'.
   NUNCA invente labels.
2. Campos de identificação (professor, curso/área, turma, componente etc.) → role 'manual', group 'dados_turma'.
3. Campos pedagógicos (objetivos, competências, habilidades, BNCC, SAEB, conteúdos, avaliação) → role 'ia_sugerida'.
4. Grupos válidos: dados_turma | objetivos | competencias | habilidades | conteudos | avaliacao | outros.
5. O 'key' é o label em snake_case sem acentos (ex: 'area_componente', 'numero_de_aulas').
6. type "textarea" para campos pedagógicos longos; "text" para campos curtos (nome, turma, data, número).
7. NÃO inclua linhas que são apenas títulos de seção sem campo associado.
13. TÍTULO vs. CAMPO PREENCHÍVEL — regra obrigatória. Avalie linha por linha e parágrafo por parágrafo:
   A. TUDO EM MAIÚSCULAS + termina com ":" → SEMPRE campo (ex.: "HABILIDADES:", "AVALIAÇÃO:"). Cria variável NA MESMA LINHA/CÉLULA.
   B. TUDO EM MAIÚSCULAS + SEM ":" → SEMPRE título, NUNCA gera variável (ex.: "CEDUP HERMANN HERING", "PLANO DE AULA (ATÉ 30 DIAS) - 2026").
   C. Minúsculas/misto + termina com ":" → campo. Variável inline (na mesma linha ou célula).
   D. Minúsculas/misto + SEM ":" → campo SOMENTE SE houver linha/célula vazia imediatamente abaixo ou à direita. Se não houver → título, descarta.
   E. MÚLTIPLOS RÓTULOS NA MESMA LINHA/CÉLULA: quando há vários rótulos terminando com ":" na mesma célula — seja em parágrafos separados (ex.: "Professor(a):\nÁrea/Componente:\nTurma:") OU na mesma linha/parágrafo (ex.: "Área/Componente: Turma:") — cada rótulo é um campo SEPARADO com sua própria variável. NUNCA combine dois rótulos num único campo. "Área/Componente: Turma:" → dois campos: {key:"area_componente", label:"Área/Componente"} e {key:"turma", label:"Turma"}.
   F. SUB-ITENS "- rótulo:" também geram variável própria.
   G. CABEÇALHO COM IMAGENS: quando uma linha da tabela tem células com imagens (logos, brasões) intercaladas com texto institucional centralizado (ex: [logo] [ESTADO DE SANTA CATARINA / SECRETARIA...] [bandeira]), essa linha é EXCLUSIVAMENTE decorativa — NUNCA gera variável. Ignore todas as células dessa linha.
   Exemplos de TÍTULOS: "CEDUP HERMANN HERING", "PLANO DE AULA".
   Exemplos de CAMPOS: "HABILIDADES:" → campo. "Professor(a):" → campo. "- Carga horária prevista:" → campo.
8. COLUNAS REPETIDAS: Quando o mesmo dado aparece em múltiplas colunas de uma tabela (células espelhadas), declare um ÚNICO campo — não crie chaves duplicadas. Exemplo: "Turma(s)" em 9 colunas → um único campo {{turma}}.
9. PADRÃO DE PERÍODOS/TRIMESTRES: Quando uma tabela tem cabeçalhos de período (1º, 2º, 3º trimestre; bimestres), analise a estrutura via injection_pattern: (a) Se o cabeçalho de conteúdo (HABILIDADES, CONCEITOS etc.) tem injection_pattern "adjacent_below" → a coluna tem UMA ÚNICA célula de valor diretamente abaixo → 1 campo por coluna sem sufixo. (b) Se o cabeçalho tem injection_pattern "period_column" → existem MÚLTIPLAS LINHAS de dados, uma por período → sufixo _tr1/_tr2/_tr3. (c) Marcadores de período (1º, 2º, 3º — células de ✓ ou texto do período) → chaves {{tr1}}, {{tr2}}, {{tr3}}.
10. RANGE DE DATAS: Se o valor de um campo contém um intervalo ("13/07/2026 a 09/08/2026" ou "DD/MM - DD/MM"), declare DOIS campos separados: {base}_inicio e {base}_fim.
11. ESCOPO DE BLOCO: Campos do tipo textarea têm conteúdo que se estende até o próximo título em caixa alta ou próxima seção. Marque esses campos com type "textarea" — nunca "text" para seções de conteúdo pedagógico.
12. DEPENDÊNCIAS — aiInstructions: Para campos role "ia_sugerida", preencha 'aiInstructions' com 1 frase curta indicando quais outros campos servem de contexto. Use o mapeamento:
   • metodologia, atividade → "Elabore considerando os objetivos de aprendizagem e as habilidades definidas neste plano."
   • avaliacao, instrumentos_avaliativos → "Defina instrumentos alinhados às habilidades e objetivos do plano."
   • habilidades (incluindo _tr1/_tr2/_tr3) → "Selecione habilidades BNCC alinhadas ao componente curricular e ao período letivo."
   • objetivos, expectativa_aprendizagem → "Formule objetivos mensuráveis com verbos de ação no infinitivo, conectados às habilidades."
   • competencias → "Parafraseie competências BNCC aplicadas ao componente e nível de ensino — nunca cópia literal."
   • conteudos, conceitos_estruturantes, objeto_conhecimento, tematica → "Organize do mais básico ao mais complexo, alinhado ao período letivo e às habilidades."
   • recuperacao_paralela → "Proponha atividades diferenciadas baseadas nas dificuldades previstas pelos objetivos e avaliação."
   • Outros campos ia_sugerida → "Seja específico ao contexto da turma, disciplina e período descritos no plano."
   Campos role "manual" → aiInstructions = "".
14. TOKENIZAÇÃO AVANÇADA DO KEY (normalização de rótulos):
   A. Marcador de plural "(s)" ou "(es)": remova os parênteses ao gerar o key. "Habilidade(s) selecionada(s)" → key "habilidades_selecionadas". "Professor(a)" → key "professor" (singular base).
   B. Símbolo "Nº" ou "N°": substitua por "numero" no key. "Nº aulas semanais" → key "numero_aulas_semanais".
   C. Conectivos e conjunções no key: use ambos os termos. "Adaptações e observações" → key "adaptacoes_observacoes".
   D. Prefixo "- " no rótulo: ignore no key. "- Carga horária:" → key "carga_horaria".
   E. Parênteses, pontuação e caracteres especiais: nunca aparecem no key — apenas letras, dígitos e _.
15. BLOCOS "Obs:", "Nota:", "Observação:", "N.B.": são instruções de negócio descritivas, NUNCA geram campo. Qualquer parágrafo, célula ou rodapé cujo texto inicia com essas palavras deve ser completamente ignorado — não crie campo, não crie label, não processe.
16. CABEÇALHO EM CAIXA ALTA SEM ":" (Regra Top-Down / Parent-Child): Quando uma linha contém APENAS texto todo em maiúsculas sem ":" E a linha imediatamente abaixo está vazia ou tem espaço para valor, o texto é um rótulo de seção que gera variável na linha inferior. Exemplos: "PROJETOS INTEGRADORES" + linha vazia → campo projeto_integrador (type textarea). NUNCA confundir com nomes de instituição/escola que aparecem no topo do documento sem linha vazia logo abaixo.
17. VARIÁVEIS DE SISTEMA (auto-preenchidas): Chaves reservadas que o sistema preenche automaticamente sem input do usuário: {{data_atual}} (data de geração em pt-BR), {{ano_letivo}} (ano corrente). Quando o documento apresentar texto como "Blumenau, {{data_atual}}" ou "Ano letivo: {{ano_letivo}}", declare esses campos com role "manual", type "text" e aiInstructions = "" — o sistema injeta o valor automaticamente; não espere que o professor preencha.
18. PADRÃO DE INJEÇÃO (injection_pattern) — OBRIGATÓRIO quando <estrutura_detectada> estiver disponível: para cada campo, encontre o par correspondente em <estrutura_detectada> pelo label e copie seu "pattern" para o campo "injection_pattern" do JSON de saída. Se não houver par correspondente, use null. Mapeamento direto de valores: "adjacent_right" | "adjacent_below" | "inline_colon" | "column_header" | "period_column". Este metadado é usado pelo sistema de injeção para localizar a célula correta no XML do Word sem re-derivar a estrutura.
   Exemplos: "Professor(a):" com par de padrão "inline_colon" → injection_pattern "inline_colon". "HABILIDADES:" com par "adjacent_below" → injection_pattern "adjacent_below". Se <estrutura_detectada> estiver vazio → injection_pattern null para todos os campos.
</regras>
<raciocinio_obrigatorio>
Antes de extrair os campos, raciocine em "raciocinio" seguindo estes passos:
1. Faça uma leitura geral do documento para mapear sua estrutura (seções, rótulos, campos preenchíveis).
2. Classifique cada campo: é de identificação (professor, turma, escola, data) ou pedagógico (objetivos, habilidades, conteúdos, avaliação)?
3. Para cada campo pedagógico, determine o group correto: objetivos | competencias | habilidades | conteudos | avaliacao | outros.
4. Confirme que cada label será copiado EXATAMENTE como aparece no documento, sem normalização.
5. Identifique colunas repetidas (→ mesmo campo único), estruturas de período (→ sufixos _tr1/_tr2/_tr3), ranges de data (→ _inicio/_fim) e colunas paralelas (→ campos independentes lado a lado).
6. Blocos "Obs:", "Nota:", "Observação:" → descartar imediatamente (Regra 15). Texto ALL CAPS + sem ":" + linha vazia abaixo → campo adjacent_below (Regra 16). Variáveis de sistema (data_atual, ano_letivo) → declarar com role manual, o sistema preenche (Regra 17). Para CADA linha/parágrafo restante, aplique a Regra 13:
7. Para cada campo extraído, procure o par correspondente em <estrutura_detectada> pelo label e preencha injection_pattern com o "pattern" do par (Regra 18). Isso é crítico para a injeção zero-config em templates em branco.
   • TUDO MAIÚSCULO + ":" → campo direto, variável na mesma célula.
   • TUDO MAIÚSCULO + sem ":" → título, descarta imediatamente.
   • Misto + ":" → campo.
   • Misto + sem ":" → campo SOMENTE se houver vazio adjacente; senão título.
   • Vários parágrafos "rótulo:" na mesma célula → um campo por parágrafo.
</raciocinio_obrigatorio>
<contrato_de_saida>
Responda com JSON: { "raciocinio": string, "campos": [...TemplateFieldSchema] }
</contrato_de_saida>`;

async function generateSchema(promptStr: string): Promise<{ text: string; provider: import("../../../../lib/ai/provider").AiProvider }> {
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

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUserProfile();

    const formData = await request.formData();
    const templateId = (formData.get("templateId") as string | null) ?? null;
    const file = formData.get("file") as File | null;
    const isNew = formData.get("isNew") === "true"; // flag to distinguish create vs re-introspect

    console.log("[PlanoMagistra] 2. Extraindo campos do template...", {
      templateId,
      arquivo: (file as File & { name?: string })?.name,
      modelo: MODEL_NAME,
    });

    if (!templateId || !file) {
      return NextResponse.json({ error: "templateId e arquivo PDF são obrigatórios." }, { status: 400 });
    }

    // Enforce template limit only on first introspection (template creation)
    if (isNew) {
      const limits = await getLimitsStatus(user.uid, user.plano ?? "free");
      if (!limits.canCreateTemplate) {
        return NextResponse.json(
          {
            error: `Limite de ${limits.limits.maxTemplates} templates atingido. Faça upgrade do plano.`,
            limitReached: true,
          },
          { status: 403 },
        );
      }
    }

    // Verify template ownership
    const db = getAdminDb();
    const templateSnap = await db.collection("magis_templates").doc(templateId).get();
    if (!templateSnap.exists || templateSnap.data()?.user_id !== user.uid) {
      return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
    }

    // Read the file buffer once and reuse for text extraction + structural scan
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const pdfText = await extractFileText(new File([fileBuffer], file.name, { type: file.type }));

    // Rule 1 + 5: structural pre-scan — parse DOCX XML for label→value pairs.
    // Includes non-table paragraphs (Rule 1) and implicitly excludes header/footer
    // XML files since scanDocxStructure only reads word/document.xml (Rule 5).
    const isDocxFile = /\.(docx|doc)(\?|$)/i.test(file.name);
    const structuralPairs = isDocxFile ? (() => {
      try { return scanDocxStructure(fileBuffer); } catch { return []; }
    })() : [];
    console.info(`[introspect] Estrutura detectada: ${structuralPairs.length} pares`);

    // Fast-path: template already has {{placeholders}} pre-typed by the user.
    // Derive schema deterministically from the keys found in the DOCX XML —
    // no AI call needed for key/group/role. The AI is still called to fill labels.
    const preAnnotatedKeys = isDocxFile ? (() => {
      try { return scanPlaceholders(fileBuffer); } catch { return [] as string[]; }
    })() : [];

    // Draft schema: deterministic structural pairs → key + metadata.
    // Sent to the AI as <schema_rascunho> so it validates rather than guesses.
    const draftSchema = structuralPairs.length > 0
      ? structuralPairsToSchema(structuralPairs)
      : preAnnotatedKeys.map(keyToField);
    console.info(`[introspect] Schema rascunho: ${draftSchema.length} campos`);

    // Few-shot: two examples covering the main structural patterns found in Brazilian school templates.
    const fewShotExamples = [
      {
        descricao: "Plano de 30 dias (CEDUP/SC) — template com campos preenchidos. Regra 10: range de datas → _inicio/_fim.",
        regra: "NUNCA invente ou normalize labels. Se o documento diz 'Área/Componente:' o label é 'Área/Componente', NÃO 'Curso' nem 'Componente curricular'.",
        campos: [
          { key: "professor", label: "Professor(a)", type: "text", required: true, role: "manual", group: "dados_turma", defaultValue: "Luiz Carlos Covre" },
          { key: "area_componente", label: "Área/Componente", type: "text", required: true, role: "manual", group: "dados_turma", defaultValue: "5421 - PRÁTICAS EM D.S.I - HTML, CSS, PHP" },
          { key: "turma", label: "Turma", type: "text", required: true, role: "manual", group: "dados_turma", defaultValue: "2º EMIEP" },
          { key: "ch_prevista", label: "Carga horária prevista", type: "text", required: true, role: "manual", group: "dados_turma" },
          { key: "data_inicio", label: "Data ou período de realização", type: "text", required: true, role: "manual", group: "dados_turma" },
          { key: "data_fim", label: "Data ou período de realização", type: "text", required: true, role: "manual", group: "dados_turma" },
          { key: "tematica_abordada", label: "TEMÁTICA ABORDADA", type: "textarea", required: true, role: "ia_sugerida", group: "conteudos" },
          { key: "conceitos_estruturantes_e_objetos_conhecimento", label: "CONCEITOS ESTRUTURANTES E OBJETOS DO CONHECIMENTO", type: "textarea", required: true, role: "ia_sugerida", group: "conteudos" },
          { key: "habilidades", label: "HABILIDADES", type: "textarea", required: true, role: "ia_sugerida", group: "habilidades" },
          { key: "objetivos_aprendizagem", label: "OBJETIVOS DE APRENDIZAGEM", type: "textarea", required: true, role: "ia_sugerida", group: "objetivos" },
          { key: "atividade_proposta_metodologia", label: "ATIVIDADE PROPOSTA/ METODOLOGIA", type: "textarea", required: true, role: "ia_sugerida", group: "conteudos" },
          { key: "avaliacao", label: "AVALIAÇÃO", type: "textarea", required: true, role: "ia_sugerida", group: "avaliacao" },
          { key: "recuperacao_paralela", label: "Recuperação paralela", type: "textarea", required: false, role: "manual", group: "outros" },
        ],
        nota: "Regra 10: 'Data ou período de realização: 13/07/2026 a 09/08/2026' → dois campos data_inicio + data_fim.",
      },
      {
        descricao: "Planejamento anual com 3 trimestres (EMIEP-2026). Regra 8: colunas repetidas → 1 campo. Regra 9: CONCEITOS/HABILIDADES/OBJETO têm célula vazia diretamente abaixo (adjacent_below) → 1 campo único por coluna. Marcadores 1º/2º/3º (period_column) → tr1/tr2/tr3. Regra 16: PROJETOS INTEGRADORES → adjacent_below.",
        campos: [
          { key: "professor_a", label: "PROFESSOR (A)", type: "text", required: true, role: "manual", group: "dados_turma" },
          { key: "nome_curso", label: "CURSO", type: "text", required: true, role: "manual", group: "dados_turma" },
          { key: "area_conhecimento", label: "Área(s) do Conhecimento", type: "text", required: true, role: "manual", group: "dados_turma" },
          { key: "turma", label: "Turma(s)", type: "text", required: true, role: "manual", group: "dados_turma" },
          { key: "componente_curricular", label: "Componente Curricular", type: "text", required: true, role: "manual", group: "dados_turma" },
          { key: "chpresencial", label: "Carga horária presencial", type: "text", required: false, role: "manual", group: "dados_turma" },
          { key: "chnpresencial", label: "Carga horária não presencial", type: "text", required: false, role: "manual", group: "dados_turma" },
          { key: "objetivo_geral_componente", label: "OBJETIVO GERAL DO COMPONENTE", type: "textarea", required: true, role: "ia_sugerida", group: "objetivos" },
          { key: "competencias_gerais_bncc", label: "COMPETÊNCIAS GERAIS BNCC", type: "textarea", required: true, role: "ia_sugerida", group: "competencias" },
          { key: "competencias_especificas_area", label: "COMPETÊNCIAS ESPECÍFICAS DA ÁREA", type: "textarea", required: true, role: "ia_sugerida", group: "competencias" },
          { key: "conceitos_estruturantes", label: "CONCEITOS ESTRUTURANTES DA ÁREA", type: "textarea", required: true, role: "ia_sugerida", group: "conteudos" },
          { key: "habilidades", label: "HABILIDADES", type: "textarea", required: true, role: "ia_sugerida", group: "habilidades" },
          { key: "objeto_conhecimento", label: "OBJETO DE CONHECIMENTO", type: "textarea", required: true, role: "ia_sugerida", group: "conteudos" },
          { key: "tr1", label: "1º Trimestre", type: "text", required: false, role: "manual", group: "dados_turma" },
          { key: "tr2", label: "2º Trimestre", type: "text", required: false, role: "manual", group: "dados_turma" },
          { key: "tr3", label: "3º Trimestre", type: "text", required: false, role: "manual", group: "dados_turma" },
          { key: "metodologia", label: "METODOLOGIA", type: "textarea", required: true, role: "ia_sugerida", group: "conteudos" },
          { key: "avaliacao", label: "AVALIAÇÃO", type: "textarea", required: true, role: "ia_sugerida", group: "avaliacao" },
          { key: "projeto_integrador", label: "PROJETOS INTEGRADORES", type: "textarea", required: false, role: "ia_sugerida", group: "outros", aiInstructions: "Seja específico ao contexto da turma, disciplina e período descritos no plano." },
          { key: "referencias_bibliograficas", label: "REFERÊNCIAS BIBLIOGRÁFICAS", type: "textarea", required: false, role: "manual", group: "outros" },
          { key: "data_atual", label: "Data de geração", type: "text", required: false, role: "manual", group: "dados_turma", defaultValue: "" },
        ],
        notas: [
          "Regra 8: PROFESSOR (A), Turma(s) etc. repetem em 9-10 colunas → 1 campo cada.",
          "Regra 9: CONCEITOS/HABILIDADES/OBJETO têm adjacent_below (célula vazia diretamente abaixo) → 1 campo único cada, NÃO _tr1/_tr2/_tr3.",
          "Regra 9: 1º/2º/3º são period_column → campos tr1/tr2/tr3 (marcação de trimestre).",
          "Regra 16: 'PROJETOS INTEGRADORES' (ALL CAPS, sem ':', linha vazia abaixo) → campo adjacent_below.",
          "Regra 17: rodapé com data (ex: 'Blumenau, DD/MM/AAAA') → campo data_atual auto-preenchido pelo sistema.",
        ],
      },
      {
        descricao: "Sequência Didática (SC) — template tabular com rótulo em célula A e variável em célula B adjacente. Padrões: Regra 1 (ancoragem célula-a-célula), Regra 14 (Nº → numero, (s) → remoção), Regra 15 (Obs: → ignorar).",
        regras: [
          "Regra 14A: 'Habilidade(s) selecionada(s)' → key 'habilidades_selecionadas' (remove (s) de ambas).",
          "Regra 14B: 'Nº de aulas' → key 'numero_de_aulas' (Nº → numero).",
          "Regra 15: rodapé 'Obs: a periodicidade da postagem...' → NENHUM campo gerado.",
          "Colunas paralelas 'Experiências de ensino e aprendizagem' | 'Recursos necessários' → dois campos independentes.",
          "Cabeçalho com logo GOVERNO DE SANTA CATARINA + 'SEQUÊNCIA DIDÁTICA' → Regra 13G, nenhum campo.",
        ],
        campos: [
          { key: "escola", label: "Escola", type: "text", required: true, role: "manual", group: "dados_turma", defaultValue: "" },
          { key: "docente", label: "Docente", type: "text", required: true, role: "manual", group: "dados_turma", defaultValue: "" },
          { key: "componente_curricular", label: "Componente Curricular", type: "text", required: true, role: "manual", group: "dados_turma", defaultValue: "" },
          { key: "turma", label: "Turma", type: "text", required: true, role: "manual", group: "dados_turma", defaultValue: "" },
          { key: "numero_de_aulas", label: "Nº de aulas", type: "text", required: true, role: "manual", group: "dados_turma", defaultValue: "" },
          { key: "data_inicio", label: "Período", type: "text", required: true, role: "manual", group: "dados_turma", defaultValue: "" },
          { key: "data_fim", label: "Período", type: "text", required: true, role: "manual", group: "dados_turma", defaultValue: "" },
          { key: "habilidades_selecionadas", label: "Habilidade(s) selecionada(s)", type: "textarea", required: true, role: "ia_sugerida", group: "habilidades", aiInstructions: "Selecione habilidades BNCC alinhadas ao componente curricular e ao período letivo." },
          { key: "experiencia_ensino_aprendizagem", label: "Experiências de ensino e aprendizagem", type: "textarea", required: true, role: "ia_sugerida", group: "conteudos", aiInstructions: "Elabore considerando os objetivos de aprendizagem e as habilidades definidas neste plano." },
          { key: "recursos", label: "Recursos necessários", type: "textarea", required: true, role: "ia_sugerida", group: "conteudos", aiInstructions: "Seja específico ao contexto da turma, disciplina e período descritos no plano." },
          { key: "adaptacoes_observacoes", label: "Adaptações e observações", type: "textarea", required: false, role: "manual", group: "outros", defaultValue: "" },
        ],
        nota: "O rodapé 'Obs: a periodicidade da postagem do plano de aula será de no máximo 30 dias...' é Regra 15 — NENHUM campo gerado a partir dele.",
      },
    ];

    const promptParts: string[] = [
      `<instrucao>`,
      draftSchema.length > 0
        ? [
            `MODO VALIDAÇÃO: O sistema gerou deterministicamente o <schema_rascunho> abaixo.`,
            `Sua tarefa é VALIDAR e COMPLETAR — não crie do zero:`,
            `  1. Para cada campo no rascunho: confirme key/group/role/type. Ajuste APENAS se o documento contradizer claramente.`,
            `  2. Copie o label EXATAMENTE como aparece no documento (não use o label do rascunho — ele é gerado automaticamente).`,
            `  3. Adicione campos que existem no documento mas não estão no rascunho.`,
            `  4. Remova campos do rascunho que não existem no documento.`,
            `  5. Aplique as Regras 8, 9 e 10 (colunas repetidas, períodos _tr1/_tr2/_tr3, datas _inicio/_fim).`,
            `  6. Preencha injection_pattern a partir de <estrutura_detectada> (Regra 18).`,
          ].join("\n")
        : `Analise o texto em <documento> e extraia TODOS os campos visíveis. CRÍTICO: o 'label' deve ser copiado EXATAMENTE como aparece. O 'key' é o label em snake_case sem acentos. Aplique as Regras 8, 9 e 10.`,
      `</instrucao>`,
      `<exemplos>`,
      JSON.stringify(fewShotExamples),
      `</exemplos>`,
    ];

    if (draftSchema.length > 0) {
      promptParts.push(
        `<schema_rascunho>`,
        JSON.stringify(draftSchema, null, 2),
        `</schema_rascunho>`,
      );
    }

    if (structuralPairs.length > 0) {
      promptParts.push(
        `<estrutura_detectada>`,
        JSON.stringify(structuralPairs, null, 2),
        `</estrutura_detectada>`,
      );
    }

    promptParts.push(`<documento>`, pdfText, `</documento>`);
    const promptStr = promptParts.join("\n");

    const { text: raw, provider: aiProvider } = await generateSchema(promptStr);

    let schema: unknown;
    try {
      schema = parseSchema(raw);
    } catch {
      return NextResponse.json({ error: "Resposta inválida do modelo ao gerar schema." }, { status: 502 });
    }

    if (!Array.isArray(schema)) {
      return NextResponse.json({ error: "Schema deve ser um array de campos." }, { status: 502 });
    }

    // Deterministic injection_pattern enrichment: match structural pairs to schema fields
    // by label and copy pattern where AI left injection_pattern null/undefined.
    if (structuralPairs.length > 0 && Array.isArray(schema)) {
      const normLabel = (s: string) =>
        s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
      for (const field of schema as import("../../../../lib/types/firestore").TemplateFieldSchema[]) {
        if (field.injection_pattern) continue;
        const fn = normLabel(field.label);
        const match = structuralPairs.find((p) => {
          const pn = normLabel(p.label);
          return pn === fn || (fn.length >= 3 && pn.endsWith(fn)) || (fn.length >= 4 && fn.includes(pn)) || (pn.length >= 4 && pn.includes(fn));
        });
        if (match) (field as unknown as Record<string, unknown>).injection_pattern = match.pattern;
      }
    }

    void import("../../../../lib/services/usage-logger").then(({ logUsage }) => {
      void logUsage({
        userId: user.uid,
        action: "introspect",
        model: MODEL_NAME,
        provider: aiProvider,
        tokensInput: 0,
        tokensOutput: 0,
        metadata: { template_id: templateId ?? undefined },
      });
    });

    await db.collection("magis_templates").doc(templateId).update({
      schema_campos: schema,
      fillable_status: "processando",
    });

    console.log("[PlanoMagistra] 2. Campos extraídos com sucesso", { templateId, totalCampos: (schema as unknown[]).length });

    // Generate fillable DOCX synchronously before responding so the editor
    // shows placeholders immediately when the user lands on the config page.
    try {
      const { downloadFile, uploadFile } = await import("../../../../lib/storage/blob");
      const { injectPlaceholders } = await import("../../../../lib/utils/docx-filler");
      const templateSnapFill = await db.collection("magis_templates").doc(templateId).get();
      const tData = templateSnapFill.data();
      const originalUrl = typeof tData?.arquivo_url === "string" ? tData.arquivo_url : null;
      const isDocx = originalUrl && /\.(docx|doc)(\?|$)/i.test(originalUrl);

      if (isDocx && originalUrl) {
        const rawBuffer = await downloadFile(originalUrl);
        const fillableBuffer = injectPlaceholders(
          rawBuffer,
          schema as import("../../../../lib/types/firestore").TemplateFieldSchema[],
        );
        const fillablePath = `templates/${templateId}/fillable.docx`;
        const fillableUrl = await uploadFile({
          path: fillablePath,
          buffer: fillableBuffer,
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
        await db.collection("magis_templates").doc(templateId).update({
          arquivo_fillable_url: fillableUrl,
          fillable_status: "pronto",
        });
      } else {
        await db.collection("magis_templates").doc(templateId).update({ fillable_status: "erro" });
      }
    } catch (e) {
      console.warn("[PlanoMagistra/introspect] Falha ao gerar DOCX preenchível:", e);
      await db.collection("magis_templates").doc(templateId).update({ fillable_status: "erro" }).catch(() => {});
    }

    return NextResponse.json({ ok: true, schema });
  } catch (error) {
    console.error("Erro na rota /api/templates/introspect:", error);
    const msg = (error as Error)?.message ?? "";
    const status = (error as { status?: number })?.status;
    if (status === 429 || msg.includes("429") || msg.includes("free_tier") || msg.includes("GROQ_API_KEY")) {
      return NextResponse.json({ error: "Cota da IA esgotada. Tente novamente mais tarde." }, { status: 429 });
    }
    return NextResponse.json({ error: "Falha ao gerar schema do template." }, { status: 500 });
  }
}
