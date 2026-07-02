import "server-only";

import { NextResponse } from "next/server";
import { SchemaType } from "@google/generative-ai";
import type { ResponseSchema } from "@google/generative-ai";

import { createHash } from "crypto";

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../../../../lib/firebase/admin";
import { requireCurrentUserProfile } from "../../../../lib/auth/session";
import { callAIWithFallbacks, makeGeminiModel, isQuotaError } from "../../../../lib/ai/provider";
import { checkRateLimit } from "../../../../lib/services/rate-limit.server";
import { PLAN_LIMITS, normalizePlanKey } from "../../../../lib/services/plan-config";
import { validateSugestoes } from "../../../../lib/services/suggestion-validator";
import { getPedagogicMemoryContext } from "../../../../lib/services/pedagogic-memory.server";
import { getPlanCapabilities } from "../../../../lib/services/plan-capabilities";
import {
  retrieveAllCurriculumContext,
  pruneCurriculumContext,
  buildRagQuery,
  buildNamespaceLookup,
  resolveNamespace,
  matchComponente,
} from "../../../../lib/services/bncc-rag.server";
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
{"raciocinio":"Campo de conteúdos para Língua Portuguesa no 1º ano do EM. Organizo do mais básico ao mais complexo, alinhado ao currículo do EM.","sugestoes":[{"id":"s1","label":"Gêneros textuais argumentativos: artigo de opinião — estrutura, tese e argumentos","descricao":"Introduz escrita argumentativa formal do EM, diferenciando fato de opinião por marcas linguísticas.","fonte":"BNCC EM13LP04"},{"id":"s2","label":"Variedades linguísticas: norma culta, registros formais e informais em diferentes contextos","descricao":"Amplia repertório comunicativo sem desvalorizar a variedade materna do aluno, alinhado ao currículo territorial.","fonte":"BNCC EM13LP01 | currículo territorial"},{"id":"s3","label":"Leitura crítica de textos multimodais: charge, infográfico e artigo — identificação de ponto de vista","descricao":"Desenvolve letramento visual e verbal, alinhado ao perfil leitor exigido pelo ENEM e SAEB.","fonte":"BNCC EM13LP03 | SAEB"}]}`,

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

function makeLocalGeminiModel(systemInstruction: string) {
  return makeGeminiModel(systemInstruction, {
    temperature: 0.35,
    topP: 0.8,
    topK: 40,
    geminiSchema: SUGESTAO_RESPONSE_SCHEMA,
  });
}

async function generateSuggestions(systemInstruction: string, prompt: string): Promise<{ text: string; provider: import("../../../../lib/ai/provider").AiProvider }> {
  const result = await callAIWithFallbacks({
    systemInstruction,
    prompt,
    temperature: 0.35,
    topP: 0.8,
    geminiSchema: SUGESTAO_RESPONSE_SCHEMA,
  });
  return result;
}

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUserProfile();

    // ── Rate limit por hora (anti-burst) ──────────────────────────────────────
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

    // ── Teto mensal (anti-grinding) ────────────────────────────────────────────
    const currentMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"
    const planoKey = normalizePlanKey(user.plano);
    const limitesMes = (PLAN_LIMITS[planoKey] ?? PLAN_LIMITS.free).maxIaCampoCallsPerMonth;
    const callsMes = user.ia_campo_mes === currentMonth ? (user.ia_campo_calls_mes ?? 0) : 0;
    if (callsMes >= limitesMes) {
      return NextResponse.json(
        {
          error: `Você atingiu o limite de ${limitesMes} sugestões este mês. Aguarde o próximo mês ou faça upgrade do plano.`,
          quotaRemaining: 0,
        },
        { status: 403 },
      );
    }

    // Incremento atômico via transação Firestore — garante contagem exata mesmo
    // com requests concorrentes. Retorna o saldo restante após o incremento.
    // Reset automático quando o mês muda (ia_campo_mes !== currentMonth).
    async function atomicIncrement(): Promise<number> {
      const db = getAdminDb();
      const userRef = db.collection("magis_users").doc(user.uid);
      let remaining = 0;
      try {
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(userRef);
          const data = snap.data() ?? {};
          const storedMonth = (data.ia_campo_mes as string | undefined) ?? "";
          const currentCount = storedMonth === currentMonth
            ? ((data.ia_campo_calls_mes as number | undefined) ?? 0)
            : 0;
          const newCount = currentCount + 1;
          remaining = Math.max(0, limitesMes - newCount);
          tx.update(userRef, { ia_campo_calls_mes: newCount, ia_campo_mes: currentMonth });
        });
      } catch { /* nunca quebra o response */ }
      return remaining;
    }

    const body = (await request.json()) as {
      templateId?: string;
      fieldKey?: string;
      fieldLabel?: string;
      fieldGroup?: string;
      metadata?: Record<string, string>;
      extraContext?: string;
      /** For PEI plans: name of the linked special-needs student. */
      estudanteNome?: string;
      /** For PEI plans: free-text student profile (diagnostico, necessidades, nivel_suporte, etc.). */
      estudanteContexto?: string;
      bypassCache?: boolean;
      stream?: boolean;
      currentValues?: Record<string, string>;
    };

    const {
      templateId,
      fieldKey,
      fieldLabel: fieldLabelRaw,
      fieldGroup,
      metadata = {},
      extraContext: extraContextRaw,
      estudanteNome: estudanteNomeRaw,
      estudanteContexto: estudanteContextoRaw,
      bypassCache = false,
      stream = false,
      currentValues = {},
    } = body;

    // Sanitize user-controlled values before prompt interpolation
    const fieldLabel = sanitizeForPrompt(fieldLabelRaw ?? "");
    // Truncate very long regente context to avoid bloating prompts (e.g. full DOCX text)
    const EXTRA_CONTEXT_MAX = 3000;
    const extraContextTruncated = extraContextRaw && extraContextRaw.length > EXTRA_CONTEXT_MAX
      ? extraContextRaw.slice(0, EXTRA_CONTEXT_MAX) + "\n[…contexto truncado]"
      : extraContextRaw;
    const extraContext = extraContextTruncated ? sanitizeForPrompt(extraContextTruncated) : undefined;
    const estudanteNome = estudanteNomeRaw ? sanitizeForPrompt(estudanteNomeRaw) : undefined;
    const estudanteContexto = estudanteContextoRaw ? sanitizeForPrompt(estudanteContextoRaw) : undefined;
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
    const isPeiTemplate = template.template_type === "plano_educacional_individualizado";

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

    const anoLetivo = new Date().getFullYear();

    const metaLines = Object.entries(sanitizedMetadata)
      .filter(([, v]) => v.trim())
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`);

    const escolaFallback = template.escola_nome ?? "";
    if (escolaFallback && !metaLines.some((l) => l.startsWith("escola"))) {
      metaLines.unshift(`escola: ${escolaFallback}`);
    }

    const tipoPlanoFallback = template.tipo_plano ?? "";
    if (tipoPlanoFallback && !metaLines.some((l) => /nível|nivel|ensino|etapa/.test(l))) {
      metaLines.unshift(`nível de ensino: ${tipoPlanoFallback}`);
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
        ? isPeiTemplate
          ? `O campo "${fieldLabel}" é de OBJETIVOS DO PEI (Plano Educacional Individualizado). ` +
            "Gere objetivos funcionais e pedagógicos adaptados ao perfil de suporte do estudante, respeitando suas potencialidades. " +
            "label = objetivo iniciando com verbo de ação no infinitivo, mensurável e realista para o estudante (ex: 'Ampliar autonomia na leitura de textos curtos com apoio de figuras'); " +
            "descricao = como verificar o alcance do objetivo, que estratégia de suporte será usada e como isso se alinha ao currículo da turma; " +
            "fonte = 'PEI', 'AEE' ou 'BNCC adaptada'."
          : `O campo "${fieldLabel}" é de OBJETIVOS DE APRENDIZAGEM. ` +
            "Gere objetivos pedagógicos específicos e mensuráveis para a turma e disciplina descritas. " +
            "label = objetivo completo iniciando com verbo de ação no infinitivo (Identificar, Analisar, Resolver, Produzir, Comparar, Aplicar, Criar, Explicar); máx. 1 frase; " +
            "descricao = como este objetivo se conecta às habilidades BNCC e ao cotidiano do aluno; " +
            "fonte = 'BNCC [código]' ou 'Objetivo pedagógico'."

      : fieldGroup === "competencias"
        ? isPeiTemplate
          ? `O campo "${fieldLabel}" é de COMPETÊNCIAS DO PEI. ` +
            "Sugira competências funcionais e socioemocionais relevantes para o estudante, sempre adaptadas ao seu perfil de suporte. " +
            "label = competência iniciando com verbo de ação no infinitivo, concreta e observável (ex: 'Comunicar necessidades básicas usando PECS ou dispositivo de CAA'); " +
            "descricao = como desenvolver essa competência no contexto da sala de aula inclusiva e do AEE; " +
            "fonte = 'Competência PEI', 'AEE' ou 'BNCC adaptada'."
          : `O campo "${fieldLabel}" é de COMPETÊNCIAS. ` +
            "Sugira competências gerais da BNCC ou competências específicas do componente curricular, sempre parafraseadas. " +
            "label = competência iniciando com verbo de ação no infinitivo, parafraseada de forma objetiva e aplicada à disciplina — ex: 'Analisar criticamente fontes diversas, identificando contexto e intencionalidade' (nunca cópia literal); " +
            "descricao = como essa competência se manifesta nas atividades e no cotidiano dos alunos desta turma; " +
            "fonte = 'Competência Geral BNCC N°X' ou 'Competência Específica [componente curricular]'."

      : fieldGroup === "habilidades"
        ? isPeiTemplate
          ? `O campo "${fieldLabel}" é de HABILIDADES DO PEI. ` +
            "Sugira habilidades adaptadas ao nível de funcionalidade do estudante, alinhadas à BNCC quando possível. " +
            "label = habilidade iniciando com verbo de ação, adaptada ao nível do estudante (ex: 'Reconhecer numerais de 1 a 10 com apoio de material concreto'); " +
            "descricao = estratégia pedagógica ou recurso de acessibilidade para desenvolver esta habilidade; " +
            "fonte = 'BNCC adaptada', 'AEE' ou 'Currículo funcional'."
          : `O campo "${fieldLabel}" é de HABILIDADES BNCC. ` +
            "Use EXCLUSIVAMENTE os códigos listados em habilidadesBNCC (se disponíveis). " +
            "label = 'CÓDIGO — descrição parafraseada em linguagem simples e direta' (ex: 'EF09MA06 — Resolver situações-problema envolvendo conjuntos numéricos'); " +
            "descricao = como desenvolver esta habilidade com a turma, incluindo conexão com SAEB quando pertinente; " +
            "fonte = 'BNCC [código]'."

      : fieldGroup === "conteudos"
        ? isPeiTemplate
          ? `O campo "${fieldLabel}" é de CONTEÚDOS/ATIVIDADES DO PEI. ` +
            "Sugira conteúdos adaptados e atividades funcionais que respeitem o perfil de suporte do estudante, mantendo conexão com o currículo da turma. " +
            "label = atividade ou conteúdo adaptado iniciando com verbo no infinitivo (ex: 'Explorar a escrita do próprio nome com letras móveis e apoio físico'); " +
            "descricao = como realizar a atividade, que recursos de acessibilidade usar e como conectar ao que a turma está trabalhando; " +
            "fonte = 'Currículo adaptado', 'AEE' ou 'Tecnologia Assistiva'."
          : `O campo "${fieldLabel}" é de CONTEÚDOS PROGRAMÁTICOS. ` +
            "Sugira tópicos específicos do componente curricular adequados ao ano/série informados, do mais básico ao mais complexo. " +
            "label = tópico de conteúdo iniciando com verbo de ação no infinitivo — ex: 'Explorar equações do 2° grau pelo discriminante e fórmula de Bhaskara', 'Identificar variações linguísticas e norma culta em diferentes contextos'; " +
            "descricao = o que será trabalhado, como se conecta ao cotidiano e à vida do aluno, e link com currículo territorial quando aplicável; " +
            "fonte = 'Currículo [componente]' ou 'currículo territorial'."

      : fieldGroup === "avaliacao"
        ? isPeiTemplate
          ? `O campo "${fieldLabel}" é de AVALIAÇÃO DO PEI. ` +
            "Sugira formas de avaliação adaptadas ao perfil do estudante: preferencialmente avaliação descritiva, portfólio, observação participante e registros anedóticos. Evite provas padronizadas como único critério. " +
            "label = forma de avaliação iniciando com verbo no infinitivo (ex: 'Observar e registrar com fotos a participação em atividades de grupo'); " +
            "descricao = o que observar, como registrar e o que indica progresso em relação ao objetivo do PEI; " +
            "fonte = 'Avaliação descritiva', 'AEE' ou 'Portfólio'."
          : `O campo "${fieldLabel}" é de AVALIAÇÃO. ` +
            "Sugira instrumentos e critérios avaliativos variados, equilibrando avaliação formativa e somativa. " +
            "label = ação de avaliação iniciando com verbo no infinitivo — ex: 'Observar o engajamento e registrar produções durante atividade experimental', 'Resolver questão de interpretação de gráfico com dados reais no modelo SAEB'; " +
            "descricao = como aplicar o instrumento, o que observar e o que evidencia a aprendizagem; " +
            "fonte = 'Avaliação formativa', 'Avaliação somativa' ou 'SAEB [descritor]'."

      : isPeiTemplate
        ? `O campo a ser preenchido no PEI é: "${fieldLabel}" (categoria: ${fieldGroup ?? "outros"}). ` +
          "Gere sugestões individualizadas, respeitando o perfil de suporte, as necessidades e as potencialidades do estudante descritos no contexto. " +
          "label = texto iniciando com verbo de ação no infinitivo, pronto para inserção neste campo PEI; " +
          "descricao = justificativa pedagógica e como implementar na prática inclusiva; " +
          "fonte = 'PEI', 'AEE', 'Tecnologia Assistiva' ou outra referência da Educação Especial."

      : `O campo a ser preenchido no plano de aula é: "${fieldLabel}" ` +
        `(categoria: ${fieldGroup ?? "outros"}). ` +
        "Gere sugestões específicas, contextualizadas com a turma e a disciplina fornecidas. " +
        "label = texto iniciando com verbo de ação no infinitivo, pronto para inserção neste campo (conciso e direto); " +
        "descricao = justificativa pedagógica — por que essa sugestão é adequada ao contexto; " +
        "fonte = referência curricular ou pedagógica pertinente (BNCC, SAEB, currículo territorial ou outra).";

    // ── System instruction — persona + contrato de saída ─────────────────────
    const exampleKey = is2profField || isBibliografiaField ? "outros" : (fieldGroup ?? "outros");
    const fewShotExample = FEW_SHOT_EXAMPLES[exampleKey] ?? FEW_SHOT_EXAMPLES["outros"]!;

    const systemInstruction = `<persona>
Você é um pedagogo sênior com 15 anos de experiência em planejamento de aulas para a educação básica brasileira. Domina a BNCC, o SAEB e o currículo territorial com profundidade técnica, conhece o vocabulário oficial do MEC e sabe como professores de escolas públicas e privadas aplicam esses referenciais na prática de sala de aula.${isPeiTemplate ? `
Além disso, você é especialista em Educação Especial e Inclusiva: domina a Política Nacional de Educação Especial na Perspectiva da Educação Inclusiva (PNEE), o Atendimento Educacional Especializado (AEE), técnicas de coensino, adaptações curriculares, Tecnologia Assistiva (TA), Comunicação Aumentativa e Alternativa (CAA) e estratégias pedagógicas baseadas em evidências para estudantes com deficiência, Transtornos Globais do Desenvolvimento (TGD) e Altas Habilidades/Superdotação. Quando o campo envolve planejamento para um estudante específico, suas sugestões devem priorizar adaptações individualizadas, respeitar o perfil de suporte do estudante e nunca inferir diagnósticos além do que foi informado.` : ""}
</persona>
<tarefa>
Gere de 3 a 5 sugestões de preenchimento para o campo indicado em <campo>. Cada sugestão deve ser específica para a disciplina, ano/série e escola descritos em <contexto>.
</tarefa>
<regras>
1. NUNCA copie trechos literais de documentos oficiais — parafraseie sempre com suas próprias palavras.
2. NUNCA invente ou complete códigos BNCC, SAEB ou currículo territorial — use SOMENTE os que você conhece com certeza.
3. Se <habilidades_bncc> estiver presente, use EXCLUSIVAMENTE os códigos listados ali — nunca invente outros.
4. Se <instrucao_do_professor> estiver presente, respeite-a como prioridade máxima.
5. SEMPRE inicie o campo "label" de cada sugestão com um verbo de ação no infinitivo (ex: Identificar, Analisar, Resolver, Produzir, Aplicar, Criar, Comparar, Explicar, Desenvolver, Elaborar, Utilizar, Observar, Registrar, Avaliar, Planejar, Discutir, Investigar, Relacionar, Selecionar, Organizar). Isso vale para todos os tipos de campo.
6. Este plano é para o ano letivo ${anoLetivo}. As sugestões devem refletir o currículo vigente nesse ano — use as versões e atualizações mais recentes da BNCC, SAEB e currículos territoriais disponíveis.
7. Se uma habilidade BNCC ou descritor SAEB estiver marcado com [ComponenteX → adaptável para ComponenteY], significa que é de outro componente curricular e não há equivalente exato no componente solicitado. Nesse caso: (a) preencha o campo "aviso" com UMA frase em português começando com "Não encontrei habilidade exata de [ComponenteY]." e explicando em 1 linha por que esta habilidade de [ComponenteX] se alinha ao contexto — ex: "Não encontrei habilidade exata de Matemática. EF06CI01 é de Ciências, mas se alinha porque ambas trabalham raciocínio proporcional e representação de dados."; (b) no "label", descreva a habilidade normalmente, sem repetir o aviso; (c) no "fonte", indique: "BNCC EF06CI01 (Ciências → adaptado para Matemática)". Nunca omita "aviso" quando adaptar de outro componente.
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
- label: texto curto e pronto para inserção direta — SEMPRE inicia com verbo de ação no infinitivo — o professor clica e insere
- descricao: justificativa pedagógica em 1-2 frases — POR QUE esta sugestão serve para este campo e contexto
- fonte: referência curricular específica (ex: 'BNCC EF09MA06', 'Competência Geral 2', 'SAEB', 'currículo territorial', 'Avaliação formativa')
- aviso: (OPCIONAL) presente SOMENTE quando a habilidade é adaptada de outro componente curricular (regra 7) — frase curta alertando o professor
Responda SOMENTE com JSON válido:
{ "raciocinio": string, "sugestoes": [{ "id": string, "label": string, "descricao": string, "fonte": string, "aviso"?: string }] }
</contrato_de_saida>`;

    // Enrich RAG query with already-filled ia_sugerida field values for better Pinecone recall
    const sanitizedCurrentValues: Record<string, string> = Object.fromEntries(
      Object.entries(currentValues)
        .filter(([k, v]) => k !== fieldKey && typeof v === "string" && v.trim().length > 0)
        .map(([k, v]) => [sanitizeForPrompt(k), sanitizeForPrompt(v as string)])
        .slice(0, 8)
    );
    const currentValuesContext = Object.values(sanitizedCurrentValues)
      .filter((v) => v.length > 3)
      .join(" ")
      .slice(0, 400);

    // Build a pedagogy-only context string for the RAG embedding query.
    // Excludes administrative keys (escola, professor, recursos) that push the
    // embedding vector away from curriculum content.
    const componente = metadata["componente_curricular"] ?? metadata["componente"] ?? metadata["disciplina"] ?? "";
    const estado = typeof template.estado === "string" ? template.estado : undefined;
    const tipoPlano = typeof template.tipo_plano === "string" ? template.tipo_plano : "";

    const NON_PEDAGOGICAL_RE = /escola|professor|recurso|materiai|local|data_aula/i;
    const pedagogicalMetaLines = Object.entries(sanitizedMetadata)
      .filter(([k, v]) => v.trim() && !NON_PEDAGOGICAL_RE.test(k))
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`);
    const pedagogicalContext = pedagogicalMetaLines.join(" | ");
    const ragQuery = buildRagQuery({
      fieldLabel,
      fieldGroup: fieldGroup ?? undefined,
      componente,
      tipoPlano,
      pedagogicalContext,
      currentValuesContext,
    });

    // Robust etapa detection — tipo_plano (nível de ensino) is the strongest signal.
    // Falls back to metadata fields. undefined means "unknown, don't filter".
    const etapaRaw = (
      tipoPlano + " " +
      (metadata["etapa"] ?? metadata["ano_turma"] ?? metadata["ano"] ??
      metadata["serie"] ?? metadata["turma"] ?? "")
    ).toLowerCase();
    const etapa: "EF" | "EM" | undefined =
      /médi|medio|ensino.?médi|ensino.?medio|\bem\b|[1-3]\s*[eE][mM]\b|[1-3][°º]\s*ano\s*[eE][mM]/
        .test(etapaRaw) ? "EM"
      : /fund|\bef\b|[1-9][°º]?\s*ano\b|[1-9][°º]\s*série/
        .test(etapaRaw) ? "EF"
      : undefined;

    const [curriculumRaw, pedagogicMemory] = await Promise.all([
      isBibliografiaField
        ? Promise.resolve({ bncc: [], saeb: [], curriculo_estadual: [], cnct: [], curriculo_digital: [] })
        : retrieveAllCurriculumContext(ragQuery, { componente, etapa, estado }),
      getPedagogicMemoryContext(user.uid, getPlanCapabilities(user.plano ?? "free").canAccessBiblioteca).catch(() => ""),
    ]);

    // Poda o contexto antes de injetar: 3 BNCC + 2 SAEB + 1 estadual + 1 cnct + 1 digital = 8 máx.
    // Pinecone já retorna resultados ordenados por score DESC, então slice preserva os mais relevantes.
    const curriculum = pruneCurriculumContext(curriculumRaw);

    const semContextoCurricular =
      !isBibliografiaField &&
      curriculum.bncc.length === 0 &&
      curriculum.saeb.length === 0 &&
      curriculum.curriculo_estadual.length === 0 &&
      curriculum.cnct.length === 0 &&
      curriculum.curriculo_digital.length === 0;
    if (semContextoCurricular) {
      console.warn(
        `[ia/campo] RAG retornou vazio — campo="${fieldKey}" componente="${componente}" etapa="${etapa ?? "?"}" estado="${estado ?? "-"}"`,
      );
    }

    // Componente normalizado para detectar habilidades cross-componente.
    // Quando o RAG retorna EF06CI01 para uma aula de Matemática, marcamos explicitamente
    // para a Magis indicar na sugestão que é uma adaptação — não uma habilidade nativa.
    const requestedComp = matchComponente(componente);
    const normC = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

    const bnccContexto = curriculum.bncc.length > 0
      ? curriculum.bncc.map((c) => {
          const isCross = requestedComp && c.componente &&
            normC(c.componente) !== normC(requestedComp);
          const tag = isCross ? ` [${c.componente} → adaptável para ${requestedComp}]` : "";
          return `${c.codigo}${tag}: ${c.texto}`;
        }).join("\n")
      : null;
    const saebContexto = curriculum.saeb.length > 0
      ? curriculum.saeb.map((c) => {
          const isCross = requestedComp && c.componente &&
            normC(c.componente) !== normC(requestedComp);
          const tag = isCross ? ` [${c.componente} → adaptável]` : "";
          return `${c.codigo}${tag}: ${c.texto}`;
        }).join("\n")
      : null;
    const estadualContexto = curriculum.curriculo_estadual.length > 0
      ? curriculum.curriculo_estadual.map((c) => c.texto).join("\n")
      : null;
    const cnctContexto = curriculum.cnct.length > 0
      ? curriculum.cnct.map((c) => `${c.curso}: ${c.texto}`).join("\n")
      : null;
    const digitalContexto = curriculum.curriculo_digital.length > 0
      ? curriculum.curriculo_digital.map((c) => `${c.codigo ? c.codigo + ": " : ""}${c.texto}`).join("\n")
      : null;

    const filledFieldsLines = Object.entries(sanitizedCurrentValues)
      .filter(([, v]) => v.length > 3)
      .map(([k, v]) => `  <campo_preenchido nome="${k}">${v.slice(0, 200)}</campo_preenchido>`);

    const prompt = [
      `<campo>`,
      `  <nome>${fieldLabel}</nome>`,
      `  <categoria>${fieldGroup ?? "outros"}</categoria>`,
      `  <instrucao>${instrucaoEspecifica}</instrucao>`,
      ...(fieldAiInstructions ? [`  <instrucao_do_professor>${fieldAiInstructions}</instrucao_do_professor>`] : []),
      `</campo>`,
      ...(isPeiTemplate && (estudanteNome || estudanteContexto) ? [
        `<estudante_pei>`,
        ...(estudanteNome ? [`  <nome>${estudanteNome}</nome>`] : []),
        ...(estudanteContexto ? [`  <perfil>${estudanteContexto}</perfil>`] : []),
        `  <instrucao_pei>Este é um Plano Educacional Individualizado (PEI). Todas as sugestões devem ser adaptadas ao perfil deste estudante, respeitando seu nível de suporte e necessidades educacionais especiais. Nunca infira diagnósticos além do informado.</instrucao_pei>`,
        `</estudante_pei>`,
      ] : []),
      `<contexto>`,
      `  <template>${template.nome}</template>`,
      `  <turma>${contexto}</turma>`,
      `  <ano_letivo>${anoLetivo}</ano_letivo>`,
      ...(extraContext?.trim() ? [`  <contexto_extra>${extraContext.trim()}</contexto_extra>`] : []),
      ...(filledFieldsLines.length > 0 ? [`  <outros_campos_ja_preenchidos>`, ...filledFieldsLines, `  </outros_campos_ja_preenchidos>`] : []),
      `</contexto>`,
      ...(pedagogicMemory ? [pedagogicMemory] : []),
      ...(bnccContexto ? [`<habilidades_bncc>\n${bnccContexto}\n</habilidades_bncc>`] : []),
      ...(saebContexto ? [`<descritores_saeb>\n${saebContexto}\n</descritores_saeb>`] : []),
      ...(estadualContexto ? [`<curriculo_${estado ?? "estadual"}>\n${estadualContexto}\n</curriculo_${estado ?? "estadual"}>`] : []),
      ...(cnctContexto ? [`<catalogo_tecnico_cnct>\n${cnctContexto}\n</catalogo_tecnico_cnct>`] : []),
      ...(digitalContexto ? [`<curriculo_educacao_digital>\n${digitalContexto}\n</curriculo_educacao_digital>`] : []),
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
      const model = makeLocalGeminiModel(systemInstruction);

      // Start stream — on quota error fall back to non-streaming via callAIWithFallbacks
      let streamResult: Awaited<ReturnType<typeof model.generateContentStream>>;
      try {
        streamResult = await model.generateContentStream(prompt);
      } catch (err) {
        if (isQuotaError(err)) {
          console.warn("[PlanoMagistra/ia/campo] Gemini quota, fallback não-streaming...");
          try {
            const { text: rawText, provider: fbProvider } = await generateSuggestions(systemInstruction, prompt);
            if (fbProvider !== "gemini") {
              console.warn(`[PlanoMagistra/ia/campo] Fallback ativo: provider=${fbProvider} field=${fieldKey}`);
            }
            const parsed = JSON.parse(rawText) as { sugestoes: IaSugestao[] };
            const raw = Array.isArray(parsed?.sugestoes) ? parsed.sugestoes : [];
            const nsLookupFb = buildNamespaceLookup(curriculum);
            const sugestoes = validateSugestoes(raw, { templateId, fieldKey })
              .map((s) => ({ ...s, namespace: resolveNamespace(s.fonte ?? "", nsLookupFb) }));
            if (cacheKey && sugestoes.length > 0) {
              void setCachedSuggestions(cacheKey, sugestoes, { fieldKey, templateId, userId: user.uid });
            }
            const remaining = await atomicIncrement();
            return NextResponse.json({ sugestoes, provider: fbProvider, quotaRemaining: remaining });
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
            void atomicIncrement(); // fire-and-forget — headers já foram enviados no streaming
            // Save to cache after full generation (updates cache even on bypassCache)
            try {
              const parsed = JSON.parse(accumulated) as { sugestoes: IaSugestao[] };
              const rawSug = Array.isArray(parsed?.sugestoes) ? parsed.sugestoes : [];
              const nsLookupStr = buildNamespaceLookup(curriculum);
              const sugestoes = validateSugestoes(rawSug, { templateId, fieldKey })
                .map((s) => ({ ...s, namespace: resolveNamespace(s.fonte ?? "", nsLookupStr) }));
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
          "X-AI-Provider": "gemini",
          // Valor pré-incremento — aproximado para streaming (headers enviados antes do fim)
          "X-Quota-Remaining": String(Math.max(0, limitesMes - callsMes - 1)),
        },
      });
    }

    // ── Batch path (existing) ─────────────────────────────────────────────────
    let rawText: string;
    let aiProvider: import("../../../../lib/ai/provider").AiProvider = "gemini";
    try {
      const genResult = await generateSuggestions(systemInstruction, prompt);
      rawText = genResult.text;
      aiProvider = genResult.provider;

      if (aiProvider !== "gemini") {
        console.warn(`[PlanoMagistra/ia/campo] Fallback ativo: provider=${aiProvider} field=${fieldKey}`);
      }

      void import("../../../../lib/services/usage-logger").then(({ logUsage }) => {
        void logUsage({
          userId: user.uid,
          action: "ia_campo",
          model: MODEL_NAME,
          provider: genResult.provider,
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
    const nsLookup = buildNamespaceLookup(curriculum);
    const sugestoes = validateSugestoes(rawSugestoes, { templateId, fieldKey })
      .map((s) => ({ ...s, namespace: resolveNamespace(s.fonte ?? "", nsLookup) }));

    if (cacheKey && sugestoes.length > 0) {
      void setCachedSuggestions(cacheKey, sugestoes, { fieldKey, templateId, userId: user.uid });
    }

    const remaining = await atomicIncrement();
    return NextResponse.json({ sugestoes, provider: aiProvider, quotaRemaining: remaining });
  } catch (error) {
    console.error("[PlanoMagistra/api/ia/campo] Erro:", error);
    return NextResponse.json({ error: "Falha ao gerar sugestões para o campo." }, { status: 500 });
  }
}
