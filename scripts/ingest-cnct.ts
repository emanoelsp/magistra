/**
 * Script de ingestão do CNCT (Catálogo Nacional de Cursos Técnicos) no Pinecone.
 *
 * Uso:
 *   npx tsx scripts/ingest-cnct.ts
 *
 * Requer no .env.local:
 *   GOOGLE_GEMINI_API_KEY, PINECONE_API_KEY, PINECONE_INDEX
 *
 * Fonte:
 *   O script baixa o CNCT do MEC automaticamente (4ª edição).
 *   Para usar um PDF local: CNCT_PDF_PATH=./docs/cnct.pdf npx tsx scripts/ingest-cnct.ts
 *
 * Os vetores são armazenados no namespace "cnct" do mesmo index da BNCC.
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
const PINECONE_INDEX   = process.env.PINECONE_INDEX ?? "bncc";
const NAMESPACE        = "cnct";
const GEMINI_API_KEY   = process.env.GOOGLE_GEMINI_API_KEY!;
const EMBEDDING_MODEL  = "gemini-embedding-001";
const EMBEDDING_API_VER = "v1beta";
const BATCH_SIZE       = 50;
const EMBED_SUB_BATCH  = 5;
const EMBED_DELAY_MS   = 300;
const EMBED_SUB_DELAY  = 2000;
const MIN_CHUNK_LEN    = 80;
const CHUNK_SIZE       = 900;

const PDF_PATH = process.env.CNCT_PDF_PATH ?? "";

// URL oficial MEC — CNCT 4ª edição (2020)
const CNCT_URL = "https://download.inep.gov.br/educacao_basica/saeb/2022/documentos/catalogo_nacional_cursos_tecnicos.pdf";

// ── Tipos ────────────────────────────────────────────────────────────────────

interface CnctChunk {
  id: string;
  texto: string;
  eixo: string;
  curso: string;
  etapa: string;
}

// ── Parsing ──────────────────────────────────────────────────────────────────

// Eixos tecnológicos do CNCT
const EIXOS = [
  "Ambiente e Saúde", "Controle e Processos Industriais", "Desenvolvimento Educacional e Social",
  "Gestão e Negócios", "Informação e Comunicação", "Infraestrutura", "Militar",
  "Produção Alimentícia", "Produção Cultural e Design", "Produção Industrial",
  "Recursos Naturais", "Segurança", "Turismo, Hospitalidade e Lazer",
];

function detectEixo(text: string): string {
  const lower = text.toLowerCase();
  for (const e of EIXOS) {
    if (lower.includes(e.toLowerCase())) return e;
  }
  return "";
}

function detectCurso(lines: string[]): string {
  // Linha com todos caps e não muito longa é provavelmente o nome do curso
  for (const l of lines) {
    if (l === l.toUpperCase() && l.length > 4 && l.length < 80 && /[A-Z]/.test(l)) return l;
  }
  return "";
}

function slugify(s: string, idx: number): string {
  return `cnct_${idx}_` + s.toLowerCase().normalize("NFD")
    .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").slice(0, 40);
}

function extractChunks(text: string): CnctChunk[] {
  const chunks: CnctChunk[] = [];
  const paragraphs = text.split(/\n{2,}/).map((p) => p.replace(/\s+/g, " ").trim()).filter((p) => p.length > 40);

  let buffer = "";
  let bufferLines: string[] = [];
  let idx = 0;

  const flush = () => {
    if (buffer.length >= MIN_CHUNK_LEN) {
      const eixo = detectEixo(buffer);
      const curso = detectCurso(bufferLines);
      // Técnico de nível médio cobre ensino médio integrado/concomitante/subsequente
      chunks.push({ id: slugify(curso || eixo || "geral", idx++), texto: buffer.trim(), eixo, curso, etapa: "EM" });
    }
    buffer = ""; bufferLines = [];
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

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function embedBatch(texts: string[]): Promise<number[][]> {
  const requests = texts.map((text) => ({ model: `models/${EMBEDDING_MODEL}`, content: { parts: [{ text }] }, taskType: "RETRIEVAL_DOCUMENT" }));
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/${EMBEDDING_API_VER}/models/${EMBEDDING_MODEL}:batchEmbedContents?key=${GEMINI_API_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requests }) },
    );
    if (res.ok) {
      const data = (await res.json()) as { embeddings: { values: number[] }[] };
      return data.embeddings.map((e) => e.values);
    }
    if (res.status === 429 || res.status === 503) {
      const wait = (attempt + 1) * 15_000;
      console.log(`  ⏳ Rate limit (${res.status}), aguardando ${wait / 1000}s...`);
      await sleep(wait);
      continue;
    }
    throw new Error(`Embed error ${res.status}: ${await res.text()}`);
  }
  throw new Error("Embed falhou após 6 tentativas.");
}

// ── Pinecone upsert ──────────────────────────────────────────────────────────

async function upsertBatch(
  ns: ReturnType<ReturnType<Pinecone["index"]>["namespace"]>,
  chunks: CnctChunk[],
  batchNum: number,
  total: number,
) {
  const ids = chunks.map((c) => c.id);
  const fetched = await ns.fetch({ ids });
  const existing = new Set(Object.keys(fetched.records ?? {}));
  const pending = chunks.filter((c) => !existing.has(c.id));

  if (pending.length === 0) { console.log(`  ↷ Lote ${batchNum}/${total} já indexado — pulando`); return; }

  const allValues: number[][] = [];
  for (let i = 0; i < pending.length; i += EMBED_SUB_BATCH) {
    const sub = pending.slice(i, i + EMBED_SUB_BATCH).map((c) => c.texto);
    const vals = await embedBatch(sub);
    allValues.push(...vals);
    if (i + EMBED_SUB_BATCH < pending.length) await sleep(EMBED_SUB_DELAY);
  }
  const records = pending.map((chunk, i) => ({
    id: chunk.id,
    values: allValues[i],
    metadata: { texto: chunk.texto, eixo: chunk.eixo, curso: chunk.curso, etapa: chunk.etapa, source: "cnct" },
  }));

  await ns.upsert({ records });
  console.log(`  ✓ Lote ${batchNum}/${total} upsertado: ${records.length} vetores`);
  await sleep(EMBED_DELAY_MS);
}

// ── Download ─────────────────────────────────────────────────────────────────

async function loadPdf(): Promise<Buffer> {
  if (PDF_PATH) {
    const p = path.resolve(PDF_PATH);
    if (!fs.existsSync(p)) throw new Error(`Arquivo não encontrado: ${p}`);
    return fs.readFileSync(p);
  }

  const cacheDir = path.join(process.cwd(), ".cache");
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir);
  const filename = path.join(cacheDir, "cnct_catalogo.pdf");

  if (fs.existsSync(filename)) { console.log(`  → Cache: ${filename}`); return fs.readFileSync(filename); }

  console.log(`  → Baixando CNCT do MEC...`);
  const res = await fetch(CNCT_URL, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} ao baixar CNCT.\n` +
      `Baixe manualmente o CNCT do MEC e defina CNCT_PDF_PATH=./docs/cnct.pdf`,
    );
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filename, buffer);
  console.log(`  → Salvo em cache: ${filename}`);
  return buffer;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!PINECONE_API_KEY) throw new Error("PINECONE_API_KEY não definida");
  if (!GEMINI_API_KEY)   throw new Error("GOOGLE_GEMINI_API_KEY não definida");

  console.log("🔌 Conectando ao Pinecone...");
  const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });
  const ns = pinecone.index(PINECONE_INDEX).namespace(NAMESPACE);

  console.log("\n📄 Carregando CNCT...");
  const buffer = await loadPdf();
  const { text } = await pdf(buffer);
  const chunks = extractChunks(text);

  const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    await upsertBatch(ns, chunks.slice(i, i + BATCH_SIZE), Math.floor(i / BATCH_SIZE) + 1, totalBatches);
  }

  console.log(`\n✅ Ingestão CNCT concluída! ${chunks.length} chunks indexados.`);
  console.log(`   Index: ${PINECONE_INDEX} | Namespace: ${NAMESPACE}`);
}

main().catch((err) => { console.error("❌", err); process.exit(1); });
