import "server-only";

import { NextResponse } from "next/server";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { ResponseSchema } from "@google/generative-ai";
import mammoth from "mammoth";
import pdf from "pdf-parse";

import { getAdminDb } from "../../../../../lib/firebase/admin";
import { downloadFile, uploadFile } from "../../../../../lib/storage/blob";
import {
  injectPlaceholders,
  reportInjections,
  scanDocxStructure,
  scanPlaceholders,
} from "../../../../../lib/utils/docx-filler";
import type { StructuralPair } from "../../../../../lib/utils/docx-filler";
import type { TemplateFieldSchema, TemplateRecord } from "../../../../../lib/types/firestore";

function keyToField(key: string): TemplateFieldSchema {
  const label = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  let role: TemplateFieldSchema["role"] = "manual";
  let group: TemplateFieldSchema["group"] = "dados_turma";
  if (/habilidade|competencia|objetivo|avaliacao|conteudo|tematica|metodologia|atividade|pratica/.test(key)) {
    role = "ia_sugerida";
    if (/habilidade|bncc|saeb/.test(key)) group = "habilidades";
    else if (/competencia/.test(key)) group = "competencias";
    else if (/objetivo/.test(key)) group = "objetivos";
    else if (/avaliacao/.test(key)) group = "avaliacao";
    else group = "conteudos";
  }
  return { key, label, type: "text", required: true, role, group, placeholder: "", helperText: "", aiInstructions: "" };
}

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
      const isQuota = status === 429 && (msg.includes("free_tier") || msg.includes("limit: 0") || msg.includes("PerDay"));
      const isRetryable = !isQuota && (status === 503 || status === 429 || msg.includes("503") || msg.includes("high demand"));
      if (!isRetryable || attempt === MAX_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
    }
  }
  throw lastError;
}

function isQuotaError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  const msg = (err as Error)?.message ?? "";
  return status === 429 && (msg.includes("free_tier") || msg.includes("limit: 0") || msg.includes("PerDay"));
}

// ── Extração de conteúdo ────────────────────────────────────────────────────

async function extractDocxHtml(buffer: Buffer): Promise<string> {
  const result = await mammoth.convertToHtml(
    { buffer },
    { convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: "" })) },
  );
  return result.value.replace(/<img[^>]*>/gi, "");
}

interface ExtractedContent {
  content: string;
  isHtml: boolean;
}

async function extractContent(buffer: Buffer, url: string): Promise<ExtractedContent> {
  const lower = url.toLowerCase().split("?")[0];
  if (lower.endsWith(".docx") || lower.endsWith(".doc")) {
    const html = await extractDocxHtml(buffer);
    return { content: html, isHtml: true };
  }
  const data = await pdf(buffer);
  return { content: data.text, isHtml: false };
}

// ── Response schema ─────────────────────────────────────────────────────────

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

// ── System instruction ──────────────────────────────────────────────────────

const SYSTEM_INSTRUCTION = `<persona>
Você é um analista de currículo escolar sênior especializado em documentos pedagógicos brasileiros (MEC/BNCC). Você recebe o HTML semântico gerado pelo Mammoth a partir de um arquivo Word (.docx). O HTML preserva toda a topologia do documento: tabelas (<table>/<tr>/<td>), parágrafos (<p>) e listas. Sua tarefa é mapear cada campo preenchível de forma geometricamente precisa.
</persona>
<regras>
1. REGRA CRÍTICA — LABEL EXATO: O 'label' DEVE ser copiado EXATAMENTE como aparece no texto da célula rótulo — sem tradução, normalização, abreviação ou substituição. Exemplos: a célula diz "PROFESSOR (A):" → label "PROFESSOR (A)" | a célula diz "Área/Componente:" → label "Área/Componente".
2. REGRA DE TOPOLOGIA — COMO IDENTIFICAR UM CAMPO:
   • Em tabelas: o rótulo está na <td> ANTERIOR (mesma <tr>) ou na <th>/<td> do cabeçalho da coluna. A célula à direita (ou abaixo) vazia ou com valor de exemplo é o campo.
   • Em parágrafos: o padrão é "Rótulo: valor" — o rótulo é o texto antes do ":" e o valor é o campo.
   • Se a célula contiver texto não-vazio (valor preenchido), capture-o como 'defaultValue'.
3. REGRA DE CLASSIFICAÇÃO:
   • Identificação (professor, turma, escola, componente, data, carga horária) → role "manual", group "dados_turma".
   • Pedagógicos (objetivos, competências, habilidades, BNCC, SAEB, conteúdos, avaliação, metodologia) → role "ia_sugerida".
4. Grupos válidos: dados_turma | objetivos | competencias | habilidades | conteudos | avaliacao | outros.
5. O 'key' é o label em snake_case sem acentos (ex: "professor_a", "area_componente", "n_aulas_semanais").
6. type "textarea" para campos pedagógicos longos (objetivos, habilidades, conteúdos, avaliação); "text" para campos curtos (nome, turma, data).
7. NÃO inclua células que são apenas títulos de seção ou decoração visual sem campo associado.
</regras>
<estrutura_pre_processada>
Quando a mensagem contém <estrutura_detectada>, essa seção lista os pares rótulo→valor já extraídos automaticamente via análise XML do documento — use-a como FONTE PRIMÁRIA para labels e posições. Os padrões indicam onde o valor aparece:
• "adjacent_right"  → célula imediatamente à direita do rótulo (mesma linha)
• "adjacent_below"  → primeira célula da linha seguinte
• "column_header"   → cabeçalho de coluna; valores ficam nas células abaixo
• "inline_colon"    → valor após ":" na mesma célula ("Professor: João")
O campo 'valuePreview' mostra o conteúdo atual da célula de valor (vazio em templates em branco).
CRÍTICO: copie o 'label' de <estrutura_detectada> VERBATIM — não normalize, não traduza.
Quando a mensagem contém <campos_confirmados>, esses campos foram confirmados pelo professor em uma extração anterior. MANTENHA seus 'key' e 'label' intactos; apenas adicione campos novos não listados.
</estrutura_pre_processada>
<raciocinio_obrigatorio>
Antes de extrair, raciocine em "raciocinio":
1. Quantas tabelas existem, quantas colunas por tabela.
2. Para cada rótulo em <estrutura_detectada>: confirme o padrão e classifique (manual/ia_sugerida, grupo).
3. Verifique campos que não aparecem em <estrutura_detectada> mas estão no HTML.
4. Confirme que cada label será copiado EXATAMENTE de <estrutura_detectada> ou do HTML.
</raciocinio_obrigatorio>
<contrato_de_saida>
Responda com JSON: { "raciocinio": string, "campos": [...TemplateFieldSchema] }
</contrato_de_saida>`;

// ── Prompt builder ──────────────────────────────────────────────────────────

const fewShotExample = {
  regra: "NUNCA invente labels. Se o HTML tem <td><strong>PROFESSOR (A):</strong></td><td>Luiz Carlos</td>, o label é 'PROFESSOR (A)' e o defaultValue é 'Luiz Carlos'.",
  html_input_example: "<table><tbody><tr><td><strong>PROFESSOR (A):</strong></td><td>Luiz Carlos Covre</td><td><strong>CURSO</strong></td><td>DSI</td></tr><tr><td><strong>Área(s) do Conhecimento:</strong></td><td>Práticas em DSI</td><td><strong>Nº aulas semanais:</strong></td><td>2</td></tr><tr><td colspan=\"4\"><strong>HABILIDADES</strong></td></tr><tr><td colspan=\"4\"></td></tr></tbody></table>",
  estrutura_detectada_example: [
    { label: "PROFESSOR (A)", valuePreview: "Luiz Carlos Covre", pattern: "adjacent_right" },
    { label: "CURSO",         valuePreview: "DSI",               pattern: "adjacent_right" },
    { label: "Área(s) do Conhecimento", valuePreview: "Práticas em DSI", pattern: "adjacent_right" },
    { label: "Nº aulas semanais",       valuePreview: "2",              pattern: "adjacent_right" },
    { label: "HABILIDADES",             valuePreview: "",               pattern: "column_header" },
  ],
  campos: [
    { key: "professor_a",         label: "PROFESSOR (A)",          type: "text",     required: true, role: "manual",      group: "dados_turma",  defaultValue: "Luiz Carlos Covre" },
    { key: "curso",               label: "CURSO",                  type: "text",     required: true, role: "manual",      group: "dados_turma",  defaultValue: "DSI" },
    { key: "areas_do_conhecimento", label: "Área(s) do Conhecimento", type: "text",  required: true, role: "manual",      group: "dados_turma",  defaultValue: "Práticas em DSI" },
    { key: "n_aulas_semanais",    label: "Nº aulas semanais",      type: "text",     required: true, role: "manual",      group: "dados_turma",  defaultValue: "2" },
    { key: "habilidades",         label: "HABILIDADES",            type: "textarea", required: true, role: "ia_sugerida", group: "habilidades" },
  ],
};

function buildPrompt(
  { content, isHtml }: ExtractedContent,
  structuralPairs: StructuralPair[],
  confirmedFields?: TemplateFieldSchema[],
): string {
  const docTag = isHtml ? "documento_html" : "documento";
  const instrucao = isHtml
    ? `Analise o HTML em <documento_html> e os pares rótulo→valor em <estrutura_detectada>. USE <estrutura_detectada> como FONTE PRIMÁRIA: cada item é um campo a extrair. O HTML serve como contexto complementar para classificação (manual vs ia_sugerida). CRÍTICO: copie o 'label' EXATAMENTE como aparece em <estrutura_detectada>. O 'key' é o label em snake_case sem acentos. Se 'valuePreview' não estiver vazio, inclua como 'defaultValue'.`
    : `Analise o texto em <documento> e os pares em <estrutura_detectada>. CRÍTICO: o 'label' deve ser copiado EXATAMENTE. O 'key' é o label em snake_case sem acentos. Se o campo estiver preenchido, inclua o conteúdo como 'defaultValue'.`;

  const parts: string[] = [
    `<instrucao>${instrucao}</instrucao>`,
    `<exemplo>${JSON.stringify(fewShotExample)}</exemplo>`,
  ];

  // Feature 1: structural pre-scan — give the AI the pre-detected pairs
  if (structuralPairs.length > 0) {
    parts.push(
      `<estrutura_detectada>`,
      JSON.stringify(structuralPairs, null, 2),
      `</estrutura_detectada>`,
    );
  }

  // Feature 3: dynamic few-shot — confirmed fields from a previous extraction
  if (confirmedFields && confirmedFields.length > 0) {
    const slim = confirmedFields.map(({ key, label, role, group }) => ({ key, label, role, group }));
    parts.push(
      `<campos_confirmados>`,
      `Campos já confirmados pelo professor neste template — mantenha key/label intactos:`,
      JSON.stringify(slim, null, 2),
      `</campos_confirmados>`,
    );
  }

  parts.push(`<${docTag}>`, content, `</${docTag}>`);
  return parts.join("\n");
}

// ── AI generation ───────────────────────────────────────────────────────────

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
  if (!res.ok) throw new Error(`Groq error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0].message.content;
}

async function generateSchema(promptStr: string): Promise<string> {
  try {
    return await generateWithGemini(promptStr);
  } catch (err) {
    if (isQuotaError(err)) {
      console.warn("[re-introspect] Gemini quota esgotada, usando Groq...");
      return generateWithGroq(promptStr);
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

// ── Route handler ───────────────────────────────────────────────────────────

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const db = getAdminDb();
    const snap = await db.collection("magis_templates").doc(id).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
    }

    const tData = snap.data() as Omit<TemplateRecord, "id"> & { estrutura_docx?: StructuralPair[] };
    const arquivoUrl = typeof tData.arquivo_url === "string" ? tData.arquivo_url : "";
    if (!arquivoUrl) {
      return NextResponse.json({ error: "Template não possui arquivo armazenado." }, { status: 400 });
    }

    const fileBuffer = await downloadFile(arquivoUrl);

    const lower = arquivoUrl.toLowerCase().split("?")[0];
    const isDocx = lower.endsWith(".docx") || lower.endsWith(".doc");

    // ── Feature 1: structural pre-scan ──────────────────────────────────────
    // Parse the DOCX XML directly to extract label→value pairs BEFORE calling
    // the AI. The AI receives this as structured context (not just raw HTML),
    // dramatically reducing positional errors.
    const structuralPairs = isDocx ? scanDocxStructure(fileBuffer) : [];
    console.info(`[re-introspect] Estrutura detectada: ${structuralPairs.length} pares`);

    // ── Feature 3: dynamic few-shot ─────────────────────────────────────────
    // If the professor has confirmed a schema before, use it as a few-shot
    // reference so the AI keeps confirmed keys/labels stable.
    const confirmedFields: TemplateFieldSchema[] | undefined =
      Array.isArray(tData.schema_campos) && tData.schema_campos.length > 0
        ? tData.schema_campos
        : undefined;

    // ── AI extraction ────────────────────────────────────────────────────────
    const extracted = await extractContent(fileBuffer, arquivoUrl);
    const prompt = buildPrompt(extracted, structuralPairs, confirmedFields);
    const raw = await generateSchema(prompt);

    let schema: unknown;
    try {
      schema = parseSchema(raw);
    } catch {
      return NextResponse.json({ error: "Resposta inválida do modelo ao gerar schema." }, { status: 502 });
    }

    if (!Array.isArray(schema)) {
      return NextResponse.json({ error: "Schema deve ser um array de campos." }, { status: 502 });
    }

    // Merge: pre-annotated {{key}} patterns in the DOCX take priority over AI inference
    const scannedKeys = isDocx ? scanPlaceholders(fileBuffer) : [];
    if (scannedKeys.length > 0) {
      const aiKeys = new Set((schema as TemplateFieldSchema[]).map((f) => f.key));
      const fromScan = scannedKeys.filter((k) => !aiKeys.has(k)).map(keyToField);
      (schema as TemplateFieldSchema[]).push(...fromScan);
    }

    // ── Inject placeholders into DOCX ────────────────────────────────────────
    let fillableUrl: string | null = null;
    let injectionReport: ReturnType<typeof reportInjections> | null = null;

    if (isDocx) {
      try {
        const fillableBuffer = injectPlaceholders(fileBuffer, schema as TemplateFieldSchema[]);

        // Feature 2: post-injection validation
        injectionReport = reportInjections(fillableBuffer, schema as TemplateFieldSchema[]);
        if (injectionReport.missing.length > 0) {
          console.info(
            `[re-introspect] Campos sem placeholder automático: ${injectionReport.missing.join(", ")}`,
          );
        }

        const fillablePath = `templates/${id}/fillable.docx`;
        fillableUrl = await uploadFile({
          path: fillablePath,
          buffer: fillableBuffer,
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });

        await db.collection("magis_templates").doc(id).update({
          schema_campos: schema,
          arquivo_fillable_url: fillableUrl,
          fillable_status: "pronto",
          // Store structural pairs for use in future re-extractions (feature 3)
          estrutura_docx: structuralPairs,
        });
      } catch (e) {
        console.warn("[re-introspect] Falha ao regenerar DOCX preenchível:", e);
        await db.collection("magis_templates").doc(id).update({
          schema_campos: schema,
          estrutura_docx: structuralPairs,
        });
      }
    } else {
      await db.collection("magis_templates").doc(id).update({ schema_campos: schema });
    }

    return NextResponse.json({
      ok: true,
      schema,
      totalCampos: (schema as unknown[]).length,
      arquivo_fillable_url: fillableUrl,
      // Feature 2: surface which fields need manual placement to the UI
      campos_sem_placeholder: injectionReport?.missing ?? [],
    });
  } catch (error) {
    console.error("[re-introspect] Erro:", error);
    const msg = (error as Error)?.message ?? "";
    return NextResponse.json(
      { error: `Falha ao re-extrair campos do template. ${msg}` },
      { status: 500 },
    );
  }
}
