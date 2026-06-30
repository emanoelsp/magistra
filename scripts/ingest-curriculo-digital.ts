/**
 * Ingesta do Currículo de Educação Digital / Computação na BNCC no Pinecone.
 *
 * Cobre dois documentos complementares:
 *   1. "Computação na Educação Básica — Complemento à BNCC" (MEC/CNE 2022)
 *      Códigos: EF01CO01, EF02CO01 … EF09CO01, EM13CO01 …
 *   2. "Currículo de Referência em Tecnologia e Computação" (CIEB)
 *      Texto livre por etapa/área, sem código padronizado.
 *
 * Uso:
 *   CURRICULO_DIGITAL_PDF_PATH=./docs/computacao-bncc.pdf npx tsx scripts/ingest-curriculo-digital.ts
 *
 * Sem PDF local, tenta baixar de CURRICULO_DIGITAL_PDF_URL (defina no .env.local).
 *
 * Vetores no namespace "curriculo_digital" do mesmo index da BNCC.
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
import fs from "fs";
import path from "path";
import pdf from "pdf-parse";
import { Pinecone } from "@pinecone-database/pinecone";

// ── Config ────────────────────────────────────────────────────────────────────

const PINECONE_API_KEY  = process.env.PINECONE_API_KEY!;
const PINECONE_INDEX    = process.env.PINECONE_INDEX ?? "bncc";
const NAMESPACE         = "curriculo_digital";
const GEMINI_API_KEY    = process.env.GOOGLE_GEMINI_API_KEY!;
const EMBEDDING_MODEL   = "gemini-embedding-001";
const EMBEDDING_API_VER = "v1beta";
const BATCH_SIZE        = 30;
const EMBED_SUB_BATCH   = 10;
const EMBED_SUB_DELAY   = 3000;
const EMBED_DELAY_MS    = 500;
const MIN_CHUNK_LEN     = 60;
const CHUNK_SIZE        = 700;

const PDF_PATH = process.env.CURRICULO_DIGITAL_PDF_PATH ?? "";
// URL oficial MEC — Guia de Educação Digital e Midiática (2025)
const PDF_URL  = process.env.CURRICULO_DIGITAL_PDF_URL
  ?? "https://www.gov.br/mec/pt-br/escolas-conectadas/arquivos/guia_eddigital_versofinaloficial.pdf";

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface DigitalChunk {
  id: string;
  codigo: string;
  texto: string;
  etapa: string;
  ano: string;
  area: string;
}

// ── Parser ────────────────────────────────────────────────────────────────────

// Códigos BNCC Computação: EF01CO01 … EF09CO12, EM13CO01 …
const CO_CODE_RE = /\b((?:EF\d{2}|EM\d{2})CO\d{2,3})\b/g;

// Áreas do Currículo de Educação Digital / CIEB
const AREAS_DIGITAL = [
  "Pensamento Computacional",
  "Mundo Digital",
  "Cultura Digital",
  "Tecnologia Digital",
  "Computação",
  "Algoritmos e Programação",
  "Dados e Privacidade",
  "Hardware e Software",
  "Redes e Internet",
];

function detectArea(text: string): string {
  const t = text.toLowerCase();
  for (const a of AREAS_DIGITAL) {
    if (t.includes(a.toLowerCase())) return a;
  }
  return "Educação Digital";
}

function detectEtapa(text: string): string {
  const t = text.toLowerCase();
  if (/ensino\s*m[eé]dio|\bem\b|[1-3][°º]\s*ano\s*(?:em|médio)/.test(t)) return "EM";
  if (/[6-9][°º]\s*ano|anos\s*finais|ef[\s-]?af/.test(t)) return "EF-AF";
  if (/[1-5][°º]\s*ano|anos\s*iniciais|ef[\s-]?ai/.test(t)) return "EF-AI";
  if (/educa[cç][aã]o\s*infantil|\bei\b/.test(t)) return "EI";
  return "EF";
}

function detectAno(text: string): string {
  const m = /([1-9][°º]?\s*ano(?:\s*ao\s*[1-9][°º]?\s*ano)?)/i.exec(text);
  return m ? m[1].trim() : "";
}

function slugify(s: string, idx: number): string {
  return `digcurr_${idx}_` + s.toLowerCase().normalize("NFD")
    .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").slice(0, 40);
}

// Parser 1: documentos com códigos EFxxCO / EMxxCO (BNCC Computação)
function extractChunksWithCodes(text: string): DigitalChunk[] {
  const chunks: DigitalChunk[] = [];
  const seen = new Set<string>();

  CO_CODE_RE.lastIndex = 0;
  const positions: Array<{ codigo: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = CO_CODE_RE.exec(text)) !== null) {
    positions.push({ codigo: m[1], index: m.index });
  }

  for (let i = 0; i < positions.length; i++) {
    const { codigo, index } = positions[i];
    if (seen.has(codigo)) continue;
    seen.add(codigo);

    const nextIdx = positions[i + 1]?.index ?? index + 500;
    const snippet = text.slice(index, Math.min(nextIdx, index + 500))
      .replace(/\s+/g, " ").trim();
    if (snippet.length < 20) continue;

    const before = text.slice(Math.max(0, index - 400), index);
    const etapa = detectEtapa(before + snippet);
    const ano   = detectAno(before + snippet);
    const area  = detectArea(before + snippet);

    chunks.push({
      id: `digcurr_${codigo}`,
      codigo,
      texto: `Educação Digital BNCC — ${etapa}${ano ? " " + ano : ""} — ${area}: ${snippet}`,
      etapa,
      ano,
      area,
    });
  }

  console.log(`  → ${chunks.length} habilidades com código CO extraídas`);
  return chunks;
}

// Parser 2: documentos sem códigos (CIEB, guias estaduais) — chunking por parágrafo
function extractChunksFreeText(text: string): DigitalChunk[] {
  const chunks: DigitalChunk[] = [];
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 50);

  let buffer = "";
  let idx = 0;
  let currentEtapa = "EF";
  let currentArea  = "Educação Digital";
  let currentAno   = "";

  const flush = () => {
    if (buffer.length < MIN_CHUNK_LEN) { buffer = ""; return; }
    const detectedEtapa = detectEtapa(buffer);
    const detectedArea  = detectArea(buffer);
    const detectedAno   = detectAno(buffer);
    if (detectedEtapa) currentEtapa = detectedEtapa;
    if (detectedArea !== "Educação Digital") currentArea = detectedArea;
    if (detectedAno) currentAno = detectedAno;

    chunks.push({
      id: slugify(currentArea, idx++),
      codigo: `DIGCURR-${idx}`,
      texto: `Educação Digital — ${currentEtapa}${currentAno ? " " + currentAno : ""} — ${currentArea}: ${buffer.trim()}`,
      etapa: currentEtapa,
      ano: currentAno,
      area: currentArea,
    });
    buffer = "";
  };

  for (const p of paragraphs) {
    if (buffer.length + p.length > CHUNK_SIZE && buffer.length > 0) flush();
    buffer += (buffer ? " " : "") + p;
  }
  flush();

  console.log(`  → ${chunks.length} chunks de texto livre extraídos`);
  return chunks;
}

function extractChunks(text: string): DigitalChunk[] {
  CO_CODE_RE.lastIndex = 0;
  const hasCodedHabilidades = CO_CODE_RE.test(text);
  CO_CODE_RE.lastIndex = 0;
  return hasCodedHabilidades
    ? extractChunksWithCodes(text)
    : extractChunksFreeText(text);
}

// ── Embedding ─────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function embedBatch(texts: string[]): Promise<number[][]> {
  const requests = texts.map((t) => ({
    model: `models/${EMBEDDING_MODEL}`,
    content: { parts: [{ text: t }] },
    taskType: "RETRIEVAL_DOCUMENT",
  }));
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
      const body = await res.text();
      const delayMatch = body.match(/"(\d+)s"/);
      const wait = delayMatch ? (parseInt(delayMatch[1]) + 5) * 1000 : (attempt + 1) * 15_000;
      console.log(`\n  ⏳ Rate limit (${res.status}), aguardando ${Math.round(wait / 1000)}s...`);
      await sleep(wait);
      continue;
    }
    throw new Error(`Embed error ${res.status}: ${await res.text()}`);
  }
  throw new Error("Embed falhou após 6 tentativas.");
}

// ── Pinecone upsert ───────────────────────────────────────────────────────────

async function upsertBatch(
  ns: ReturnType<ReturnType<Pinecone["index"]>["namespace"]>,
  chunks: DigitalChunk[],
  batchNum: number,
  total: number,
) {
  const ids = chunks.map((c) => c.id);
  const fetched = await ns.fetch({ ids });
  const existing = new Set(Object.keys(fetched.records ?? {}));
  const pending  = chunks.filter((c) => !existing.has(c.id));

  if (pending.length === 0) { console.log(`  ↷ Lote ${batchNum}/${total} já indexado — pulando`); return; }

  const allValues: number[][] = [];
  for (let s = 0; s < pending.length; s += EMBED_SUB_BATCH) {
    const sub = pending.slice(s, s + EMBED_SUB_BATCH).map((c) => c.texto);
    process.stdout.write(`  Embedando sub-lote ${Math.floor(s / EMBED_SUB_BATCH) + 1} (${sub.length} textos)...\r`);
    allValues.push(...await embedBatch(sub));
    if (s + EMBED_SUB_BATCH < pending.length) await sleep(EMBED_SUB_DELAY);
  }

  await ns.upsert({
    records: pending.map((chunk, i) => ({
      id: chunk.id,
      values: allValues[i]!,
      metadata: {
        codigo: chunk.codigo,
        texto:  chunk.texto,
        etapa:  chunk.etapa,
        ano:    chunk.ano,
        area:   chunk.area,
        source: "curriculo_digital",
      },
    })),
  });
  console.log(`  ✓ Lote ${batchNum}/${total} upsertado: ${pending.length} vetores`);
  await sleep(EMBED_DELAY_MS);
}

// ── Download ──────────────────────────────────────────────────────────────────

async function loadPdf(): Promise<Buffer> {
  if (PDF_PATH) {
    const p = path.resolve(PDF_PATH);
    if (!fs.existsSync(p)) throw new Error(`Arquivo não encontrado: ${p}`);
    console.log(`  → Lendo: ${p}`);
    return fs.readFileSync(p);
  }
  if (!PDF_URL) {
    throw new Error(
      "Defina CURRICULO_DIGITAL_PDF_PATH (caminho local) ou CURRICULO_DIGITAL_PDF_URL no .env.local.\n" +
      "Documentos sugeridos:\n" +
      "  • Computação na Educação Básica (MEC 2022): buscar no portal.mec.gov.br\n" +
      "  • Currículo de Referência em Tecnologia (CIEB): curriculo.cieb.net.br",
    );
  }
  const cacheDir = path.join(process.cwd(), ".cache");
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir);
  const filename = path.join(cacheDir, `curriculo_digital_${path.basename(new URL(PDF_URL).pathname)}`);
  if (fs.existsSync(filename)) { console.log(`  → Cache: ${filename}`); return fs.readFileSync(filename); }

  console.log(`  → Baixando: ${PDF_URL}`);
  const res = await fetch(PDF_URL, { headers: { "User-Agent": "Mozilla/5.0 PlanoMagistra/1.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar PDF`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filename, buffer);
  return buffer;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!PINECONE_API_KEY) throw new Error("PINECONE_API_KEY não definida");
  if (!GEMINI_API_KEY)   throw new Error("GOOGLE_GEMINI_API_KEY não definida");

  console.log("🔌 Conectando ao Pinecone...");
  const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });
  const ns = pinecone.index(PINECONE_INDEX).namespace(NAMESPACE);

  console.log("\n📄 Carregando Currículo de Educação Digital...");
  const buffer = await loadPdf();
  const { text, numpages } = await pdf(buffer);
  console.log(`  → ${numpages} páginas`);
  const chunks = extractChunks(text);

  const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    await upsertBatch(ns, chunks.slice(i, i + BATCH_SIZE), Math.floor(i / BATCH_SIZE) + 1, totalBatches);
  }

  console.log(`\n✅ Ingestão Currículo Digital concluída! ${chunks.length} chunks indexados.`);
  console.log(`   Index: ${PINECONE_INDEX} | Namespace: ${NAMESPACE}`);
}

main().catch((err) => { console.error("❌", err); process.exit(1); });
