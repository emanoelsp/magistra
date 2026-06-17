/**
 * Ingestão BNCC Ensino Médio a partir do dataset estático.
 * Evita dependência de PDFs do MEC (inacessíveis ou em formato de imagem).
 *
 * Uso: npx tsx scripts/ingest-bncc-em-static.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { Pinecone } from "@pinecone-database/pinecone";
import { BNCC_EM_HABILIDADES, TOTAL } from "./bncc-em-data.js";

const PINECONE_API_KEY = process.env.PINECONE_API_KEY!;
const PINECONE_INDEX   = process.env.PINECONE_INDEX ?? "bncc";
const GEMINI_API_KEY   = process.env.GOOGLE_GEMINI_API_KEY!;
const EMBEDDING_MODEL  = "gemini-embedding-001";
const EMBEDDING_API_VER = "v1beta";
const BATCH_SIZE       = 30;
const EMBED_DELAY_MS   = 400;

// ── Embedding ─────────────────────────────────────────────────────────────────

async function embedBatch(texts: string[], retries = 5): Promise<number[][]> {
  const requests = texts.map((text) => ({
    model: `models/${EMBEDDING_MODEL}`,
    content: { parts: [{ text }] },
    taskType: "RETRIEVAL_DOCUMENT",
  }));

  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/${EMBEDDING_API_VER}/models/${EMBEDDING_MODEL}:batchEmbedContents?key=${GEMINI_API_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requests }) },
    );
    if (res.ok) {
      const data = (await res.json()) as { embeddings: { values: number[] }[] };
      return data.embeddings.map((e) => e.values);
    }
    const body = await res.text();
    if (res.status === 429 && attempt < retries) {
      // Extract retry delay from response if available
      let waitMs = 60_000;
      const delayMatch = body.match(/retryDelay.*?"(\d+)s"/);
      if (delayMatch) waitMs = (parseInt(delayMatch[1]) + 5) * 1000;
      console.log(`\n  ⏳ Rate limit 429 — aguardando ${Math.round(waitMs / 1000)}s (tentativa ${attempt}/${retries})...`);
      await sleep(waitMs);
      continue;
    }
    throw new Error(`Embed error ${res.status}: ${body}`);
  }
  throw new Error("Embed falhou após todas as tentativas");
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!PINECONE_API_KEY) throw new Error("PINECONE_API_KEY não definida no .env.local");
  if (!GEMINI_API_KEY)   throw new Error("GOOGLE_GEMINI_API_KEY não definida no .env.local");

  console.log(`\n📚 Dataset BNCC EM carregado: ${TOTAL} habilidades`);
  console.log("🔌 Conectando ao Pinecone...");

  const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });
  const index = pinecone.index(PINECONE_INDEX);

  const totalBatches = Math.ceil(TOTAL / BATCH_SIZE);
  let totalNew = 0;

  for (let i = 0; i < BNCC_EM_HABILIDADES.length; i += BATCH_SIZE) {
    const batch = BNCC_EM_HABILIDADES.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    // Verificar quais já estão no Pinecone
    const ids = batch.map((h) => h.codigo);
    const fetched = await index.fetch({ ids });
    const existingIds = new Set(Object.keys(fetched.records ?? {}));
    const pending = batch.filter((h) => !existingIds.has(h.codigo));

    if (pending.length === 0) {
      console.log(`  ↷ Lote ${batchNum}/${totalBatches} — todos já indexados`);
      continue;
    }

    if (existingIds.size > 0) {
      console.log(`  ↷ ${existingIds.size} já indexados neste lote`);
    }

    process.stdout.write(`  Lote ${batchNum}/${totalBatches}: embedando ${pending.length} habilidades...\r`);
    const allValues = await embedBatch(pending.map((h) => h.texto));

    await index.upsert({
      records: pending.map((hab, i) => ({
        id: hab.codigo,
        values: allValues[i]!,
        metadata: {
          codigo: hab.codigo,
          texto: hab.texto,
          area: hab.area,
          componente: hab.componente,
          etapa: hab.etapa,
          ano: hab.ano,
        },
      })),
    });

    totalNew += pending.length;
    console.log(`  ✓ Lote ${batchNum}/${totalBatches}: ${pending.length} vetores upsertados`);
    await sleep(EMBED_DELAY_MS);
  }

  console.log(`\n✅ Ingestão BNCC EM concluída!`);
  console.log(`   ${TOTAL} habilidades processadas | ${totalNew} novas no Pinecone`);
  console.log(`   Index: ${PINECONE_INDEX} | Namespace: default (BNCC)`);
}

main().catch((err) => {
  console.error("❌ Erro na ingestão:", err);
  process.exit(1);
});
