import "server-only";

import { getAdminDb } from "../firebase/admin";
import type { UsageAction } from "../types/firestore";

// Gemini 2.0 Flash pricing (USD per 1M tokens)
const DEFAULT_INPUT_COST_PER_1M = 0.075;
const DEFAULT_OUTPUT_COST_PER_1M = 0.30;

interface LogUsageParams {
  userId: string;
  action: UsageAction;
  model: string;
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

    // Fetch current cost config (fall back to defaults if not set)
    const configSnap = await db.collection("admin_config").doc("singleton").get();
    const config = configSnap.data() ?? {};
    const inputRate = (config.gemini_input_cost_per_1m as number) ?? DEFAULT_INPUT_COST_PER_1M;
    const outputRate = (config.gemini_output_cost_per_1m as number) ?? DEFAULT_OUTPUT_COST_PER_1M;

    const tokensTotal = params.tokensInput + params.tokensOutput;
    const costUsd =
      (params.tokensInput / 1_000_000) * inputRate +
      (params.tokensOutput / 1_000_000) * outputRate;

    await db.collection("usage_logs").add({
      user_id: params.userId,
      action: params.action,
      model: params.model,
      tokens_input: params.tokensInput,
      tokens_output: params.tokensOutput,
      tokens_total: tokensTotal,
      cost_usd: costUsd,
      timestamp: new Date().toISOString(),
      metadata: params.metadata ?? {},
    });

    // Update user's token counter
    await db
      .collection("users")
      .doc(params.userId)
      .set(
        { tokens_usados_mes: (await db.collection("users").doc(params.userId).get()).data()?.tokens_usados_mes + tokensTotal || tokensTotal },
        { merge: true },
      );
  } catch (err) {
    // Never throw — usage logging must not break the main request
    console.warn("[PlanoMagistra/usage-logger] Falha ao registrar uso:", err);
  }
}
