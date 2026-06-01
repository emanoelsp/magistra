export interface PlanLimits {
  maxTemplates: number;
  maxPlanosPerMonth: number;
  maxDownloadsPerPlano: number;
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  free:     { maxTemplates: 1,   maxPlanosPerMonth: 1,   maxDownloadsPerPlano: 1   },
  starter:  { maxTemplates: 1,   maxPlanosPerMonth: 2,   maxDownloadsPerPlano: 1   },
  medio:    { maxTemplates: 2,   maxPlanosPerMonth: 4,   maxDownloadsPerPlano: 2   },
  pro:      { maxTemplates: 5,   maxPlanosPerMonth: 10,  maxDownloadsPerPlano: 4   },
  avancado: { maxTemplates: 5,   maxPlanosPerMonth: 10,  maxDownloadsPerPlano: 4   },
  premium:  { maxTemplates: 5,   maxPlanosPerMonth: 10,  maxDownloadsPerPlano: 4   },
  escola:   { maxTemplates: 999, maxPlanosPerMonth: 999, maxDownloadsPerPlano: 999 },
};

export const PLAN_PRICES_BRL: Record<string, number> = {
  free:     0,
  starter:  9.90,
  medio:    19.90,
  pro:      49.90,
  avancado: 49.90,
  premium:  49.90,
  escola:   0,
};

export const PLAN_LABELS: Record<string, string> = {
  free:     "Explorador",
  starter:  "Educador",
  medio:    "Mestre",
  pro:      "Regente",
  avancado: "Regente",
  premium:  "Regente",
  escola:   "Escola",
};

// Normaliza labels ou aliases para a chave canônica do plano
const LABEL_TO_KEY: Record<string, string> = {
  explorador: "free",
  educador:   "starter",
  mestre:     "medio",
  regente:    "pro",
  escola:     "escola",
  avancado:   "pro",
  premium:    "pro",
};

export function normalizePlanKey(raw: string | null | undefined): string {
  if (!raw) return "free";
  const lower = raw.trim().toLowerCase();
  return PLAN_LIMITS[lower] ? lower : (LABEL_TO_KEY[lower] ?? "free");
}
