import type { TemplateFieldClasse, TemplateFieldOrigem, TemplateFieldRole } from "../types/firestore";

/**
 * Deterministic rules for inferring a chip's lifecycle class from its key/role.
 * Same logic used server-side (introspection validation), client-side (badge display),
 * and in the migration script for existing field_positions data.
 *
 * Priority:
 *   1. If role === "ia_sugerida" → always "pedagogico"
 *   2. Check key against contextual patterns (dates, months, periods)
 *   3. Check key against perfil patterns (school, teacher, class identity)
 *   4. Default to "perfil" (conservative — better to over-restrict than over-generate)
 */

const PEDAGOGICO_BY_ROLE = new Set<TemplateFieldRole>(["ia_sugerida"]);

const CONTEXTUAL_PATTERNS: RegExp[] = [
  /^(ctx[_.]|mes[_.]|mes$|data[_.]|data_atual|data_geracao|data_realizacao|data_inicio|data_fim)/i,
  /^(bimestre|trimestre|semestre|periodo[_.]|periodo$)/i,
  /^(ano_letivo|ano_atual|ano$)/i,
];

const PERFIL_PATTERNS: RegExp[] = [
  /^(professor|docente|regente|ministrante|formador|orientador)[_.]?/i,
  /^(escola|unidade_escolar|colegio|instituicao)[_.]?/i,
  /^(turma|serie|ano_serie|classe)[_.]?/i,
  /^(area_componente|componente|disciplina|materia)[_.]?/i,
  /^(cargo|funcao|coordenador|diretor)[_.]?/i,
  /^(municipio|cidade|estado|uf)[_.]?/i,
];

const PEDAGOGICO_PATTERNS: RegExp[] = [
  /^(bncc|saeb|habilidade|competencia|conteudo|objetivo|metodologia|avaliacao|recurso)[_.]?/i,
  /^(ped[_.]|pedagogico)[_.]?/i,
  /^(expectativa|recuperacao|atividade|estrategia)[_.]?/i,
  /^(tematica|tema|projeto|objeto_conhecimento|unidade_tematica)[_.]?/i,
];

export function inferirClasse(
  key: string,
  role?: TemplateFieldRole | string,
): TemplateFieldClasse {
  if (role && PEDAGOGICO_BY_ROLE.has(role as TemplateFieldRole)) return "pedagogico";
  for (const re of CONTEXTUAL_PATTERNS) if (re.test(key)) return "contextual";
  for (const re of PEDAGOGICO_PATTERNS) if (re.test(key)) return "pedagogico";
  for (const re of PERFIL_PATTERNS) if (re.test(key)) return "perfil";
  return "perfil";
}

/** Maps old `role` to the equivalent `origem`. */
export function inferirOrigem(role?: TemplateFieldRole | string): TemplateFieldOrigem {
  if (role === "ia_sugerida") return "ia";
  return "manual";
}

/** Human-readable label for each class (pt-BR). */
export const CLASSE_LABELS: Record<TemplateFieldClasse, string> = {
  perfil:      "Perfil",
  pedagogico:  "Pedagógico",
  contextual:  "Contextual",
};

/** Tailwind color tokens for the class badge. */
export const CLASSE_COLORS: Record<TemplateFieldClasse, { bg: string; text: string; border: string }> = {
  perfil:     { bg: "bg-slate-100",   text: "text-slate-600",   border: "border-slate-200" },
  pedagogico: { bg: "bg-blue-50",     text: "text-blue-700",    border: "border-blue-200"  },
  contextual: { bg: "bg-amber-50",    text: "text-amber-700",   border: "border-amber-200" },
};
