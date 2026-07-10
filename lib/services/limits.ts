import "server-only";

import { getAdminDb } from "../firebase/admin";
export { PLAN_LIMITS, PLAN_PRICES_BRL, PLAN_LABELS, normalizePlanKey } from "./plan-config";
export type { PlanLimits } from "./plan-config";
import { PLAN_LIMITS, normalizePlanKey } from "./plan-config";
import type { PlanLimits } from "./plan-config";

export interface LimitsStatus {
  canCreateTemplate: boolean;
  canCreatePlano: boolean;
  currentTemplates: number;
  currentPlanosThisMonth: number;
  /** Saldo de chamadas de sugestão IA no mês (ia_campo + gerar_plano). */
  iaCallsRemaining: number;
  limits: PlanLimits;
  plano: string;
}

function getMonthStart(): Date {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const p = new Date(value);
    return Number.isNaN(p.getTime()) ? null : p;
  }
  if (typeof value === "object" && value !== null && "toDate" in value && typeof (value as { toDate: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate();
  }
  return null;
}

export async function getLimitsStatus(userId: string, plano: string): Promise<LimitsStatus> {
  const db = getAdminDb();
  const normalizedPlano = normalizePlanKey(plano);
  const baseLimits = PLAN_LIMITS[normalizedPlano] ?? PLAN_LIMITS.free;

  const [templatesSnap, planosSnap, userSnap] = await Promise.all([
    db.collection("magis_templates").where("user_id", "==", userId).get(),
    db.collection("magins_planos_aula").where("user_id", "==", userId).get(),
    db.collection("magis_users").doc(userId).get(),
  ]);

  const userData = userSnap.data() ?? {};
  const avulsoTemplates = (userData.avulso_templates as number | undefined) ?? 0;
  const avulsoPlanos = (userData.avulso_planos as number | undefined) ?? 0;

  const limits: PlanLimits = {
    ...baseLimits,
    maxTemplates: baseLimits.maxTemplates >= 999 ? baseLimits.maxTemplates : baseLimits.maxTemplates + avulsoTemplates,
    maxPlanosPerMonth: baseLimits.maxPlanosPerMonth >= 999 ? baseLimits.maxPlanosPerMonth : baseLimits.maxPlanosPerMonth + avulsoPlanos,
  };

  const monthStart = getMonthStart();
  let currentPlanosThisMonth = 0;

  for (const doc of planosSnap.docs) {
    const d = doc.data();
    if (d.status !== "gerado") continue; // only finalized plans count toward limit
    const created = toDate(d.data_geracao);
    if (created && created >= monthStart) {
      currentPlanosThisMonth += 1;
    }
  }

  // Exclude soft-deleted templates from the count
  const currentTemplates = templatesSnap.docs.filter((d) => !d.data().deleted_at).length;

  // Mesmo formato/reset das rotas de IA: contador zera quando o mês vira
  const currentMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  const iaCallsMes = (userData.ia_campo_mes as string | undefined) === currentMonth
    ? ((userData.ia_campo_calls_mes as number | undefined) ?? 0)
    : 0;

  return {
    canCreateTemplate: currentTemplates < limits.maxTemplates,
    canCreatePlano: currentPlanosThisMonth < limits.maxPlanosPerMonth,
    currentTemplates,
    currentPlanosThisMonth,
    iaCallsRemaining: Math.max(0, limits.maxIaCampoCallsPerMonth - iaCallsMes),
    limits,
    plano: normalizedPlano,
  };
}
