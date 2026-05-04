import "server-only";

import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

import { getAdminDb } from "../../../../lib/firebase/admin";
import type { IaSugestao, TemplateRecord } from "../../../../lib/types/firestore";

const MODEL_NAME = process.env.GOOGLE_GEMINI_MODEL ?? "gemini-2.0-flash";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

function isRetryable(err: unknown): boolean {
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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      templateId?: string;
      fieldKey?: string;
      fieldLabel?: string;
      fieldGroup?: string;
      metadata?: Record<string, string>;
    };

    const { templateId, fieldKey, fieldLabel, fieldGroup, metadata = {} } = body;

    if (!templateId || !fieldKey || !fieldLabel) {
      return NextResponse.json(
        { error: "templateId, fieldKey e fieldLabel são obrigatórios." },
        { status: 400 },
      );
    }

    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GOOGLE_GEMINI_API_KEY não configurada." }, { status: 500 });
    }

    const db = getAdminDb();
    const snap = await db.collection("templates").doc(templateId).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
    }

    const template = snap.data() as TemplateRecord;

    // Build context from ALL filled metadata fields (keys extracted from the template schema
    // can have any name, so we include everything rather than hard-coding field names)
    const metaLines = Object.entries(metadata)
      .filter(([, v]) => v.trim())
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`);

    // Also include escola from the template record if not already in metadata
    const escolaFallback = template.escola_nome ?? "";
    if (escolaFallback && !metaLines.some((l) => l.startsWith("escola"))) {
      metaLines.unshift(`escola: ${escolaFallback}`);
    }

    const contexto = metaLines.join(" | ") || "Sem contexto fornecido";

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      generationConfig: {
        temperature: 0.35,
        topP: 0.8,
        topK: 40,
        responseMimeType: "application/json",
      },
      systemInstruction:
        "Você é um especialista em currículo da educação básica brasileira (BNCC, SAEB, CTBC). " +
        "Gere de 3 a 5 sugestões pedagógicas para o campo solicitado. " +
        "Cada sugestão deve ser específica para o contexto da turma e disciplina fornecidos. " +
        "NUNCA copie trechos literais de documentos oficiais — parafraseie sempre. " +
        "NUNCA invente códigos BNCC — use somente códigos reais que você conhece com certeza. " +
        "Retorne SOMENTE um JSON válido no formato: { \"sugestoes\": [{ \"id\": string, \"label\": string, \"descricao\": string, \"fonte\": string }] }",
    });

    const label2prof = fieldLabel.toLowerCase();
    const key2prof = fieldKey.toLowerCase();
    const is2profField =
      label2prof.includes("2°") ||
      label2prof.includes("segundo prof") ||
      label2prof.includes("2prof") ||
      label2prof.includes("apoio") ||
      label2prof.includes("inclusão") ||
      label2prof.includes("inclusao") ||
      label2prof.includes("nee") ||
      label2prof.includes("aee") ||
      key2prof.includes("2prof") ||
      key2prof.includes("apoio") ||
      key2prof.includes("inclusao") ||
      key2prof.includes("nee");

    const instrucaoEspecifica = is2profField
      ? "Este campo é sobre o 2° professor / professor de apoio para educação inclusiva (NEE). " +
        "Sugira: estratégias de coensino (co-teaching), adaptações curriculares para alunos com " +
        "necessidades educacionais especiais, ações do AEE (Atendimento Educacional Especializado), " +
        "e recursos de tecnologia assistiva quando aplicável. Não invente laudos ou diagnósticos."
      : "Se for habilidades/competências BNCC, inclua o código real e uma descrição breve em suas próprias palavras. " +
        "Se for conteúdos, sugira tópicos relevantes para a turma e disciplina. " +
        "Se for objetivos, sugira objetivos pedagógicos claros e mensuráveis.";

    const prompt = JSON.stringify({
      templateNome: template.nome,
      campo: { key: fieldKey, label: fieldLabel, group: fieldGroup ?? "outros" },
      contexto,
      instrucao:
        `Gere 3 a 5 sugestões para este campo. ${instrucaoEspecifica} ` +
        "Retorne SOMENTE o JSON { sugestoes: [...] }.",
    });

    let rawText: string;
    try {
      const response = await withRetry(() => model.generateContent(prompt));
      rawText = response.response.text();

      void import("../../../../lib/services/usage-logger").then(({ logUsage }) => {
        const usage = response.response.usageMetadata;
        void logUsage({
          userId: body.metadata?.["user_id"] as string ?? "unknown",
          action: "ia_campo",
          model: MODEL_NAME,
          tokensInput: usage?.promptTokenCount ?? 0,
          tokensOutput: usage?.candidatesTokenCount ?? 0,
          metadata: { template_id: templateId, field_key: fieldKey },
        });
      });
    } catch (err) {
      console.error("[PlanoMestre/api/ia/campo] Erro no Gemini:", err);
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

    return NextResponse.json({ sugestoes });
  } catch (error) {
    console.error("[PlanoMestre/api/ia/campo] Erro:", error);
    return NextResponse.json({ error: "Falha ao gerar sugestões para o campo." }, { status: 500 });
  }
}
