import "server-only";

import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import pdf from "pdf-parse";
import PizZip from "pizzip";

import { getAdminDb } from "../../../../lib/firebase/admin";

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
      const delay = RETRY_DELAY_MS * attempt;
      console.log(`[PlanoMestre] Retry ${attempt}/${MAX_RETRIES} em ${delay}ms (modelo sob demanda)...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

function extractDocxText(buffer: Buffer): string {
  const zip = new PizZip(buffer);
  const xmlFile = zip.files["word/document.xml"];
  if (!xmlFile) return "";
  const xml = xmlFile.asText();
  // Strip all XML tags, collapse whitespace, preserve paragraph breaks
  return xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

async function extractFileText(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();
  if (name.endsWith(".docx") || name.endsWith(".doc")) {
    return extractDocxText(buffer);
  }
  const data = await pdf(buffer);
  return data.text;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const templateId = (formData.get("templateId") as string | null) ?? null;
    const file = formData.get("file") as File | null;

    console.log("[PlanoMestre] 2. Extraindo campos do template...", { templateId, arquivo: (file as File & { name?: string })?.name, modelo: MODEL_NAME });

    if (!templateId || !file) {
      return NextResponse.json({ error: "templateId e arquivo PDF são obrigatórios." }, { status: 400 });
    }

    const pdfText = await extractFileText(file);

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
        "Você analisa modelos de planos pedagógicos em PDF e devolve um schema JSON de campos.\n" +
        "- Campos de identificação (professor, curso, turma, componente curricular, número de aulas etc.) " +
        "devem ter role = \"manual\" (professor preenche).\n" +
        "- Campos pedagógicos (objetivos, competências, habilidades BNCC, SAEB, CTBC, conteúdos, avaliação) " +
        "devem ter role = \"ia_sugerida\".\n" +
        "- Agrupe campos em groups: dados_turma, objetivos, competencias, habilidades, conteudos, avaliacao, outros.\n" +
        "- Retorne SOMENTE um array JSON de objetos no formato TemplateFieldSchema, sem texto extra.",
    });

    const fewShotExample = {
      descricao: "Exemplo de schema para um planejamento anual EMIEP.",
      campos: [
        {
          key: "professor",
          label: "Professor(a)",
          type: "text",
          required: true,
          role: "manual",
          group: "dados_turma",
        },
        {
          key: "curso",
          label: "Curso",
          type: "text",
          required: true,
          role: "manual",
          group: "dados_turma",
        },
        {
          key: "numero_aulas",
          label: "Número de aulas",
          type: "number",
          required: true,
          role: "manual",
          group: "dados_turma",
        },
        {
          key: "turma",
          label: "Turma",
          type: "text",
          required: true,
          role: "manual",
          group: "dados_turma",
        },
        {
          key: "componente_curricular",
          label: "Componente curricular",
          type: "text",
          required: true,
          role: "manual",
          group: "dados_turma",
        },
        {
          key: "objetivos_gerais",
          label: "Objetivos gerais",
          type: "textarea",
          required: true,
          role: "ia_sugerida",
          group: "objetivos",
        },
        {
          key: "competencias",
          label: "Competências",
          type: "textarea",
          required: true,
          role: "ia_sugerida",
          group: "competencias",
        },
        {
          key: "habilidades",
          label: "Habilidades (BNCC)",
          type: "textarea",
          required: true,
          role: "ia_sugerida",
          group: "habilidades",
        },
        {
          key: "referencias_saeb",
          label: "Referências SAEB",
          type: "textarea",
          required: false,
          role: "ia_sugerida",
          group: "avaliacao",
        },
        {
          key: "conteudos_unidade_1",
          label: "Conteúdos – Unidade 1",
          type: "textarea",
          required: true,
          role: "ia_sugerida",
          group: "conteudos",
        },
      ],
    };

    const prompt = {
      instrucao:
        "Analise o texto do PDF e extraia TODOS os campos que aparecem no documento. " +
        "Devolva um array JSON onde cada campo do PDF vira um objeto no schema. " +
        "IMPORTANTE: Use os NOMES EXATOS e ESTRUTURA do template (títulos, seções, linhas em branco para preencher). " +
        "Campos de identificação (professor, curso, turma, componente, ano, número de aulas) = role manual, group dados_turma. " +
        "Campos pedagógicos (objetivos, competências, habilidades, BNCC, SAEB, conteúdos, avaliação) = role ia_sugerida. " +
        "Retorne SOMENTE o array JSON, sem texto extra.",
      fewShotExample,
      pdfText,
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
        return NextResponse.json({ error: "Resposta inválida do modelo ao gerar schema." }, { status: 502 });
      }
      schema = JSON.parse(raw.slice(firstBracket, lastBracket + 1));
    }

    if (typeof schema === "object" && schema !== null && !Array.isArray(schema) && "campos" in schema) {
      schema = (schema as { campos: unknown }).campos;
    }
    if (!Array.isArray(schema)) {
      return NextResponse.json({ error: "Schema deve ser um array de campos." }, { status: 502 });
    }

    const db = getAdminDb();
    await db.collection("templates").doc(templateId).update({
      schema_campos: schema,
    });

    console.log("[PlanoMestre] 2. Campos extraídos com sucesso", { templateId, totalCampos: (schema as unknown[]).length });

    // Async: regenerate the fillable DOCX now that schema is known
    void (async () => {
      try {
        const { downloadFile, uploadFile } = await import("../../../../lib/storage/blob");
        const { injectPlaceholders } = await import("../../../../lib/utils/docx-filler");
        const templateSnap = await db.collection("templates").doc(templateId).get();
        const tData = templateSnap.data();
        const originalUrl = typeof tData?.arquivo_url === "string" ? tData.arquivo_url : null;
        if (!originalUrl) return;
        const isDocx = /\.(docx|doc)(\?|$)/i.test(originalUrl);
        if (!isDocx) return;

        const rawBuffer = await downloadFile(originalUrl);
        const fillableBuffer = injectPlaceholders(
          rawBuffer,
          schema as import("../../../../lib/types/firestore").TemplateFieldSchema[],
        );
        const fillablePath = `templates/${templateId}/fillable.docx`;
        const fillableUrl = await uploadFile({
          path: fillablePath,
          buffer: fillableBuffer,
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
        await db.collection("templates").doc(templateId).update({ arquivo_fillable_url: fillableUrl });
      } catch (e) {
        console.warn("[PlanoMestre/introspect] Falha ao regenerar DOCX preenchível:", e);
      }
    })();

    return NextResponse.json({ ok: true, schema });
  } catch (error) {
    console.error("Erro na rota /api/templates/introspect:", error);
    return NextResponse.json({ error: "Falha ao gerar schema do template." }, { status: 500 });
  }
}

