import "server-only";

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ResponseSchema } from "@google/generative-ai";

// ── Tipos públicos ────────────────────────────────────────────────────────────

export interface AiCallOptions {
  systemInstruction: string;
  prompt: string;
  temperature?: number;
  topP?: number;
  topK?: number;
  geminiSchema?: ResponseSchema;
}

export type AiProvider = "gemini" | "openai" | "groq";

export interface AiResult {
  text: string;
  provider: AiProvider;
}

// ── Constantes ────────────────────────────────────────────────────────────────

const GEMINI_MODEL = process.env.GOOGLE_GEMINI_MODEL ?? "gemini-2.0-flash";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const GROQ_MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

// ── Classificação de erros ────────────────────────────────────────────────────

export function isQuotaError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  const msg = (err as Error)?.message ?? "";
  return (
    status === 429 &&
    (msg.includes("free_tier") || msg.includes("limit: 0") || msg.includes("PerDay"))
  );
}

function isTransientError(err: unknown): boolean {
  if (isQuotaError(err)) return false;
  const status = (err as { status?: number })?.status;
  const msg = (err as Error)?.message ?? "";
  return (
    status === 503 ||
    status === 429 ||
    msg.includes("503") ||
    msg.includes("high demand") ||
    msg.includes("RECITATION")
  );
}

// ── Retry helper ──────────────────────────────────────────────────────────────

export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isTransientError(err) || attempt === MAX_RETRIES) throw err;
      const delay = RETRY_DELAY_MS * attempt;
      console.log(`[PlanoMagistra/ai] Retry ${attempt}/${MAX_RETRIES} em ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// ── Construtor do modelo Gemini (também exportado para o path de streaming) ───

export function makeGeminiModel(
  systemInstruction: string,
  options: Pick<AiCallOptions, "temperature" | "topP" | "topK" | "geminiSchema"> = {},
) {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GEMINI_API_KEY não configurada.");
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: {
      temperature: options.temperature ?? 0.1,
      topP: options.topP ?? 0.6,
      topK: options.topK ?? 40,
      responseMimeType: "application/json",
      ...(options.geminiSchema ? { responseSchema: options.geminiSchema } : {}),
    },
    systemInstruction,
  });
}

// ── Provedores individuais ─────────────────────────────────────────────────────

async function callGemini(options: AiCallOptions): Promise<string> {
  const model = makeGeminiModel(options.systemInstruction, options);
  const result = await withRetry(() => model.generateContent(options.prompt));
  return result.response.text();
}

async function callOpenAI(options: AiCallOptions): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY não configurada.");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: options.temperature ?? 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: options.systemInstruction },
        { role: "user", content: options.prompt },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${body}`);
  }
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  const content = data.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI retornou resposta vazia.");
  return content;
}

async function callGroq(options: AiCallOptions): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY não configurada.");
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: options.temperature ?? 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: options.systemInstruction },
        { role: "user", content: options.prompt },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Groq error ${res.status}: ${body}`);
  }
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  const content = data.choices[0]?.message?.content;
  if (!content) throw new Error("Groq retornou resposta vazia.");
  return content;
}

// ── Orquestrador com fallback em cadeia ───────────────────────────────────────

/**
 * Chama os provedores de IA em ordem: Gemini → OpenAI → Groq.
 *
 * - Gemini: tentado primeiro, com retry automático para erros transientes (503/429 passageiro).
 *   Se a quota do plano gratuito esgotar (429 + "free_tier"/"PerDay"), vai para o próximo.
 * - OpenAI: usado se Gemini esgotou a quota. Qualquer falha passa para Groq.
 * - Groq: último recurso. Se falhar, lança o erro para o chamador.
 *
 * O `geminiSchema` é aplicado apenas ao Gemini. Os outros provedores usam
 * `response_format: { type: "json_object" }` nativo.
 */
export async function callAIWithFallbacks(options: AiCallOptions): Promise<AiResult> {
  // 1. Gemini
  try {
    const text = await callGemini(options);
    return { text, provider: "gemini" };
  } catch (err) {
    if (!isQuotaError(err)) throw err;
    console.warn("[PlanoMagistra/ai] Gemini quota esgotada, tentando OpenAI...");
  }

  // 2. OpenAI
  try {
    const text = await callOpenAI(options);
    console.warn("[PlanoMagistra/ai] OpenAI usado como fallback 1.");
    return { text, provider: "openai" };
  } catch (err) {
    console.warn("[PlanoMagistra/ai] OpenAI falhou, tentando Groq...", (err as Error)?.message);
  }

  // 3. Groq
  const text = await callGroq(options);
  console.warn("[PlanoMagistra/ai] Groq usado como fallback 2.");
  return { text, provider: "groq" };
}
