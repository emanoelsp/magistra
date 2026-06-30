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
import { execSync } from "child_process";
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

// URLs oficiais INEP — Matrizes de Referência SAEB (corretas, verificadas)
const SAEB_URLS = [
  "https://download.inep.gov.br/educacao_basica/saeb/matriz-de-referencia-de-lingua-portuguesa_2001.pdf",
  "https://download.inep.gov.br/educacao_basica/saeb/matriz-de-referencia-de-matematica_2001.pdf",
  "https://download.inep.gov.br/educacao_basica/saeb/matriz-de-referencia-de-linguagens_BNCC.pdf",
  "https://download.inep.gov.br/educacao_basica/saeb/matriz-de-referencia-de-matematica_BNCC.pdf",
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

// Descritores SAEB clássicos: D01, D02, ... D99
const DESCRITOR_REGEX = /\bD(\d{1,2})\b/g;

// Tópicos do SAEB (Roman numerals or numbered sections)
const TOPICO_REGEX = /^(T[eê]pico\s*[IVX\d]+[:.]?|[IVX]+[.:]?\s+\w)/i;

// Códigos Matemática BNCC 2022: 2N1.1, 5A2.3, 9G1.4, etc.
// {ano}{eixo}{cognitivo}.{num} — ano: 2|5|9; eixo: N|A|G|P|M; cognitivo: 1|2
const MAT_BNCC_CODE_RE = /\b(\d[NAGPM]\d+\.\d+)\b/g;

function sourceKey(source: string): string {
  const base = source.split("/").pop()?.replace(".pdf", "").toLowerCase() ?? "saeb";
  const comp = /portugu|linguagem|lingu/.test(base) ? "lp"
    : /matem/.test(base) ? "mat"
    : /cienc/.test(base) ? "cien"
    : "gen";
  const ver = /bncc/.test(base) ? "bncc" : /(\d{4})/.exec(base)?.[1] ?? "";
  return ver ? `${comp}_${ver}` : comp;
}

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

// ── Parser 1: matrizes clássicas 2001 (D01–D30) ──────────────────────────────

function extractChunks(text: string, source: string): SaebChunk[] {
  const chunks: SaebChunk[] = [];
  const seen = new Set<string>();
  const prefix = sourceKey(source);

  DESCRITOR_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = DESCRITOR_REGEX.exec(text)) !== null) {
    const num = match[1].padStart(2, "0");
    const codigo = `D${num}`;
    const uid = `${prefix}_${codigo}`;
    if (seen.has(uid)) continue;
    seen.add(uid);

    const before = text.slice(Math.max(0, match.index - 700), match.index);
    const lines = before.split("\n").map((l) => l.trim()).filter(Boolean);

    const after = text.slice(match.index, match.index + 400);
    const afterLines = after.split("\n").map((l) => l.trim()).filter(Boolean);

    const descLines = afterLines.slice(0, 4).join(" ").replace(/\s+/g, " ").trim();
    if (descLines.length < 20) continue;

    let topico = "";
    for (const l of [...lines].reverse()) {
      if (TOPICO_REGEX.test(l)) { topico = l.slice(0, 80); break; }
    }

    const contextoFull = [...lines.slice(-5), ...afterLines.slice(0, 5)].join(" ");
    const componente = detectComponente(contextoFull);
    const etapa = detectEtapa([...lines].reverse().join(" "));

    chunks.push({
      id: `saeb_${uid}`,
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

// ── Parser 2: Matemática BNCC 2022 (2N1.1, 5A2.3, 9G1.4…) ──────────────────
// Código: {ano}{eixo}{cognitivo}.{num}
// Eixo: N=Números A=Álgebra G=Geometria P=Probabilidade/Estatística M=Medidas
// Etapa: 2→EF-AI-2, 5→EF-AI-5, 9→EF-AF

const EIXO_LABEL: Record<string, string> = {
  N: "Números", A: "Álgebra", G: "Geometria",
  P: "Probabilidade e Estatística", M: "Medidas",
};

const COGNITIVO_LABEL: Record<string, string> = {
  "1": "Compreender e aplicar conceitos e procedimentos",
  "2": "Resolver problemas e argumentar",
};

const ANO_ETAPA: Record<string, string> = {
  "2": "EF-AI-2", "5": "EF-AI-5", "9": "EF-AF",
};

function extractChunksMatBncc(text: string): SaebChunk[] {
  const chunks: SaebChunk[] = [];
  const seen = new Set<string>();

  // Collect all match positions so we can slice text between them
  MAT_BNCC_CODE_RE.lastIndex = 0;
  const positions: Array<{ codigo: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = MAT_BNCC_CODE_RE.exec(text)) !== null) {
    positions.push({ codigo: m[1], index: m.index });
  }

  for (let i = 0; i < positions.length; i++) {
    const { codigo, index } = positions[i];
    if (seen.has(codigo)) continue;
    seen.add(codigo);

    // Text from this code until the next one (or 400 chars max)
    const nextIndex = positions[i + 1]?.index ?? index + 400;
    const snippet = text.slice(index, Math.min(nextIndex, index + 400))
      .replace(/\s+/g, " ").trim();

    if (snippet.length < 15) continue;

    const anoChar = codigo[0];
    const eixoChar = codigo[1];
    const cogChar = codigo[2];

    const etapa = ANO_ETAPA[anoChar] ?? "EF";
    const eixo = EIXO_LABEL[eixoChar] ?? eixoChar;
    const cognitivo = COGNITIVO_LABEL[cogChar] ?? "";
    const topico = cognitivo ? `${eixo} — ${cognitivo}` : eixo;

    chunks.push({
      id: `saeb_mat_bncc_${codigo}`,
      codigo,
      texto: `SAEB Matemática BNCC ${anoChar}°ano — ${eixo}: ${snippet}`,
      componente: "Matemática",
      etapa,
      topico,
    });
  }

  console.log(`  → ${chunks.length} habilidades Matemática BNCC extraídas`);
  return chunks;
}

// ── Parser 3: Linguagens BNCC 2022 (sem códigos — chunking por QUADRO + item) ─
// Habilidades são itens numerados (1. 2. 3.) dentro de QUADROs por etapa.

const QUADRO_RE = /QUADRO\s+\d+[\s\S]{0,300}?((?:2|5|9)[ºo°]\s*ANO|2[ºo°]\s*ANO\s*DO\s*ENSINO)/gi;
const ITEM_RE   = /(?<!\d)(\d{1,2})\.\s+([A-ZÁÉÍÓÚ][^\n]{15,300})/g;

function etapaFromAno(ano: string): string {
  const n = ano.trim()[0];
  if (n === "2") return "EF-AI-2";
  if (n === "5") return "EF-AI-5";
  if (n === "9") return "EF-AF";
  return "EF";
}

function extractChunksLingBncc(text: string): SaebChunk[] {
  const chunks: SaebChunk[] = [];

  // Split text into QUADRO sections by finding section headings
  // Each QUADRO covers one etapa; we track current etapa from nearest heading
  const quadroRe = /QUADRO\s+\d+\s*\n[\s\S]*?(?:HABILIDADES[^\n]*\n)/gi;
  const anoRe = /([259][ºo°°]\s*(?:E\s*)?ANO|2[ºo°°]\s*ANO)/i;

  // Process the full text in order, tracking current section metadata
  const sections = text.split(/(?=QUADRO\s+\d)/i).filter((s) => s.trim().length > 30);

  let globalIdx = 0;
  for (const section of sections) {
    // Detect etapa from this section's header
    const anoMatch = anoRe.exec(section);
    const etapa = anoMatch ? etapaFromAno(anoMatch[1]) : "EF";

    // Detect eixo (knowledge area) from section
    const eixo = /arte/i.test(section) ? "Arte"
      : /educa[cç][aã]o\s*f[ií]sica/i.test(section) ? "Educação Física"
      : /an[aá]lise\s*lingu[ií]stica/i.test(section) ? "Análise Linguística/Semiótica"
      : "Leitura";

    // Extract numbered items
    ITEM_RE.lastIndex = 0;
    let itemMatch: RegExpExecArray | null;
    const items: string[] = [];

    while ((itemMatch = ITEM_RE.exec(section)) !== null) {
      const itemText = itemMatch[2].replace(/\s+/g, " ").trim();
      if (itemText.length >= 20) items.push(itemText);
    }

    // Group items into chunks of ~3 each so each vector has enough context
    for (let i = 0; i < items.length; i += 3) {
      const group = items.slice(i, i + 3);
      if (group.length === 0) continue;
      globalIdx++;
      const id = `saeb_ling_bncc_${etapa}_${eixo.replace(/\W+/g, "_").toLowerCase()}_${globalIdx}`;
      chunks.push({
        id,
        codigo: `LING-BNCC-${globalIdx}`,
        texto: `SAEB Linguagens BNCC ${etapa} — ${eixo}: ${group.join(" | ")}`,
        componente: "Língua Portuguesa",
        etapa,
        topico: eixo,
      });
    }
  }

  console.log(`  → ${chunks.length} chunks Linguagens BNCC extraídos`);
  return chunks;
}

// ── Router: escolhe o parser certo por arquivo ────────────────────────────────

function extractChunksAuto(text: string, source: string): SaebChunk[] {
  const base = source.split("/").pop()?.toLowerCase() ?? "";
  if (/matem.*bncc/i.test(base))    return extractChunksMatBncc(text);
  if (/lingu.*bncc/i.test(base))    return extractChunksLingBncc(text);
  return extractChunks(text, source); // matrizes clássicas 2001
}

// ── Embedding ────────────────────────────────────────────────────────────────

const EMBED_SUB_BATCH = 20; // items por chamada — fica dentro do limite free tier

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function embedBatch(texts: string[]): Promise<number[][]> {
  const requests = texts.map((text) => ({
    model: `models/${EMBEDDING_MODEL}`,
    content: { parts: [{ text }] },
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
      const wait = (attempt + 1) * 15_000;
      console.log(`\n  ⏳ Rate limit (${res.status}), aguardando ${wait / 1000}s...`);
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

  const allValues: number[][] = [];
  for (let s = 0; s < pending.length; s += EMBED_SUB_BATCH) {
    const sub = pending.slice(s, s + EMBED_SUB_BATCH).map((c) => c.texto);
    process.stdout.write(`  Embedando sub-lote ${Math.floor(s / EMBED_SUB_BATCH) + 1} (${sub.length} textos)...\r`);
    const vals = await embedBatch(sub);
    allValues.push(...vals);
    if (s + EMBED_SUB_BATCH < pending.length) await sleep(2000);
  }

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

// ── Download PDF (via curl — evita problema SSL do Node.js com INEP) ──────────

function downloadPdf(url: string): Buffer {
  const cacheDir = path.join(process.cwd(), ".cache");
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir);
  const filename = path.join(cacheDir, "saeb_" + path.basename(url.split("?")[0]));

  if (fs.existsSync(filename)) {
    const size = fs.statSync(filename).size;
    if (size > 10_000) {
      console.log(`  → Cache local: ${filename} (${(size / 1024).toFixed(0)} KB)`);
      return fs.readFileSync(filename);
    }
    fs.unlinkSync(filename);
  }

  console.log(`  → Baixando: ${path.basename(url)}`);
  execSync(`curl -sL -o "${filename}" "${url}"`, { stdio: "inherit" });

  const size = fs.statSync(filename).size;
  if (size < 10_000) throw new Error(`Arquivo muito pequeno após download: ${size} bytes`);
  console.log(`  → Salvo: ${filename} (${(size / 1024).toFixed(0)} KB)`);
  return fs.readFileSync(filename);
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
      : downloadPdf(source);
    const { text } = await pdf(pdfBuffer);
    const chunks = extractChunksAuto(text, source);
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
