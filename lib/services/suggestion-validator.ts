import type { IaSugestao } from "../types/firestore";
import { decompor, extractBnccCodes, extractSaebCodes } from "../utils/bncc-code";

const MIN_DESCRICAO_LEN = 20;

/**
 * Validates BNCC/SAEB codes found in the fonte field using the canonical
 * decompor() function, which checks both format and component whitelists.
 * Returns false if any extracted code fails structural validation.
 */
function hasValidCodesInFonte(fonte: string): boolean {
  const bnccCodes = extractBnccCodes(fonte);
  for (const code of bnccCodes) {
    const d = decompor(code);
    if (!d || !d.valido) return false;
  }

  const saebCodes = extractSaebCodes(fonte);
  for (const code of saebCodes) {
    const num = parseInt(code.slice(1), 10);
    if (num < 1 || num > 30) return false;
  }

  return true;
}

function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isTooSimilar(a: string, b: string): boolean {
  const na = normalizeForComparison(a);
  const nb = normalizeForComparison(b);
  if (na === nb) return true;
  const wa = new Set(na.split(" "));
  const wb = new Set(nb.split(" "));
  const intersection = [...wa].filter((w) => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union > 0 && intersection / union > 0.75;
}

export function validateSugestoes(
  sugestoes: IaSugestao[],
  context?: { templateId?: string; fieldKey?: string },
): IaSugestao[] {
  const valid: IaSugestao[] = [];
  const seen: string[] = [];

  for (const s of sugestoes) {
    const descricao = s.descricao?.trim() ?? "";
    const label = s.label?.trim() ?? "";

    if (!label) {
      console.warn("[suggestion-validator] Removida: sem label", { ...context, id: s.id });
      continue;
    }

    if (descricao.length > 0 && descricao.length < MIN_DESCRICAO_LEN) {
      console.warn("[suggestion-validator] Removida: descrição muito curta", { ...context, id: s.id, len: descricao.length });
      continue;
    }

    const fingerprint = `${label} ${descricao}`;
    if (seen.some((prev) => isTooSimilar(prev, fingerprint))) {
      console.warn("[suggestion-validator] Removida: duplicata", { ...context, id: s.id });
      continue;
    }

    // Strip malformed codes from fonte rather than removing the whole suggestion.
    let fonteValidada = s.fonte;
    if (s.fonte && !hasValidCodesInFonte(s.fonte)) {
      console.warn("[suggestion-validator] Código com formato inválido removido de fonte:", { ...context, id: s.id, fonte: s.fonte });
      fonteValidada = undefined;
    }

    seen.push(fingerprint);
    valid.push({ ...s, fonte: fonteValidada });
  }

  return valid;
}
