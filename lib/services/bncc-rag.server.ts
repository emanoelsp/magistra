import "server-only";

import { Pinecone } from "@pinecone-database/pinecone";

const EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_API_VER = "v1beta";
const EMBEDDING_DIMENSIONS = 3072;
const TOP_K = 5;

// In-process embedding cache (5-min TTL) — avoids re-embedding identical RAG queries
// within a warm server instance. Keys are `${taskType}::${text}`.
const embeddingCache = new Map<string, { vector: number[]; expiresAt: number }>();
const EMBEDDING_CACHE_TTL_MS = 5 * 60 * 1000;

export interface BnccChunk {
  codigo: string;
  texto: string;
  area: string;
  componente: string;
  etapa: string;
  ano: string;
}

export interface SaebChunk {
  codigo: string;
  texto: string;
  componente: string;
  etapa: string;
  topico: string;
}

export interface CurriculoEstadualChunk {
  id: string;
  texto: string;
  estado: string;
  etapa: string;
  componente: string;
  secao: string;
}

export interface CnctChunk {
  id: string;
  texto: string;
  curso: string;
  eixo: string;
  etapa: string;
}

export interface CurriculoDigitalChunk {
  id: string;
  codigo: string;
  texto: string;
  etapa: string;
  ano: string;
  area: string;
}

export interface CurriculumContext {
  bncc: BnccChunk[];
  saeb: SaebChunk[];
  curriculo_estadual: CurriculoEstadualChunk[];
  cnct: CnctChunk[];
  curriculo_digital: CurriculoDigitalChunk[];
}

function getPinecone(): Pinecone {
  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) throw new Error("PINECONE_API_KEY não configurada.");
  return new Pinecone({ apiKey });
}

function getIndex() {
  const indexName = process.env.PINECONE_INDEX ?? "bncc";
  return getPinecone().index(indexName);
}

type EmbedTaskType = "RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT" | "SEMANTIC_SIMILARITY";

export async function embedText(
  text: string,
  taskType: EmbedTaskType = "RETRIEVAL_QUERY",
): Promise<number[]> {
  const cacheKey = `${taskType}::${text}`;
  const cached = embeddingCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.vector;

  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GEMINI_API_KEY não configurada.");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/${EMBEDDING_API_VER}/models/${EMBEDDING_MODEL}:embedContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: `models/${EMBEDDING_MODEL}`,
          content: { parts: [{ text }] },
          taskType,
        }),
        signal: controller.signal,
      },
    );
    if (!res.ok) throw new Error(`Embed error ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { embedding: { values: number[] } };
    embeddingCache.set(cacheKey, { vector: data.embedding.values, expiresAt: Date.now() + EMBEDDING_CACHE_TTL_MS });
    return data.embedding.values;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Componente fuzzy match ────────────────────────────────────────────────────

const COMPONENTES_BNCC = [
  "Matemática", "Língua Portuguesa", "Ciências", "História", "Geografia",
  "Arte", "Educação Física", "Língua Inglesa", "Ensino Religioso",
  "Física", "Química", "Biologia", "Sociologia", "Filosofia", "Língua Espanhola",
];

function normComp(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z\s]/g, "").trim();
}

// ── BNCC code exact-match ────────────────────────────────────────────────────

const BNCC_CODE_RE = /\b(EF|EM)\d{2}[A-Z]{2}\d{2,3}\b/g;

function extractBnccCodes(query: string): string[] {
  return [...new Set(query.match(BNCC_CODE_RE) ?? [])];
}

// ── Componente fuzzy match ────────────────────────────────────────────────────
export function matchComponente(raw: string): string | undefined {
  if (!raw) return undefined;
  const needle = normComp(raw);
  const needleTokens = needle.split(/\s+/);
  let best: string | undefined;
  let bestScore = 0;
  for (const c of COMPONENTES_BNCC) {
    const hay = normComp(c);
    const hayTokens = hay.split(/\s+/);
    const overlap = needleTokens.filter((t) => hayTokens.some((h) => h.includes(t) || t.includes(h))).length;
    const score = overlap / Math.max(needleTokens.length, hayTokens.length);
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best && bestScore >= 0.4 ? best : undefined;
}

// ── BNCC retrieval (default namespace — backwards compat) ────────────────────

export async function retrieveBnccContext(
  query: string,
  filters: { componente?: string; etapa?: string },
): Promise<BnccChunk[]> {
  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) return [];

  try {
    const index = getIndex();
    const codes = extractBnccCodes(query);

    // Fast path: exact fetch by BNCC code IDs — no embedding needed
    if (codes.length > 0) {
      const fetched = await index.fetch({ ids: codes }).catch(() => null);
      if (fetched) {
        const exact = Object.values(fetched.records ?? {})
          .filter((r) => r.metadata)
          .map((r) => ({
            codigo: String(r.metadata!["codigo"] ?? ""),
            texto: String(r.metadata!["texto"] ?? ""),
            area: String(r.metadata!["area"] ?? ""),
            componente: String(r.metadata!["componente"] ?? ""),
            etapa: String(r.metadata!["etapa"] ?? ""),
            ano: String(r.metadata!["ano"] ?? ""),
          }));
        if (exact.length > 0) return exact;
      }
    }

    const vector = await embedText(query);
    const pineconeFilter: Record<string, unknown> = {};
    if (filters.etapa) pineconeFilter["etapa"] = { $eq: filters.etapa };
    const comp = matchComponente(filters.componente ?? "");
    if (comp) pineconeFilter["componente"] = { $eq: comp };
    else if (filters.componente) {
      console.warn("[rag] Componente não mapeado, sem filtro:", filters.componente);
    }

    const response = await index.query({
      vector,
      topK: TOP_K,
      filter: Object.keys(pineconeFilter).length > 0 ? pineconeFilter : undefined,
      includeMetadata: true,
    });

    return (response.matches ?? [])
      .filter((m) => (m.score ?? 0) > 0.5)
      .map((m) => ({
        codigo: String(m.metadata?.["codigo"] ?? ""),
        texto: String(m.metadata?.["texto"] ?? ""),
        area: String(m.metadata?.["area"] ?? ""),
        componente: String(m.metadata?.["componente"] ?? ""),
        etapa: String(m.metadata?.["etapa"] ?? ""),
        ano: String(m.metadata?.["ano"] ?? ""),
      }));
  } catch (err) {
    console.warn("[rag] BNCC retrieval falhou, prosseguindo sem contexto:", err);
    return [];
  }
}

// ── SAEB retrieval (namespace "saeb") ────────────────────────────────────────

async function retrieveSaebContext(
  vector: number[],
  filters: { componente?: string; etapa?: string },
): Promise<SaebChunk[]> {
  try {
    const ns = getIndex().namespace("saeb");
    const pineconeFilter: Record<string, unknown> = {};
    const comp = matchComponente(filters.componente ?? "");
    if (comp) pineconeFilter["componente"] = { $eq: comp };

    const response = await ns.query({
      vector,
      topK: TOP_K,
      filter: Object.keys(pineconeFilter).length > 0 ? pineconeFilter : undefined,
      includeMetadata: true,
    });

    return (response.matches ?? [])
      .filter((m) => (m.score ?? 0) > 0.45)
      .map((m) => ({
        codigo: String(m.metadata?.["codigo"] ?? ""),
        texto: String(m.metadata?.["texto"] ?? ""),
        componente: String(m.metadata?.["componente"] ?? ""),
        etapa: String(m.metadata?.["etapa"] ?? ""),
        topico: String(m.metadata?.["topico"] ?? ""),
      }));
  } catch (err) {
    console.warn("[rag] SAEB retrieval falhou:", err);
    return [];
  }
}

// ── Currículo Estadual retrieval (namespace "curriculo_estadual") ─────────────

async function retrieveCurriculoEstadual(
  vector: number[],
  filters: { estado?: string; componente?: string; etapa?: string },
): Promise<CurriculoEstadualChunk[]> {
  if (!filters.estado) return [];
  try {
    const ns = getIndex().namespace("curriculo_estadual");
    const pineconeFilter: Record<string, unknown> = { estado: { $eq: filters.estado } };
    const comp = matchComponente(filters.componente ?? "");
    if (comp) pineconeFilter["componente"] = { $eq: comp };
    if (filters.etapa) pineconeFilter["etapa"] = { $eq: filters.etapa };

    const response = await ns.query({
      vector,
      topK: TOP_K,
      filter: pineconeFilter,
      includeMetadata: true,
    });

    return (response.matches ?? [])
      .filter((m) => (m.score ?? 0) > 0.45)
      .map((m) => ({
        id: String(m.id),
        texto: String(m.metadata?.["texto"] ?? ""),
        estado: String(m.metadata?.["estado"] ?? ""),
        etapa: String(m.metadata?.["etapa"] ?? ""),
        componente: String(m.metadata?.["componente"] ?? ""),
        secao: String(m.metadata?.["secao"] ?? ""),
      }));
  } catch (err) {
    console.warn("[rag] Currículo estadual retrieval falhou:", err);
    return [];
  }
}

// ── CNCT retrieval (namespace "cnct") ─────────────────────────────────────────

async function retrieveCnct(
  vector: number[],
  filters: { componente?: string },
): Promise<CnctChunk[]> {
  try {
    const ns = getIndex().namespace("cnct");
    const pineconeFilter: Record<string, unknown> = {};
    const comp = matchComponente(filters.componente ?? "");
    if (comp) pineconeFilter["componente"] = { $eq: comp };

    const response = await ns.query({
      vector,
      topK: TOP_K,
      filter: Object.keys(pineconeFilter).length > 0 ? pineconeFilter : undefined,
      includeMetadata: true,
    });

    return (response.matches ?? [])
      .filter((m) => (m.score ?? 0) > 0.45)
      .map((m) => ({
        id: String(m.id),
        texto: String(m.metadata?.["texto"] ?? ""),
        curso: String(m.metadata?.["curso"] ?? ""),
        eixo: String(m.metadata?.["eixo"] ?? ""),
        etapa: String(m.metadata?.["etapa"] ?? ""),
      }));
  } catch (err) {
    console.warn("[rag] CNCT retrieval falhou:", err);
    return [];
  }
}

// ── Currículo Digital retrieval (namespace "curriculo_digital") ───────────────

async function retrieveCurriculoDigital(
  vector: number[],
  filters: { etapa?: string },
): Promise<CurriculoDigitalChunk[]> {
  try {
    const ns = getIndex().namespace("curriculo_digital");
    const pineconeFilter: Record<string, unknown> = {};
    if (filters.etapa) pineconeFilter["etapa"] = { $eq: filters.etapa };

    const response = await ns.query({
      vector,
      topK: TOP_K,
      filter: Object.keys(pineconeFilter).length > 0 ? pineconeFilter : undefined,
      includeMetadata: true,
    });

    return (response.matches ?? [])
      .filter((m) => (m.score ?? 0) > 0.45)
      .map((m) => ({
        id: String(m.id),
        codigo: String(m.metadata?.["codigo"] ?? ""),
        texto: String(m.metadata?.["texto"] ?? ""),
        etapa: String(m.metadata?.["etapa"] ?? ""),
        ano: String(m.metadata?.["ano"] ?? ""),
        area: String(m.metadata?.["area"] ?? ""),
      }));
  } catch (err) {
    console.warn("[rag] Currículo Digital retrieval falhou:", err);
    return [];
  }
}

// ── Context pruning — limita total de chunks antes de injetar no prompt ──────

// Orçamento por namespace. BNCC é a âncora semântica (3 slots). SAEB complementa
// com descritores de avaliação (2 slots). Estadual/digital/cnct são sinaleiros
// contextuais — 1 slot cada é suficiente para ampliar sem afogar o modelo.
// Máx total: 8 chunks → evita "Lost in the Middle" ao manter contexto circular.
const NAMESPACE_BUDGET = {
  bncc:               3,
  saeb:               2,
  curriculo_estadual: 1,
  cnct:               1,
  curriculo_digital:  1,
} as const;

// Pinecone retorna resultados já ordenados por score DESC. slice(0, n) mantém
// os n mais relevantes de cada namespace — sem re-embedding, sem custo extra.
export function pruneCurriculumContext(ctx: CurriculumContext): CurriculumContext {
  return {
    bncc:               ctx.bncc.slice(0, NAMESPACE_BUDGET.bncc),
    saeb:               ctx.saeb.slice(0, NAMESPACE_BUDGET.saeb),
    curriculo_estadual: ctx.curriculo_estadual.slice(0, NAMESPACE_BUDGET.curriculo_estadual),
    cnct:               ctx.cnct.slice(0, NAMESPACE_BUDGET.cnct),
    curriculo_digital:  ctx.curriculo_digital.slice(0, NAMESPACE_BUDGET.curriculo_digital),
  };
}

// ── Namespace lookup — resolve namespace via dados reais, não heurística ──────

// Constrói um mapa token → namespace a partir dos chunks efetivamente recuperados.
// Usar os dados reais elimina a dependência de regex sobre a string `fonte` do LLM.
export function buildNamespaceLookup(ctx: CurriculumContext): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of ctx.bncc) {
    if (c.codigo) m.set(c.codigo.toLowerCase(), "bncc");
  }
  for (const c of ctx.saeb) {
    if (c.codigo) {
      m.set(c.codigo.toLowerCase(), "saeb");
      // Também indexa o código curto sem prefixo "saeb_lp_2001_" → "d01"
      const bare = c.codigo.replace(/^saeb_[a-z]+_\d{4}_/i, "");
      if (bare && bare !== c.codigo) m.set(bare.toLowerCase(), "saeb");
    }
  }
  for (const c of ctx.curriculo_estadual) {
    if (c.id) m.set(c.id.toLowerCase(), "curriculo_estadual");
  }
  for (const c of ctx.cnct) {
    if (c.curso) m.set(c.curso.toLowerCase(), "cnct");
    if (c.eixo) m.set(c.eixo.toLowerCase(), "cnct");
  }
  for (const c of ctx.curriculo_digital) {
    if (c.area) m.set(c.area.toLowerCase(), "curriculo_digital");
    if (c.codigo) m.set(c.codigo.toLowerCase(), "curriculo_digital");
  }
  return m;
}

// Resolve namespace pesquisando tokens do mapa no campo `fonte` do LLM.
// Tokens com ≤ 3 chars são ignorados para evitar colisões ("D0" etc.).
export function resolveNamespace(fonte: string, lookup: Map<string, string>): string {
  const fl = fonte.toLowerCase();
  for (const [token, ns] of lookup) {
    if (token.length > 3 && fl.includes(token)) return ns;
  }
  return "unknown";
}

// ── Query builder — linguagem natural melhora alinhamento vetorial ────────────

// Modelos de embedding (especialmente os treinados pela Google) são otimizados
// para intenção em linguagem natural, não para concatenação de tags. Transformar
// "Objetivos objetivos EF disciplina: Matemática" em
// "Objetivos de aprendizagem para Matemática no Ensino Fundamental" alinha o
// vetor de query com o tom dos documentos da BNCC indexados como RETRIEVAL_DOCUMENT.
export function buildRagQuery(params: {
  fieldLabel: string;
  fieldGroup?: string;
  componente: string;
  tipoPlano: string;
  pedagogicalContext: string;
  currentValuesContext: string;
}): string {
  const { fieldLabel, componente, tipoPlano, pedagogicalContext, currentValuesContext } = params;

  const etapaLabel = /médi|medio/i.test(tipoPlano)
    ? "Ensino Médio"
    : /fund/i.test(tipoPlano)
    ? "Ensino Fundamental"
    : tipoPlano || "Educação Básica";

  const base = componente
    ? `${fieldLabel} para ${componente} no ${etapaLabel}`
    : `${fieldLabel} para ${etapaLabel}`;

  const extras = [pedagogicalContext, currentValuesContext].filter(Boolean).join(" — ").slice(0, 300);
  return extras ? `${base} — ${extras}` : base;
}

// ── Combined retrieval — 1 embed call, queries in parallel ───────────────────

export async function retrieveAllCurriculumContext(
  query: string,
  filters: { componente?: string; etapa?: string; estado?: string },
  options?: { skipSaeb?: boolean; skipEstadual?: boolean; skipCnct?: boolean; skipDigital?: boolean },
): Promise<CurriculumContext> {
  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) return { bncc: [], saeb: [], curriculo_estadual: [], cnct: [], curriculo_digital: [] };

  try {
    const index = getIndex();
    const codes = extractBnccCodes(query);

    const pineconeFilter: Record<string, unknown> = {};
    if (filters.etapa) pineconeFilter["etapa"] = { $eq: filters.etapa };
    const comp = matchComponente(filters.componente ?? "");
    if (comp) pineconeFilter["componente"] = { $eq: comp };
    const hasFilter = Object.keys(pineconeFilter).length > 0;

    // Embed query and exact-fetch BNCC codes in parallel
    const [vector, exactFetch] = await Promise.all([
      embedText(query),
      codes.length > 0 ? index.fetch({ ids: codes }).catch(() => null) : Promise.resolve(null),
    ]);

    const bnccExact: BnccChunk[] = exactFetch
      ? Object.values(exactFetch.records ?? {})
          .filter((r) => r.metadata)
          .map((r) => ({
            codigo: String(r.metadata!["codigo"] ?? ""),
            texto: String(r.metadata!["texto"] ?? ""),
            area: String(r.metadata!["area"] ?? ""),
            componente: String(r.metadata!["componente"] ?? ""),
            etapa: String(r.metadata!["etapa"] ?? ""),
            ano: String(r.metadata!["ano"] ?? ""),
          }))
      : [];

    const [bnccResult, saebResult, estadualResult, cnctResult, digitalResult] = await Promise.all([
      // BNCC vector query — skipped when exact codes found
      bnccExact.length > 0
        ? Promise.resolve({ matches: [] as { score?: number; metadata?: Record<string, unknown> }[] })
        : index.query({
            vector, topK: TOP_K,
            filter: hasFilter ? pineconeFilter : undefined,
            includeMetadata: true,
          }).catch(() => ({ matches: [] as { score?: number; metadata?: Record<string, unknown> }[] })),

      // SAEB
      options?.skipSaeb
        ? Promise.resolve({ _saeb: [] as SaebChunk[] })
        : retrieveSaebContext(vector, filters).then((r) => ({ _saeb: r })).catch(() => ({ _saeb: [] as SaebChunk[] })),

      // Currículo Estadual — only if estado is set
      options?.skipEstadual || !filters.estado
        ? Promise.resolve({ _estadual: [] as CurriculoEstadualChunk[] })
        : retrieveCurriculoEstadual(vector, filters).then((r) => ({ _estadual: r })).catch(() => ({ _estadual: [] as CurriculoEstadualChunk[] })),

      // CNCT — cursos técnicos
      options?.skipCnct
        ? Promise.resolve({ _cnct: [] as CnctChunk[] })
        : retrieveCnct(vector, { componente: filters.componente }).then((r) => ({ _cnct: r })).catch(() => ({ _cnct: [] as CnctChunk[] })),

      // Currículo Digital / Computação na BNCC
      options?.skipDigital
        ? Promise.resolve({ _digital: [] as CurriculoDigitalChunk[] })
        : retrieveCurriculoDigital(vector, { etapa: filters.etapa }).then((r) => ({ _digital: r })).catch(() => ({ _digital: [] as CurriculoDigitalChunk[] })),
    ]);

    // Prefer exact matches; fall back to vector search results
    const bncc = bnccExact.length > 0
      ? bnccExact
      : (bnccResult.matches ?? [])
          .filter((m) => (m.score ?? 0) > 0.5)
          .map((m) => ({
            codigo: String(m.metadata?.["codigo"] ?? ""),
            texto: String(m.metadata?.["texto"] ?? ""),
            area: String(m.metadata?.["area"] ?? ""),
            componente: String(m.metadata?.["componente"] ?? ""),
            etapa: String(m.metadata?.["etapa"] ?? ""),
            ano: String(m.metadata?.["ano"] ?? ""),
          }));

    const saeb              = "_saeb"    in saebResult    ? saebResult._saeb       : [];
    const curriculo_estadual = "_estadual" in estadualResult ? estadualResult._estadual : [];
    const cnct              = "_cnct"    in cnctResult    ? cnctResult._cnct       : [];
    const curriculo_digital  = "_digital" in digitalResult  ? digitalResult._digital  : [];

    return { bncc, saeb, curriculo_estadual, cnct, curriculo_digital };
  } catch (err) {
    console.warn("[rag] Combined retrieval falhou, prosseguindo sem contexto:", err);
    return { bncc: [], saeb: [], curriculo_estadual: [], cnct: [], curriculo_digital: [] };
  }
}

export { EMBEDDING_DIMENSIONS };
