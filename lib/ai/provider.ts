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

export type AiProvider = "claude" | "gemini" | "openai" | "groq" | "ollama";

/** Token usage reported by the provider — feeds the cost dashboard via logUsage. */
export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AiResult {
  text: string;
  provider: AiProvider;
  /** "json" when the provider returned structured JSON; "toon" when it used TOON line format. */
  format: "json" | "toon";
  /** Present when the provider reports usage — absent only for providers that omit it. */
  usage?: AiUsage;
}

/** Internal per-provider result before the orchestrator stamps provider/format. */
interface ProviderText {
  text: string;
  usage?: AiUsage;
}

// ── Constantes ────────────────────────────────────────────────────────────────

const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
const GEMINI_MODEL = process.env.GOOGLE_GEMINI_MODEL ?? "gemini-2.0-flash";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const GROQ_MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1";
// Modelos tentados em ordem; pula automaticamente os que exigem assinatura (403) ou não existem (404)
const OLLAMA_MODELS: string[] = [
  process.env.OLLAMA_MODEL ?? "",
  "gemma4",
  "deepseek-v4-flash",
  "glm-4.7",
  "glm-5",
  "minimax-m2.1",
  "nemotron-3-super",
  "qwen3.5",
  "gpt-oss",
  "deepseek-v4-pro",
  "glm-5.1",
  "minimax-m2.5",
  "kimi-k2.5",
  "nemotron-3-ultra",
  "qwen3-coder",
  "glm-5.2",
  "minimax-m3",
  "kimi-k2.6",
  "minimax-m2.7",
  "kimi-k2.7-code",
  "gemini-3-flash-preview",
].filter((m, i, arr) => m && arr.indexOf(m) === i); // dedup e remove vazio

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

// Timeout por chamada. Sem ele, um provider que trava sem responder consome a
// função serverless inteira e o fallback nunca chega a rodar. Timeout NÃO é
// retryado (retryar um provider travado custa outra janela inteira) — ele
// derruba direto para o próximo provider da cadeia.
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) > 0
  ? Number(process.env.AI_TIMEOUT_MS)
  : 120_000;

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
  return genAI.getGenerativeModel(
    {
      model: GEMINI_MODEL,
      generationConfig: {
        temperature: options.temperature ?? 0.1,
        topP: options.topP ?? 0.6,
        topK: options.topK ?? 40,
        responseMimeType: "application/json",
        ...(options.geminiSchema ? { responseSchema: options.geminiSchema } : {}),
      },
      systemInstruction,
    },
    { timeout: AI_TIMEOUT_MS },
  );
}

// ── Provedores individuais ─────────────────────────────────────────────────────

async function callClaude(options: AiCallOptions): Promise<ProviderText> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY não configurada.");
  // maxRetries: 0 — o withRetry daqui é a única camada de retry; deixar o retry
  // interno do SDK ligado multiplicaria as tentativas (3 × 2) em outages.
  const client = new Anthropic({ apiKey, timeout: AI_TIMEOUT_MS, maxRetries: 0 });
  // Claude segue instruções de JSON muito bem — ignora systemSuffixFallback (TOON é para
  // provedores que não suportam formato estruturado nativo).
  const create = (maxTokens: number) =>
    withRetry(() =>
      client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        temperature: options.temperature ?? 0.1,
        system: options.systemInstruction,
        messages: [{ role: "user", content: options.prompt }],
      }),
    );

  let message = await create(8192);
  // Saída truncada = JSON quebrado = 502 para o professor. Uma introspecção com
  // 30+ campos estoura 8192 tokens; repetir uma vez com teto 4x resolve sem
  // custo no caso comum (só paga quando realmente truncou).
  if (message.stop_reason === "max_tokens") {
    console.warn(`[PlanoMagistra/ai] Claude truncou em 8192 tokens — repetindo com teto 32768.`);
    message = await create(32_768);
    if (message.stop_reason === "max_tokens") {
      throw new Error("Claude: resposta truncada mesmo com max_tokens=32768.");
    }
  }

  const block = message.content.find((c) => c.type === "text");
  const text = block?.type === "text" ? block.text : undefined;
  if (!text) throw new Error("Claude retornou resposta vazia.");
  return {
    text,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    },
  };
}

async function callGemini(options: AiCallOptions): Promise<ProviderText> {
  const model = makeGeminiModel(options.systemInstruction, options);
  const result = await withRetry(() => model.generateContent(options.prompt));
  const meta = result.response.usageMetadata;
  return {
    text: result.response.text(),
    ...(meta
      ? { usage: { inputTokens: meta.promptTokenCount ?? 0, outputTokens: meta.candidatesTokenCount ?? 0 } }
      : {}),
  };
}

async function callOpenAI(options: AiCallOptions): Promise<ProviderText> {
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
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  });
  if (!res.ok) {
    const resBody = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${resBody}`);
  }
  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = data.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI retornou resposta vazia.");
  return {
    text: content,
    ...(data.usage
      ? { usage: { inputTokens: data.usage.prompt_tokens ?? 0, outputTokens: data.usage.completion_tokens ?? 0 } }
      : {}),
  };
}

async function callGroq(options: AiCallOptions): Promise<ProviderText> {
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
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  });
  if (!res.ok) {
    const resBody = await res.text();
    throw new Error(`Groq error ${res.status}: ${resBody}`);
  }
  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = data.choices[0]?.message?.content;
  if (!content) throw new Error("Groq retornou resposta vazia.");
  return {
    text: content,
    ...(data.usage
      ? { usage: { inputTokens: data.usage.prompt_tokens ?? 0, outputTokens: data.usage.completion_tokens ?? 0 } }
      : {}),
  };
}

async function callOllama(options: AiCallOptions): Promise<ProviderText> {
  const apiKey = process.env.OLLAMA_API_KEY;
  if (!apiKey) throw new Error("OLLAMA_API_KEY não configurada.");
  const useToon = Boolean(options.systemSuffixFallback);
  const systemContent = useToon
    ? options.systemInstruction + "\n\n" + options.systemSuffixFallback
    : options.systemInstruction;

  let lastError = "";
  for (const model of OLLAMA_MODELS) {
    const body: Record<string, unknown> = {
      model,
      stream: false,
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: options.prompt },
      ],
      options: { temperature: options.temperature ?? 0.1 },
    };
    if (!useToon) body.format = "json";

    const res = await fetch(`${OLLAMA_BASE_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });

    if (res.status === 403 || res.status === 404) {
      const msg = await res.text();
      console.warn(`[PlanoMagistra/ai] Ollama modelo "${model}" indisponível (${res.status}), tentando próximo...`);
      lastError = `${res.status}: ${msg}`;
      continue;
    }
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(`Ollama error ${res.status}: ${msg}`);
    }

    const data = (await res.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };
    const content = data.message?.content;
    if (!content) throw new Error(`Ollama modelo "${model}" retornou resposta vazia.`);
    console.info(`[PlanoMagistra/ai] Ollama usou modelo "${model}".`);
    return {
      text: content,
      ...(typeof data.eval_count === "number"
        ? { usage: { inputTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count } }
        : {}),
    };
  }

  throw new Error(`Ollama: nenhum modelo disponível. Último erro: ${lastError}`);
}

// ── Orquestrador com fallback em cadeia ───────────────────────────────────────

/**
 * Chama os provedores de IA em ordem: Claude → Gemini → OpenAI → Groq → Ollama.
 *
 * Semântica de fallback: QUALQUER falha de um provider (cota, 5xx persistente,
 * timeout, chave ausente, resposta vazia) derruba para o próximo da cadeia.
 * A versão anterior só caía em erro de cota — um 529 da Anthropic que esgotasse
 * os retries abortava a cadeia inteira com Gemini/OpenAI/Groq saudáveis. O
 * custo do fall-through indiscriminado (um request 4xx inválido tenta todos os
 * providers antes de falhar) é aceitável; indisponibilidade em outage não é.
 * Erros transientes (429/503/529) ainda são retryados DENTRO de cada provider
 * pelo withRetry antes de cair; timeouts caem direto.
 *
 * - Claude: primário. JSON nativo. Repete 1x com teto 4x quando trunca em max_tokens.
 * - Gemini: segundo. JSON com schema enforcement.
 * - OpenAI: terceiro. TOON quando systemSuffixFallback definido; JSON nativo caso contrário.
 * - Groq: quarto. Mesmo comportamento do OpenAI.
 * - Ollama: quinto/último recurso. Endpoint configurável via OLLAMA_BASE_URL.
 */
export async function callAIWithFallbacks(options: AiCallOptions): Promise<AiResult> {
  const fallbackFormat: "json" | "toon" = options.systemSuffixFallback ? "toon" : "json";

  const chain: Array<{
    provider: AiProvider;
    format: "json" | "toon";
    call: (o: AiCallOptions) => Promise<ProviderText>;
  }> = [
    { provider: "claude", format: "json", call: callClaude },
    { provider: "gemini", format: "json", call: callGemini },
    { provider: "openai", format: fallbackFormat, call: callOpenAI },
    { provider: "groq", format: fallbackFormat, call: callGroq },
    { provider: "ollama", format: fallbackFormat, call: callOllama },
  ];

  let lastError: unknown;
  for (let i = 0; i < chain.length; i++) {
    const { provider, format, call } = chain[i];
    try {
      const { text, usage } = await call(options);
      if (i > 0) {
        console.warn(`[PlanoMagistra/ai] ${provider} usado como fallback ${i} (format=${format}).`);
      }
      return { text, provider, format, ...(usage ? { usage } : {}) };
    } catch (err) {
      lastError = err;
      const motivo = isQuotaError(err) ? "cota/crédito esgotado" : (err as Error)?.message ?? "erro desconhecido";
      const proximo = chain[i + 1]?.provider ?? "nenhum";
      console.warn(`[PlanoMagistra/ai] ${provider} falhou (${motivo.slice(0, 200)}), próximo: ${proximo}`);
    }
  }
  throw lastError;
}
