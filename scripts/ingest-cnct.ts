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
const BATCH_SIZE       = 100;
const EMBED_SUB_BATCH  = 20;
const EMBED_DELAY_MS   = 500;
const EMBED_SUB_DELAY  = 8000;
const MIN_CHUNK_LEN    = 80;
const CHUNK_SIZE       = 900;

const PDF_PATH = process.env.CNCT_PDF_PATH ?? "";
// URL do catálogo PDF via API do portal CNCT/MEC. Protegida por Cloudflare — pode retornar HTML.
// Fallback: baixar manualmente em https://cnct.mec.gov.br e usar CNCT_PDF_PATH.
const CNCT_URL = process.env.CNCT_URL ?? "https://cnct.mec.gov.br/cnct-api/catalogopdf";

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

// Extrai "TÉCNICO EM XXX" ou "TECNÓLOGO EM XXX" do início de um parágrafo.
// Neste PDF gerado pelo portal CNCT, cada seção de curso começa com:
//   "TÉCNICO EM [NOME] [carga] horas [conteúdo...]"
// Captura tudo antes da carga horária (dígitos seguidos de "horas").
function detectCurso(text: string): string {
  // Caminho 1: parágrafo COMEÇA com o nome do curso (formato deste PDF)
  const mStart = /^(T[EÉ]CNICO\s+EM\s+[\wÀ-ÿ\s]+?|TECN[OÓ]LOGO\s+EM\s+[\wÀ-ÿ\s]+?)\s+\d{3,4}\s+horas/i.exec(text);
  if (mStart) return mStart[1].replace(/\s+/g, " ").trim().slice(0, 80);

  // Caminho 2: nome no meio do texto (PDFs mais antigos, fallback)
  const mMid = /(?:^|\s)(T[EÉ]CNICO\s+EM\s+[\wÀ-ÿ\s]+?|TECN[OÓ]LOGO\s+EM\s+[\wÀ-ÿ\s]+?)\s*(?:\d{3,4}\s+horas|$)/im.exec(text);
  if (mMid) return mMid[1].replace(/\s+/g, " ").trim().slice(0, 80);

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
  let idx = 0;
  // Sticky: propaga eixo/curso para chunks que não os mencionam explicitamente.
  // Reseta curso quando um novo eixo é detectado (nova seção do catálogo).
  let currentEixo = "";
  let currentCurso = "";

  const flush = () => {
    if (buffer.length < MIN_CHUNK_LEN) { buffer = ""; return; }

    const detectedEixo  = detectEixo(buffer);
    const detectedCurso = detectCurso(buffer);

    if (detectedEixo && detectedEixo !== currentEixo) {
      currentEixo  = detectedEixo;
      currentCurso = ""; // novo eixo → reset curso
    }
    if (detectedCurso) currentCurso = detectedCurso;

    // Descarta chunks de antes da primeira seção de eixo (cabeçalhos/sumário)
    if (!currentEixo) { buffer = ""; return; }

    chunks.push({
      id: slugify(currentCurso || currentEixo, idx++),
      texto: buffer.trim(),
      eixo: currentEixo,
      curso: currentCurso,
      etapa: "EM",
    });
    buffer = "";
  };

  for (const p of paragraphs) {
    if (buffer.length + p.length > CHUNK_SIZE && buffer.length > 0) flush();
    buffer += (buffer ? " " : "") + p;
  }
  flush();

  const semEixo   = chunks.filter((c) => !c.eixo).length;
  const semCurso  = chunks.filter((c) => !c.curso).length;
  console.log(`  → ${chunks.length} chunks extraídos (sem eixo: ${semEixo} | sem curso: ${semCurso})`);
  return chunks;
}

// ── Embedding ────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function embedBatch(texts: string[]): Promise<number[][]> {
  const requests = texts.map((text) => ({ model: `models/${EMBEDDING_MODEL}`, content: { parts: [{ text }] }, taskType: "RETRIEVAL_DOCUMENT" }));
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/${EMBEDDING_API_VER}/models/${EMBEDDING_MODEL}:batchEmbedContents?key=${GEMINI_API_KEY}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requests }) },
      );
      if (res.ok) {
        const data = (await res.json()) as { embeddings: { values: number[] }[] };
        return data.embeddings.map((e) => e.values);
      }
      if (res.status === 429 || res.status === 503) {
        const wait = [30, 60, 90, 120, 150, 180][attempt] ?? 180;
        console.log(`  ⏳ Rate limit (${res.status}), aguardando ${wait}s... (tentativa ${attempt + 1}/6)`);
        await sleep(wait * 1000);
        continue;
      }
      throw new Error(`Embed error ${res.status}: ${await res.text()}`);
    } catch (err) {
      // Captura timeouts de rede (ConnectTimeoutError) além de HTTP 4xx/5xx
      if (err instanceof Error && (err.message.includes("fetch failed") || err.message.includes("Timeout"))) {
        const wait = [30, 60, 90, 120, 150, 180][attempt] ?? 180;
        console.log(`  ⏳ Erro de rede, aguardando ${wait}s... (tentativa ${attempt + 1}/6)`);
        await sleep(wait * 1000);
        continue;
      }
      throw err;
    }
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

  console.log(`  → Tentando baixar: ${CNCT_URL}`);
  const res = await fetch(CNCT_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/pdf,*/*",
      "Accept-Language": "pt-BR,pt;q=0.9",
    },
  });
  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} ao baixar CNCT.\n` +
      "O portal cnct.mec.gov.br está protegido por Cloudflare e bloqueia downloads automáticos.\n" +
      "Baixe o PDF manualmente em: https://cnct.mec.gov.br → botão 'Catálogo PDF'\n" +
      "Depois rode:\n" +
      "  CNCT_PDF_PATH=./docs/cnct.pdf npx tsx scripts/ingest-cnct.ts",
    );
  }
  // Verifica se retornou HTML (Cloudflare JS challenge) em vez de PDF
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    const html = await res.text();
    if (html.includes("Cloudflare") || html.includes("Just a moment") || html.includes("challenge")) {
      throw new Error(
        "O Cloudflare está bloqueando o download automático do CNCT.\n" +
        "Baixe o PDF manualmente em: https://cnct.mec.gov.br → botão 'Catálogo PDF'\n" +
        "Depois rode:\n" +
        "  CNCT_PDF_PATH=.cache/cnct_catalogo.pdf npx tsx scripts/ingest-cnct.ts",
      );
    }
    throw new Error(`Resposta inesperada (HTML) ao baixar CNCT: ${html.slice(0, 200)}`);
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
