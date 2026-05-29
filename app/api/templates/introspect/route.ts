import "server-only";

import { NextResponse } from "next/server";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { ResponseSchema } from "@google/generative-ai";
import pdf from "pdf-parse";
import PizZip from "pizzip";

import { getAdminDb } from "../../../../lib/firebase/admin";

const MODEL_NAME = process.env.GOOGLE_GEMINI_MODEL ?? "gemini-2.0-flash";
const GROQ_MODEL = "llama-3.3-70b-versatile";

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
      const isQuotaExhausted = status === 429 && (msg.includes("free_tier") || msg.includes("limit: 0") || msg.includes("PerDay"));
      const isRetryable = !isQuotaExhausted && (status === 503 || status === 429 || msg.includes("503") || msg.includes("high demand"));
      if (!isRetryable || attempt === MAX_RETRIES) throw err;
      const delay = RETRY_DELAY_MS * attempt;
      console.log(`[PlanoMagistra] Retry ${attempt}/${MAX_RETRIES} em ${delay}ms (modelo sob demanda)...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

function isQuotaError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  const msg = (err as Error)?.message ?? "";
  return status === 429 && (msg.includes("free_tier") || msg.includes("limit: 0") || msg.includes("PerDay"));
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

async function extractFileText(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();
  if (name.endsWith(".docx") || name.endsWith(".doc")) {
    return extractDocxText(buffer);
  }
  const data = await pdf(buffer);
  return data.text;
}

// ── Response schema — restringe role, group e type aos valores válidos ─────
const INTROSPECT_RESPONSE_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  required: ["raciocinio", "campos"],
  properties: {
    raciocinio: { type: SchemaType.STRING },
    campos: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        required: ["key", "label", "type", "required", "role", "group"],
        properties: {
          key:          { type: SchemaType.STRING },
          label:        { type: SchemaType.STRING },
          type:         { type: SchemaType.STRING, format: "enum", enum: ["text", "textarea"] },
          required:     { type: SchemaType.BOOLEAN },
          role:         { type: SchemaType.STRING, format: "enum", enum: ["manual", "ia_sugerida"] },
          group:        { type: SchemaType.STRING, format: "enum", enum: ["dados_turma", "objetivos", "competencias", "habilidades", "conteudos", "avaliacao", "outros"] },
          defaultValue: { type: SchemaType.STRING, nullable: true },
        },
      },
    },
  },
};

const SYSTEM_INSTRUCTION = `<persona>
Você é um analista de currículo escolar sênior, especializado em estruturar documentos pedagógicos brasileiros segundo as normas do MEC e a BNCC. Tem expertise em identificar a arquitetura de planos de aula — distinguindo campos de identificação de campos pedagógicos — e em extrair sua estrutura com precisão absoluta, sem inferências ou normalizações.
</persona>
<regras>
1. REGRA CRÍTICA: O campo 'label' DEVE ser copiado EXATAMENTE como aparece no documento — sem tradução, normalização, abreviação ou substituição.
   Exemplos: 'Área/Componente:' → label 'Área/Componente' | 'HABILIDADES:' → label 'Habilidades' | 'Professor(a):' → label 'Professor(a)'.
   NUNCA invente labels.
2. Campos de identificação (professor, curso/área, turma, componente etc.) → role 'manual', group 'dados_turma'.
3. Campos pedagógicos (objetivos, competências, habilidades, BNCC, SAEB, conteúdos, avaliação) → role 'ia_sugerida'.
4. Grupos válidos: dados_turma | objetivos | competencias | habilidades | conteudos | avaliacao | outros.
5. O 'key' é o label em snake_case sem acentos (ex: 'area_componente', 'numero_de_aulas').
</regras>
<raciocinio_obrigatorio>
Antes de extrair os campos, raciocine em "raciocinio" seguindo estes passos:
1. Faça uma leitura geral do documento para mapear sua estrutura (seções, rótulos, campos preenchíveis).
2. Classifique cada campo: é de identificação (professor, turma, escola, data) ou pedagógico (objetivos, habilidades, conteúdos, avaliação)?
3. Para cada campo pedagógico, determine o group correto: objetivos | competencias | habilidades | conteudos | avaliacao | outros.
4. Confirme que cada label será copiado EXATAMENTE como aparece no documento, sem normalização.
</raciocinio_obrigatorio>
<contrato_de_saida>
Responda com JSON: { "raciocinio": string, "campos": [...TemplateFieldSchema] }
</contrato_de_saida>`;

async function generateWithGemini(promptStr: string): Promise<string> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GEMINI_API_KEY não configurada.");
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: {
      temperature: 0.1,
      topP: 0.6,
      topK: 40,
      responseMimeType: "application/json",
      responseSchema: INTROSPECT_RESPONSE_SCHEMA,
    },
    systemInstruction: SYSTEM_INSTRUCTION,
  });
  const result = await withRetry(() => model.generateContent(promptStr));
  return result.response.text();
}

async function generateWithGroq(promptStr: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY não configurada.");
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_INSTRUCTION },
        { role: "user", content: promptStr },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Groq error ${res.status}: ${body}`);
  }
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0].message.content;
}

async function generateSchema(promptStr: string): Promise<string> {
  try {
    return await generateWithGemini(promptStr);
  } catch (err) {
    if (isQuotaError(err)) {
      console.warn("[PlanoMagistra] Gemini quota esgotada, usando Groq como fallback...");
      return await generateWithGroq(promptStr);
    }
    throw err;
  }
}

function parseSchema(raw: string): unknown {
  let schema: unknown;
  try {
    schema = JSON.parse(raw);
  } catch {
    const firstBracket = raw.indexOf("[");
    const lastBracket = raw.lastIndexOf("]");
    if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) {
      throw new Error("invalid_schema");
    }
    schema = JSON.parse(raw.slice(firstBracket, lastBracket + 1));
  }
  if (typeof schema === "object" && schema !== null && !Array.isArray(schema) && "campos" in schema) {
    schema = (schema as { campos: unknown }).campos;
  }
  return schema;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const templateId = (formData.get("templateId") as string | null) ?? null;
    const file = formData.get("file") as File | null;

    console.log("[PlanoMagistra] 2. Extraindo campos do template...", {
      templateId,
      arquivo: (file as File & { name?: string })?.name,
      modelo: MODEL_NAME,
    });

    if (!templateId || !file) {
      return NextResponse.json({ error: "templateId e arquivo PDF são obrigatórios." }, { status: 400 });
    }

    const pdfText = await extractFileText(file);

    // Few-shot: labels MUST be copied verbatim from the document text.
    // This example shows how the CEDUP template would be extracted.
    const fewShotExample = {
      descricao:
        "Extração de um plano de 30 dias (CEDUP/SC). " +
        "Observe: os labels são cópias EXATAS dos rótulos do documento.",
      regra:
        "NUNCA invente ou normalize labels. " +
        "Se o documento diz 'Área/Componente:' o label é 'Área/Componente', NÃO 'Curso' nem 'Componente curricular'.",
      campos: [
        { key: "professor", label: "Professor(a)", type: "text", required: true, role: "manual", group: "dados_turma", defaultValue: "Luiz Carlos Covre" },
        { key: "area_componente", label: "Área/Componente", type: "text", required: true, role: "manual", group: "dados_turma", defaultValue: "5421 - PRÁTICAS EM D.S.I - HTML, CSS, PHP" },
        { key: "turma", label: "Turma", type: "text", required: true, role: "manual", group: "dados_turma", defaultValue: "2º EMIEP" },
        { key: "tematica_abordada", label: "Temática abordada", type: "textarea", required: true, role: "ia_sugerida", group: "conteudos" },
        { key: "conceitos_estruturantes", label: "Conceitos estruturantes e objetos do conhecimento", type: "textarea", required: true, role: "ia_sugerida", group: "conteudos" },
        { key: "habilidades", label: "Habilidades", type: "textarea", required: true, role: "ia_sugerida", group: "habilidades" },
        { key: "objetivos_de_aprendizagem", label: "Objetivos de aprendizagem", type: "textarea", required: true, role: "ia_sugerida", group: "objetivos" },
        { key: "atividade_metodologia", label: "Atividade proposta/ Metodologia", type: "textarea", required: true, role: "ia_sugerida", group: "conteudos" },
        { key: "avaliacao", label: "Avaliação", type: "textarea", required: true, role: "ia_sugerida", group: "avaliacao" },
      ],
    };

    const promptStr = [
      `<instrucao>`,
      `Analise o texto em <documento> e extraia TODOS os campos visíveis. CRÍTICO: o 'label' deve ser copiado EXATAMENTE como aparece (título da seção, rótulo da linha, cabeçalho). Não normalize, não traduza, não abrevia. O 'key' é o label em snake_case sem acentos. Se o documento estiver preenchido, inclua o conteúdo como 'defaultValue'. Retorne SOMENTE o array JSON.`,
      `</instrucao>`,
      `<exemplo>`,
      JSON.stringify(fewShotExample),
      `</exemplo>`,
      `<documento>`,
      pdfText,
      `</documento>`,
    ].join("\n");

    const raw = await generateSchema(promptStr);

    let schema: unknown;
    try {
      schema = parseSchema(raw);
    } catch {
      return NextResponse.json({ error: "Resposta inválida do modelo ao gerar schema." }, { status: 502 });
    }

    if (!Array.isArray(schema)) {
      return NextResponse.json({ error: "Schema deve ser um array de campos." }, { status: 502 });
    }

    const db = getAdminDb();
    await db.collection("magis_templates").doc(templateId).update({ schema_campos: schema });

    console.log("[PlanoMagistra] 2. Campos extraídos com sucesso", { templateId, totalCampos: (schema as unknown[]).length });

    void (async () => {
      try {
        const { downloadFile, uploadFile } = await import("../../../../lib/storage/blob");
        const { injectPlaceholders } = await import("../../../../lib/utils/docx-filler");
        const templateSnap = await db.collection("magis_templates").doc(templateId).get();
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
        await db.collection("magis_templates").doc(templateId).update({ arquivo_fillable_url: fillableUrl });
      } catch (e) {
        console.warn("[PlanoMagistra/introspect] Falha ao regenerar DOCX preenchível:", e);
      }
    })();

    return NextResponse.json({ ok: true, schema });
  } catch (error) {
    console.error("Erro na rota /api/templates/introspect:", error);
    const msg = (error as Error)?.message ?? "";
    const status = (error as { status?: number })?.status;
    if (status === 429 || msg.includes("429") || msg.includes("free_tier") || msg.includes("GROQ_API_KEY")) {
      return NextResponse.json({ error: "Cota da IA esgotada. Tente novamente mais tarde." }, { status: 429 });
    }
    return NextResponse.json({ error: "Falha ao gerar schema do template." }, { status: 500 });
  }
}
