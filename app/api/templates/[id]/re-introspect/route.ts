import "server-only";

import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import pdf from "pdf-parse";
import PizZip from "pizzip";

import { getAdminDb, getAdminStorageBucket } from "../../../../../lib/firebase/admin";
import { injectPlaceholders } from "../../../../../lib/utils/docx-filler";
import type { TemplateFieldSchema, TemplateRecord } from "../../../../../lib/types/firestore";

const MODEL_NAME = process.env.GOOGLE_GEMINI_MODEL ?? "gemini-2.0-flash";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number })?.status;
      const msg = (err as Error)?.message ?? "";
      const isRetryable = status === 503 || status === 429 || msg.includes("503") || msg.includes("high demand");
      if (!isRetryable || attempt === MAX_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
    }
  }
  throw lastError;
}

function extractDocxText(buffer: Buffer): string {
  const zip = new PizZip(buffer);
  const xmlFile = zip.files["word/document.xml"];
  if (!xmlFile) return "";
  const xml = xmlFile.asText();
  return xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

function extractText(buffer: Buffer, filePath: string): Promise<string> | string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".docx") || lower.endsWith(".doc")) {
    return extractDocxText(buffer);
  }
  return pdf(buffer).then((d) => d.text);
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const db = getAdminDb();
    const snap = await db.collection("templates").doc(id).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
    }

    const tData = snap.data() as Omit<TemplateRecord, "id"> & { arquivo_url?: string };
    const arquivoUrl = tData.arquivo_url ?? "";
    if (!arquivoUrl) {
      return NextResponse.json({ error: "Template não possui arquivo armazenado." }, { status: 400 });
    }

    const bucket = getAdminStorageBucket();
    const [rawBuffer] = await bucket.file(arquivoUrl).download();
    const fileBuffer = rawBuffer as Buffer;

    const fileText = await extractText(fileBuffer, arquivoUrl);

    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GOOGLE_GEMINI_API_KEY não configurada." }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      generationConfig: {
        temperature: 0.1,
        topP: 0.6,
        topK: 40,
        responseMimeType: "application/json",
      },
      systemInstruction:
        "Você analisa modelos de planos pedagógicos e devolve um schema JSON de campos.\n" +
        "- Campos de identificação (professor, curso, turma, componente curricular, número de aulas etc.) " +
        "devem ter role = \"manual\".\n" +
        "- Campos pedagógicos (objetivos, competências, habilidades BNCC, SAEB, CTBC, conteúdos, avaliação) " +
        "devem ter role = \"ia_sugerida\".\n" +
        "- Agrupe campos em groups: dados_turma, objetivos, competencias, habilidades, conteudos, avaliacao, outros.\n" +
        "- Retorne SOMENTE um array JSON de objetos no formato TemplateFieldSchema, sem texto extra.",
    });

    const prompt = {
      instrucao:
        "Analise o texto do arquivo e extraia TODOS os campos que aparecem no documento. " +
        "Devolva um array JSON onde cada campo vira um objeto no schema. " +
        "Use os NOMES EXATOS do template. " +
        "Campos de identificação = role manual, group dados_turma. " +
        "Campos pedagógicos = role ia_sugerida. " +
        "Retorne SOMENTE o array JSON, sem texto extra.",
      fileText,
    };

    const result = await withRetry(() => model.generateContent(JSON.stringify(prompt)));
    const raw = result.response.text();

    let schema: unknown;
    try {
      schema = JSON.parse(raw);
    } catch {
      const firstBracket = raw.indexOf("[");
      const lastBracket = raw.lastIndexOf("]");
      if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) {
        return NextResponse.json({ error: "Resposta inválida do modelo." }, { status: 502 });
      }
      schema = JSON.parse(raw.slice(firstBracket, lastBracket + 1));
    }

    if (typeof schema === "object" && schema !== null && !Array.isArray(schema) && "campos" in schema) {
      schema = (schema as { campos: unknown }).campos;
    }
    if (!Array.isArray(schema)) {
      return NextResponse.json({ error: "Schema deve ser um array de campos." }, { status: 502 });
    }

    await db.collection("templates").doc(id).update({ schema_campos: schema });

    // Regenerate fillable DOCX if applicable
    const isDocx = arquivoUrl.endsWith(".docx") || arquivoUrl.endsWith(".doc");
    if (isDocx) {
      void (async () => {
        try {
          const fillableBuffer = injectPlaceholders(
            fileBuffer,
            schema as TemplateFieldSchema[],
          );
          const fillablePath = arquivoUrl.replace(/\.(docx|doc)$/, ".fillable.$1");
          await bucket.file(fillablePath).save(fillableBuffer, {
            metadata: { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
          });
          await db.collection("templates").doc(id).update({ arquivo_fillable_url: fillablePath });
        } catch (e) {
          console.warn("[PlanoMestre/re-introspect] Falha ao regenerar DOCX preenchível:", e);
        }
      })();
    }

    return NextResponse.json({ ok: true, schema, totalCampos: (schema as unknown[]).length });
  } catch (error) {
    console.error("[PlanoMestre/re-introspect] Erro:", error);
    return NextResponse.json({ error: "Falha ao re-extrair campos do template." }, { status: 500 });
  }
}
