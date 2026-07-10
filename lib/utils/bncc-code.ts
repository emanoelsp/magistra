/**
 * Canonical BNCC/SAEB code utilities — single source of truth for the TypeScript side.
 *
 * Imported by:
 *   - lib/services/bncc-validator.ts   (closed-world filter)
 *   - lib/services/suggestion-validator.ts (structural format check)
 *
 * The Python ingest_bncc.py is the documented mirror of this module.
 * Keep regexes and component whitelists in sync when editing either side.
 */

// ── Regexes ───────────────────────────────────────────────────────────────────
// No /i flag — codes are always uppercase in the BNCC spec.
// Word-boundary anchored to avoid matching substrings in identifiers.

/** Matches any BNCC code (EF, EI, EM) in running text. */
export const RE_BNCC = /\b(EF|EI|EM)\d{2}[A-Z]{2,3}\d{2,3}\b/g;

/**
 * Matches SAEB descriptor codes in running text.
 *
 * Deliberate constraints vs. the previous /\b[DT]\d{1,3}\b/gi:
 *   1. Uppercase only (no /i) — "d1" or "t2" in prose are NOT SAEB descriptors.
 *   2. D-prefix only — T-prefixed topics (T1, T2) rarely appear in teacher plan text
 *      and collide with common abbreviations (trimestre, turno, tipo).
 *   3. 1–2 digits max — SAEB has D1–D30; D100 is not a valid descriptor.
 */
export const RE_SAEB = /\bD\d{1,2}\b/g;

// ── Component whitelists ──────────────────────────────────────────────────────

export const COMPS_EF = new Set([
  "LP","AR","EF","LI","MA","CI","HI","GE","ER",
]);

export const CAMPOS_EI = new Set([
  "CG","TS","EO","ET",
  // less common but valid in some editions
  "EL","EP",
]);

export const COMPS_EM = new Set([
  // Áreas integradas (EM13 prefix)
  "LGG","MAT","CNT","CHS",
  // Specific components under each area
  "LP","AR","EF","LI","LE","MA","FI","QU","BI","HI","GE","SO","FL","ER",
]);

/**
 * Year-pair strings that actually occur in published EF codes: individual
 * years 01–09 plus the multi-year faixas (EF12EF, EF15LP, EF35EF, EF67LP,
 * EF69AR, EF89EF). Anything else (e.g. "24") is a fabricated code even when
 * the digits parse to a plausible range.
 */
export const FAIXAS_EF = new Set([
  "01","02","03","04","05","06","07","08","09",
  "12","15","35","67","69","89",
]);

// ── Decomposer ────────────────────────────────────────────────────────────────

export interface CodigoDecomposto {
  codigo:     string;
  etapa:      "EF" | "EI" | "EM";
  /** Year / faixa numbers covered by this code. Empty for EM. */
  anos:       number[];
  componente: string;
  seq:        number;
  valido:     boolean;
  /** Human-readable reason when valido === false. */
  erro?:      string;
}

const RE_EF = /^EF(\d{2})([A-Z]{2,3})(\d{2})$/;
const RE_EI = /^EI(\d{2})([A-Z]{2,3})(\d{2})$/;
const RE_EM = /^EM13([A-Z]{2,3})(\d{2,3})$/;

/**
 * "67" → [6,7]; "15" → [1,2,3,4,5]; "09" → [9]; "35" → [3,4,5]
 * A leading zero means an individual year ("01".."09"); otherwise the first
 * digit is the low bound and the second is the high bound.
 * When lo > hi the pair is treated as two individual years (e.g. "91" → [9,1]
 * is invalid in the real BNCC but we report it rather than silently ignoring).
 */
function parseAnos(anos2: string): number[] {
  if (anos2.startsWith("0")) return [parseInt(anos2, 10)];
  const lo = parseInt(anos2[0] ?? "0", 10);
  const hi = parseInt(anos2[1] ?? "0", 10);
  if (lo === hi) return [lo];
  if (lo < hi) {
    const out: number[] = [];
    for (let y = lo; y <= hi; y++) out.push(y);
    return out;
  }
  return [lo, hi]; // malformed range — caller checks valido
}

/**
 * Structurally decomposes and validates a BNCC code.
 * Returns null when the string is not a recognisable BNCC code at all.
 * Returns a result with valido=false when the code has the right shape but
 * fails the component whitelist or year-range check.
 */
export function decompor(raw: string): CodigoDecomposto | null {
  const c = raw.trim().toUpperCase();
  let m: RegExpMatchArray | null;

  m = c.match(RE_EF);
  if (m) {
    const [, anos2, comp, seq] = m as [string, string, string, string];
    const anos = parseAnos(anos2);
    const valido = COMPS_EF.has(comp) && FAIXAS_EF.has(anos2);
    return {
      codigo: c, etapa: "EF", anos, componente: comp,
      seq: parseInt(seq, 10), valido,
      erro: valido ? undefined : `Componente "${comp}" ou faixa de anos "${anos2}" inválidos para EF`,
    };
  }

  m = c.match(RE_EI);
  if (m) {
    const [, faixa, campo, seq] = m as [string, string, string, string];
    const faixaNum = parseInt(faixa, 10);
    const valido = CAMPOS_EI.has(campo) && faixaNum >= 1 && faixaNum <= 5;
    return {
      codigo: c, etapa: "EI", anos: [faixaNum], componente: campo,
      seq: parseInt(seq, 10), valido,
      erro: valido ? undefined : `Campo de experiência "${campo}" ou faixa "${faixa}" inválidos para EI`,
    };
  }

  m = c.match(RE_EM);
  if (m) {
    const [, area, seq] = m as [string, string, string];
    const valido = COMPS_EM.has(area);
    return {
      codigo: c, etapa: "EM", anos: [], componente: area,
      seq: parseInt(seq, 10), valido,
      erro: valido ? undefined : `Área/componente "${area}" não reconhecido para EM`,
    };
  }

  return null;
}

// ── Extraction helpers ────────────────────────────────────────────────────────

/** Extracts all BNCC codes from text (deduplicated, uppercased). Resets lastIndex. */
export function extractBnccCodes(text: string): string[] {
  RE_BNCC.lastIndex = 0;
  return [...new Set((text.match(RE_BNCC) ?? []).map((c) => c.toUpperCase()))];
}

/** Extracts SAEB descriptor codes D1–D30 from text (strict uppercase). */
export function extractSaebCodes(text: string): string[] {
  RE_SAEB.lastIndex = 0;
  return [...new Set((text.match(RE_SAEB) ?? []).map((c) => c.toUpperCase()))];
}

/** Extracts all curriculum codes (BNCC + SAEB) from text. */
export function extractAllCodes(text: string): string[] {
  return [...new Set([...extractBnccCodes(text), ...extractSaebCodes(text)])];
}
