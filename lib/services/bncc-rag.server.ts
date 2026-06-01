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

export interface CurriculumContext {
  bncc: BnccChunk[];
  ctbc: CtbcChunk[];
  saeb: SaebChunk[];
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

export async function embedText(text: string): Promise<number[]> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GEMINI_API_KEY não configurada.");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/${EMBEDDING_API_VER}/models/${EMBEDDING_MODEL}:embedContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: { parts: [{ text }] } }),
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
    const vector = await embedText(query);
    const index = getIndex();

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

// ── CTBC retrieval (namespace "ctbc") ────────────────────────────────────────

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
    console.warn("[rag] CTBC retrieval falhou:", err);
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

// ── Combined retrieval — 1 embed call, 3 queries in parallel ─────────────────

export async function retrieveAllCurriculumContext(
  query: string,
  filters: { componente?: string; etapa?: string },
  options?: { skipCtbc?: boolean; skipSaeb?: boolean },
): Promise<CurriculumContext> {
  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) return { bncc: [], ctbc: [], saeb: [] };

  try {
    // Single embed call shared across all three sources
    const vector = await embedText(query);
    const index = getIndex();

    const pineconeFilter: Record<string, unknown> = {};
    if (filters.etapa) pineconeFilter["etapa"] = { $eq: filters.etapa };
    const comp = matchComponente(filters.componente ?? "");
    if (comp) pineconeFilter["componente"] = { $eq: comp };

    const [bnccResult, ctbcResult, saebResult] = await Promise.all([
      // BNCC — default namespace
      index.query({
        vector, topK: TOP_K,
        filter: Object.keys(pineconeFilter).length > 0 ? pineconeFilter : undefined,
        includeMetadata: true,
      }).catch(() => ({ matches: [] })),

      // CTBC
      options?.skipCtbc
        ? Promise.resolve({ matches: [] })
        : retrieveCtbcContext(vector, filters).then((r) => ({ _ctbc: r })).catch(() => ({ _ctbc: [] as CtbcChunk[] })),

      // SAEB
      options?.skipSaeb
        ? Promise.resolve({ matches: [] })
        : retrieveSaebContext(vector, filters).then((r) => ({ _saeb: r })).catch(() => ({ _saeb: [] as SaebChunk[] })),
    ]);

    const bncc = (bnccResult.matches ?? [])
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

    return { bncc, ctbc, saeb };
  } catch (err) {
    console.warn("[rag] Combined retrieval falhou, prosseguindo sem contexto:", err);
    return { bncc: [], ctbc: [], saeb: [] };
  }
}

export { EMBEDDING_DIMENSIONS };
