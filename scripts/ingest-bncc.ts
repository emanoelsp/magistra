/**
 * Script de ingestão da BNCC no Pinecone.
 *
 * Uso:
 *   npx tsx scripts/ingest-bncc.ts
 *
 * Requer no .env.local:
 *   GOOGLE_GEMINI_API_KEY, PINECONE_API_KEY, PINECONE_INDEX
 *
 * Fontes (PDFs oficiais do MEC):
 *   EI + EF: BNCC_EI_EF_110518_versaofinal_site.pdf
 *   EM:      BNCC_20dez_site.pdf
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
import fs from "fs";
import path from "path";
import pdf from "pdf-parse";
import { Pinecone } from "@pinecone-database/pinecone";

// ── Config ──────────────────────────────────────────────────────────────────

const PINECONE_API_KEY = process.env.PINECONE_API_KEY!;
const PINECONE_INDEX = process.env.PINECONE_INDEX ?? "bncc";
const GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY!;
const EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_API_VER = "v1beta";
const BATCH_SIZE = 50;
const EMBED_DELAY_MS = 300;

const BNCC_URLS = [
  "https://basenacionalcomum.mec.gov.br/images/BNCC_EI_EF_110518_versaofinal_site.pdf",
  "https://basenacionalcomum.mec.gov.br/images/BNCC_20dez_site.pdf",
];

// ── Tipos ────────────────────────────────────────────────────────────────────

interface BnccChunk {
  codigo: string;
  texto: string;
  area: string;
  componente: string;
  etapa: "EI" | "EF" | "EM";
  ano: string;
}

// ── Parsing ──────────────────────────────────────────────────────────────────

// Regex que captura o código BNCC e o texto da habilidade anterior a ele
// Exemplos de código: EF01MA01, EI03ET01, EM13MAT101
const CODIGO_REGEX = /\(([A-Z]{2}\d{2}[A-Z]{2,3}\d{2,3})\)/g;

// Mapa de sigla de componente → nome completo
const COMPONENTE_MAP: Record<string, string> = {
  MA: "Matemática",
  LP: "Língua Portuguesa",
  CI: "Ciências",
  HI: "História",
  GE: "Geografia",
  AR: "Arte",
  EF: "Educação Física",
  LI: "Língua Inglesa",
  ER: "Ensino Religioso",
  FI: "Física",
  QU: "Química",
  BI: "Biologia",
  SO: "Sociologia",
  FL: "Filosofia",
  ET: "Natureza e Sociedade", // EI
  EO: "Eu, o Outro e o Nós", // EI
  CG: "Corpo, Gestos e Movimentos", // EI
  TS: "Traços, Sons, Cores e Formas", // EI
  EF2: "Escuta, Fala, Pensamento e Imaginação", // EI (abrev customizada)
};

// Mapa de área para os componentes mais comuns do EM
const EM_AREA_MAP: Record<string, string> = {
  MAT: "Matemática",
  LGG: "Linguagens",
  CNT: "Ciências da Natureza",
  CHS: "Ciências Humanas",
};

function parseCodigoInfo(codigo: string): { etapa: string; ano: string; componente: string; area: string } {
  const etapa = codigo.slice(0, 2);
  const ano = codigo.slice(2, 4);
  const compSigla = codigo.slice(4, 6);
  const compSiglaLong = codigo.slice(4, 7); // EM usa 3 letras às vezes

  let componente = COMPONENTE_MAP[compSigla] ?? COMPONENTE_MAP[compSiglaLong] ?? compSigla;
  let area = componente;

  // Para EM, o padrão é EM13MAT101 → MAT = Matemática
  if (etapa === "EM") {
    const emComp = EM_AREA_MAP[compSigla] ?? EM_AREA_MAP[compSiglaLong];
    if (emComp) {
      area = emComp;
      componente = emComp;
    }
  }

  return { etapa, ano, componente, area };
}

function extractChunks(text: string): BnccChunk[] {
  const chunks: BnccChunk[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  CODIGO_REGEX.lastIndex = 0;

  while ((match = CODIGO_REGEX.exec(text)) !== null) {
    const codigo = match[1];
    if (seen.has(codigo)) continue;
    seen.add(codigo);

    // Pega o texto antes do código (até 600 chars), limpando quebras excessivas
    const before = text.slice(Math.max(0, match.index - 600), match.index);
    const lines = before.split("\n").map((l) => l.trim()).filter(Boolean);

    // A habilidade está normalmente nas últimas 1-3 linhas antes do código
    const descricao = lines.slice(-3).join(" ").replace(/\s+/g, " ").trim();
    if (descricao.length < 20) continue;

    const { etapa, ano, componente, area } = parseCodigoInfo(codigo);

    chunks.push({
      codigo,
      texto: `(${codigo}) ${descricao}`,
      area,
      componente,
      etapa: etapa as BnccChunk["etapa"],
      ano,
    });
  }

  console.log(`  → ${chunks.length} habilidades extraídas`);
  return chunks;
}

// ── Embedding ────────────────────────────────────────────────────────────────

// Embeda um lote inteiro em UMA chamada API (batchEmbedContents)
async function embedBatch(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY!;
  const requests = texts.map((text) => ({
    model: `models/${EMBEDDING_MODEL}`,
    content: { parts: [{ text }] },
    taskType: "RETRIEVAL_DOCUMENT",
  }));
  const res = await fetch(
    `https://generativelanguage.googleapis.com/${EMBEDDING_API_VER}/models/${EMBEDDING_MODEL}:batchEmbedContents?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
    },
  );
  if (!res.ok) throw new Error(`Embed error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { embeddings: { values: number[] }[] };
  return data.embeddings.map((e) => e.values);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Pinecone upsert ──────────────────────────────────────────────────────────

async function upsertBatch(
  index: ReturnType<Pinecone["index"]>,
  chunks: BnccChunk[],
  batchNum: number,
  total: number,
) {
  // Verifica quais IDs já existem no Pinecone para pular
  const ids = chunks.map((c) => c.codigo);
  const fetched = await index.fetch({ ids });
  const existingIds = new Set(Object.keys(fetched.records ?? {}));
  const pending = chunks.filter((c) => !existingIds.has(c.codigo));

  if (pending.length === 0) {
    console.log(`  ↷ Lote ${batchNum}/${total} já indexado — pulando`);
    return;
  }

  if (existingIds.size > 0) {
    console.log(`  ↷ ${existingIds.size} já indexados, embedando ${pending.length} novos`);
  }

  // 1 chamada API para o lote inteiro
  process.stdout.write(`  Embedando ${pending.length} textos em 1 chamada...\r`);
  const allValues = await embedBatch(pending.map((c) => c.texto));

  const records = pending.map((chunk, i) => ({
    id: chunk.codigo,
    values: allValues[i],
    metadata: {
      codigo: chunk.codigo,
      texto: chunk.texto,
      area: chunk.area,
      componente: chunk.componente,
      etapa: chunk.etapa,
      ano: chunk.ano,
    },
  }));

  await index.upsert({ records });
  console.log(`  ✓ Lote ${batchNum}/${total} upsertado: ${records.length} vetores`);
  await sleep(EMBED_DELAY_MS);
}

// ── Download PDF ─────────────────────────────────────────────────────────────

async function downloadPdf(url: string): Promise<Buffer> {
  const cacheDir = path.join(process.cwd(), ".cache");
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir);
  const filename = path.join(cacheDir, path.basename(url));

  if (fs.existsSync(filename)) {
    console.log(`  → Cache local: ${filename}`);
    return fs.readFileSync(filename);
  }

  console.log(`  → Baixando: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filename, buffer);
  console.log(`  → Salvo em cache: ${filename}`);
  return buffer;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!PINECONE_API_KEY) throw new Error("PINECONE_API_KEY não definida no .env.local");
  if (!GEMINI_API_KEY) throw new Error("GOOGLE_GEMINI_API_KEY não definida no .env.local");

  console.log("🔌 Conectando ao Pinecone...");
  const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });

  const DIMS = 3072;

  // Recria o index se não existir ou se as dimensões estiverem erradas
  const existingIndexes = await pinecone.listIndexes();
  const existing = existingIndexes.indexes?.find((i) => i.name === PINECONE_INDEX);
  if (existing && existing.dimension !== DIMS) {
    console.log(`⚠️  Index "${PINECONE_INDEX}" tem ${existing.dimension} dims — recriando com ${DIMS}...`);
    await pinecone.deleteIndex(PINECONE_INDEX);
    await sleep(3000);
  }
  if (!existing || existing.dimension !== DIMS) {
    console.log(`📦 Criando index "${PINECONE_INDEX}" (serverless, ${DIMS} dims)...`);
    await pinecone.createIndex({
      name: PINECONE_INDEX,
      dimension: DIMS,
      metric: "cosine",
      spec: { serverless: { cloud: "aws", region: "us-east-1" } },
    });
    await sleep(5000);
  } else {
    console.log(`✓ Index "${PINECONE_INDEX}" já existe (${DIMS} dims)`);
  }

  const index = pinecone.index(PINECONE_INDEX);
  let totalChunks = 0;

  for (const url of BNCC_URLS) {
    console.log(`\n📄 Processando: ${path.basename(url)}`);

    const pdfBuffer = await downloadPdf(url);
    const { text } = await pdf(pdfBuffer);
    const chunks = extractChunks(text);
    totalChunks += chunks.length;

    const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      await upsertBatch(index, batch, batchNum, totalBatches);
    }
  }

  console.log(`\n✅ Ingestão concluída! ${totalChunks} habilidades indexadas no Pinecone.`);
  console.log(`   Index: ${PINECONE_INDEX} | Modelo: ${EMBEDDING_MODEL}`);
}

main().catch((err) => {
  console.error("❌ Erro na ingestão:", err);
  process.exit(1);
});
