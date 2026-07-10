/**
 * Closed-world BNCC code validator.
 *
 * Principle: AI writes freely, but every BNCC/SAEB code it cites must exist in
 * the set retrieved by the RAG — never from the model's parametric memory.
 *
 * All regexes and code extraction logic live in lib/utils/bncc-code.ts,
 * which is the canonical TypeScript source. The Python ingest_bncc.py mirrors it.
 */

import type { IaSugestao } from "../types/firestore";
import { extractAllCodes } from "../utils/bncc-code";

// ── Allowed-code set builder ──────────────────────────────────────────────────

/**
 * Builds the set of codes that are valid for the current request.
 * Empty set = "no context" → validation is skipped (no false positives).
 */
export function buildAllowedCodes(curriculum: {
  bncc: Array<{ codigo: string }>;
  saeb: Array<{ codigo: string }>;
}): Set<string> {
  const allowed = new Set<string>();
  for (const c of curriculum.bncc) if (c.codigo) allowed.add(c.codigo.toUpperCase());
  for (const c of curriculum.saeb) if (c.codigo) allowed.add(c.codigo.toUpperCase());
  return allowed;
}

// ── Per-suggestion check ──────────────────────────────────────────────────────

/**
 * Returns the list of codes cited in the suggestion that are NOT in allowedCodes.
 * Empty result → suggestion is valid (either no codes cited or all codes allowed).
 *
 * Cross-component adaptations (tagged in the prompt context with "→ adaptável para X")
 * are safe: those codes are included in allowedCodes because buildAllowedCodes collects
 * every code returned by Pinecone regardless of component. The "→ adaptável" marker
 * in the prompt is purely informational for the model; it creates no bypass here.
 */
export function invalidCodesIn(s: IaSugestao, allowedCodes: Set<string>): string[] {
  if (allowedCodes.size === 0) return [];
  const text = `${s.label ?? ""} ${s.descricao ?? ""} ${s.fonte ?? ""}`;
  const cited = extractAllCodes(text);
  return cited.filter((code) => !allowedCodes.has(code));
}

export function isSugestaoValid(s: IaSugestao, allowedCodes: Set<string>): boolean {
  return invalidCodesIn(s, allowedCodes).length === 0;
}

// ── Batch filter ──────────────────────────────────────────────────────────────

export interface FilterResult {
  filtered:    IaSugestao[];
  removedCount: number;
  /**
   * True when EVERY suggestion cited at least one invalid code — no valid
   * suggestion survived the filter. The caller must NOT fall-open silently;
   * it should retry with a correction prompt or mark suggestions precisaRevisao.
   */
  allInvalid:  boolean;
  /** The invalid codes found across all removed suggestions (for the correction prompt). */
  invalidCodes: string[];
}

/**
 * Filters suggestions, removing those that cite codes outside the allowed set.
 *
 * IMPORTANT: When allInvalid === true, the caller must:
 *   1. Attempt ONE regeneration with the error injected into the prompt.
 *   2. If the regeneration also returns allInvalid, mark remaining suggestions
 *      with precisaRevisao: true and return them so the UI warns the teacher.
 *   Never silently return unvalidated suggestions when allInvalid is true.
 */
export function filterSugestoes(
  sugestoes: IaSugestao[],
  allowedCodes: Set<string>,
): FilterResult {
  if (allowedCodes.size === 0) {
    return { filtered: sugestoes, removedCount: 0, allInvalid: false, invalidCodes: [] };
  }

  const invalidPerSugestao = sugestoes.map((s) => ({
    s,
    bad: invalidCodesIn(s, allowedCodes),
  }));

  const valid   = invalidPerSugestao.filter((x) => x.bad.length === 0).map((x) => x.s);
  const invalid = invalidPerSugestao.filter((x) => x.bad.length > 0);
  const allInvalidCodes = [...new Set(invalid.flatMap((x) => x.bad))];

  if (valid.length > 0) {
    return {
      filtered:     valid,
      removedCount: invalid.length,
      allInvalid:   false,
      invalidCodes: allInvalidCodes,
    };
  }

  // All suggestions failed — do NOT fall-open. Signal the caller.
  return {
    filtered:     [],           // empty → caller must retry or mark precisaRevisao
    removedCount: sugestoes.length,
    allInvalid:   true,
    invalidCodes: allInvalidCodes,
  };
}

// ── Correction prompt builder ─────────────────────────────────────────────────

/**
 * Returns a correction paragraph to prepend to the original prompt on retry.
 * The paragraph is in the same language as the system instruction (pt-BR) so
 * the model receives a single-language request.
 */
export function buildCorrecaoPrompt(invalidCodes: string[]): string {
  return (
    `⚠️ CORREÇÃO OBRIGATÓRIA: na tentativa anterior você citou os seguintes códigos ` +
    `que NÃO estão no contexto fornecido: ${invalidCodes.join(", ")}.\n` +
    `Use APENAS os códigos listados em <habilidades_bncc> e <descritores_saeb>. ` +
    `Se não houver código adequado para este campo, NÃO cite nenhum código — escreva a sugestão sem referência numérica.\n\n`
  );
}
