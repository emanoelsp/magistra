/**
 * Capabilities derived from user plan tier.
 * Single source of truth — all feature gates reference this.
 */

export interface PlanCapabilities {
  /** Minhas Escolas page + escola/turma association in templates/planos */
  canAccessEscolas: boolean;
  /** Histórico page */
  canAccessHistorico: boolean;
  /** Histórico filters by escola/turma/curso */
  historicoWithOrg: boolean;
  /** "Gerar todas sugestões" bulk button in PlanEditor */
  canUseBulkIa: boolean;
  /** Escola/turma shortcut in plano creation wizard */
  canAssociateEscola: boolean;
  /** Biblioteca de templates (Regente only) */
  canAccessBiblioteca: boolean;
  /** Relatórios de uso (Regente only) */
  canAccessRelatorios: boolean;
}

function normalizePlan(plano: string): string {
  return plano?.trim().toLowerCase() || "free";
}

export function getPlanCapabilities(plano: string): PlanCapabilities {
  const tier = normalizePlan(plano);

  // Explorador (free)
  if (tier === "free" || tier === "explorador") {
    return {
      canAccessEscolas: false,
      canAccessHistorico: false,
      historicoWithOrg: false,
      canUseBulkIa: false,
      canAssociateEscola: false,
      canAccessBiblioteca: false,
      canAccessRelatorios: false,
    };
  }

  // Educador (starter)
  if (tier === "starter" || tier === "educador") {
    return {
      canAccessEscolas: false,
      canAccessHistorico: true,
      historicoWithOrg: false,
      canUseBulkIa: false,
      canAssociateEscola: false,
      canAccessBiblioteca: false,
      canAccessRelatorios: false,
    };
  }

  // Mestre (medio)
  if (tier === "medio" || tier === "mestre") {
    return {
      canAccessEscolas: true,
      canAccessHistorico: true,
      historicoWithOrg: true,
      canUseBulkIa: true,
      canAssociateEscola: true,
      canAccessBiblioteca: false,
      canAccessRelatorios: false,
    };
  }

  // Regente (pro, avancado, premium, escola)
  return {
    canAccessEscolas: true,
    canAccessHistorico: true,
    historicoWithOrg: true,
    canUseBulkIa: true,
    canAssociateEscola: true,
    canAccessBiblioteca: true,
    canAccessRelatorios: true,
  };
}

export const PLAN_DISPLAY: Record<string, string> = {
  free:     "Explorador",
  starter:  "Educador",
  medio:    "Mestre",
  pro:      "Regente",
  escola:   "Regente",
  avancado: "Regente",
  premium:  "Regente",
};

export function getPlanLabel(plano: string): string {
  return PLAN_DISPLAY[normalizePlan(plano)] ?? plano;
}
