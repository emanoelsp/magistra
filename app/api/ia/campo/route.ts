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

async function generateWithGemini(systemInstruction: string, prompt: string): Promise<string> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GEMINI_API_KEY não configurada.");
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: { temperature: 0.35, topP: 0.8, topK: 40, responseMimeType: "application/json" },
    systemInstruction,
  });
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
    };

    const { templateId, fieldKey, fieldLabel, fieldGroup, metadata = {}, extraContext } = body;

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

    const instrucaoEspecifica = is2profField
      ? "Este campo é sobre o 2° professor / professor de apoio para educação inclusiva (NEE). " +
        "Sugira: estratégias de coensino (co-teaching), adaptações curriculares para alunos com " +
        "necessidades educacionais especiais, ações do AEE (Atendimento Educacional Especializado), " +
        "e recursos de tecnologia assistiva quando aplicável. Não invente laudos ou diagnósticos."
      : isBibliografiaField
        ? "Este campo é de Referências Bibliográficas. Sugira de 3 a 5 livros didáticos ou obras " +
          "pedagógicas reais e relevantes para a disciplina e nível de ensino fornecidos no contexto. " +
          "Para cada sugestão: 'label' deve ser o título do livro, 'descricao' deve conter autor(es), " +
          "editora e ano aproximado de publicação (ex: 'Maria Silva, Editora Moderna, 2021'), " +
          "'fonte' deve ser 'Indicação bibliográfica'. " +
          "Sugira apenas livros que você conhece com certeza que existem — não invente títulos ou autores."
        : "Se for habilidades/competências BNCC, inclua o código real e uma descrição breve em suas próprias palavras. " +
          "Se for conteúdos, sugira tópicos relevantes para a turma e disciplina. " +
          "Se for objetivos, sugira objetivos pedagógicos claros e mensuráveis.";

    const systemInstruction =
      "Você é um especialista em currículo da educação básica brasileira (BNCC, SAEB, CTBC). " +
      "Gere de 3 a 5 sugestões pedagógicas para o campo solicitado. " +
      "Cada sugestão deve ser específica para o contexto da turma e disciplina fornecidos. " +
      "NUNCA copie trechos literais de documentos oficiais — parafraseie sempre. " +
      "NUNCA invente códigos BNCC — use somente códigos reais que você conhece com certeza. " +
      'Retorne SOMENTE um JSON válido no formato: { "sugestoes": [{ "id": string, "label": string, "descricao": string, "fonte": string }] }';

    // RAG: busca habilidades BNCC reais — não aplicável para campos de bibliografia
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
      templateNome: template.nome,
      campo: { key: fieldKey, label: fieldLabel, group: fieldGroup ?? "outros" },
      contexto,
      ...(bnccContexto ? { habilidadesBNCC: bnccContexto } : {}),
      ...(extraContext?.trim() ? { contextoExtra: extraContext.trim() } : {}),
      instrucao:
        `Gere 3 a 5 sugestões para este campo. ${instrucaoEspecifica} ` +
        (bnccContexto
          ? "Use APENAS os códigos BNCC fornecidos em habilidadesBNCC — nunca invente códigos. "
          : "") +
        (extraContext?.trim() ? `Leve em conta este contexto extra do professor: "${extraContext.trim()}". ` : "") +
        "Retorne SOMENTE o JSON { sugestoes: [...] }.",
    });

    // Cache lookup — pula cache quando há extraContext (refinamento pontual do professor)
    const cacheKey = extraContext?.trim()
      ? null
      : buildCacheKey(fieldKey, templateId, metadata);

    if (cacheKey) {
      const cached = await getCachedSuggestions(cacheKey);
      if (cached) {
        console.log(`[PlanoMagistra/ia/campo] Cache hit: ${cacheKey.slice(0, 8)}… (${fieldKey})`);
        return NextResponse.json({ sugestoes: cached, cached: true });
      }
    }

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

    // Salva no cache de forma assíncrona (não bloqueia a resposta)
    if (cacheKey && sugestoes.length > 0) {
      void setCachedSuggestions(cacheKey, sugestoes, { fieldKey, templateId });
    }

    return NextResponse.json({ sugestoes });
  } catch (error) {
    console.error("[PlanoMagistra/api/ia/campo] Erro:", error);
    return NextResponse.json({ error: "Falha ao gerar sugestões para o campo." }, { status: 500 });
  }
}
