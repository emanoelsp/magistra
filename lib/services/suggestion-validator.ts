import type { IaSugestao } from "../types/firestore";

const MIN_DESCRICAO_LEN = 20;

// BNCC code patterns:
// EF: EF01MA01, EF02LP03 (2-digit year + 2-letter component + 2-digit sequence)
// EM: EM13CNT101, EM13LP01, EM13MAT101 (EM13 + component + 2-3 digit sequence)
// SAEB: descriptors like D01, D32
const BNCC_CODE_REGEX = /^(EF\d{2}[A-Z]{2,3}\d{2}|EM13[A-Z]{2,3}\d{2,3}|D\d{2})$/;

function validateBnccCode(fonte: string): boolean {
  if (!fonte?.trim()) return true; // no fonte is fine — not all fields cite codes
  // Extract all code-like tokens from the fonte string
  const tokens = fonte.trim().split(/[\s,;]+/);
  const codeTokens = tokens.filter((t) => /^[A-Z]{2}\d/.test(t));
  if (codeTokens.length === 0) return true; // fonte is descriptive text, not a code
  return codeTokens.every((code) => BNCC_CODE_REGEX.test(code));
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
  // Jaccard similarity on words
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

    // Validate BNCC code format in fonte — mark as unverified rather than removing
    let fonteValidada = s.fonte;
    if (s.fonte && !validateBnccCode(s.fonte)) {
      console.warn("[suggestion-validator] Código BNCC com formato inválido:", { ...context, id: s.id, fonte: s.fonte });
      fonteValidada = undefined; // strip invalid code, keep suggestion
    }

    seen.push(fingerprint);
    valid.push({ ...s, fonte: fonteValidada });
  }

  return valid;
}
