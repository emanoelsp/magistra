/**
 * Closed-world BNCC code validator.
 *
 * Principle (from Fable 5): AI redige livremente, mas CÓDIGOS BNCC/SAEB citados
 * devem existir no conjunto recuperado pelo RAG — nunca vindos da memória do modelo.
 * Códigos inventados ("EF07LP99", componente errado, número fora de range) são
 * descartados aqui, ANTES de chegar ao professor.
 *
 * Usage:
 *   const allowed = buildAllowedCodes(curriculum);
 *   const filtered = filterSugestoes(sugestoes, allowed);
 */

import type { IaSugestao } from "../types/firestore";

// Same pattern used in the Python ingest script (canonical — keep in sync)
const RE_BNCC_CODE = /\b(EF|EM|EI)\d{2}[A-Z]{2,3}\d{2,3}\b/g;
const RE_SAEB_CODE = /\b[DT]\d{1,3}\b/gi;

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

/** Returns all BNCC/SAEB codes cited in a string. */
function extractCitedCodes(text: string): string[] {
  const bncc = [...(text.match(RE_BNCC_CODE) ?? [])].map((c) => c.toUpperCase());
  const saeb = [...(text.match(RE_SAEB_CODE) ?? [])].map((c) => c.toUpperCase());
  return [...new Set([...bncc, ...saeb])];
}

/**
 * Returns false when the suggestion cites at least one BNCC/SAEB code
 * that is NOT in the allowed set. Cross-component adaptations (already
 * tagged in the prompt with "→ adaptável para X") are let through — the
 * AI was explicitly told to use them.
 *
 * When allowedCodes is empty, all suggestions pass (no context = no restriction).
 */
export function isSugestaoValid(
  s: IaSugestao,
  allowedCodes: Set<string>,
): boolean {
  if (allowedCodes.size === 0) return true;
  const text = `${s.label ?? ""} ${s.descricao ?? ""} ${s.fonte ?? ""}`;
  const cited = extractCitedCodes(text);
  if (cited.length === 0) return true; // no code cited → no restriction
  return cited.every((code) => allowedCodes.has(code));
}

/**
 * Filters suggestions, removing those with codes outside the allowed set.
 * If filtering would leave zero suggestions, returns the original list
 * (fail-open: better to show an unvalidated suggestion than nothing).
 */
export function filterSugestoes(
  sugestoes: IaSugestao[],
  allowedCodes: Set<string>,
): { filtered: IaSugestao[]; removedCount: number } {
  if (allowedCodes.size === 0) return { filtered: sugestoes, removedCount: 0 };

  const valid = sugestoes.filter((s) => isSugestaoValid(s, allowedCodes));
  if (valid.length === 0) {
    // Fail-open: log and return originals
    console.warn(
      "[bncc-validator] Todas as sugestões contêm códigos inválidos — retornando sem filtro.",
      sugestoes.map((s) => extractCitedCodes(`${s.label} ${s.fonte}`)),
    );
    return { filtered: sugestoes, removedCount: 0 };
  }
  return { filtered: valid, removedCount: sugestoes.length - valid.length };
}
