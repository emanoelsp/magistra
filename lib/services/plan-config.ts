export interface PlanLimits {
  maxTemplates: number;
  maxPlanosPerMonth: number;
  maxDownloadsPerPlano: number;
  /** Teto mensal de chamadas à /api/ia/campo — protege contra grinding sustentado */
  maxIaCampoCallsPerMonth: number;
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  free:     { maxTemplates: 1,   maxPlanosPerMonth: 1,   maxDownloadsPerPlano: 1,   maxIaCampoCallsPerMonth: 50   },
  starter:  { maxTemplates: 2,   maxPlanosPerMonth: 2,   maxDownloadsPerPlano: 1,   maxIaCampoCallsPerMonth: 130  },
  medio:    { maxTemplates: 3,   maxPlanosPerMonth: 4,   maxDownloadsPerPlano: 3,   maxIaCampoCallsPerMonth: 270  },
  pro:      { maxTemplates: 8,   maxPlanosPerMonth: 10,  maxDownloadsPerPlano: 3,   maxIaCampoCallsPerMonth: 675  },
  avancado: { maxTemplates: 8,   maxPlanosPerMonth: 10,  maxDownloadsPerPlano: 4,   maxIaCampoCallsPerMonth: 675  },
  premium:  { maxTemplates: 8,   maxPlanosPerMonth: 10,  maxDownloadsPerPlano: 4,   maxIaCampoCallsPerMonth: 675  },
  escola:   { maxTemplates: 999, maxPlanosPerMonth: 999, maxDownloadsPerPlano: 999, maxIaCampoCallsPerMonth: 9999 },
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
