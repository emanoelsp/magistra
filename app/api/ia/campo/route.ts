import "server-only";

import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

import { getAdminDb } from "../../../../lib/firebase/admin";
import { retrieveBnccContext } from "../../../../lib/services/bncc-rag.server";
import {
  buildCacheKey,
  getCachedSuggestions,
  setCachedSuggestions,
} from "../../../../lib/services/suggestions-cache.server";
import type { IaSugestao, TemplateRecord } from "../../../../lib/types/firestore";

const MODEL_NAME = process.env.GOOGLE_GEMINI_MODEL ?? "gemini-2.0-flash";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

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
    generationConfig: { temperature: 0.35, topP: 0.8, topK: 40, responseMimeType: "application/json" },
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
      fieldLabel,
      fieldGroup,
      metadata = {},
      extraContext,
      bypassCache = false,
      stream = false,
    } = body;

    if (!templateId || !fieldKey || !fieldLabel) {
      return NextResponse.json(
        { error: "templateId, fieldKey e fieldLabel são obrigatórios." },
        { status: 400 },
      );
    }

    const db = getAdminDb();
    const snap = await db.collection("templates").doc(templateId).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
    }

    const template = snap.data() as TemplateRecord;

    // Find field-level aiInstructions from schema
    const fieldSchema = Array.isArray(template.schema_campos)
      ? template.schema_campos.find((f) => f.key === fieldKey)
      : undefined;
    const fieldAiInstructions = fieldSchema?.aiInstructions?.trim() ?? "";

    const metaLines = Object.entries(metadata)
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
    const systemInstruction =
      "Você é um assistente pedagógico especializado em educação básica brasileira (BNCC, SAEB, CTBC). " +
      "Sua única tarefa é gerar 3 a 5 sugestões de preenchimento para o campo específico indicado no prompt. " +
      "CONTRATO DE SAÍDA — cada sugestão deve ter: " +
      "  id: string única simples ('s1', 's2', ...); " +
      "  label: texto curto e pronto para inserção direta no campo — o professor clica e insere; " +
      "  descricao: justificativa pedagógica em 1-2 frases — POR QUE esta sugestão serve para este campo e contexto; " +
      "  fonte: referência curricular específica (ex: 'BNCC EF09MA06', 'Competência Geral 2', 'SAEB', 'CTBC', 'Avaliação formativa'). " +
      "REGRAS INVIOLÁVEIS: " +
      "(1) NUNCA copie trechos literais de documentos oficiais — parafraseie sempre com suas próprias palavras. " +
      "(2) NUNCA invente ou complete códigos BNCC, SAEB ou CTBC — use SOMENTE os que você conhece com certeza. " +
      "(3) Cada sugestão deve ser específica para o campo, disciplina, ano/série e escola descritos. " +
      'Responda SOMENTE com JSON válido: { "sugestoes": [{ "id": string, "label": string, "descricao": string, "fonte": string }] }';

    const ragQuery = `${fieldLabel} ${fieldGroup ?? ""} ${contexto}`.trim();
    const etapaRaw = metadata["etapa"] ?? metadata["ano"] ?? "";
    const etapa = etapaRaw.toLowerCase().includes("médio") || etapaRaw.toLowerCase().includes("medio")
      ? "EM"
      : "EF";
    const componente = metadata["componente_curricular"] ?? metadata["componente"] ?? metadata["disciplina"] ?? "";

    const bnccChunks = isBibliografiaField
      ? []
      : await retrieveBnccContext(ragQuery, { componente, etapa });
    const bnccContexto = bnccChunks.length > 0
      ? bnccChunks.map((c) => `${c.codigo}: ${c.texto}`).join("\n")
      : null;

    const prompt = JSON.stringify({
      campo_sendo_editado: fieldLabel,
      categoria_do_campo: fieldGroup ?? "outros",
      template_da_escola: template.nome,
      contexto_turma: contexto,
      ...(bnccContexto ? { habilidades_bncc_disponiveis: bnccContexto } : {}),
      ...(fieldAiInstructions ? { instrucoes_especificas_do_campo: fieldAiInstructions } : {}),
      ...(extraContext?.trim() ? { contexto_extra_do_professor: extraContext.trim() } : {}),
      instrucao: instrucaoEspecifica +
        (fieldAiInstructions
          ? ` INSTRUÇÃO ESPECÍFICA DESTE CAMPO (definida pelo professor ao criar o template): "${fieldAiInstructions}". Respeite esta instrução como prioridade.`
          : "") +
        (bnccContexto
          ? " USE APENAS os códigos de habilidades_bncc_disponiveis — nunca invente outros."
          : "") +
        (extraContext?.trim()
          ? ` Considere também o contexto extra informado pelo professor: "${extraContext.trim()}".`
          : "") +
        " Retorne SOMENTE o JSON { sugestoes: [...] }.",
    });

    // Cache key — null when extraContext is present (one-off refinement, don't cache)
    const cacheKey = extraContext?.trim()
      ? null
      : buildCacheKey(fieldKey, templateId, metadata);

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
            const sugestoes = Array.isArray(parsed?.sugestoes) ? parsed.sugestoes : [];
            if (cacheKey && sugestoes.length > 0) {
              void setCachedSuggestions(cacheKey, sugestoes, { fieldKey, templateId });
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
              const sugestoes = Array.isArray(parsed?.sugestoes) ? parsed.sugestoes : [];
              if (cacheKey && sugestoes.length > 0) {
                void setCachedSuggestions(cacheKey, sugestoes, { fieldKey, templateId });
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
          userId: body.metadata?.["user_id"] as string ?? "unknown",
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

    const sugestoes = Array.isArray(parsed?.sugestoes) ? parsed.sugestoes : [];

    if (cacheKey && sugestoes.length > 0) {
      void setCachedSuggestions(cacheKey, sugestoes, { fieldKey, templateId });
    }

    return NextResponse.json({ sugestoes });
  } catch (error) {
    console.error("[PlanoMagistra/api/ia/campo] Erro:", error);
    return NextResponse.json({ error: "Falha ao gerar sugestões para o campo." }, { status: 500 });
  }
}
