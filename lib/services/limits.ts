import "server-only";

import { getAdminDb } from "../firebase/admin";

export interface PlanLimits {
  maxTemplates: number;
  maxPlanosPerMonth: number;
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  free:     { maxTemplates: 1,   maxPlanosPerMonth: 1   },  // Explorador — R$0
  starter:  { maxTemplates: 1,   maxPlanosPerMonth: 2   },  // Educador   — R$9,90
  medio:    { maxTemplates: 2,   maxPlanosPerMonth: 4   },  // Mestre     — R$19,90
  pro:      { maxTemplates: 5,   maxPlanosPerMonth: 10  },  // Regente    — R$49,90
  avancado: { maxTemplates: 5,   maxPlanosPerMonth: 10  },  // alias → Regente
  premium:  { maxTemplates: 5,   maxPlanosPerMonth: 10  },  // alias → Regente
  escola:   { maxTemplates: 999, maxPlanosPerMonth: 999 },  // Escola     — sob consulta
};

export interface LimitsStatus {
  canCreateTemplate: boolean;
  canCreatePlano: boolean;
  currentTemplates: number;
  currentPlanosThisMonth: number;
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
  const normalizedPlano = plano?.trim().toLowerCase() || "free";
  const limits = PLAN_LIMITS[normalizedPlano] ?? PLAN_LIMITS.free;

  const [templatesSnap, planosSnap] = await Promise.all([
    db.collection("magis_templates").where("user_id", "==", userId).get(),
    db.collection("magis_planos").where("user_id", "==", userId).get(),
  ]);

  const monthStart = getMonthStart();
  let currentPlanosThisMonth = 0;

  for (const doc of planosSnap.docs) {
    const d = doc.data();
    const created = toDate(d.data_geracao);
    if (created && created >= monthStart) {
      currentPlanosThisMonth += 1;
    }
  }

  const currentTemplates = templatesSnap.size;

  return {
    canCreateTemplate: currentTemplates < limits.maxTemplates,
    canCreatePlano: currentPlanosThisMonth < limits.maxPlanosPerMonth,
    currentTemplates,
    currentPlanosThisMonth,
    limits,
    plano: normalizedPlano,
  };
}
