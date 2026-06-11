import "server-only";

import { getAdminDb } from "../firebase/admin";
import type { UsageAction } from "../types/firestore";
import type { AiProvider } from "../ai/provider";

// Pricing per 1M tokens (USD)
const COST_RATES: Record<string, { input: number; output: number }> = {
  gemini:  { input: 0.075, output: 0.30 },
  openai:  { input: 0.15,  output: 0.60 },  // gpt-4o-mini
  groq:    { input: 0,     output: 0 },      // free tier
};
const DEFAULT_RATES = COST_RATES.gemini;

interface LogUsageParams {
  userId: string;
  action: UsageAction;
  model: string;
  provider?: AiProvider;
  tokensInput: number;
  tokensOutput: number;
  metadata?: {
    template_id?: string;
    plano_id?: string;
    field_key?: string;
  };
}

export async function logUsage(params: LogUsageParams): Promise<void> {
  try {
    const db = getAdminDb();

    const provider = params.provider ?? "gemini";
    const rates = COST_RATES[provider] ?? DEFAULT_RATES;

    // For Gemini, also check admin-configured rates
    let inputRate = rates.input;
    let outputRate = rates.output;
    if (provider === "gemini") {
      const configSnap = await db.collection("magis_admin_config").doc("singleton").get();
      const config = configSnap.data() ?? {};
      inputRate = (config.gemini_input_cost_per_1m as number) ?? inputRate;
      outputRate = (config.gemini_output_cost_per_1m as number) ?? outputRate;
    }

    const tokensTotal = params.tokensInput + params.tokensOutput;
    const costUsd =
      (params.tokensInput / 1_000_000) * inputRate +
      (params.tokensOutput / 1_000_000) * outputRate;

    await db.collection("magis_usage_logs").add({
      user_id: params.userId,
      action: params.action,
      model: params.model,
      provider,
      tokens_input: params.tokensInput,
      tokens_output: params.tokensOutput,
      tokens_total: tokensTotal,
      cost_usd: costUsd,
      timestamp: new Date().toISOString(),
      metadata: params.metadata ?? {},
    });

    // Update user's token counter
    await db
      .collection("magis_users")
      .doc(params.userId)
      .set(
        { tokens_usados_mes: (await db.collection("magis_users").doc(params.userId).get()).data()?.tokens_usados_mes + tokensTotal || tokensTotal },
        { merge: true },
      );
  } catch (err) {
    // Never throw — usage logging must not break the main request
    console.warn("[PlanoMagistra/usage-logger] Falha ao registrar uso:", err);
  }
}
