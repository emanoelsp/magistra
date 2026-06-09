import "server-only";

import { Pinecone } from "@pinecone-database/pinecone";

const EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_API_VER = "v1beta";
const EMBEDDING_DIMENSIONS = 3072;
const TOP_K = 5;

export interface BnccChunk {
  codigo: string;
  texto: string;
  area: string;
  componente: string;
  etapa: string;
  ano: string;
}

export interface CtbcChunk {
  id: string;
  texto: string;
  secao: string;
  componente: string;
  etapa: string;
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

export interface CurriculumContext {
  bncc: BnccChunk[];
  ctbc: CtbcChunk[];
  saeb: SaebChunk[];
  curriculo_estadual: CurriculoEstadualChunk[];
  cnct: CnctChunk[];
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
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GEMINI_API_KEY não configurada.");
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
    },
  );
  if (!res.ok) throw new Error(`Embed error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { embedding: { values: number[] } };
  return data.embedding.values;
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
function matchComponente(raw: string): string | undefined {
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

// ── Currículo Territorial retrieval (namespace "ctbc") ───────────────────────

async function retrieveCtbcContext(
  vector: number[],
  filters: { componente?: string; etapa?: string },
): Promise<CtbcChunk[]> {
  try {
    const ns = getIndex().namespace("ctbc");
    const pineconeFilter: Record<string, unknown> = {};
    const comp = matchComponente(filters.componente ?? "");
    if (comp) pineconeFilter["componente"] = { $eq: comp };
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
        texto: String(m.metadata?.["texto"] ?? ""),
        secao: String(m.metadata?.["secao"] ?? ""),
        componente: String(m.metadata?.["componente"] ?? ""),
        etapa: String(m.metadata?.["etapa"] ?? ""),
      }));
  } catch (err) {
    console.warn("[rag] Currículo Territorial retrieval falhou:", err);
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

// ── Combined retrieval — 1 embed call, 3 queries in parallel ─────────────────

export async function retrieveAllCurriculumContext(
  query: string,
  filters: { componente?: string; etapa?: string; estado?: string },
  options?: { skipCtbc?: boolean; skipSaeb?: boolean; skipEstadual?: boolean; skipCnct?: boolean },
): Promise<CurriculumContext> {
  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) return { bncc: [], ctbc: [], saeb: [], curriculo_estadual: [], cnct: [] };

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

    const [bnccResult, ctbcResult, saebResult, estadualResult, cnctResult] = await Promise.all([
      // BNCC vector query — skipped when exact codes found
      bnccExact.length > 0
        ? Promise.resolve({ matches: [] as { score?: number; metadata?: Record<string, unknown> }[] })
        : index.query({
            vector, topK: TOP_K,
            filter: hasFilter ? pineconeFilter : undefined,
            includeMetadata: true,
          }).catch(() => ({ matches: [] as { score?: number; metadata?: Record<string, unknown> }[] })),

      // Currículo Territorial
      options?.skipCtbc
        ? Promise.resolve({ _ctbc: [] as CtbcChunk[] })
        : retrieveCtbcContext(vector, filters).then((r) => ({ _ctbc: r })).catch(() => ({ _ctbc: [] as CtbcChunk[] })),

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

    const ctbc = "_ctbc" in ctbcResult ? ctbcResult._ctbc : [];
    const saeb = "_saeb" in saebResult ? saebResult._saeb : [];
    const curriculo_estadual = "_estadual" in estadualResult ? estadualResult._estadual : [];
    const cnct = "_cnct" in cnctResult ? cnctResult._cnct : [];

    return { bncc, ctbc, saeb, curriculo_estadual, cnct };
  } catch (err) {
    console.warn("[rag] Combined retrieval falhou, prosseguindo sem contexto:", err);
    return { bncc: [], ctbc: [], saeb: [], curriculo_estadual: [], cnct: [] };
  }
}

export { EMBEDDING_DIMENSIONS };
