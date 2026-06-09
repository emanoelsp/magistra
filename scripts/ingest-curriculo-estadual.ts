/**
 * Script de ingestão dos currículos estaduais complementares à BNCC no Pinecone.
 *
 * Uso:
 *   npx tsx scripts/ingest-curriculo-estadual.ts
 *   npx tsx scripts/ingest-curriculo-estadual.ts SP      # ingere só São Paulo
 *   npx tsx scripts/ingest-curriculo-estadual.ts SP MG CE # ingere só esses estados
 *
 * Configuração dos PDFs:
 *   Edite scripts/curriculo-estados-urls.json e preencha pdf_url ou pdf_path
 *   para cada estado que deseja indexar.
 *
 * Os vetores são armazenados no namespace "curriculo_estadual" com metadata estado=UF.
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
const NAMESPACE        = "curriculo_estadual";
const GEMINI_API_KEY   = process.env.GOOGLE_GEMINI_API_KEY!;
const EMBEDDING_MODEL  = "gemini-embedding-001";
const EMBEDDING_API_VER = "v1beta";
const BATCH_SIZE       = 50;
const EMBED_SUB_BATCH  = 5;
const EMBED_DELAY_MS   = 300;
const EMBED_SUB_DELAY  = 2000;
const MIN_CHUNK_LEN    = 80;
const CHUNK_SIZE       = 900;

interface EstadoConfig {
  nome: string;
  pdf_url: string;
  pdf_path: string;
}

type EstadosMap = Record<string, EstadoConfig | string | undefined>;

// ── Tipos ────────────────────────────────────────────────────────────────────

interface EstadualChunk {
  id: string;
  texto: string;
  estado: string;
  secao: string;
  componente: string;
  etapa: string;
}

// ── Parsing ──────────────────────────────────────────────────────────────────

function slugify(s: string, idx: number, uf: string): string {
  return `est_${uf}_${idx}_` + s.toLowerCase().normalize("NFD")
    .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").slice(0, 35);
}

const etapaRe = /(educa[cç][aã]o\s*infantil|ensino\s*fundamental|ensino\s*m[eé]dio|EF|EM|EI)/i;
const compRe  = /(portugu[eê]s|matem[aá]tica|ci[eê]ncias|hist[oó]ria|geografia|arte|ingl[eê]s|f[ií]sica|qu[ií]mica|biologia|filosofia|sociologia)/i;
const secaoRe = /^(cap[íi]tulo|se[çc][aã]o|unidade|eixo|campo|[aá]rea|habilidade|objetivo|compet[eê]n|componente)/i;

function detectMeta(lines: string[]) {
  let secao = "", etapa = "", componente = "";
  for (const l of lines) {
    if (!secao && secaoRe.test(l)) secao = l.slice(0, 80);
    if (!etapa) { const m = etapaRe.exec(l); if (m) etapa = m[1]; }
    if (!componente) { const m = compRe.exec(l); if (m) componente = m[1]; }
  }
  return { secao: secao || "Geral", componente: componente || "", etapa: etapa || "" };
}

function extractChunks(text: string, uf: string): EstadualChunk[] {
  const chunks: EstadualChunk[] = [];
  const paragraphs = text.split(/\n{2,}/).map((p) => p.replace(/\s+/g, " ").trim()).filter((p) => p.length > 40);

  let buffer = "";
  let bufferLines: string[] = [];
  let idx = 0;

  const flush = () => {
    if (buffer.length >= MIN_CHUNK_LEN) {
      const { secao, componente, etapa } = detectMeta(bufferLines);
      chunks.push({ id: slugify(secao, idx++, uf), texto: buffer.trim(), estado: uf, secao, componente, etapa });
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
      console.log(`  ⏳ Rate limit (${res.status}), aguardando ${wait / 1000}s antes de tentar novamente...`);
      await sleep(wait);
      continue;
    }
    throw new Error(`Embed error ${res.status}: ${await res.text()}`);
  }
  throw new Error("Embed falhou após 6 tentativas (rate limit persistente).");
}

// ── Pinecone upsert ──────────────────────────────────────────────────────────

async function upsertBatch(
  ns: ReturnType<ReturnType<Pinecone["index"]>["namespace"]>,
  chunks: EstadualChunk[],
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
    metadata: { texto: chunk.texto, estado: chunk.estado, secao: chunk.secao, componente: chunk.componente, etapa: chunk.etapa, source: "curriculo_estadual" },
  }));

  await ns.upsert({ records });
  console.log(`  ✓ Lote ${batchNum}/${total} upsertado: ${records.length} vetores`);
  await sleep(EMBED_DELAY_MS);
}

// ── Download ─────────────────────────────────────────────────────────────────

async function loadPdf(uf: string, config: EstadoConfig): Promise<Buffer> {
  if (config.pdf_path) {
    const p = path.resolve(config.pdf_path);
    if (!fs.existsSync(p)) throw new Error(`Arquivo não encontrado: ${p}`);
    return fs.readFileSync(p);
  }
  if (!config.pdf_url) throw new Error(`Nenhum pdf_url ou pdf_path para ${uf}`);

  const cacheDir = path.join(process.cwd(), ".cache");
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir);
  const filename = path.join(cacheDir, `curriculo_${uf}_${path.basename(new URL(config.pdf_url).pathname)}`);

  if (fs.existsSync(filename)) { console.log(`  → Cache: ${filename}`); return fs.readFileSync(filename); }

  console.log(`  → Baixando: ${config.pdf_url}`);
  // Sites de secretarias estaduais frequentemente têm certificados SSL não reconhecidos pelo Node
  const agent = process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0"
    ? undefined
    : undefined; // NODE_TLS_REJECT_UNAUTHORIZED=0 já resolve globalmente
  const res = await fetch(config.pdf_url, { headers: { "User-Agent": "Mozilla/5.0 PlanoMagistra/1.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar PDF de ${uf}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filename, buffer);
  return buffer;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!PINECONE_API_KEY) throw new Error("PINECONE_API_KEY não definida");
  if (!GEMINI_API_KEY)   throw new Error("GOOGLE_GEMINI_API_KEY não definida");

  const configPath = path.join(process.cwd(), "scripts", "curriculo-estados-urls.json");
  const allEstados = JSON.parse(fs.readFileSync(configPath, "utf-8")) as EstadosMap;

  // Filter by CLI args (e.g. npx tsx ingest-curriculo-estadual.ts SP MG)
  const ufsArgs = process.argv.slice(2).map((s) => s.toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s));

  const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });
  const ns = pinecone.index(PINECONE_INDEX).namespace(NAMESPACE);

  let totalChunks = 0;
  let skipped = 0;

  for (const [uf, configRaw] of Object.entries(allEstados)) {
    if (uf === "_instrucoes" || typeof configRaw !== "object" || !configRaw) continue;
    const config = configRaw as EstadoConfig;
    if (ufsArgs.length > 0 && !ufsArgs.includes(uf)) continue;
    if (!config.pdf_url && !config.pdf_path) { skipped++; continue; }

    console.log(`\n📍 ${uf} — ${config.nome}`);
    try {
      const buffer = await loadPdf(uf, config);
      const { text } = await pdf(buffer);
      const chunks = extractChunks(text, uf);
      totalChunks += chunks.length;

      const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);
      for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        await upsertBatch(ns, chunks.slice(i, i + BATCH_SIZE), Math.floor(i / BATCH_SIZE) + 1, totalBatches);
      }
    } catch (err) {
      console.error(`  ✗ Erro ao processar ${uf}:`, err);
    }
  }

  console.log(`\n✅ Ingestão estadual concluída! ${totalChunks} chunks indexados.`);
  if (skipped > 0) console.log(`   ${skipped} estados pulados (sem URL/caminho configurado).`);
  console.log(`   Index: ${PINECONE_INDEX} | Namespace: ${NAMESPACE}`);
}

main().catch((err) => { console.error("❌", err); process.exit(1); });
