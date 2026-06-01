import "server-only";

import { Pinecone } from "@pinecone-database/pinecone";

const EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_API_VER = "v1beta";
const EMBEDDING_DIMENSIONS = 3072;
const TOP_K = 6;

export interface BnccChunk {
  codigo: string;
  texto: string;
  area: string;
  componente: string;
  etapa: string;
  ano: string;
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

    // Fuzzy match de componente: normaliza ambos e usa inclusão bidirecional de tokens
    if (filters.componente) {
      const COMPONENTES_BNCC = [
        "Matemática",
        "Língua Portuguesa",
        "Ciências",
        "História",
        "Geografia",
        "Arte",
        "Educação Física",
        "Língua Inglesa",
        "Ensino Religioso",
        "Física",
        "Química",
        "Biologia",
        "Sociologia",
        "Filosofia",
        "Língua Espanhola",
      ];

      function normalizeComp(s: string): string {
        return s
          .toLowerCase()
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .replace(/[^a-z\s]/g, "")
          .trim();
      }

      const needle = normalizeComp(filters.componente);
      const needleTokens = needle.split(/\s+/);

      let bestMatch: string | undefined;
      let bestScore = 0;

      for (const candidate of COMPONENTES_BNCC) {
        const hay = normalizeComp(candidate);
        const hayTokens = hay.split(/\s+/);
        const overlap = needleTokens.filter((t) => hayTokens.some((h) => h.includes(t) || t.includes(h))).length;
        const score = overlap / Math.max(needleTokens.length, hayTokens.length);
        if (score > bestScore) { bestScore = score; bestMatch = candidate; }
      }

      if (bestMatch && bestScore >= 0.4) {
        pineconeFilter["componente"] = { $eq: bestMatch };
      } else {
        console.warn("[PlanoMagistra/rag] Componente não mapeado, sem filtro:", filters.componente);
      }
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
    console.warn("[PlanoMagistra/rag] Falha no retrieval, prosseguindo sem contexto BNCC:", err);
    return [];
  }
}

export { EMBEDDING_DIMENSIONS };
