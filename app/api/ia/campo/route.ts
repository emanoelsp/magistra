import "server-only";

import { NextResponse } from "next/server";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { ResponseSchema } from "@google/generative-ai";

import { createHash } from "crypto";

import { getAdminDb } from "../../../../lib/firebase/admin";
import { requireCurrentUserProfile } from "../../../../lib/auth/session";
import { checkRateLimit } from "../../../../lib/services/rate-limit.server";
import { validateSugestoes } from "../../../../lib/services/suggestion-validator";
import { getPedagogicMemoryContext } from "../../../../lib/services/pedagogic-memory.server";
import { retrieveAllCurriculumContext } from "../../../../lib/services/bncc-rag.server";
import {
  buildCacheKey,
  getCachedSuggestions,
  setCachedSuggestions,
} from "../../../../lib/services/suggestions-cache.server";
import type { IaSugestao, TemplateRecord } from "../../../../lib/types/firestore";

function sanitizeForPrompt(value: string): string {
  return value.replace(/<\/?[^>]+>/g, "").replace(/[{}]/g, "").trim();
}

function computeSchemaHash(schemaCampos: unknown[]): string {
  const normalized = JSON.stringify(
    [...schemaCampos].sort((a, b) =>
      ((a as { key?: string }).key ?? "").localeCompare((b as { key?: string }).key ?? "")
    )
  );
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

const MODEL_NAME = process.env.GOOGLE_GEMINI_MODEL ?? "gemini-2.0-flash";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

// ── Response schema — garante conformidade estrutural no nível do sampler ──
const SUGESTAO_RESPONSE_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  required: ["raciocinio", "sugestoes"],
  properties: {
    raciocinio: { type: SchemaType.STRING },
    sugestoes: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        required: ["id", "label", "descricao", "fonte"],
        properties: {
          id:        { type: SchemaType.STRING },
          label:     { type: SchemaType.STRING },
          descricao: { type: SchemaType.STRING },
          fonte:     { type: SchemaType.STRING },
        },
      },
    },
  },
};

// ── Few-shot examples por group ────────────────────────────────────────────
const FEW_SHOT_EXAMPLES: Record<string, string> = {
  objetivos: `Entrada:
<campo><nome>Objetivos de aprendizagem</nome><categoria>objetivos</categoria></campo>
<contexto><turma>disciplina: Matemática | ano: 5º ano EF | escola: EEEF João Paulo II</turma></contexto>
Saída:
{"raciocinio":"Campo de objetivos para Matemática no 5º ano. Selecionei verbos de ação no infinitivo, mensuráveis, conectados às habilidades EF05MA.","sugestoes":[{"id":"s1","label":"Identificar frações equivalentes e comparar frações com denominadores diferentes usando representações visuais","descricao":"Desenvolve o pensamento proporcional, base para álgebra no EF2, alinhado a EF05MA06.","fonte":"BNCC EF05MA06"},{"id":"s2","label":"Resolver situações-problema de divisão com resto interpretando o resultado no contexto","descricao":"Consolida a divisão com significado prático, alinhado ao EF05MA07 e às matrizes SAEB do 5º ano.","fonte":"BNCC EF05MA07 | SAEB"},{"id":"s3","label":"Calcular a área de figuras planas por composição e decomposição em quadradinhos","descricao":"Introduz área de forma concreta antes da fórmula, favorecendo compreensão geométrica prevista em EF05MA18.","fonte":"BNCC EF05MA18"}]}`,

  habilidades: `Entrada:
<campo><nome>Habilidades BNCC</nome><categoria>habilidades</categoria></campo>
<contexto><turma>disciplina: Matemática | ano: 9º ano EF | escola: CEDUP/SC</turma></contexto>
<habilidades_bncc>
EF09MA06: Resolver e elaborar problemas envolvendo conjuntos numéricos.
EF09MA11: Resolver problemas usando o teorema de Pitágoras.
EF09MA16: Determinar o conjunto de resultados de um experimento aleatório.
</habilidades_bncc>
Saída:
{"raciocinio":"Tenho 3 códigos BNCC disponíveis para Matemática no 9º ano. Usarei EXCLUSIVAMENTE esses códigos no formato 'CÓDIGO — descrição parafraseada', sem inventar outros.","sugestoes":[{"id":"s1","label":"EF09MA06 — Resolver problemas com os quatro conjuntos numéricos usando diferentes estratégias de cálculo","descricao":"Integra N, Z, Q e I em situações-problema variadas, consolidando o campo numérico antes do EM.","fonte":"BNCC EF09MA06"},{"id":"s2","label":"EF09MA11 — Aplicar o teorema de Pitágoras para calcular distâncias em situações reais e geométricas","descricao":"Conecta geometria à realidade do aluno e reforça raciocínio espacial cobrado no SAEB.","fonte":"BNCC EF09MA11 | SAEB"},{"id":"s3","label":"EF09MA16 — Identificar e calcular a probabilidade de eventos em experimentos aleatórios simples","descricao":"Introduz raciocínio probabilístico com espaço amostral finito, preparando para estatística no EM.","fonte":"BNCC EF09MA16"}]}`,

  avaliacao: `Entrada:
<campo><nome>Avaliação</nome><categoria>avaliacao</categoria></campo>
<contexto><turma>disciplina: Ciências | ano: 7º ano EF | escola: Colégio Estadual</turma></contexto>
Saída:
{"raciocinio":"Campo de avaliação para Ciências no 7º ano. Equilibro instrumentos formativos e somativos, variando o formato e tornando os critérios explícitos.","sugestoes":[{"id":"s1","label":"Observação do engajamento e registro no caderno de ciências durante atividade experimental","descricao":"Avalia o processo investigativo em tempo real, permitindo intervenção imediata pelo professor.","fonte":"Avaliação formativa"},{"id":"s2","label":"Produção de mapa conceitual individual conectando os termos trabalhados na unidade","descricao":"Evidencia organização do conhecimento e avalia compreensão relacional, não apenas memorização.","fonte":"Avaliação somativa"},{"id":"s3","label":"Questão de interpretação de gráfico ou tabela com dados científicos reais (modelo SAEB)","descricao":"Prepara para avaliações externas e avalia letramento científico na leitura de dados.","fonte":"SAEB | Avaliação somativa"}]}`,

  conteudos: `Entrada:
<campo><nome>Conteúdos programáticos</nome><categoria>conteudos</categoria></campo>
<contexto><turma>disciplina: Língua Portuguesa | ano: 1º ano EM | escola: EEM Prof. José Ribeiro</turma></contexto>
Saída:
{"raciocinio":"Campo de conteúdos para Língua Portuguesa no 1º ano do EM. Organizo do mais básico ao mais complexo, alinhado ao currículo do EM.","sugestoes":[{"id":"s1","label":"Gêneros textuais argumentativos: artigo de opinião — estrutura, tese e argumentos","descricao":"Introduz escrita argumentativa formal do EM, diferenciando fato de opinião por marcas linguísticas.","fonte":"BNCC EM13LP04"},{"id":"s2","label":"Variedades linguísticas: norma culta, registros formais e informais em diferentes contextos","descricao":"Amplia repertório comunicativo sem desvalorizar a variedade materna do aluno, alinhado ao CTBC.","fonte":"BNCC EM13LP01 | CTBC"},{"id":"s3","label":"Leitura crítica de textos multimodais: charge, infográfico e artigo — identificação de ponto de vista","descricao":"Desenvolve letramento visual e verbal, alinhado ao perfil leitor exigido pelo ENEM e SAEB.","fonte":"BNCC EM13LP03 | SAEB"}]}`,

  competencias: `Entrada:
<campo><nome>Competências gerais</nome><categoria>competencias</categoria></campo>
<contexto><turma>disciplina: História | ano: 8º ano EF | escola: EMEF Rui Barbosa</turma></contexto>
Saída:
{"raciocinio":"Campo de competências para História no 8º ano. Sugiro competências BNCC parafraseadas — nunca cópia literal — aplicadas ao contexto específico da disciplina e ano.","sugestoes":[{"id":"s1","label":"Analisar criticamente fontes históricas diversas, identificando contexto, autoria e intencionalidade","descricao":"Manifesta pensamento científico aplicado à história, desenvolvendo leitura crítica de documentos primários e secundários.","fonte":"Competência Geral BNCC Nº2"},{"id":"s2","label":"Relacionar processos históricos do século XIX às estruturas sociais brasileiras contemporâneas","descricao":"Desenvolve consciência histórica conectando passado e presente, central para o currículo do 8º ano.","fonte":"Competência Específica História EF"},{"id":"s3","label":"Argumentar sobre questões históricas usando evidências e respeitando perspectivas diferentes","descricao":"Exercita comunicação fundamentada em evidências, essencial para produção textual em história.","fonte":"Competência Geral BNCC Nº7"}]}`,

  outros: `Entrada:
<campo><nome>Metodologia</nome><categoria>outros</categoria></campo>
<contexto><turma>disciplina: Geografia | ano: 6º ano EF | escola: EMEF Santos Dumont</turma></contexto>
Saída:
{"raciocinio":"Campo de metodologia (outros) para Geografia no 6º ano. Sugiro abordagens práticas e específicas para esta faixa etária e disciplina.","sugestoes":[{"id":"s1","label":"Leitura e interpretação de mapas temáticos com roteiro guiado de análise em duplas","descricao":"Desenvolve raciocínio geográfico de forma colaborativa, central para o 6º ano que inicia cartografia.","fonte":"Objetivo pedagógico"},{"id":"s2","label":"Produção de maquete do relevo local com material reciclável e apresentação oral para a turma","descricao":"Ativa aprendizagem tridimensional e comunicação, tornando o conteúdo de relevo concreto e significativo.","fonte":"Objetivo pedagógico"},{"id":"s3","label":"Estudo do meio: observação do bairro com ficha de campo e registro fotográfico","descricao":"Conecta conceitos de espaço geográfico à realidade próxima do aluno, metodologia prevista pela BNCC.","fonte":"BNCC EF06GE04"}]}`,
};

function isQuotaError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  const msg = (err as Error)?.message ?? "";
  return status === 429 && (msg.includes("free_tier") || msg.includes("limit: 0") || msg.includes("PerDay"));
}

function isRetryable(err: unknown): boolean {
  if (isQuotaError(err)) return false;
  const status = (err as { status?: number })?.status;
  const msg = (err as Error)?.message ?? "";
  return (
    status === 503 ||
    status === 429 ||
    msg.includes("503") ||
    msg.includes("429") ||
    msg.includes("high demand") ||
    msg.includes("RECITATION")
  );
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || attempt === MAX_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
    }
  }
  throw lastError;
}

function makeGeminiModel(systemInstruction: string) {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GEMINI_API_KEY não configurada.");
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: {
      temperature: 0.35,
      topP: 0.8,
      topK: 40,
      responseMimeType: "application/json",
      responseSchema: SUGESTAO_RESPONSE_SCHEMA,
    },
    systemInstruction,
  });
}

async function generateWithGemini(systemInstruction: string, prompt: string): Promise<string> {
  const model = makeGeminiModel(systemInstruction);
  const response = await withRetry(() => model.generateContent(prompt));
  return response.response.text();
}

async function generateWithGroq(systemInstruction: string, prompt: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY não configurada.");
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.35,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Groq error ${res.status}: ${body}`);
  }
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0].message.content;
}

async function generateSuggestions(systemInstruction: string, prompt: string): Promise<string> {
  try {
    return await generateWithGemini(systemInstruction, prompt);
  } catch (err) {
    if (isQuotaError(err)) {
      console.warn("[PlanoMagistra/ia/campo] Gemini quota esgotada, usando Groq como fallback...");
      return await generateWithGroq(systemInstruction, prompt);
    }
    throw err;
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUserProfile();

    // Rate limit: per user/hour based on plan
    const rl = await checkRateLimit(user.uid, user.plano ?? "free", "ia_campo");
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Limite de sugestões atingido. Tente novamente após ${new Date(rl.resetAt).toLocaleTimeString("pt-BR")}.` },
        {
          status: 429,
          headers: { "X-RateLimit-Reset": rl.resetAt, "X-RateLimit-Remaining": "0" },
        },
      );
    }

    const body = (await request.json()) as {
      templateId?: string;
      fieldKey?: string;
      fieldLabel?: string;
      fieldGroup?: string;
      metadata?: Record<string, string>;
      extraContext?: string;
      bypassCache?: boolean;
      stream?: boolean;
    };

    const {
      templateId,
      fieldKey,
      fieldLabel: fieldLabelRaw,
      fieldGroup,
      metadata = {},
      extraContext: extraContextRaw,
      bypassCache = false,
      stream = false,
    } = body;

    // Sanitize user-controlled values before prompt interpolation
    const fieldLabel = sanitizeForPrompt(fieldLabelRaw ?? "");
    const extraContext = extraContextRaw ? sanitizeForPrompt(extraContextRaw) : undefined;
    const sanitizedMetadata = Object.fromEntries(
      Object.entries(metadata).map(([k, v]) => [sanitizeForPrompt(k), sanitizeForPrompt(v)])
    );

    if (!templateId || !fieldKey || !fieldLabel) {
      return NextResponse.json(
        { error: "templateId, fieldKey e fieldLabel são obrigatórios." },
        { status: 400 },
      );
    }

    const db = getAdminDb();
    const snap = await db.collection("magis_templates").doc(templateId).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
    }

    const template = snap.data() as TemplateRecord;

    // Verify template ownership
    if (template.user_id !== user.uid) {
      return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
    }

    const schemaHash = Array.isArray(template.schema_campos)
      ? computeSchemaHash(template.schema_campos)
      : undefined;

    // Find field-level aiInstructions from schema
    const fieldSchema = Array.isArray(template.schema_campos)
      ? template.schema_campos.find((f) => f.key === fieldKey)
      : undefined;
    const fieldAiInstructions = fieldSchema?.aiInstructions?.trim() ?? "";

    const metaLines = Object.entries(sanitizedMetadata)
      .filter(([, v]) => v.trim())
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`);

    const escolaFallback = template.escola_nome ?? "";
    if (escolaFallback && !metaLines.some((l) => l.startsWith("escola"))) {
      metaLines.unshift(`escola: ${escolaFallback}`);
    }

    const contexto = metaLines.join(" | ") || "Sem contexto fornecido";

    const labelLower = fieldLabel.toLowerCase();
    const keyLower = fieldKey.toLowerCase();

    const is2profField =
      labelLower.includes("2°") ||
      labelLower.includes("segundo prof") ||
      labelLower.includes("2prof") ||
      labelLower.includes("apoio") ||
      labelLower.includes("inclusão") ||
      labelLower.includes("inclusao") ||
      labelLower.includes("nee") ||
      labelLower.includes("aee") ||
      keyLower.includes("2prof") ||
      keyLower.includes("apoio") ||
      keyLower.includes("inclusao") ||
      keyLower.includes("nee");

    const isBibliografiaField =
      labelLower.includes("referência") ||
      labelLower.includes("referencia") ||
      labelLower.includes("bibliograf") ||
      labelLower.includes("bibliografia") ||
      labelLower.includes("livro") ||
      keyLower.includes("referencia") ||
      keyLower.includes("bibliograf") ||
      keyLower.includes("livro");

    // ── Instrução específica por tipo/grupo de campo ─────────────────────────
    const instrucaoEspecifica = is2profField
      ? `O campo "${fieldLabel}" refere-se ao 2° professor / professor de apoio para educação inclusiva (NEE/AEE). ` +
        "label = estratégia ou ação específica (ex: 'Coensino paralelo para aluno com TEA — professor regente e de apoio atuam juntos na mesma atividade'); " +
        "descricao = como implementar na prática com a turma descrita no contexto; " +
        "fonte = 'AEE', 'Política de Educação Especial' ou 'Coensino'. " +
        "Sugira: estratégias de coensino, adaptações curriculares, ações do AEE, tecnologia assistiva. Não invente laudos ou diagnósticos."

      : isBibliografiaField
        ? `O campo "${fieldLabel}" é de Referências Bibliográficas. ` +
          "Sugira 3 a 5 livros didáticos ou obras acadêmicas REAIS, relevantes para a disciplina e nível informados. " +
          "label = referência completa no padrão ABNT NBR 6023 para livro: SOBRENOME, Nome. Título: subtítulo. Ed. Cidade: Editora, Ano. " +
          "Exemplo: SILBERSCHATZ, Abraham; KORTH, Henry F.; SUDARSHAN, S. Sistema de Banco de Dados. 7. ed. Rio de Janeiro: GEN LTC, 2020. " +
          "descricao = frase curta sobre por que o livro é relevante para esta disciplina e turma; " +
          "fonte = 'Referência ABNT'. " +
          "REGRAS: apenas livros que você conhece com certeza que existem; não invente títulos, autores ou editoras; prefira edições a partir de 2015."

      : fieldGroup === "objetivos"
        ? `O campo "${fieldLabel}" é de OBJETIVOS DE APRENDIZAGEM. ` +
          "Gere objetivos pedagógicos específicos e mensuráveis para a turma e disciplina descritas. " +
          "label = objetivo completo iniciando com verbo de ação no infinitivo (Identificar, Analisar, Resolver, Produzir, Comparar, Aplicar, Criar, Explicar); máx. 1 frase; " +
          "descricao = como este objetivo se conecta às habilidades BNCC e ao cotidiano do aluno; " +
          "fonte = 'BNCC [código]' ou 'Objetivo pedagógico'."

      : fieldGroup === "competencias"
        ? `O campo "${fieldLabel}" é de COMPETÊNCIAS. ` +
          "Sugira competências gerais da BNCC ou competências específicas do componente curricular, sempre parafraseadas. " +
          "label = texto da competência parafraseado de forma objetiva e aplicada à disciplina (nunca cópia literal); " +
          "descricao = como essa competência se manifesta nas atividades e no cotidiano dos alunos desta turma; " +
          "fonte = 'Competência Geral BNCC N°X' ou 'Competência Específica [componente curricular]'."

      : fieldGroup === "habilidades"
        ? `O campo "${fieldLabel}" é de HABILIDADES BNCC. ` +
          "Use EXCLUSIVAMENTE os códigos listados em habilidadesBNCC (se disponíveis). " +
          "label = 'CÓDIGO — descrição parafraseada em linguagem simples e direta' (ex: 'EF09MA06 — Resolver situações-problema envolvendo conjuntos numéricos'); " +
          "descricao = como desenvolver esta habilidade com a turma, incluindo conexão com SAEB quando pertinente; " +
          "fonte = 'BNCC [código]'."

      : fieldGroup === "conteudos"
        ? `O campo "${fieldLabel}" é de CONTEÚDOS PROGRAMÁTICOS. ` +
          "Sugira tópicos específicos do componente curricular adequados ao ano/série informados, do mais básico ao mais complexo. " +
          "label = nome do tópico de conteúdo (conciso, ex: 'Equações do 2° grau — discriminante e fórmula de Bhaskara'); " +
          "descricao = o que será trabalhado, como se conecta ao cotidiano e à vida do aluno, e link com CTBC quando aplicável; " +
          "fonte = 'Currículo [componente]' ou 'CTBC'."

      : fieldGroup === "avaliacao"
        ? `O campo "${fieldLabel}" é de AVALIAÇÃO. ` +
          "Sugira instrumentos e critérios avaliativos variados, equilibrando avaliação formativa e somativa. " +
          "label = instrumento ou critério específico (ex: 'Resolução de problema em dupla com registro do raciocínio'); " +
          "descricao = como aplicar o instrumento, o que observar e o que evidencia a aprendizagem; " +
          "fonte = 'Avaliação formativa', 'Avaliação somativa' ou 'SAEB [descritor]'."

      : `O campo a ser preenchido no plano de aula é: "${fieldLabel}" ` +
        `(categoria: ${fieldGroup ?? "outros"}). ` +
        "Gere sugestões específicas, contextualizadas com a turma e a disciplina fornecidas. " +
        "label = conteúdo pronto para inserção neste campo (conciso e direto); " +
        "descricao = justificativa pedagógica — por que essa sugestão é adequada ao contexto; " +
        "fonte = referência curricular ou pedagógica pertinente (BNCC, SAEB, CTBC ou outra).";

    // ── System instruction — persona + contrato de saída ─────────────────────
    const exampleKey = is2profField || isBibliografiaField ? "outros" : (fieldGroup ?? "outros");
    const fewShotExample = FEW_SHOT_EXAMPLES[exampleKey] ?? FEW_SHOT_EXAMPLES["outros"]!;

    const systemInstruction = `<persona>
Você é um pedagogo sênior com 15 anos de experiência em planejamento de aulas para a educação básica brasileira. Domina a BNCC, o SAEB e o CTBC com profundidade técnica, conhece o vocabulário oficial do MEC e sabe como professores de escolas públicas e privadas aplicam esses referenciais na prática de sala de aula.
</persona>
<tarefa>
Gere de 3 a 5 sugestões de preenchimento para o campo indicado em <campo>. Cada sugestão deve ser específica para a disciplina, ano/série e escola descritos em <contexto>.
</tarefa>
<regras>
1. NUNCA copie trechos literais de documentos oficiais — parafraseie sempre com suas próprias palavras.
2. NUNCA invente ou complete códigos BNCC, SAEB ou CTBC — use SOMENTE os que você conhece com certeza.
3. Se <habilidades_bncc> estiver presente, use EXCLUSIVAMENTE os códigos listados ali — nunca invente outros.
4. Se <instrucao_do_professor> estiver presente, respeite-a como prioridade máxima.
</regras>
<exemplos>
${fewShotExample}
</exemplos>
<raciocinio_obrigatorio>
Antes de gerar as sugestões, raciocine em "raciocinio" seguindo estes passos:
1. Identifique o tipo e propósito do campo (objetivo, habilidade, conteúdo, avaliação, outro).
2. Analise o contexto da turma (disciplina, ano/série, escola) para calibrar profundidade e linguagem.
3. Se <habilidades_bncc> estiver presente, identifique quais códigos são mais pertinentes para este campo.
4. Decida quais 3 a 5 sugestões seriam mais úteis e diretamente aplicáveis por este professor.
</raciocinio_obrigatorio>
<contrato_de_saida>
Cada sugestão deve conter:
- id: string única simples ('s1', 's2', ...)
- label: texto curto e pronto para inserção direta — o professor clica e insere
- descricao: justificativa pedagógica em 1-2 frases — POR QUE esta sugestão serve para este campo e contexto
- fonte: referência curricular específica (ex: 'BNCC EF09MA06', 'Competência Geral 2', 'SAEB', 'CTBC', 'Avaliação formativa')
Responda SOMENTE com JSON válido:
{ "raciocinio": string, "sugestoes": [{ "id": string, "label": string, "descricao": string, "fonte": string }] }
</contrato_de_saida>`;

    const ragQuery = `${fieldLabel} ${fieldGroup ?? ""} ${contexto}`.trim();
    const etapaRaw = metadata["etapa"] ?? metadata["ano"] ?? "";
    const etapa = etapaRaw.toLowerCase().includes("médio") || etapaRaw.toLowerCase().includes("medio")
      ? "EM"
      : "EF";
    const componente = metadata["componente_curricular"] ?? metadata["componente"] ?? metadata["disciplina"] ?? "";
    const estado = typeof template.estado === "string" ? template.estado : undefined;

    const [curriculum, pedagogicMemory] = await Promise.all([
      isBibliografiaField
        ? Promise.resolve({ bncc: [], ctbc: [], saeb: [], curriculo_estadual: [], cnct: [] })
        : retrieveAllCurriculumContext(ragQuery, { componente, etapa, estado }),
      getPedagogicMemoryContext(user.uid).catch(() => ""),
    ]);

    const bnccContexto = curriculum.bncc.length > 0
      ? curriculum.bncc.map((c) => `${c.codigo}: ${c.texto}`).join("\n")
      : null;
    const ctbcContexto = curriculum.ctbc.length > 0
      ? curriculum.ctbc.map((c) => c.texto).join("\n")
      : null;
    const saebContexto = curriculum.saeb.length > 0
      ? curriculum.saeb.map((c) => `${c.codigo}: ${c.texto}`).join("\n")
      : null;
    const estadualContexto = curriculum.curriculo_estadual.length > 0
      ? curriculum.curriculo_estadual.map((c) => c.texto).join("\n")
      : null;
    const cnctContexto = curriculum.cnct.length > 0
      ? curriculum.cnct.map((c) => `${c.curso}: ${c.texto}`).join("\n")
      : null;

    const prompt = [
      `<campo>`,
      `  <nome>${fieldLabel}</nome>`,
      `  <categoria>${fieldGroup ?? "outros"}</categoria>`,
      `  <instrucao>${instrucaoEspecifica}</instrucao>`,
      ...(fieldAiInstructions ? [`  <instrucao_do_professor>${fieldAiInstructions}</instrucao_do_professor>`] : []),
      `</campo>`,
      `<contexto>`,
      `  <template>${template.nome}</template>`,
      `  <turma>${contexto}</turma>`,
      ...(extraContext?.trim() ? [`  <contexto_extra>${extraContext.trim()}</contexto_extra>`] : []),
      `</contexto>`,
      ...(pedagogicMemory ? [pedagogicMemory] : []),
      ...(bnccContexto ? [`<habilidades_bncc>\n${bnccContexto}\n</habilidades_bncc>`] : []),
      ...(ctbcContexto ? [`<habilidades_ctbc>\n${ctbcContexto}\n</habilidades_ctbc>`] : []),
      ...(saebContexto ? [`<descritores_saeb>\n${saebContexto}\n</descritores_saeb>`] : []),
      ...(estadualContexto ? [`<curriculo_${estado ?? "estadual"}>\n${estadualContexto}\n</curriculo_${estado ?? "estadual"}>`] : []),
      ...(cnctContexto ? [`<catalogo_tecnico_cnct>\n${cnctContexto}\n</catalogo_tecnico_cnct>`] : []),
    ].join("\n");

    // Cache key — null when extraContext is present (one-off refinement, don't cache)
    const cacheKey = extraContext?.trim()
      ? null
      : buildCacheKey(fieldKey, templateId, sanitizedMetadata, user.uid, schemaHash);

    // Cache lookup — skip when bypassCache to force new generation
    if (cacheKey && !bypassCache) {
      const cached = await getCachedSuggestions(cacheKey);
      if (cached) {
        console.log(`[PlanoMagistra/ia/campo] Cache hit: ${cacheKey.slice(0, 8)}… (${fieldKey})`);
        return NextResponse.json({ sugestoes: cached, cached: true });
      }
    }

    // ── Streaming path ────────────────────────────────────────────────────────
    if (stream) {
      const model = makeGeminiModel(systemInstruction);

      // Start stream — if this throws (quota, auth), return a proper error response
      let streamResult: Awaited<ReturnType<typeof model.generateContentStream>>;
      try {
        streamResult = await model.generateContentStream(prompt);
      } catch (err) {
        if (isQuotaError(err)) {
          console.warn("[PlanoMagistra/ia/campo] Gemini quota, Groq fallback no stream...");
          try {
            const rawText = await generateWithGroq(systemInstruction, prompt);
            const parsed = JSON.parse(rawText) as { sugestoes: IaSugestao[] };
            const raw = Array.isArray(parsed?.sugestoes) ? parsed.sugestoes : [];
            const sugestoes = validateSugestoes(raw, { templateId, fieldKey });
            if (cacheKey && sugestoes.length > 0) {
              void setCachedSuggestions(cacheKey, sugestoes, { fieldKey, templateId, userId: user.uid });
            }
            return NextResponse.json({ sugestoes });
          } catch {
            return NextResponse.json({ error: "Cota da IA esgotada. Tente novamente mais tarde." }, { status: 429 });
          }
        }
        return NextResponse.json({ error: "Falha ao iniciar geração." }, { status: 502 });
      }

      const encoder = new TextEncoder();
      let accumulated = "";

      const readable = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            for await (const chunk of streamResult.stream) {
              const text = chunk.text();
              accumulated += text;
              controller.enqueue(encoder.encode(text));
            }
            // Save to cache after full generation (updates cache even on bypassCache)
            try {
              const parsed = JSON.parse(accumulated) as { sugestoes: IaSugestao[] };
              const rawSug = Array.isArray(parsed?.sugestoes) ? parsed.sugestoes : [];
              const sugestoes = validateSugestoes(rawSug, { templateId, fieldKey });
              if (cacheKey && sugestoes.length > 0) {
                void setCachedSuggestions(cacheKey, sugestoes, { fieldKey, templateId, userId: user.uid });
              }
            } catch { /* ignore parse errors during cache save */ }
          } catch (err) {
            const msg = (err as Error)?.message ?? "Erro durante streaming.";
            controller.enqueue(encoder.encode(JSON.stringify({ _streamError: msg })));
          } finally {
            controller.close();
          }
        },
      });

      return new Response(readable, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache, no-store",
          "X-Accel-Buffering": "no",
        },
      });
    }

    // ── Batch path (existing) ─────────────────────────────────────────────────
    let rawText: string;
    try {
      rawText = await generateSuggestions(systemInstruction, prompt);

      void import("../../../../lib/services/usage-logger").then(({ logUsage }) => {
        void logUsage({
          userId: user.uid,
          action: "ia_campo",
          model: MODEL_NAME,
          tokensInput: 0,
          tokensOutput: 0,
          metadata: { template_id: templateId, field_key: fieldKey },
        });
      });
    } catch (err) {
      console.error("[PlanoMagistra/api/ia/campo] Erro ao gerar sugestões:", err);
      const msg = (err as Error)?.message ?? "";
      if (msg.includes("GROQ_API_KEY") || msg.includes("quota") || msg.includes("429")) {
        return NextResponse.json({ error: "Cota da IA esgotada. Tente novamente mais tarde." }, { status: 429 });
      }
      return NextResponse.json({ error: "Falha ao gerar sugestões." }, { status: 502 });
    }

    let parsed: { sugestoes: IaSugestao[] };
    try {
      parsed = JSON.parse(rawText) as { sugestoes: IaSugestao[] };
    } catch {
      const firstBrace = rawText.indexOf("{");
      const lastBrace = rawText.lastIndexOf("}");
      if (firstBrace === -1 || lastBrace <= firstBrace) {
        return NextResponse.json({ error: "Resposta inválida do modelo." }, { status: 502 });
      }
      parsed = JSON.parse(rawText.slice(firstBrace, lastBrace + 1)) as { sugestoes: IaSugestao[] };
    }

    const rawSugestoes = Array.isArray(parsed?.sugestoes) ? parsed.sugestoes : [];
    const sugestoes = validateSugestoes(rawSugestoes, { templateId, fieldKey });

    if (cacheKey && sugestoes.length > 0) {
      void setCachedSuggestions(cacheKey, sugestoes, { fieldKey, templateId, userId: user.uid });
    }

    return NextResponse.json({ sugestoes });
  } catch (error) {
    console.error("[PlanoMagistra/api/ia/campo] Erro:", error);
    return NextResponse.json({ error: "Falha ao gerar sugestões para o campo." }, { status: 500 });
  }
}
