import "server-only";

import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

import { getAdminDb } from "../../../lib/firebase/admin";
import type { IaSugestao, TemplateFieldSchema, TemplateRecord } from "../../../lib/types/firestore";

const MODEL_NAME = process.env.GOOGLE_GEMINI_MODEL ?? "gemini-2.0-flash";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

function isRetryableError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  const msg = (err as Error)?.message ?? "";
  return status === 503 || status === 429 || msg.includes("503") || msg.includes("high demand");
}

function isRecitationError(err: unknown): boolean {
  return ((err as Error)?.message ?? "").includes("RECITATION");
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRetryableError(err) || attempt === MAX_RETRIES) throw err;
      const delay = RETRY_DELAY_MS * attempt;
      console.log(`[PlanoMagistra] Retry ${attempt}/${MAX_RETRIES} em ${delay}ms (503/429)...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      templateId,
      diretriz,
      dadosManuais,
      camposIaSugerida,
      contextoTurma,
      objetivos,
      preferencias,
      turma,
      anoSerie,
      componenteCurricular,
    } = body ?? {};

    if (typeof templateId !== "string" || !templateId) {
      return NextResponse.json({ error: "templateId é obrigatório." }, { status: 400 });
    }

    const db = getAdminDb();
    const snapshot = await db.collection("templates").doc(templateId).get();

    if (!snapshot.exists) {
      return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
    }

    const template = snapshot.data() as TemplateRecord;
    const schemaCampos = Array.isArray(template.schema_campos) ? template.schema_campos : [];
    const iaFields: TemplateFieldSchema[] = Array.isArray(camposIaSugerida)
      ? camposIaSugerida
      : schemaCampos.filter((c) => (c as { role?: string }).role === "ia_sugerida");

    const useLegacyFormat = iaFields.length === 0 && (contextoTurma != null || objetivos != null);

    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GOOGLE_GEMINI_API_KEY não configurada." }, { status: 500 });
    }

    console.log("[PlanoMagistra] 4. Gerando sugestões da IA...", { templateId, useLegacyFormat, camposIa: iaFields.length });

    const genAI = new GoogleGenerativeAI(apiKey);

    if (useLegacyFormat) {
      const model = genAI.getGenerativeModel({
        model: MODEL_NAME,
        generationConfig: { temperature: 0.3, topP: 0.7, topK: 40, responseMimeType: "application/json" },
        systemInstruction:
          "Você é um assistente educacional. Preencha o JSON com sugestões baseadas em BNCC, SAEB e CTBC. " +
          "IMPORTANTE: Parafraseie sempre em suas próprias palavras. NUNCA copie trechos literais de documentos oficiais. " +
          "Use descrições breves e originais. NUNCA invente códigos BNCC. Retorne SOMENTE um JSON válido.",
      });
      const payload = {
        templateNome: template.nome,
        schemaCampos: template.schema_campos,
        diretriz: diretriz ?? "BNCC",
        contextoTurma: contextoTurma ?? null,
        objetivos: objetivos ?? null,
        preferencias: preferencias ?? null,
        turma: turma ?? (dadosManuais as Record<string, unknown>)?.nome_turma ?? null,
        anoSerie: anoSerie ?? (dadosManuais as Record<string, unknown>)?.ano_serie ?? null,
        componenteCurricular: componenteCurricular ?? (dadosManuais as Record<string, unknown>)?.componente_curricular ?? null,
      };
      const userPrompt =
        "Preencha o JSON com sugestões pedagógicas. Use turma, anoSerie e componenteCurricular para contextualizar. " +
        "Parafraseie em suas próprias palavras; não copie trechos literais de documentos. Use descrições originais e breves.\n\n" +
        JSON.stringify(payload);
      const response = await withRetry(() => model.generateContent(userPrompt));
      const rawText = response.response.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        const fb = rawText.indexOf("{");
        const lb = rawText.lastIndexOf("}");
        parsed = fb >= 0 && lb > fb ? JSON.parse(rawText.slice(fb, lb + 1)) : {};
      }
      console.log("[PlanoMagistra] 4. Sugestões da IA geradas (legado)", { conteudo: typeof parsed === "object" ? Object.keys(parsed as object).length : 0 });

      return NextResponse.json({ conteudo: parsed, sugestoes: null });
    }

    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      generationConfig: {
        temperature: 0.3,
        topP: 0.7,
        topK: 40,
        responseMimeType: "application/json",
      },
      systemInstruction:
        "Você é um assistente educacional. Para cada campo solicitado, retorne um array de sugestões " +
        "no formato { id, label, descricao?, fonte? }. Baseie-se em BNCC, SAEB e CTBC. " +
        "IMPORTANTE: Parafraseie sempre em suas próprias palavras. NUNCA copie trechos literais de documentos oficiais. " +
        "Use labels e descrições breves e originais. NUNCA invente códigos BNCC. Retorne SOMENTE um JSON com as chaves dos campos e arrays de sugestões.",
    });

    const payload = {
      templateNome: template.nome,
      diretriz: diretriz ?? "BNCC",
      dadosManuais: dadosManuais ?? {},
      camposParaSugerir: iaFields.map((f) => ({ key: f.key, label: f.label, group: f.group })),
    };

    const basePrompt =
      "Gere sugestões para cada campo pedagógico. Use dadosManuais (turma, ano, disciplina) para contextualizar: " +
      "ex.: BNCC do 5º ano de Língua Portuguesa. Para cada chave em camposParaSugerir, retorne um array " +
      "de objetos { id: string único, label: string, descricao?: string, fonte?: string }. " +
      "Parafraseie em suas próprias palavras; não copie trechos literais. Use descrições originais e breves. Retorne SOMENTE o JSON.\n\n" +
      JSON.stringify(payload);

    let rawText: string | undefined;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const retrySuffix =
          attempt > 1
            ? "\n\n[RETRY] Use MÁXIMO 10-12 palavras por label. Resuma em uma frase curta. Zero citações literais."
            : "";
        const response = await withRetry(() => model.generateContent(basePrompt + retrySuffix));
        rawText = response.response.text();
        break;
      } catch (err) {
        lastErr = err;
        const canRetry = isRecitationError(err) || isRetryableError(err);
        if (!canRetry || attempt === MAX_RETRIES) throw err;
        const delay = RETRY_DELAY_MS * attempt;
        console.log(`[PlanoMagistra] Retry ${attempt}/${MAX_RETRIES} em ${delay}ms${isRecitationError(err) ? " (RECITATION)" : ""}...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    if (typeof rawText === "undefined") throw lastErr;

    let parsed: Record<string, IaSugestao[]>;
    try {
      parsed = JSON.parse(rawText) as Record<string, IaSugestao[]>;
    } catch {
      const firstBrace = rawText.indexOf("{");
      const lastBrace = rawText.lastIndexOf("}");
      if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        return NextResponse.json(
          { error: "Resposta inválida do modelo. Não foi possível extrair JSON." },
          { status: 502 },
        );
      }
      parsed = JSON.parse(rawText.slice(firstBrace, lastBrace + 1)) as Record<string, IaSugestao[]>;
    }

    console.log("[PlanoMagistra] 4. Sugestões da IA geradas", { sugestoes: Object.keys(parsed).length });

    return NextResponse.json({ sugestoes: parsed });
  } catch (error) {
    console.error("Erro na rota /api/gerar-plano:", error);
    return NextResponse.json({ error: "Falha ao gerar plano com IA." }, { status: 500 });
  }
}

