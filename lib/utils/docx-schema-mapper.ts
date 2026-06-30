/**
 * docx-schema-mapper — PlanoMagistra
 *
 * Deterministic rules for mapping document labels → canonical field keys,
 * and field keys → schema metadata (group, role, type, aiInstructions).
 *
 * Derived from structural analysis of three EMIEP/CEDUP-SC templates:
 *   • C-Planejamento anual - EMIEP-2026
 *   • Plano_30dias (CEDUP Hermann Hering)
 *   • Plano de aula / Sequência Didática
 *
 * See docs/REGRAS_MAPEAMENTO_PLACEHOLDERS.md for the full rule set.
 */

import type {
  TemplateFieldSchema,
  TemplateFieldGroup,
  TemplateFieldRole,
  TemplateFieldKind,
  InjectionPattern,
} from "../types/firestore";
import type { StructuralPair } from "./docx-filler";

// ── Normalization helpers ────────────────────────────────────────────────────

/** Normalize text for key derivation: lowercase, remove accents, collapse spaces. */
function normForKey(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")  // remove diacritics
    .replace(/\(s\)/g, "s")            // Habilidade(s) → habilidades
    .replace(/\(es\)/g, "es")          // Professor(es) → professores
    .replace(/\(a\)/g, "a")            // Professor(a) → professora → trim later
    .replace(/n[°º]/gi, "numero")      // Nº / N° → numero
    .replace(/[^a-z0-9\s]/g, " ")      // non-alphanumeric → space
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize known document typos before key derivation.
 * Applied to the normalized string (already lowercased, accent-free).
 */
function normalizeTypos(s: string): string {
  return s
    .replace(/esteruturantes/g, "estruturantes")   // conceitos esteruturantes → estruturantes
    .replace(/protosta/g, "proposta")               // atividade protosta → proposta
    .replace(/realizacao/g, "realizacao")           // already correct, no-op
    .replace(/\bpresencial\b/g, "presencial");      // no-op, for documentation
}

// ── Label → canonical key mapping table ─────────────────────────────────────
//
// Each entry: [normalized_label_fragment, canonical_key]
// Entries are matched in order — more specific (longer) entries must precede
// shorter/more generic ones.  The search uses normForKey(label).includes(fragment).
//
// Rules (from REGRAS_MAPEAMENTO_PLACEHOLDERS.md §3):
//   1. Exact match: normForKey(label) === fragment → key
//   2. Partial match: fragment.length >= 4 && normForKey(label).includes(fragment) → key

const LABEL_TO_KEY: Array<[string, string]> = [
  // ── Identificação do professor ──────────────────────────────────────────
  ["nome do professor",           "nome_prof"],
  ["nome professor",              "nome_prof"],
  ["professor a",                 "professor"],    // PROFESSOR (A): → professor
  ["professora",                  "professor"],
  ["professor",                   "professor"],
  ["docente",                     "professor"],
  ["regente",                     "professor"],
  ["orientador",                  "professor"],
  ["ministrante",                 "professor"],

  // ── Escola / Instituição ────────────────────────────────────────────────
  ["unidade escolar",             "escola"],
  ["colegio",                     "escola"],
  ["instituicao",                 "escola"],
  ["escola",                      "escola"],

  // ── Curso ───────────────────────────────────────────────────────────────
  ["nome do curso",               "nome_curso"],
  ["nome curso",                  "nome_curso"],
  ["curso",                       "nome_curso"],

  // ── Área / Componente ───────────────────────────────────────────────────
  // "area_componente" (Plano 30 dias funde área + componente)
  ["area componente",             "area_componente"],
  // "area_conhecimento" (Planejamento Anual e Plano de Aula)
  ["area s do conhecimento",      "area_conhecimento"],
  ["area do conhecimento",        "area_conhecimento"],
  ["area conhecimento",           "area_conhecimento"],
  // fallback genérico
  ["area",                        "area_conhecimento"],

  // ── Componente Curricular ────────────────────────────────────────────────
  ["componentes curriculares",    "componente_curricular"],
  ["componente curricular",       "componente_curricular"],
  ["componente",                  "componente_curricular"],
  ["disciplina",                  "componente_curricular"],
  ["materia",                     "componente_curricular"],

  // ── Turma ───────────────────────────────────────────────────────────────
  ["turma s",                     "turma"],
  ["turma",                       "turma"],
  ["ano serie",                   "turma"],
  ["serie",                       "turma"],
  ["classe",                      "turma"],

  // ── Período / Data ──────────────────────────────────────────────────────
  ["periodo",                     "periodo"],

  // ── Número de aulas ─────────────────────────────────────────────────────
  ["numero aulas semanais",       "numero_aulas"],
  ["numero de aulas semanais",    "numero_aulas"],
  ["numero de aulas",             "numero_aulas"],
  ["numero aulas",                "numero_aulas"],
  ["n aulas semanais",            "numero_aulas"],  // Nº aulas semanais

  // ── Carga horária ────────────────────────────────────────────────────────
  ["carga horaria presencial",    "chpresencial"],
  ["carga horaria nao presencial","chnpresencial"],
  ["carga horaria prevista",      "ch_prevista"],
  ["ch prevista",                 "ch_prevista"],
  ["carga horaria",               "carga_horaria"],

  // ── Datas ────────────────────────────────────────────────────────────────
  ["data ou periodo de realizacao","data_inicio"],  // range → _inicio/_fim handled by AI
  ["data de realizacao",          "data_inicio"],
  ["data inicio",                 "data_inicio"],
  ["data fim",                    "data_fim"],
  ["data atual",                  "data_atual"],

  // ── Trimestres (marcadores) ──────────────────────────────────────────────
  ["1 trimestre",                 "tr1"],
  ["2 trimestre",                 "tr2"],
  ["3 trimestre",                 "tr3"],
  ["primeiro trimestre",          "tr1"],
  ["segundo trimestre",           "tr2"],
  ["terceiro trimestre",          "tr3"],

  // ── Objetivos ────────────────────────────────────────────────────────────
  ["objetivo geral do componente","objetivo_geral_componente"],
  ["objetivo geral componente",   "objetivo_geral_componente"],
  ["objetivo geral",              "objetivo_geral_componente"],
  ["objetivos de aprendizagem",   "objetivos_aprendizagem"],
  ["objetivos aprendizagem",      "objetivos_aprendizagem"],
  ["expectativas de aprendizagem","expectativa_aprendizagem"],
  ["expectativa aprendizagem",    "expectativa_aprendizagem"],
  ["expectativas",                "expectativa_aprendizagem"],

  // ── Temática ─────────────────────────────────────────────────────────────
  ["tematica abordada",           "tematica_abordada"],
  ["tematica",                    "tematica_abordada"],

  // ── Competências ─────────────────────────────────────────────────────────
  ["competencias gerais bncc",    "competencias_gerais_bncc"],
  ["competencias gerais",         "competencias_gerais_bncc"],
  ["competencias especificas da area","competencias_especificas_area"],
  ["competencias especificas area","competencias_especificas_area"],
  ["competencias especificas",    "competencias_especificas_area"],
  ["competencias",                "competencias_gerais_bncc"],  // fallback

  // ── Conteúdos / Conceitos estruturantes ─────────────────────────────────
  // typo normalizations applied before lookup via normalizeTypos()
  ["conceitos estruturantes e objetos do conhecimento","conceitos_estruturantes_e_objetos_conhecimento"],
  ["conceitos estruturantes e objetos conhecimento",   "conceitos_estruturantes_e_objetos_conhecimento"],
  ["conceitos estruturantes da area","conceitos_estruturantes"],
  ["conceitos estruturantes",     "conceitos_estruturantes"],

  // ── Objetos do conhecimento ──────────────────────────────────────────────
  ["objetos de conhecimento em estudo","objetos_conhecimento"],
  ["objetos do conhecimento",     "objetos_conhecimento"],
  ["objetos de conhecimento",     "objetos_conhecimento"],
  ["objeto de conhecimento",      "objetos_conhecimento"],
  ["objeto conhecimento",         "objetos_conhecimento"],
  ["objeto s de conhecimento",    "objetos_conhecimento"],
  ["objeto s conhecimento",       "objetos_conhecimento"],

  // ── Habilidades ──────────────────────────────────────────────────────────
  ["habilidades selecionadas",    "habilidades"],
  ["habilidade s selecionada s",  "habilidades"],
  ["habilidades",                 "habilidades"],
  ["habilidade",                  "habilidades"],

  // ── Metodologia / Atividades ──────────────────────────────────────────────
  // typo: "protosta" → "proposta" (via normalizeTypos before lookup)
  ["atividade proposta metodologia","atividade_proposta_metodologia"],
  ["atividade proposta",          "atividade_proposta_metodologia"],
  ["atividade metodologia",       "atividade_proposta_metodologia"],
  ["metodologia",                 "metodologia"],
  ["experiencias de ensino e aprendizagem","experiencia_ensino_aprendizagem"],
  ["experiencia de ensino e aprendizagem", "experiencia_ensino_aprendizagem"],
  ["experiencias de ensino aprendizagem",  "experiencia_ensino_aprendizagem"],
  ["experiencia ensino aprendizagem",      "experiencia_ensino_aprendizagem"],

  // ── Recursos ──────────────────────────────────────────────────────────────
  ["recursos necessarios",        "recursos"],
  ["recursos",                    "recursos"],

  // ── Avaliação ─────────────────────────────────────────────────────────────
  ["instrumento s avaliativos utilizados","instrumentos_avaliativos"],
  ["instrumentos avaliativos utilizados","instrumentos_avaliativos"],
  ["instrumentos avaliativos",    "instrumentos_avaliativos"],
  ["avaliacao",                   "avaliacao"],

  // ── Recuperação paralela ──────────────────────────────────────────────────
  ["recuperacao paralela da aprendizagem","recuperacao_paralela"],
  ["recuperacao paralela",        "recuperacao_paralela"],

  // ── 2º Professor / Articulação ────────────────────────────────────────────
  ["plano de articulacao",        "articulacao_2professor"],   // partial: "plano de articulacao com 2..."
  ["articulacao 2",               "articulacao_2professor"],
  ["articulacao",                 "articulacao_2professor"],
  ["adaptacoes e observacoes",    "adaptacao_2professor"],
  ["adaptacoes observacoes",      "adaptacao_2professor"],
  ["adaptacoes",                  "adaptacao_2professor"],

  // ── Projetos ──────────────────────────────────────────────────────────────
  ["projetos integradores",       "projeto_integrador"],
  ["projeto integrador",          "projeto_integrador"],
  ["projeto",                     "projeto_integrador"],

  // ── Referências ───────────────────────────────────────────────────────────
  ["referencias bibliograficas",  "referencias_bibliograficas"],
  ["referencias",                 "referencias_bibliograficas"],
];

// ── Key → field metadata ─────────────────────────────────────────────────────

export interface FieldMeta {
  group: TemplateFieldGroup;
  role: TemplateFieldRole;
  type: TemplateFieldKind;
  aiInstructions: string;
  required: boolean;
}

const KEY_TO_META: Record<string, FieldMeta> = {
  // ── dados_turma — manual ─────────────────────────────────────────────────
  professor:           { group: "dados_turma", role: "manual", type: "text",     aiInstructions: "", required: true  },
  nome_prof:           { group: "dados_turma", role: "manual", type: "text",     aiInstructions: "", required: true  },
  escola:              { group: "dados_turma", role: "manual", type: "text",     aiInstructions: "", required: false },
  nome_curso:          { group: "dados_turma", role: "manual", type: "text",     aiInstructions: "", required: false },
  area_conhecimento:   { group: "dados_turma", role: "manual", type: "text",     aiInstructions: "", required: true  },
  area_componente:     { group: "dados_turma", role: "manual", type: "text",     aiInstructions: "", required: true  },
  componente_curricular: { group: "dados_turma", role: "manual", type: "text",   aiInstructions: "", required: true  },
  turma:               { group: "dados_turma", role: "manual", type: "text",     aiInstructions: "", required: true  },
  periodo:             { group: "dados_turma", role: "manual", type: "text",     aiInstructions: "", required: false },
  numero_aulas:        { group: "dados_turma", role: "manual", type: "text",     aiInstructions: "", required: false },
  chpresencial:        { group: "dados_turma", role: "manual", type: "text",     aiInstructions: "", required: false },
  chnpresencial:       { group: "dados_turma", role: "manual", type: "text",     aiInstructions: "", required: false },
  ch_prevista:         { group: "dados_turma", role: "manual", type: "text",     aiInstructions: "", required: false },
  carga_horaria:       { group: "dados_turma", role: "manual", type: "text",     aiInstructions: "", required: false },
  data_inicio:         { group: "dados_turma", role: "manual", type: "text",     aiInstructions: "", required: false },
  data_fim:            { group: "dados_turma", role: "manual", type: "text",     aiInstructions: "", required: false },
  data_atual:          { group: "dados_turma", role: "manual", type: "text",     aiInstructions: "", required: false },
  tr1:                 { group: "dados_turma", role: "manual", type: "text",     aiInstructions: "", required: false },
  tr2:                 { group: "dados_turma", role: "manual", type: "text",     aiInstructions: "", required: false },
  tr3:                 { group: "dados_turma", role: "manual", type: "text",     aiInstructions: "", required: false },

  // ── objetivos — ia_sugerida ──────────────────────────────────────────────
  objetivo_geral_componente: {
    group: "objetivos", role: "ia_sugerida", type: "textarea",
    aiInstructions: "Formule objetivos mensuráveis com verbos de ação no infinitivo, conectados às habilidades.",
    required: true,
  },
  objetivos_aprendizagem: {
    group: "objetivos", role: "ia_sugerida", type: "textarea",
    aiInstructions: "Formule objetivos mensuráveis com verbos de ação no infinitivo, conectados às habilidades.",
    required: true,
  },
  expectativa_aprendizagem: {
    group: "objetivos", role: "ia_sugerida", type: "textarea",
    aiInstructions: "Formule objetivos mensuráveis com verbos de ação no infinitivo, conectados às habilidades.",
    required: true,
  },
  tematica_abordada: {
    group: "objetivos", role: "manual", type: "textarea",
    aiInstructions: "",
    required: true,
  },

  // ── competencias — ia_sugerida ────────────────────────────────────────────
  competencias_gerais_bncc: {
    group: "competencias", role: "ia_sugerida", type: "textarea",
    aiInstructions: "Parafraseie competências BNCC aplicadas ao componente e nível de ensino — nunca cópia literal.",
    required: true,
  },
  competencias_especificas_area: {
    group: "competencias", role: "ia_sugerida", type: "textarea",
    aiInstructions: "Parafraseie competências BNCC aplicadas ao componente e nível de ensino — nunca cópia literal.",
    required: true,
  },

  // ── habilidades — ia_sugerida ─────────────────────────────────────────────
  habilidades: {
    group: "habilidades", role: "ia_sugerida", type: "textarea",
    aiInstructions: "Selecione habilidades BNCC alinhadas ao componente curricular e ao período letivo.",
    required: true,
  },

  // ── conteudos — ia_sugerida ───────────────────────────────────────────────
  conceitos_estruturantes: {
    group: "conteudos", role: "ia_sugerida", type: "textarea",
    aiInstructions: "Organize do mais básico ao mais complexo, alinhado ao período letivo e às habilidades.",
    required: true,
  },
  conceitos_estruturantes_e_objetos_conhecimento: {
    group: "conteudos", role: "ia_sugerida", type: "textarea",
    aiInstructions: "Organize do mais básico ao mais complexo, alinhado ao período letivo e às habilidades.",
    required: true,
  },
  objetos_conhecimento: {
    group: "conteudos", role: "ia_sugerida", type: "textarea",
    aiInstructions: "Organize do mais básico ao mais complexo, alinhado ao período letivo e às habilidades.",
    required: true,
  },
  metodologia: {
    group: "conteudos", role: "ia_sugerida", type: "textarea",
    aiInstructions: "Elabore considerando os objetivos de aprendizagem e as habilidades definidas neste plano.",
    required: true,
  },
  atividade_proposta_metodologia: {
    group: "conteudos", role: "ia_sugerida", type: "textarea",
    aiInstructions: "Elabore considerando os objetivos de aprendizagem e as habilidades definidas neste plano.",
    required: true,
  },
  experiencia_ensino_aprendizagem: {
    group: "conteudos", role: "ia_sugerida", type: "textarea",
    aiInstructions: "Elabore considerando os objetivos de aprendizagem e as habilidades definidas neste plano.",
    required: true,
  },
  recursos: {
    group: "conteudos", role: "manual", type: "textarea",
    aiInstructions: "",
    required: false,
  },

  // ── avaliacao ─────────────────────────────────────────────────────────────
  avaliacao: {
    group: "avaliacao", role: "ia_sugerida", type: "textarea",
    aiInstructions: "Defina instrumentos alinhados às habilidades e objetivos do plano.",
    required: true,
  },
  instrumentos_avaliativos: {
    group: "avaliacao", role: "manual", type: "textarea",
    aiInstructions: "",
    required: false,
  },
  recuperacao_paralela: {
    group: "avaliacao", role: "manual", type: "textarea",
    aiInstructions: "",
    required: false,
  },

  // ── outros ────────────────────────────────────────────────────────────────
  articulacao_2professor: {
    group: "outros", role: "manual", type: "textarea",
    aiInstructions: "",
    required: false,
  },
  adaptacao_2professor: {
    group: "outros", role: "manual", type: "textarea",
    aiInstructions: "",
    required: false,
  },
  projeto_integrador: {
    group: "outros", role: "ia_sugerida", type: "textarea",
    aiInstructions: "Seja específico ao contexto da turma, disciplina e período descritos no plano.",
    required: false,
  },
  referencias_bibliograficas: {
    group: "outros", role: "manual", type: "textarea",
    aiInstructions: "",
    required: false,
  },
};

// ── Exported: label → canonical key ─────────────────────────────────────────

/**
 * Converts any document label to a canonical snake_case field key.
 *
 * Algorithm (§3 of REGRAS_MAPEAMENTO_PLACEHOLDERS.md):
 *   1. Normalize: lowercase, remove accents, expand (s)/(es)/(a), Nº → numero
 *   2. Apply typo corrections (esteruturantes → estruturantes, protosta → proposta)
 *   3. Strip leading/trailing punctuation and prefixes ("- ", ":"…)
 *   4. Exact match in LABEL_TO_KEY table → return canonical key
 *   5. Partial match (longer fragment first) → return canonical key
 *   6. Generic snake_case fallback → join words with "_", max 40 chars
 */
export function labelToKey(label: string): string {
  const stripped = label
    .replace(/:+$/, "")        // trailing colons
    .replace(/^[-\s]+/, "")   // leading "- "
    .trim();

  const norm = normalizeTypos(normForKey(stripped));

  // 1. Exact match
  for (const [fragment, key] of LABEL_TO_KEY) {
    if (norm === fragment) return key;
  }

  // 2. Partial match — longer fragments take priority
  const sorted = [...LABEL_TO_KEY].sort((a, b) => b[0].length - a[0].length);
  for (const [fragment, key] of sorted) {
    if (fragment.length >= 4 && norm.includes(fragment)) return key;
  }

  // 3. Generic fallback: snake_case, max 40 chars
  return norm.replace(/\s+/g, "_").slice(0, 40);
}

// ── Exported: key → field metadata ──────────────────────────────────────────

/**
 * Returns the canonical group/role/type/aiInstructions/required for a field key.
 *
 * Handles trimester-suffixed keys (e.g. "habilidades_tr1") by stripping the
 * suffix and looking up the base key metadata.
 */
export function keyToFieldMeta(key: string): FieldMeta {
  if (key in KEY_TO_META) return KEY_TO_META[key];

  // Trimester suffix: conceitos_estruturantes_tr2 → base: conceitos_estruturantes
  const trMatch = key.match(/^(.+?)_tr\d+$/);
  if (trMatch) {
    const baseMeta = KEY_TO_META[trMatch[1]];
    if (baseMeta) return baseMeta;
  }

  // Numbered suffix: habilidades_1, conceitos_2 → base lookup
  const numMatch = key.match(/^(.+?)_\d+$/);
  if (numMatch) {
    const baseMeta = KEY_TO_META[numMatch[1]];
    if (baseMeta) return baseMeta;
  }

  // Unknown key: classify by keyword heuristics
  if (/habilidade|bncc|saeb/.test(key)) {
    return { group: "habilidades", role: "ia_sugerida", type: "textarea",
      aiInstructions: "Selecione habilidades BNCC alinhadas ao componente curricular e ao período letivo.",
      required: true };
  }
  if (/competencia/.test(key)) {
    return { group: "competencias", role: "ia_sugerida", type: "textarea",
      aiInstructions: "Parafraseie competências BNCC aplicadas ao componente e nível de ensino — nunca cópia literal.",
      required: true };
  }
  if (/objetivo|expectativa/.test(key)) {
    return { group: "objetivos", role: "ia_sugerida", type: "textarea",
      aiInstructions: "Formule objetivos mensuráveis com verbos de ação no infinitivo, conectados às habilidades.",
      required: true };
  }
  if (/avaliacao|avaliativ/.test(key)) {
    return { group: "avaliacao", role: "ia_sugerida", type: "textarea",
      aiInstructions: "Defina instrumentos alinhados às habilidades e objetivos do plano.",
      required: false };
  }
  if (/metodologia|atividade|experiencia|conteudo|conceito|objeto/.test(key)) {
    return { group: "conteudos", role: "ia_sugerida", type: "textarea",
      aiInstructions: "Elabore considerando os objetivos de aprendizagem e as habilidades definidas neste plano.",
      required: false };
  }
  if (/data|turma|professor|escola|componente|area|periodo|carga|hora|curso|numero|aula/.test(key)) {
    return { group: "dados_turma", role: "manual", type: "text", aiInstructions: "", required: false };
  }

  return { group: "outros", role: "manual", type: "textarea", aiInstructions: "", required: false };
}

// ── Exported: key → complete TemplateFieldSchema ─────────────────────────────

/**
 * Builds a minimal but valid TemplateFieldSchema from a field key.
 * Used as a fast path for pre-annotated templates (those that already have
 * {{key}} placeholders typed by the user) and as a fallback in scanPlaceholders.
 *
 * The label is derived by reversing snake_case, with title case.
 * For best UX the AI should override the label with the actual document text.
 */
export function keyToField(key: string): TemplateFieldSchema {
  const meta = keyToFieldMeta(key);
  const label = key
    .replace(/_tr(\d)$/, " — Trimestre $1")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    key,
    label,
    type: meta.type,
    required: meta.required,
    role: meta.role,
    group: meta.group,
    aiInstructions: meta.aiInstructions || undefined,
  };
}

// ── Exported: structural pairs → draft schema ────────────────────────────────

/**
 * Converts the output of scanDocxStructure() into a draft TemplateFieldSchema[].
 *
 * This draft is DETERMINISTIC — no AI calls. It should be sent to the AI as
 * <schema_rascunho> so the AI validates and enriches it rather than creating
 * from scratch.
 *
 * Period-column handling:
 *   - Period marker pairs (1º, 2º, 3º) → keys tr1, tr2, tr3.
 *   - Content columns adjacent to period markers → single field (no _tr suffix).
 *     The AI is responsible for expanding these to _tr1/_tr2/_tr3 when appropriate,
 *     guided by the period_column pairs in the structural context.
 *
 * Deduplication: labels that map to the same key are collapsed to one field.
 * Period pairs with the same base label but different periodSuffix are kept distinct.
 */
export function structuralPairsToSchema(pairs: StructuralPair[]): TemplateFieldSchema[] {
  const schema: TemplateFieldSchema[] = [];
  const seenKeys = new Set<string>();

  for (const pair of pairs) {
    const baseKey = labelToKey(pair.label);

    // Period markers: "1º" → tr1, "2º" → tr2, etc.
    // The periodSuffix is already encoded in the key derivation for ordinal labels.
    // For non-ordinal content columns with a periodSuffix, append the suffix.
    let key = baseKey;
    if (pair.periodSuffix && baseKey !== "tr1" && baseKey !== "tr2" && baseKey !== "tr3") {
      key = baseKey + pair.periodSuffix;
    }

    const cleanLabel = pair.label.replace(/:+$/, "").replace(/^[-\s]+/, "").trim();

    if (seenKeys.has(key)) {
      // Two structurally distinct pairs mapped to the same canonical key
      // (e.g. "HABILIDADES" and "HABILIDADES CURRÍCULO DE EDUCAÇÃO DIGITAL" both → "habilidades").
      // Generate a unique key from the full normalized label so both fields appear in the
      // draft schema — the AI will then see them independently and assign proper keys.
      const fullNorm = normForKey(cleanLabel).replace(/\s+/g, "_").slice(0, 40);
      const fallbackKey = fullNorm && fullNorm !== key ? fullNorm : `${key}_2`;
      if (seenKeys.has(fallbackKey)) continue; // truly identical label
      key = fallbackKey;
    }
    seenKeys.add(key);

    const meta = keyToFieldMeta(key);

    // Type refinement: inline_colon + short preview + dados_turma → text
    let type = meta.type;
    if (
      (pair.pattern === "adjacent_right" || pair.pattern === "inline_colon") &&
      meta.group === "dados_turma" &&
      meta.type === "textarea"
    ) {
      type = "text";
    }

    const field: TemplateFieldSchema = {
      key,
      label: cleanLabel,
      type,
      required: meta.required,
      role: meta.role,
      group: meta.group,
      injection_pattern: pair.pattern as InjectionPattern,
    };
    if (meta.aiInstructions) field.aiInstructions = meta.aiInstructions;

    schema.push(field);
  }

  return schema;
}
