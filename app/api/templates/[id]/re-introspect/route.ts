import "server-only";

import { NextResponse } from "next/server";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { ResponseSchema } from "@google/generative-ai";
import mammoth from "mammoth";
import pdf from "pdf-parse";

import { getAdminDb } from "../../../../../lib/firebase/admin";
import { downloadFile, uploadFile } from "../../../../../lib/storage/blob";
import { injectPlaceholders, scanPlaceholders } from "../../../../../lib/utils/docx-filler";
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
    // Skip embedded images — reduces token count significantly
    { convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: "" })) },
  );
  // Remove empty img tags left by the converter
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

// ── System instruction (shared for both Gemini and Groq) ────────────────────

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
<raciocinio_obrigatorio>
Antes de extrair, raciocine em "raciocinio":
1. Mapeie a estrutura HTML: quantas tabelas existem, quantas colunas por tabela, quais são cabeçalhos vs. dados.
2. Para cada <tr>: identifique quais <td> são rótulos (texto em negrito, geralmente à esquerda) e quais são campos (vazia ou com valor de exemplo à direita/abaixo).
3. Classifique cada campo: identificação ou pedagógico? Qual group?
4. Confirme que cada label será copiado EXATAMENTE do HTML, sem normalização.
</raciocinio_obrigatorio>
<contrato_de_saida>
Responda com JSON: { "raciocinio": string, "campos": [...TemplateFieldSchema] }
</contrato_de_saida>`;

// ── Prompt builder ──────────────────────────────────────────────────────────

const fewShotExample = {
  regra: "NUNCA invente labels. Se o HTML tem <td><strong>PROFESSOR (A):</strong></td><td>Luiz Carlos</td>, o label é 'PROFESSOR (A)' e o defaultValue é 'Luiz Carlos'.",
  html_input_example: "<table><tbody><tr><td><strong>PROFESSOR (A):</strong></td><td>Luiz Carlos Covre</td><td><strong>CURSO</strong></td><td>DSI</td></tr><tr><td><strong>Área(s) do Conhecimento:</strong></td><td>Práticas em DSI</td><td><strong>Nº aulas semanais:</strong></td><td>2</td></tr><tr><td colspan=\"4\"><strong>HABILIDADES</strong></td></tr><tr><td colspan=\"4\"></td></tr></tbody></table>",
  campos: [
    { key: "professor_a", label: "PROFESSOR (A)", type: "text", required: true, role: "manual", group: "dados_turma", defaultValue: "Luiz Carlos Covre" },
    { key: "curso", label: "CURSO", type: "text", required: true, role: "manual", group: "dados_turma", defaultValue: "DSI" },
    { key: "areas_do_conhecimento", label: "Área(s) do Conhecimento", type: "text", required: true, role: "manual", group: "dados_turma", defaultValue: "Práticas em DSI" },
    { key: "n_aulas_semanais", label: "Nº aulas semanais", type: "text", required: true, role: "manual", group: "dados_turma", defaultValue: "2" },
    { key: "habilidades", label: "HABILIDADES", type: "textarea", required: true, role: "ia_sugerida", group: "habilidades" },
  ],
};

function buildPrompt({ content, isHtml }: ExtractedContent): string {
  const docTag = isHtml ? "documento_html" : "documento";
  const instrucao = isHtml
    ? `Analise o HTML em <documento_html>. O HTML foi gerado pelo Mammoth e preserva a estrutura de tabelas (<table><tr><td>) do documento Word. Para cada linha da tabela, identifique: qual <td> é o rótulo (label) e qual é o campo (geralmente a célula adjacente vazia ou com valor de exemplo). CRÍTICO: copie o label EXATAMENTE como aparece no texto HTML. O 'key' é o label em snake_case sem acentos. Se a célula contém texto, inclua como 'defaultValue'.`
    : `Analise o texto em <documento>. CRÍTICO: o 'label' deve ser copiado EXATAMENTE como aparece. O 'key' é o label em snake_case sem acentos. Se o campo estiver preenchido, inclua o conteúdo como 'defaultValue'.`;

  return [
    `<instrucao>${instrucao}</instrucao>`,
    `<exemplo>${JSON.stringify(fewShotExample)}</exemplo>`,
    `<${docTag}>`,
    content,
    `</${docTag}>`,
  ].join("\n");
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

    const tData = snap.data() as Omit<TemplateRecord, "id">;
    const arquivoUrl = typeof tData.arquivo_url === "string" ? tData.arquivo_url : "";
    if (!arquivoUrl) {
      return NextResponse.json({ error: "Template não possui arquivo armazenado." }, { status: 400 });
    }

    const fileBuffer = await downloadFile(arquivoUrl);

    const lower = arquivoUrl.toLowerCase().split("?")[0];
    const isDocx = lower.endsWith(".docx") || lower.endsWith(".doc");

    // Mammoth extracts semantic HTML for DOCX (preserves table topology)
    // pdf-parse extracts flat text for PDF (best available without OCR)
    const extracted = await extractContent(fileBuffer, arquivoUrl);

    const raw = await generateSchema(buildPrompt(extracted));

    let schema: unknown;
    try {
      schema = parseSchema(raw);
    } catch {
      return NextResponse.json({ error: "Resposta inválida do modelo ao gerar schema." }, { status: 502 });
    }

    if (!Array.isArray(schema)) {
      return NextResponse.json({ error: "Schema deve ser um array de campos." }, { status: 502 });
    }

    // Merge: scanned {{key}} patterns in the DOCX take priority over AI inference
    const scannedKeys = isDocx ? scanPlaceholders(fileBuffer) : [];
    if (scannedKeys.length > 0) {
      const aiKeys = new Set((schema as TemplateFieldSchema[]).map((f) => f.key));
      const fromScan = scannedKeys.filter((k) => !aiKeys.has(k)).map(keyToField);
      (schema as TemplateFieldSchema[]).push(...fromScan);
    }

    let fillableUrl: string | null = null;
    if (isDocx) {
      try {
        const fillableBuffer = injectPlaceholders(fileBuffer, schema as TemplateFieldSchema[]);
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
        });
      } catch (e) {
        console.warn("[re-introspect] Falha ao regenerar DOCX preenchível:", e);
        await db.collection("magis_templates").doc(id).update({ schema_campos: schema });
      }
    } else {
      await db.collection("magis_templates").doc(id).update({ schema_campos: schema });
    }

    return NextResponse.json({ ok: true, schema, totalCampos: (schema as unknown[]).length, arquivo_fillable_url: fillableUrl });
  } catch (error) {
    console.error("[re-introspect] Erro:", error);
    const msg = (error as Error)?.message ?? "";
    return NextResponse.json(
      { error: `Falha ao re-extrair campos do template. ${msg}` },
      { status: 500 },
    );
  }
}
