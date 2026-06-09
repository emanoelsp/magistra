/**
 * Script de ingestão dos descritores do SAEB no Pinecone.
 *
 * Uso:
 *   npx tsx scripts/ingest-saeb.ts
 *
 * Requer no .env.local:
 *   GOOGLE_GEMINI_API_KEY, PINECONE_API_KEY, PINECONE_INDEX
 *
 * Fontes (documentos oficiais INEP):
 *   O script tenta baixar as matrizes de referência do SAEB automaticamente.
 *   Para usar um PDF local: defina SAEB_PDF_PATH=./docs/saeb.pdf
 *
 * Os vetores são armazenados no namespace "saeb" do mesmo index da BNCC.
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
const NAMESPACE        = "saeb";
const GEMINI_API_KEY   = process.env.GOOGLE_GEMINI_API_KEY!;
const EMBEDDING_MODEL  = "gemini-embedding-001";
const EMBEDDING_API_VER = "v1beta";
const BATCH_SIZE       = 50;
const EMBED_DELAY_MS   = 300;

const PDF_PATH = process.env.SAEB_PDF_PATH ?? "";

// URLs oficiais INEP — Matrizes de Referência SAEB
const SAEB_URLS = [
  "https://download.inep.gov.br/educacao_basica/saeb/2022/documentos/matrizes_de_referencia_saeb.pdf",
];

// ── Tipos ────────────────────────────────────────────────────────────────────

interface SaebChunk {
  id: string;
  codigo: string;
  texto: string;
  componente: string;
  etapa: string;
  topico: string;
}

// ── Parsing ──────────────────────────────────────────────────────────────────

// Descritores SAEB: D01, D02, ... D99
const DESCRITOR_REGEX = /\bD(\d{1,2})\b/g;

// Tópicos do SAEB (Roman numerals or numbered sections)
const TOPICO_REGEX = /^(T[eê]pico\s*[IVX\d]+[:.]?|[IVX]+[.:]?\s+\w)/i;

function detectComponente(context: string): string {
  const c = context.toLowerCase();
  if (/portugu[eê]s|leitura|texto|lingu[aá]gem/.test(c)) return "Língua Portuguesa";
  if (/matem[aá]tica|n[úu]mero|geometria|álgebra/.test(c)) return "Matemática";
  if (/ci[eê]ncias|f[ií]sica|qu[ií]mica|biologia/.test(c)) return "Ciências";
  return "";
}

function detectEtapa(context: string): string {
  const c = context.toLowerCase();
  if (/5[oº°]\s*ano|5[aª]\s*série|anos\s*iniciais/.test(c)) return "EF-AI";
  if (/9[oº°]\s*ano|9[aª]\s*série|anos\s*finais/.test(c)) return "EF-AF";
  if (/3[oº°]\s*ano|ensino\s*m[eé]dio/.test(c)) return "EM";
  return "EF";
}

function extractChunks(text: string): SaebChunk[] {
  const chunks: SaebChunk[] = [];
  const seen = new Set<string>();

  // Reset regex
  DESCRITOR_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = DESCRITOR_REGEX.exec(text)) !== null) {
    const num = match[1].padStart(2, "0");
    const codigo = `D${num}`;
    if (seen.has(codigo)) continue;
    seen.add(codigo);

    // Contexto antes do descritor (até 700 chars)
    const before = text.slice(Math.max(0, match.index - 700), match.index);
    const lines = before.split("\n").map((l) => l.trim()).filter(Boolean);

    // Contexto depois do descritor (até 400 chars — o texto da habilidade)
    const after = text.slice(match.index, match.index + 400);
    const afterLines = after.split("\n").map((l) => l.trim()).filter(Boolean);

    // O texto do descritor é normalmente a linha logo após o código
    const descLines = afterLines.slice(0, 4).join(" ").replace(/\s+/g, " ").trim();
    if (descLines.length < 20) continue;

    // Detectar tópico (seção pai do descritor)
    let topico = "";
    for (const l of [...lines].reverse()) {
      if (TOPICO_REGEX.test(l)) { topico = l.slice(0, 80); break; }
    }

    const contextoFull = [...lines.slice(-5), ...afterLines.slice(0, 5)].join(" ");
    const componente = detectComponente(contextoFull);
    const etapa = detectEtapa([...lines].reverse().join(" "));

    chunks.push({
      id: `saeb_${codigo}`,
      codigo,
      texto: `${codigo}: ${descLines}`,
      componente,
      etapa,
      topico: topico || "Geral",
    });
  }

  console.log(`  → ${chunks.length} descritores extraídos`);
  return chunks;
}

// ── Embedding ────────────────────────────────────────────────────────────────

async function embedBatch(texts: string[]): Promise<number[][]> {
  const requests = texts.map((text) => ({
    model: `models/${EMBEDDING_MODEL}`,
    content: { parts: [{ text }] },
    taskType: "RETRIEVAL_DOCUMENT",
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
  chunks: SaebChunk[],
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
      codigo: chunk.codigo,
      texto: chunk.texto,
      componente: chunk.componente,
      etapa: chunk.etapa,
      topico: chunk.topico,
      source: "saeb",
    },
  }));

  await ns.upsert({ records });
  console.log(`  ✓ Lote ${batchNum}/${total} upsertado: ${records.length} vetores`);
  await sleep(EMBED_DELAY_MS);
}

// ── Download PDF ─────────────────────────────────────────────────────────────

async function downloadPdf(url: string): Promise<Buffer> {
  const cacheDir = path.join(process.cwd(), ".cache");
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir);
  const filename = path.join(cacheDir, "saeb_" + path.basename(url.split("?")[0]));

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
  if (!GEMINI_API_KEY)   throw new Error("GOOGLE_GEMINI_API_KEY não definida no .env.local");

  console.log("🔌 Conectando ao Pinecone...");
  const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });
  const index = pinecone.index(PINECONE_INDEX);
  const ns = index.namespace(NAMESPACE);

  const sources = PDF_PATH ? [PDF_PATH] : SAEB_URLS;
  let totalChunks = 0;

  for (const source of sources) {
    console.log(`\n📄 Processando: ${path.basename(source)}`);
    const pdfBuffer = PDF_PATH
      ? fs.readFileSync(path.resolve(PDF_PATH))
      : await downloadPdf(source);
    const { text } = await pdf(pdfBuffer);
    const chunks = extractChunks(text);
    totalChunks += chunks.length;

    const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      await upsertBatch(ns, batch, batchNum, totalBatches);
    }
  }

  console.log(`\n✅ Ingestão SAEB concluída! ${totalChunks} descritores indexados.`);
  console.log(`   Index: ${PINECONE_INDEX} | Namespace: ${NAMESPACE}`);
}

main().catch((err) => {
  console.error("❌ Erro na ingestão SAEB:", err);
  process.exit(1);
});
