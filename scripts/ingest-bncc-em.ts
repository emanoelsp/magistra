/**
 * Ingestão BNCC — Ensino Médio apenas.
 * Retomável: salva progresso em .cache/bncc-em-progress.json
 * e pula chunks já indexados no Pinecone.
 *
 * Uso: npx tsx scripts/ingest-bncc-em.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import fs from "fs";
import path from "path";
import pdf from "pdf-parse";
import { Pinecone } from "@pinecone-database/pinecone";

const PINECONE_API_KEY = process.env.PINECONE_API_KEY!;
const PINECONE_INDEX   = process.env.PINECONE_INDEX ?? "bncc";
const GEMINI_API_KEY   = process.env.GOOGLE_GEMINI_API_KEY!;
const EMBEDDING_MODEL  = "gemini-embedding-001";
const EMBEDDING_API_VER = "v1beta";
const BATCH_SIZE       = 30;   // menor que o original para evitar timeout
const EMBED_DELAY_MS   = 500;
const DOWNLOAD_RETRIES = 5;

// Se o PDF foi baixado manualmente, coloque em .cache/BNCC_EnsinoMedio.pdf
const EM_PDF_LOCAL  = path.join(process.cwd(), ".cache", "BNCC_EnsinoMedio.pdf");
const CACHE_DIR     = path.join(process.cwd(), ".cache");
const PROGRESS_FILE = path.join(CACHE_DIR, "bncc-em-progress.json");

// URLs do MEC para o BNCC Ensino Médio (tentadas em ordem)
const EM_PDF_URLS = [
  "https://basenacionalcomum.mec.gov.br/images/historico/04122019-BNCC-FINAL.pdf",
  "https://basenacionalcomum.mec.gov.br/images/BNCC_EnsinoMedio_embaixa_site_110518.pdf",
];

interface BnccChunk {
  codigo: string;
  texto: string;
  area: string;
  componente: string;
  etapa: string;
  ano: string;
}

interface Progress {
  totalChunks: number;
  upserted: string[];   // códigos já indexados nesta sessão
  lastBatch: number;
}

// ── Progress helpers ──────────────────────────────────────────────────────────

function loadProgress(): Progress {
  if (fs.existsSync(PROGRESS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf-8")) as Progress;
    } catch { /* ignore corrupt file */ }
  }
  return { totalChunks: 0, upserted: [], lastBatch: 0 };
}

function saveProgress(p: Progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2));
}

// ── Parsing ───────────────────────────────────────────────────────────────────

// EM BNCC codes: EM13MAT101, EM13LP01, EM13CNT101, etc.
const EM_CODE_RE = /\((EM\d{2}[A-Z]{2,3}\d{2,3})\)/g;

const EM_AREA_MAP: Record<string, string> = {
  MAT: "Matemática",
  LGG: "Linguagens",
  CNT: "Ciências da Natureza",
  CHS: "Ciências Humanas e Sociais Aplicadas",
  LP:  "Língua Portuguesa",
  LE:  "Língua Estrangeira",
};

function parseEmCodigo(codigo: string): { componente: string; area: string; ano: string } {
  const compSigla = codigo.slice(4, 7);
  const comp2     = codigo.slice(4, 6);
  const componente = EM_AREA_MAP[compSigla] ?? EM_AREA_MAP[comp2] ?? compSigla;
  return { componente, area: componente, ano: codigo.slice(2, 4) };
}

function extractEmChunks(text: string): BnccChunk[] {
  const chunks: BnccChunk[] = [];
  const seen = new Set<string>();
  EM_CODE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = EM_CODE_RE.exec(text)) !== null) {
    const codigo = match[1];
    if (seen.has(codigo)) continue;
    seen.add(codigo);

    const before = text.slice(Math.max(0, match.index - 800), match.index);
    const lines  = before.split("\n").map((l) => l.trim()).filter(Boolean);
    const descricao = lines.slice(-4).join(" ").replace(/\s+/g, " ").trim();
    if (descricao.length < 20) continue;

    const { componente, area, ano } = parseEmCodigo(codigo);
    chunks.push({ codigo, texto: `(${codigo}) ${descricao}`, area, componente, etapa: "EM", ano });
  }

  return chunks;
}

// ── Embedding ─────────────────────────────────────────────────────────────────

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

// ── Download com retry ────────────────────────────────────────────────────────

// Salva sempre como BNCC_EnsinoMedio.pdf — tenta cada URL até obter um PDF válido (>3 MB)
async function downloadEmPdf(): Promise<Buffer> {
  // Verificar cache existente
  if (fs.existsSync(EM_PDF_LOCAL)) {
    const size = fs.statSync(EM_PDF_LOCAL).size;
    if (size > 3_000_000) {
      console.log(`  → Cache local: ${EM_PDF_LOCAL} (${(size / 1024 / 1024).toFixed(1)} MB)`);
      return fs.readFileSync(EM_PDF_LOCAL);
    }
    // arquivo inválido ou pequeno demais — deletar e re-baixar
    fs.unlinkSync(EM_PDF_LOCAL);
    console.log("  → Cache inválido removido, re-baixando...");
  }

  for (const url of EM_PDF_URLS) {
    for (let attempt = 1; attempt <= DOWNLOAD_RETRIES; attempt++) {
      try {
        console.log(`  → Tentativa ${attempt}/${DOWNLOAD_RETRIES}: baixando de ${url.split("/").pop()}...`);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 90_000);

        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());

        if (buffer.length < 3_000_000) {
          console.warn(`  ⚠  Arquivo muito pequeno (${(buffer.length / 1024 / 1024).toFixed(1)} MB) — pode ser o PDF errado`);
          break; // tentar próxima URL
        }

        fs.writeFileSync(EM_PDF_LOCAL, buffer);
        console.log(`  → Salvo: ${EM_PDF_LOCAL} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);
        return buffer;
      } catch (err) {
        console.warn(`  ⚠  Tentativa ${attempt} (${url.split("/").pop()}) falhou: ${err}`);
        if (attempt < DOWNLOAD_RETRIES) await sleep(3000 * attempt);
      }
    }
  }
  throw new Error("Falha ao baixar o PDF do BNCC EM. Baixe manualmente e salve como .cache/BNCC_EnsinoMedio.pdf");
}

// ── Upsert com checkpoint ─────────────────────────────────────────────────────

async function upsertBatch(
  index: ReturnType<Pinecone["index"]>,
  chunks: BnccChunk[],
  batchNum: number,
  total: number,
  progress: Progress,
): Promise<string[]> {
  const ids = chunks.map((c) => c.codigo);

  // Pular IDs já em progresso local
  const alreadyDone = new Set(progress.upserted);
  const toCheck = chunks.filter((c) => !alreadyDone.has(c.codigo));

  if (toCheck.length === 0) {
    console.log(`  ↷ Lote ${batchNum}/${total} já concluído — pulando`);
    return [];
  }

  // Verificar quais já estão no Pinecone
  const fetched = await index.fetch({ ids: toCheck.map((c) => c.codigo) });
  const existingIds = new Set(Object.keys(fetched.records ?? {}));
  const pending = toCheck.filter((c) => !existingIds.has(c.codigo));

  if (pending.length === 0) {
    console.log(`  ↷ Lote ${batchNum}/${total} — todos já no Pinecone`);
    return toCheck.map((c) => c.codigo);
  }

  if (existingIds.size > 0) {
    console.log(`  ↷ ${existingIds.size} já indexados, embedando ${pending.length} novos`);
  }

  process.stdout.write(`  Lote ${batchNum}/${total}: embedando ${pending.length} chunks...\r`);
  const allValues = await embedBatch(pending.map((c) => c.texto));

  await index.upsert({
    records: pending.map((chunk, i) => ({
      id: chunk.codigo,
      values: allValues[i]!,
      metadata: { codigo: chunk.codigo, texto: chunk.texto, area: chunk.area, componente: chunk.componente, etapa: chunk.etapa, ano: chunk.ano },
    })),
  });

  console.log(`  ✓ Lote ${batchNum}/${total}: ${pending.length} vetores upsertados (${ids.join(", ").slice(0, 60)}...)`);
  await sleep(EMBED_DELAY_MS);
  return [...existingIds, ...pending.map((c) => c.codigo)];
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!PINECONE_API_KEY) throw new Error("PINECONE_API_KEY não definida");
  if (!GEMINI_API_KEY) throw new Error("GOOGLE_GEMINI_API_KEY não definida");
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

  const progress = loadProgress();
  console.log(`\n📌 Progresso anterior: ${progress.upserted.length} chunks já indexados`);
  if (progress.lastBatch > 0) {
    console.log(`   Retomando do lote ${progress.lastBatch + 1}...`);
  }

  console.log("\n🔌 Conectando ao Pinecone...");
  const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });
  const index = pinecone.index(PINECONE_INDEX);

  console.log("\n📄 Obtendo PDF do BNCC Ensino Médio...");
  const pdfBuffer = await downloadEmPdf();

  console.log("📝 Extraindo chunks do EM...");
  const { text } = await pdf(pdfBuffer);
  const chunks = extractEmChunks(text);
  console.log(`   → ${chunks.length} habilidades EM extraídas`);

  if (chunks.length === 0) {
    console.error("❌ Nenhum chunk extraído — verificar regex ou PDF.");
    process.exit(1);
  }

  progress.totalChunks = chunks.length;
  saveProgress(progress);

  const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);
  let totalNew = 0;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    if (batchNum <= progress.lastBatch) {
      process.stdout.write(`  ↷ Lote ${batchNum}/${totalBatches} (antes do checkpoint)\r`);
      continue;
    }

    try {
      const inserted = await upsertBatch(index, chunks.slice(i, i + BATCH_SIZE), batchNum, totalBatches, progress);
      totalNew += inserted.length;
      progress.upserted = [...new Set([...progress.upserted, ...inserted])];
      progress.lastBatch = batchNum;
      saveProgress(progress);
    } catch (err) {
      console.error(`\n❌ Erro no lote ${batchNum}: ${err}`);
      console.log(`   Progresso salvo até lote ${progress.lastBatch}. Rode novamente para continuar.`);
      process.exit(1);
    }
  }

  console.log(`\n✅ Ingestão EM concluída!`);
  console.log(`   ${chunks.length} habilidades processadas | ${totalNew} novas no Pinecone`);
  console.log(`   Index: ${PINECONE_INDEX}`);

  // Limpar progresso após sucesso
  fs.unlinkSync(PROGRESS_FILE);
  console.log("   Checkpoint removido.");
}

main().catch((err) => {
  console.error("❌ Erro fatal:", err);
  process.exit(1);
});
