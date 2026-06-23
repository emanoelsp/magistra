import "server-only";

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ResponseSchema } from "@google/generative-ai";
import Anthropic from "@anthropic-ai/sdk";

// ── Tipos públicos ────────────────────────────────────────────────────────────

export interface AiCallOptions {
  systemInstruction: string;
  prompt: string;
  temperature?: number;
  topP?: number;
  topK?: number;
  geminiSchema?: ResponseSchema;
  /** When set, fallback providers (OpenAI/Groq) append this to the system instruction
   *  and omit response_format:json_object, enabling alternative output formats (e.g. TOON). */
  systemSuffixFallback?: string;
}

export type AiProvider = "claude" | "gemini" | "openai" | "groq";

export interface AiResult {
  text: string;
  provider: AiProvider;
  /** "json" when the provider returned structured JSON; "toon" when it used TOON line format. */
  format: "json" | "toon";
}

// ── Constantes ────────────────────────────────────────────────────────────────

const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
const GEMINI_MODEL = process.env.GOOGLE_GEMINI_MODEL ?? "gemini-2.0-flash";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const GROQ_MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

// ── Classificação de erros ────────────────────────────────────────────────────

export function isQuotaError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  const msg = (err as Error)?.message ?? "";
  // Gemini: 429 com keywords de cota do plano gratuito
  if (status === 429 && (msg.includes("free_tier") || msg.includes("limit: 0") || msg.includes("PerDay")))
    return true;
  // Claude: créditos esgotados (400 com mensagem específica)
  if (msg.toLowerCase().includes("credit balance") || msg.toLowerCase().includes("insufficient_quota"))
    return true;
  return false;
}

function isTransientError(err: unknown): boolean {
  if (isQuotaError(err)) return false;
  const status = (err as { status?: number })?.status;
  const msg = (err as Error)?.message ?? "";
  return (
    status === 503 ||
    status === 529 || // Claude overloaded
    status === 429 ||
    msg.includes("503") ||
    msg.includes("529") ||
    msg.includes("high demand") ||
    msg.includes("overloaded") ||
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

async function callClaude(options: AiCallOptions): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY não configurada.");
  const client = new Anthropic({ apiKey });
  // Claude segue instruções de JSON muito bem — ignora systemSuffixFallback (TOON é para
  // provedores que não suportam formato estruturado nativo).
  const message = await withRetry(() =>
    client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 8192,
      temperature: options.temperature ?? 0.1,
      system: options.systemInstruction,
      messages: [{ role: "user", content: options.prompt }],
    }),
  );
  const block = message.content.find((c) => c.type === "text");
  const text = block?.type === "text" ? block.text : undefined;
  if (!text) throw new Error("Claude retornou resposta vazia.");
  return text;
}

async function callGemini(options: AiCallOptions): Promise<string> {
  const model = makeGeminiModel(options.systemInstruction, options);
  const result = await withRetry(() => model.generateContent(options.prompt));
  return result.response.text();
}

async function callOpenAI(options: AiCallOptions): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY não configurada.");
  const useToon = Boolean(options.systemSuffixFallback);
  const systemContent = useToon
    ? options.systemInstruction + "\n\n" + options.systemSuffixFallback
    : options.systemInstruction;
  const body: Record<string, unknown> = {
    model: OPENAI_MODEL,
    temperature: options.temperature ?? 0.1,
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: options.prompt },
    ],
  };
  if (!useToon) body.response_format = { type: "json_object" };
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const resBody = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${resBody}`);
  }
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  const content = data.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI retornou resposta vazia.");
  return content;
}

async function callGroq(options: AiCallOptions): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY não configurada.");
  const useToon = Boolean(options.systemSuffixFallback);
  const systemContent = useToon
    ? options.systemInstruction + "\n\n" + options.systemSuffixFallback
    : options.systemInstruction;
  const body: Record<string, unknown> = {
    model: GROQ_MODEL,
    temperature: options.temperature ?? 0.1,
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: options.prompt },
    ],
  };
  if (!useToon) body.response_format = { type: "json_object" };
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const resBody = await res.text();
    throw new Error(`Groq error ${res.status}: ${resBody}`);
  }
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  const content = data.choices[0]?.message?.content;
  if (!content) throw new Error("Groq retornou resposta vazia.");
  return content;
}

// ── Orquestrador com fallback em cadeia ───────────────────────────────────────

/**
 * Chama os provedores de IA em ordem: Claude → Gemini → OpenAI → Groq.
 *
 * - Claude: primário. JSON nativo (instrução no system prompt). Retry em 429/529 transientes.
 *   Se créditos esgotarem, cai para Gemini.
 * - Gemini: segundo. JSON com schema enforcement. Retry automático.
 *   Se cota do plano gratuito esgotar, cai para OpenAI.
 * - OpenAI: terceiro. TOON quando systemSuffixFallback definido; JSON nativo caso contrário.
 * - Groq: último recurso. Mesmo comportamento do OpenAI.
 */
export async function callAIWithFallbacks(options: AiCallOptions): Promise<AiResult> {
  const fallbackFormat: "json" | "toon" = options.systemSuffixFallback ? "toon" : "json";

  // 1. Claude — JSON nativo (sem TOON; Claude segue instrução de formato no system prompt)
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const text = await callClaude(options);
      return { text, provider: "claude", format: "json" };
    } catch (err) {
      if (!isQuotaError(err)) throw err;
      console.warn("[PlanoMagistra/ai] Claude quota/crédito esgotado, tentando Gemini...");
    }
  }

  // 2. Gemini — JSON com schema enforcement
  try {
    const text = await callGemini(options);
    return { text, provider: "gemini", format: "json" };
  } catch (err) {
    if (!isQuotaError(err)) throw err;
    console.warn("[PlanoMagistra/ai] Gemini quota esgotada, tentando OpenAI...");
  }

  // 3. OpenAI — TOON quando systemSuffixFallback, JSON caso contrário
  try {
    const text = await callOpenAI(options);
    console.warn(`[PlanoMagistra/ai] OpenAI usado como fallback 2 (format=${fallbackFormat}).`);
    return { text, provider: "openai", format: fallbackFormat };
  } catch (err) {
    console.warn("[PlanoMagistra/ai] OpenAI falhou, tentando Groq...", (err as Error)?.message);
  }

  // 4. Groq — último recurso
  const text = await callGroq(options);
  console.warn(`[PlanoMagistra/ai] Groq usado como fallback 3 (format=${fallbackFormat}).`);
  return { text, provider: "groq", format: fallbackFormat };
}
