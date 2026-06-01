/**
 * Script de ingestão do CTBC (Currículo Territorial) no Pinecone.
 *
 * Uso:
 *   npx tsx scripts/ingest-ctbc.ts
 *
 * Requer no .env.local:
 *   GOOGLE_GEMINI_API_KEY, PINECONE_API_KEY, PINECONE_INDEX
 *
 * Fonte do PDF:
 *   Defina CTBC_PDF_URL  com a URL do documento, OU
 *   Defina CTBC_PDF_PATH com o caminho local do PDF (ex: ./docs/ctbc.pdf)
 *
 * Os vetores são armazenados no namespace "ctbc" do mesmo index da BNCC.
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import pdf from "pdf-parse";
import { Pinecone } from "@pinecone-database/pinecone";

// ── Config ──────────────────────────────────────────────────────────────────

const PINECONE_API_KEY = process.env.PINECONE_API_KEY!;
const PINECONE_INDEX   = process.env.PINECONE_INDEX ?? "bncc";
const NAMESPACE        = "ctbc";
const GEMINI_API_KEY   = process.env.GOOGLE_GEMINI_API_KEY!;
const EMBEDDING_MODEL  = "gemini-embedding-001";
const EMBEDDING_API_VER = "v1beta";
const BATCH_SIZE       = 50;
const EMBED_DELAY_MS   = 300;
const MIN_CHUNK_LEN    = 60;
const CHUNK_SIZE       = 800; // chars por chunk

const PDF_URL  = process.env.CTBC_PDF_URL ?? "";
const PDF_PATH = process.env.CTBC_PDF_PATH ?? "";

// ── Tipos ────────────────────────────────────────────────────────────────────

interface CtbcChunk {
  id: string;
  texto: string;
  secao: string;
  componente: string;
  etapa: string;
}

// ── Parsing ──────────────────────────────────────────────────────────────────

function slugify(s: string, idx: number): string {
  return "ctbc_" + idx + "_" + s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").slice(0, 40);
}

// Tenta detectar seção/etapa/componente por heurística de cabeçalho
function detectMeta(lines: string[]): { secao: string; componente: string; etapa: string } {
  const secaoRe = /^(cap[íi]tulo|seção|unidade|eixo|campo|área|habilidade|objetivo|competên)/i;
  const etapaRe  = /(educa[cç][aã]o infantil|ensino fundamental|ensino m[eé]dio|EF|EM|EI)/i;
  const compRe   = /(portugu[eê]s|matem[aá]tica|ci[eê]ncias|hist[oó]ria|geografia|arte|ingl[eê]s|f[ií]sica|qu[ií]mica|biologia|filosofia|sociologia)/i;

  let secao = "";
  let etapa = "";
  let componente = "";

  for (const l of lines) {
    if (!secao && secaoRe.test(l)) secao = l.slice(0, 80);
    const em = etapaRe.exec(l);
    if (!etapa && em) etapa = em[1];
    const cm = compRe.exec(l);
    if (!componente && cm) componente = cm[1];
  }

  return { secao: secao || "Geral", componente: componente || "", etapa: etapa || "" };
}

function extractChunks(text: string): CtbcChunk[] {
  const chunks: CtbcChunk[] = [];

  // Split em parágrafos e reagrupa em chunks de ~CHUNK_SIZE chars
  const paragraphs = text.split(/\n{2,}/).map((p) => p.replace(/\s+/g, " ").trim()).filter((p) => p.length > 30);

  let buffer = "";
  let bufferLines: string[] = [];
  let idx = 0;

  const flush = () => {
    if (buffer.length >= MIN_CHUNK_LEN) {
      const { secao, componente, etapa } = detectMeta(bufferLines);
      chunks.push({
        id: slugify(secao, idx++),
        texto: buffer.trim(),
        secao,
        componente,
        etapa,
      });
    }
    buffer = "";
    bufferLines = [];
  };

  for (const p of paragraphs) {
    if (buffer.length + p.length > CHUNK_SIZE && buffer.length > 0) flush();
    buffer += (buffer ? " " : "") + p;
    bufferLines.push(p);
  }
  flush();

  console.log(`  → ${chunks.length} chunks extraídos`);
  return chunks;
}

// ── Embedding ────────────────────────────────────────────────────────────────

async function embedBatch(texts: string[]): Promise<number[][]> {
  const requests = texts.map((text) => ({
    model: `models/${EMBEDDING_MODEL}`,
    content: { parts: [{ text }] },
  }));
  const res = await fetch(
    `https://generativelanguage.googleapis.com/${EMBEDDING_API_VER}/models/${EMBEDDING_MODEL}:batchEmbedContents?key=${GEMINI_API_KEY}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requests }) },
  );
  if (!res.ok) throw new Error(`Embed error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { embeddings: { values: number[] }[] };
  return data.embeddings.map((e) => e.values);
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// ── Pinecone upsert ──────────────────────────────────────────────────────────

async function upsertBatch(
  ns: ReturnType<ReturnType<Pinecone["index"]>["namespace"]>,
  chunks: CtbcChunk[],
  batchNum: number,
  total: number,
) {
  const ids = chunks.map((c) => c.id);
  const fetched = await ns.fetch({ ids });
  const existingIds = new Set(Object.keys(fetched.records ?? {}));
  const pending = chunks.filter((c) => !existingIds.has(c.id));

  if (pending.length === 0) {
    console.log(`  ↷ Lote ${batchNum}/${total} já indexado — pulando`);
    return;
  }

  process.stdout.write(`  Embedando ${pending.length} textos em 1 chamada...\r`);
  const allValues = await embedBatch(pending.map((c) => c.texto));

  const records = pending.map((chunk, i) => ({
    id: chunk.id,
    values: allValues[i],
    metadata: {
      texto: chunk.texto,
      secao: chunk.secao,
      componente: chunk.componente,
      etapa: chunk.etapa,
      source: "ctbc",
    },
  }));

  await ns.upsert({ records });
  console.log(`  ✓ Lote ${batchNum}/${total} upsertado: ${records.length} vetores`);
  await sleep(EMBED_DELAY_MS);
}

// ── Download PDF ─────────────────────────────────────────────────────────────

async function loadPdf(): Promise<Buffer> {
  if (PDF_PATH) {
    const fullPath = path.resolve(PDF_PATH);
    if (!fs.existsSync(fullPath)) throw new Error(`Arquivo não encontrado: ${fullPath}`);
    console.log(`  → Lendo arquivo local: ${fullPath}`);
    return fs.readFileSync(fullPath);
  }

  if (!PDF_URL) {
    throw new Error(
      "Defina CTBC_PDF_URL (URL do PDF) ou CTBC_PDF_PATH (caminho local) no .env.local",
    );
  }

  const cacheDir = path.join(process.cwd(), ".cache");
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir);
  const filename = path.join(cacheDir, "ctbc_" + path.basename(new URL(PDF_URL).pathname));

  if (fs.existsSync(filename)) {
    console.log(`  → Cache local: ${filename}`);
    return fs.readFileSync(filename);
  }

  console.log(`  → Baixando: ${PDF_URL}`);
  const res = await fetch(PDF_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar ${PDF_URL}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filename, buffer);
  console.log(`  → Salvo em cache: ${filename}`);
  return buffer;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!PINECONE_API_KEY) throw new Error("PINECONE_API_KEY não definida no .env.local");
  if (!GEMINI_API_KEY)   throw new Error("GOOGLE_GEMINI_API_KEY não definida no .env.local");

  console.log("🔌 Conectando ao Pinecone...");
  const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });
  const index = pinecone.index(PINECONE_INDEX);
  const ns = index.namespace(NAMESPACE);

  console.log(`\n📄 Carregando documento CTBC...`);
  const pdfBuffer = await loadPdf();
  const { text } = await pdf(pdfBuffer);
  const chunks = extractChunks(text);

  const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    await upsertBatch(ns, batch, batchNum, totalBatches);
  }

  console.log(`\n✅ Ingestão CTBC concluída! ${chunks.length} chunks indexados.`);
  console.log(`   Index: ${PINECONE_INDEX} | Namespace: ${NAMESPACE}`);
}

main().catch((err) => {
  console.error("❌ Erro na ingestão CTBC:", err);
  process.exit(1);
});
