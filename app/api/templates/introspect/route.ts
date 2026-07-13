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
import { inferirClasse, inferirOrigem } from "../../../../lib/utils/field-taxonomy";

// Use a dedicated model for introspection when configured (allows using a more
// capable model for extraction while keeping a faster model for suggestions).
const MODEL_NAME = process.env.GOOGLE_GEMINI_INTROSPECT_MODEL
  ?? process.env.GOOGLE_GEMINI_MODEL
  ?? "gemini-2.0-flash";

function extractDocxText(buffer: Buffer): string {
  const zip = new PizZip(buffer);
  const xmlFile = zip.files["word/document.xml"];
  if (!xmlFile) return "";
  const xml = xmlFile.asText();

  // Preserve table geometry so the AI understands which labels and values
  // belong to different cells in the same row (avoids label agglutination).
  // Strategy:
  //   • </w:tc>  → [CELL] — marks cell boundary within a row
  //   • </w:tr>  → [ROW]  — marks row boundary
  //   • </w:p>   → \n     — paragraph break (handles soft-return cells)
  //   • <w:br/>  → \n     — soft-return line break within a run
  const structured = xml
    .replace(/<\/w:tc>/g, " [CELL] ")
    .replace(/<\/w:tr>/g, " [ROW]\n")
    .replace(/<w:br(?:\s[^>]*)?\/?>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ");

  const lines = structured
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // Add column indices to each cell within a row so the AI knows C0 is almost
  // always a label in multi-column tables and C1+ are value/filler slots.
  // Format: "[C0]cell text [CELL] [C1]next cell [CELL] ... [ROW]"
  const numberedLines = lines.map((line) => {
    if (!line.includes("[ROW]")) return line;
    const withoutRow = line.replace(/\s*\[ROW\]\s*$/, "");
    const cells = withoutRow.split(/\s*\[CELL\]\s*/);
    return cells
      .map((cell, ci) => (cell.trim() ? `[C${ci}]${cell.trim()}` : `[C${ci}]`))
      .join(" [CELL] ")
      + " [ROW]";
  });

  return numberedLines.join("\n");
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

// ── Template type detection ──────────────────────────────────────────────────
// Deterministic vocabulary scan — no AI call needed. Each pattern scores 1 point.
// ≥3 → plano_educacional_individualizado (high confidence)
// 1–2 → plano_educacional_individualizado (tipo_incerto = true, UI will confirm)
// 0 → regente

const PEI_SIGNALS: RegExp[] = [
  /segundo\s+professor/i,
  /plano\s+educacional\s+individualizado/i,
  /\bPEI\b/,
  /habilidades\s+preditoras/i,
  /p[úu]blico[\s-]alvo\s+da\s+educa[çc][ãa]o\s+especial/i,
  /\bPAEE\b/,
  /adequa[çc][õo]es?\s+curriculares/i,
  /necessidades\s+educacionais\s+especiais/i,
  /\bNEE\b/,
  /\bCID[-\s]?10\b|\bCID[-\s]?[A-Z]\d{2}/i,
  /apoio\s+especializado/i,
  /adequa[çc][ãa]o\s+de\s+acessibilidade/i,
  /transtorno\s+do\s+espectro\s+autista|\bTEA\b/,
  /\blaudo\s+m[eé]dico\b/i,
  /defici[êe]ncia\s+(visual|auditiva|intelectual|f[íi]sica)/i,
];

function detectTemplateType(text: string): {
  template_type: import("../../../../lib/types/firestore").TemplateType;
  tipo_incerto: boolean;
} {
  const score = PEI_SIGNALS.filter((re) => re.test(text)).length;
  if (score === 0) return { template_type: "regente", tipo_incerto: false };
  return {
    template_type: "plano_educacional_individualizado",
    tipo_incerto: score < 3,
  };
}

// ── Response schema — restringe role, group, classe e type aos valores válidos
const INTROSPECT_RESPONSE_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  required: ["raciocinio", "campos"],
  properties: {
    raciocinio: { type: SchemaType.STRING },
    campos: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        required: ["key", "label", "type", "required", "role", "group", "classe"],
        properties: {
          key:               { type: SchemaType.STRING },
          label:             { type: SchemaType.STRING },
          type:              { type: SchemaType.STRING, format: "enum", enum: ["text", "textarea"] },
          required:          { type: SchemaType.BOOLEAN },
          role:              { type: SchemaType.STRING, format: "enum", enum: ["manual", "ia_sugerida"] },
          classe:            { type: SchemaType.STRING, format: "enum", enum: ["perfil", "pedagogico", "contextual"] },
          group:             { type: SchemaType.STRING, format: "enum", enum: ["dados_turma", "objetivos", "competencias", "habilidades", "conteudos", "avaliacao", "outros"] },
          defaultValue:      { type: SchemaType.STRING, nullable: true },
          aiInstructions:    { type: SchemaType.STRING, nullable: true },
          injection_pattern: { type: SchemaType.STRING, nullable: true, format: "enum", enum: ["adjacent_right", "adjacent_below", "inline_colon", "column_header", "period_column"] },
          ai_confidence:     { type: SchemaType.NUMBER, nullable: true },
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
2. Campos de identificação (professor, curso/área, turma, componente etc.) → role 'manual', group 'dados_turma', classe 'perfil'.
3. Campos pedagógicos (objetivos, competências, habilidades, BNCC, SAEB, conteúdos, avaliação, metodologia, recursos didáticos, recuperação paralela, adaptações/adequações/flexibilizações para educação especial, referências bibliográficas) → role 'ia_sugerida', classe 'pedagogico'.
3b. CLASSES DE CAMPO (campo obrigatório 'classe'):
   'perfil'     → dado de IDENTIDADE do professor/escola/turma preenchido uma única vez (professor, escola, turma, componente, cargo, município, e-mail, nº de aulas).
   'pedagogico' → conteúdo que a IA pode redigir/sugerir a cada plano (habilidades BNCC, SAEB, conteúdos, objetivos, metodologia, avaliação, competências, recursos utilizados, recuperação paralela, adaptações para educação especial, referências bibliográficas). Na dúvida entre perfil e pedagogico para um campo de CONTEÚDO redigível, prefira 'pedagogico' — o professor pode fixá-lo depois, mas o inverso esconde as sugestões da IA.
   'contextual' → calculado mecanicamente por período (data_atual, data_realizacao, mes_referencia, bimestre, ano_letivo, período).
   Regra de consistência: role 'ia_sugerida' implica classe 'pedagogico'. role 'manual' pode ser 'perfil' ou 'contextual' conforme o tipo de dado.
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
8. COLUNAS REPETIDAS: Quando o MESMO rótulo aparece em múltiplas COLUNAS DA MESMA LINHA (células espelhadas lateralmente), declare um ÚNICO campo. Exemplo: "Turma(s)" repetido em 9 colunas da mesma linha → um único campo {{turma}}.
   ATENÇÃO — NÃO confunda com campos em linhas diferentes: "HABILIDADES" (linha A) e "HABILIDADES CURRÍCULO DE EDUCAÇÃO DIGITAL" (linha B) são DOIS CAMPOS DISTINTOS mesmo que compartilhem palavras. Campos em linhas diferentes são sempre independentes. Do mesmo modo, "OBJETO DE CONHECIMENTO (COMPONENTE CURRICULAR)" e "OBJETO DE CONHECIMENTO (CURRÍCULO EDUCAÇÃO DIGITAL)" são campos SEPARADOS pois estão em linhas diferentes e têm qualificadores distintos entre parênteses.
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
13b. VARREDURA EXAUSTIVA (Regra 22 — OBRIGATÓRIA): O <schema_rascunho> é incompleto por definição. O scanner determinístico usa heurísticas de pontuação e formatação que omitem labels em Title Case, sem dois pontos ou com estrutura atípica. Após validar o rascunho, varra o <documento> integralmente — célula por célula, parágrafo por parágrafo — em busca de rótulos ausentes do rascunho. Critério de inclusão: qualquer texto curto (< 100 chars) em C0 seguido de célula/linha vazia adjacente é um campo candidato, mesmo sem ":" e mesmo em Title Case. Prefira falso positivo (campo a mais) a falso negativo (campo omitido).
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
19. MARCADORES DE GEOMETRIA DE TABELA: O texto do documento contém marcadores estruturais "[CELL]" (fim de célula) e "[ROW]" (fim de linha). "[Cn]" indica o índice da coluna (0-base) — [C0] é quase sempre rótulo em tabelas multi-coluna; [C1], [C2] etc. são quase sempre valores ou campos preenchíveis. Use-os para entender a geometria da tabela — não os inclua no label. Rótulos em células diferentes da mesma linha "[ROW]" são campos independentes.
20. ÍNDICE DE COLUNA (columnIdx em <estrutura_detectada>): Quando o par em <estrutura_detectada> contém "columnIdx", esse é o índice físico do rótulo na tabela. Pares com columnIdx=0 têm alta confiança de serem rótulos. Pares com columnIdx>0 podem ser colunas de dados repetidos — avalie a Regra 8 (colunas repetidas).
21. CONFIANÇA POR CAMPO (ai_confidence): Forneça um valor 0.0 a 1.0 para cada campo indicando certeza na extração:
   • 1.0 — rótulo com ":" explícito OU par validado em <estrutura_detectada> com padrão claro
   • 0.8 — rótulo em CAIXA ALTA inequívoco OU par em <estrutura_detectada> sem confirmação de valor
   • 0.6 — rótulo inferido por posição ou negrito, sem ":" confirmado
   • 0.4 — campo com rótulo ambíguo, múltiplos candidatos ou ausente em <estrutura_detectada>
   • 0.2 — estimativa pura sem par estrutural e sem rótulo explícito
   Campos role "manual" com rótulo ":" explícito → 0.9–1.0. Campos role "ia_sugerida" com base BNCC clara → 0.8.
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
8. Para cada campo extraído, atribua ai_confidence (Regra 21) refletindo a certeza da extração. Pares com match em <estrutura_detectada> → ≥ 0.8. Sem match → ≤ 0.5.
9. VARREDURA INDEPENDENTE (Regra 13b): após processar o <schema_rascunho>, percorra o <documento> linha a linha e célula a célula de forma independente do rascunho. Para cada linha [CX] texto curto | [CX+1] vazio que NÃO esteja coberta por nenhum campo já extraído, aplique o critério da Regra 13b e adicione o campo. Exemplos de labels que o scanner determinístico erra: "Metodologia aplicada" (Title Case, sem ":"), "Recursos didáticos" (sem bold), "Ano / Série" (sem formatação). Inclua todos.
</raciocinio_obrigatorio>
<contrato_de_saida>
Responda com JSON: { "raciocinio": string, "campos": [...TemplateFieldSchema] }
</contrato_de_saida>`;

// ── TOON (Token Object Notation) ─────────────────────────────────────────────
// Used as output format for fallback providers (OpenAI/Groq) that lack JSON
// schema enforcement. One field per line — impossible to malform with missing
// brackets or commas. The parser is whitelist-only: invalid enums fall back to
// safe defaults, partial lines are silently dropped.
//
// Wire format:
//   RACIOCINIO: <free text>
//   CAMPO key=<key> | label=<exact label> | type=<text|textarea> | required=<true|false> | role=<manual|ia_sugerida> | group=<group> | injection_pattern=<pattern|null> | aiInstructions=<text>
//
// aiInstructions MUST be the last segment — it may contain " | " internally.

const TOON_SYSTEM_SUFFIX = `
FORMATO DE SAÍDA — SUBSTITUI TODA INSTRUÇÃO JSON ANTERIOR:
Responda APENAS com linhas no formato TOON abaixo. ZERO JSON. ZERO markdown. ZERO texto fora das linhas RACIOCINIO e CAMPO.

RACIOCINIO: <seu raciocínio condensado em uma linha>
CAMPO key=<chave_snake_case> | label=<label exato do documento> | type=<text|textarea> | required=<true|false> | role=<manual|ia_sugerida> | classe=<perfil|pedagogico|contextual> | group=<dados_turma|objetivos|competencias|habilidades|conteudos|avaliacao|outros> | injection_pattern=<adjacent_right|adjacent_below|inline_colon|column_header|period_column|null> | ai_confidence=<0.0-1.0> | aiInstructions=<instrução curta ou vazio>

Regras do formato:
- Uma linha CAMPO por campo, sem exceções.
- O separador entre atributos é " | " (espaço-pipe-espaço).
- aiInstructions é sempre o ÚLTIMO atributo da linha (pode conter espaços e vírgulas).
- ai_confidence: número entre 0.0 e 1.0. Se não souber, use 0.6.
- classe: perfil (identidade professor/escola/turma — preenche 1x) | pedagogico (IA sugere: conteúdo redigível, incl. recursos, recuperação, adaptações, referências) | contextual (data/período, calculado).
- Nunca omita nenhum atributo. Se não souber o valor, use o default: required=true, injection_pattern=null, ai_confidence=0.6, aiInstructions=

Exemplo:
RACIOCINIO: 4 campos de identificação e 3 pedagógicos detectados.
CAMPO key=professor | label=Professor(a) | type=text | required=true | role=manual | classe=perfil | group=dados_turma | injection_pattern=inline_colon | ai_confidence=1.0 | aiInstructions=
CAMPO key=data_realizacao | label=Data | type=text | required=true | role=manual | classe=contextual | group=dados_turma | injection_pattern=inline_colon | ai_confidence=0.9 | aiInstructions=
CAMPO key=habilidades | label=HABILIDADES | type=textarea | required=true | role=ia_sugerida | classe=pedagogico | group=habilidades | injection_pattern=adjacent_below | ai_confidence=0.9 | aiInstructions=Selecione habilidades BNCC alinhadas ao componente curricular e ao período letivo.`;

const VALID_ROLES = new Set<string>(["manual", "ia_sugerida"]);
const VALID_CLASSES = new Set<string>(["perfil", "pedagogico", "contextual"]);
const VALID_GROUPS = new Set<string>(["dados_turma", "objetivos", "competencias", "habilidades", "conteudos", "avaliacao", "outros"]);
const VALID_TYPES = new Set<string>(["text", "textarea"]);
const VALID_PATTERNS = new Set<string>(["adjacent_right", "adjacent_below", "inline_colon", "column_header", "period_column"]);

function parseToonSchema(raw: string): import("../../../../lib/types/firestore").TemplateFieldSchema[] {
  const fields: import("../../../../lib/types/firestore").TemplateFieldSchema[] = [];

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("CAMPO ")) continue;

    const content = trimmed.slice(6); // strip "CAMPO "

    // Split on " | " only when followed by a known attribute name and "="
    // This prevents splitting inside aiInstructions values that contain " | ".
    const parts = content.split(/\s*\|\s*(?=[a-zA-Z_]+=)/);
    const pairs: Record<string, string> = {};
    for (const part of parts) {
      const eqIdx = part.indexOf("=");
      if (eqIdx === -1) continue;
      pairs[part.slice(0, eqIdx).trim()] = part.slice(eqIdx + 1).trim();
    }

    const key = pairs.key?.trim();
    const label = pairs.label?.trim();
    if (!key || !label) continue; // drop malformed lines

    const rawConfidence = parseFloat(pairs.ai_confidence ?? "");
    const role = VALID_ROLES.has(pairs.role) ? (pairs.role as "manual" | "ia_sugerida") : "manual";
    const classeRaw = pairs.classe;
    const classe = VALID_CLASSES.has(classeRaw ?? "")
      ? (classeRaw as import("../../../../lib/types/firestore").TemplateFieldClasse)
      : inferirClasse(key, role);
    fields.push({
      key,
      label,
      type: VALID_TYPES.has(pairs.type) ? (pairs.type as "text" | "textarea") : "text",
      required: pairs.required !== "false",
      role,
      classe,
      origem: inferirOrigem(role),
      group: VALID_GROUPS.has(pairs.group)
        ? (pairs.group as import("../../../../lib/types/firestore").TemplateFieldSchema["group"])
        : "outros",
      injection_pattern: VALID_PATTERNS.has(pairs.injection_pattern ?? "")
        ? (pairs.injection_pattern as import("../../../../lib/types/firestore").InjectionPattern)
        : undefined,
      ai_confidence: !isNaN(rawConfidence) ? Math.min(1, Math.max(0, rawConfidence)) : undefined,
      aiInstructions: pairs.aiInstructions ?? "",
      defaultValue: pairs.defaultValue ?? "",
    });
  }

  return fields;
}

// ── Structural validation (both formats) ────────────────────────────────────
// Sanity-check parsed fields before writing to Firestore. Guards against
// hallucinated schemas, empty responses, and provider-specific quirks.

function validateParsedSchema(
  fields: import("../../../../lib/types/firestore").TemplateFieldSchema[],
): { valid: boolean; reason?: string } {
  if (!Array.isArray(fields) || fields.length === 0)
    return { valid: false, reason: "schema vazio" };

  const keys = new Set<string>();
  for (const f of fields) {
    if (typeof f.key !== "string" || !/^[a-z][a-z0-9_]*$/.test(f.key))
      return { valid: false, reason: `key inválido: "${f.key}"` };
    if (typeof f.label !== "string" || f.label.trim().length === 0)
      return { valid: false, reason: `label vazio para key "${f.key}"` };
    if (typeof f.role !== "string" || !VALID_ROLES.has(f.role))
      return { valid: false, reason: `role inválido "${f.role}" em "${f.key}"` };
    if (typeof f.group !== "string" || !VALID_GROUPS.has(f.group))
      return { valid: false, reason: `group inválido "${f.group}" em "${f.key}"` };
    if (keys.has(f.key))
      return { valid: false, reason: `key duplicado: "${f.key}"` };
    keys.add(f.key);
  }
  return { valid: true };
}

async function generateSchema(promptStr: string): Promise<import("../../../../lib/ai/provider").AiResult> {
  return callAIWithFallbacks({
    systemInstruction: SYSTEM_INSTRUCTION,
    prompt: promptStr,
    temperature: 0.1,
    topP: 0.6,
    geminiSchema: INTROSPECT_RESPONSE_SCHEMA,
    systemSuffixFallback: TOON_SYSTEM_SUFFIX,
  });
}

function parseSchema(
  raw: string,
  format: "json" | "toon",
): import("../../../../lib/types/firestore").TemplateFieldSchema[] {
  if (format === "toon") {
    const fields = parseToonSchema(raw);
    const check = validateParsedSchema(fields);
    if (!check.valid) throw new Error(`invalid_toon_schema: ${check.reason}`);
    return coerceRoleFromClasse(fields);
  }

  // JSON path (Gemini)
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
  if (!Array.isArray(schema)) throw new Error("invalid_schema: not an array");

  const raw_fields = schema as import("../../../../lib/types/firestore").TemplateFieldSchema[];
  const check = validateParsedSchema(raw_fields);
  if (!check.valid) throw new Error(`invalid_json_schema: ${check.reason}`);
  // Backfill classe/origem for any field the model didn't classify
  return coerceRoleFromClasse(raw_fields.map((f) => ({
    ...f,
    classe: VALID_CLASSES.has(f.classe ?? "") ? f.classe : inferirClasse(f.key, f.role),
    origem: inferirOrigem(f.role),
  })));
}

/**
 * O modelo pode emitir role e classe CONTRADITÓRIOS (role=manual +
 * classe=pedagogico) — o prompt só força consistência numa direção. Como a
 * classe é a taxonomia canônica (role está deprecado), o role gravado no
 * Firestore é derivado dela: campo pedagogico sai ia_sugerida, o resto manual.
 * Sem isso, o badge da UI (classe) e o comportamento na geração (role) divergem.
 */
function coerceRoleFromClasse(
  fields: import("../../../../lib/types/firestore").TemplateFieldSchema[],
): import("../../../../lib/types/firestore").TemplateFieldSchema[] {
  return fields.map((f) => {
    if (!f.classe) return f;
    const expectedRole = f.classe === "pedagogico" ? "ia_sugerida" as const : "manual" as const;
    if (f.role === expectedRole) return f;
    console.info(`[introspect] Coerção role: key=${f.key} classe=${f.classe} role ${f.role ?? "(vazio)"}→${expectedRole}`);
    return { ...f, role: expectedRole, origem: inferirOrigem(expectedRole) };
  });
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

    // .doc legado é binário OLE — o PizZip lança e viraria 500 genérico.
    // Rejeitar com instrução clara antes de qualquer processamento.
    if (/\.doc$/i.test(file.name)) {
      return NextResponse.json(
        { error: "Arquivos .doc (Word 97-2003) não são suportados. Abra o arquivo no Word e salve como .docx." },
        { status: 400 },
      );
    }

    // Read the file buffer once and reuse for text extraction + structural scan
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const pdfText = await extractFileText(new File([fileBuffer], file.name, { type: file.type }));

    // Rule 1 + 5: structural pre-scan — parse DOCX XML for label→value pairs.
    // Includes non-table paragraphs (Rule 1) and implicitly excludes header/footer
    // XML files since scanDocxStructure only reads word/document.xml (Rule 5).
    const isDocxFile = /\.(docx|doc)(\?|$)/i.test(file.name);
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    const allStructuralPairs = isDocxFile ? (() => {
      try { return scanDocxStructure(fileBuffer); } catch { return []; }
    })() : [];
    // Pares cujo valor já é um email completo são conteúdo estático — não criar campo.
    const structuralPairs = allStructuralPairs.filter(
      (p) => !EMAIL_RE.test(p.valuePreview.trim()),
    );
    console.info(`[introspect] Estrutura detectada: ${allStructuralPairs.length} pares (${allStructuralPairs.length - structuralPairs.length} email(s) estáticos excluídos)`);

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
            `  3. Adicione campos que existem no documento mas não estão no rascunho. IMPORTANTE: campo com label diferente mas parecido = campo NOVO — não descarte.`,
            `  4. Remova campos do rascunho que não existem no documento.`,
            `  5. Aplique as Regras 8, 9 e 10 (colunas repetidas, períodos _tr1/_tr2/_tr3, datas _inicio/_fim). Regra 8 NÃO se aplica a campos em linhas diferentes.`,
            `  6. Preencha injection_pattern a partir de <estrutura_detectada> (Regra 18).`,
            `  7. Chaves auto-geradas longas ou truncadas (ex: "habilidades_curriculo_de_educacao_digi") devem ser renomeadas para uma versão concisa e legível seguindo as Regras 5 e 14 (ex: "habilidades_curriculo_educacao_digital").`,
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

    // Neutraliza tentativa de fechar o delimitador dentro do texto do arquivo
    // (prompt injection). Templates legítimos nunca contêm essa tag; outros
    // usos de <> em labels são preservados intactos.
    promptParts.push(`<documento>`, pdfText.replace(/<\/?\s*documento\s*>/gi, "‹documento›"), `</documento>`);
    const promptStr = promptParts.join("\n");

    // Detect template type before the AI call (deterministic, free)
    const { template_type, tipo_incerto } = detectTemplateType(pdfText);
    console.info(`[introspect] template_type="${template_type}" tipo_incerto=${tipo_incerto}`);

    const { text: raw, provider: aiProvider, format: aiFormat, usage: aiUsage } = await generateSchema(promptStr);

    let schema: import("../../../../lib/types/firestore").TemplateFieldSchema[];
    try {
      schema = parseSchema(raw, aiFormat);
    } catch (parseErr) {
      console.error("[introspect] parseSchema falhou:", (parseErr as Error).message, { provider: aiProvider, format: aiFormat });
      return NextResponse.json({ error: "Resposta inválida do modelo ao gerar schema." }, { status: 502 });
    }

    // Deterministic injection_pattern enrichment + confidence cross-validation.
    // For each schema field: (a) fill missing injection_pattern from structural pairs,
    // (b) flag fields with no structural backing as low-confidence.
    const normLabel = (s: string) =>
      s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

    const camposBaixaConfianca: string[] = [];
    if (structuralPairs.length > 0) {
      const pairNorms = structuralPairs.map((p) => normLabel(p.label));
      for (const field of schema) {
        const fn = normLabel(field.label);
        const matchPair = structuralPairs.find((p) => {
          const pn = normLabel(p.label);
          return pn === fn || (fn.length >= 3 && pn.endsWith(fn)) || (fn.length >= 4 && fn.includes(pn)) || (pn.length >= 4 && pn.includes(fn));
        });
        // Enrich injection_pattern if AI left it empty
        if (!field.injection_pattern && matchPair) {
          field.injection_pattern = matchPair.pattern as import("../../../../lib/types/firestore").TemplateFieldSchema["injection_pattern"];
        }
        // Flag fields with no structural backing — AI may have inferred from context alone
        const hasStructuralBacking = pairNorms.some((pn) => pn.includes(fn) || fn.includes(pn));
        if (!hasStructuralBacking) camposBaixaConfianca.push(field.key);
        // Downgrade confidence for fields with no structural pair
        if (!hasStructuralBacking && field.ai_confidence !== undefined && field.ai_confidence > 0.5) {
          field.ai_confidence = Math.min(field.ai_confidence, 0.5);
        }
      }
    }
    console.info(`[introspect] Campos baixa confiança: ${camposBaixaConfianca.length > 0 ? camposBaixaConfianca.join(", ") : "nenhum"}`);

    // Nome do professor é dado fixo por definição: se o perfil tem nome real,
    // o campo professor do template já nasce com Valor padrão preenchido —
    // aparece na config do template e pré-preenche o balão da geração.
    // Só por prefixo de key (professor/docente/nome_prof): label contendo
    // "professor" pega falso positivo ("ADAPTAÇÕES ... DO PROFESSOR REGENTE").
    const nomeProfessor = (user.nome ?? "").trim();
    if (nomeProfessor && !nomeProfessor.includes("@")) {
      for (const field of schema) {
        if (!field.defaultValue && field.role !== "ia_sugerida" && /^(professor|docente|nome_prof)/.test(field.key)) {
          field.defaultValue = nomeProfessor;
        }
      }
    }

    void import("../../../../lib/services/usage-logger").then(({ logUsage }) => {
      void logUsage({
        userId: user.uid,
        action: "introspect",
        model: MODEL_NAME,
        provider: aiProvider,
        tokensInput: aiUsage?.inputTokens ?? 0,
        tokensOutput: aiUsage?.outputTokens ?? 0,
        metadata: { template_id: templateId ?? undefined },
      });
    });

    // Strip undefined values — Firestore Admin rejeita undefined em campos opcionais do schema
    const schemaSanitized = JSON.parse(JSON.stringify(schema)) as typeof schema;
    await db.collection("magis_templates").doc(templateId).update({
      schema_campos: schemaSanitized,
      fillable_status: "processando",
      campos_baixa_confianca: camposBaixaConfianca,
      template_type,
      tipo_incerto,
    });

    console.log("[PlanoMagistra] 2. Campos extraídos com sucesso", { templateId, totalCampos: schema.length, provider: aiProvider, format: aiFormat });

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
        const fillableBuffer = injectPlaceholders(rawBuffer, schema);
        // Unique timestamped path so each introspection gets a fresh URL — no CDN staleness.
        const oldFillableUrl = typeof tData?.arquivo_fillable_url === "string" ? tData.arquivo_fillable_url : "";
        const fillablePath = `templates/${templateId}/fillable_${Date.now()}.docx`;
        const fillableUrl = await uploadFile({
          path: fillablePath,
          buffer: fillableBuffer,
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
        if (oldFillableUrl && oldFillableUrl !== fillableUrl) {
          const { deleteFile } = await import("../../../../lib/storage/blob");
          void deleteFile(oldFillableUrl).catch(() => {});
        }
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

    return NextResponse.json({ ok: true, schema, campos_baixa_confianca: camposBaixaConfianca, template_type, tipo_incerto });
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
