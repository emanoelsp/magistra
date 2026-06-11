import "server-only";

import { NextResponse } from "next/server";
import { SchemaType } from "@google/generative-ai";
import type { ResponseSchema } from "@google/generative-ai";
import pdf from "pdf-parse";
import PizZip from "pizzip";

import { getAdminDb } from "../../../../lib/firebase/admin";
import { requireCurrentUserProfile } from "../../../../lib/auth/session";
import { getLimitsStatus } from "../../../../lib/services/limits";
import { callAIWithFallbacks } from "../../../../lib/ai/provider";

const MODEL_NAME = process.env.GOOGLE_GEMINI_MODEL ?? "gemini-2.0-flash";

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
          key:            { type: SchemaType.STRING },
          label:          { type: SchemaType.STRING },
          type:           { type: SchemaType.STRING, format: "enum", enum: ["text", "textarea"] },
          required:       { type: SchemaType.BOOLEAN },
          role:           { type: SchemaType.STRING, format: "enum", enum: ["manual", "ia_sugerida"] },
          group:          { type: SchemaType.STRING, format: "enum", enum: ["dados_turma", "objetivos", "competencias", "habilidades", "conteudos", "avaliacao", "outros"] },
          defaultValue:   { type: SchemaType.STRING, nullable: true },
          aiInstructions: { type: SchemaType.STRING, nullable: true },
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
   Exemplos: 'Área/Componente:' → label 'Área/Componente' | 'HABILIDADES:' → label 'HABILIDADES' | 'Professor(a):' → label 'Professor(a)'.
   NUNCA invente labels.
2. Campos de identificação (professor, curso/área, turma, componente etc.) → role 'manual', group 'dados_turma'.
3. Campos pedagógicos (objetivos, competências, habilidades, BNCC, SAEB, conteúdos, avaliação) → role 'ia_sugerida'.
4. Grupos válidos: dados_turma | objetivos | competencias | habilidades | conteudos | avaliacao | outros.
5. O 'key' é o label em snake_case sem acentos (ex: 'area_componente', 'numero_de_aulas').
6. type "textarea" para campos pedagógicos longos; "text" para campos curtos (nome, turma, data, número).
7. NÃO inclua linhas que são apenas títulos de seção sem campo associado.
13. TÍTULO vs. CAMPO PREENCHÍVEL — regra obrigatória. Avalie linha por linha e parágrafo por parágrafo:
   A. TUDO EM MAIÚSCULAS + termina com ":" → SEMPRE campo (ex.: "HABILIDADES:", "AVALIAÇÃO:"). Cria variável NA MESMA LINHA/CÉLULA.
   B. TUDO EM MAIÚSCULAS + SEM ":" → SEMPRE título, NUNCA gera variável (ex.: "CEDUP HERMANN HERING", "PLANO DE AULA (ATÉ 30 DIAS) - 2026").
   C. Minúsculas/misto + termina com ":" → campo. Variável inline (na mesma linha ou célula).
   D. Minúsculas/misto + SEM ":" → campo SOMENTE SE houver linha/célula vazia imediatamente abaixo ou à direita. Se não houver → título, descarta.
   E. MÚLTIPLOS RÓTULOS NA MESMA LINHA/CÉLULA: quando há vários parágrafos terminando com ":" na mesma célula (ex.: "Professor(a):\nÁrea/Componente:\nTurma:"), cada um é um campo separado com sua própria variável.
   F. SUB-ITENS "- rótulo:" também geram variável própria.
   G. CABEÇALHO COM IMAGENS: quando uma linha da tabela tem células com imagens (logos, brasões) intercaladas com texto institucional centralizado (ex: [logo] [ESTADO DE SANTA CATARINA / SECRETARIA...] [bandeira]), essa linha é EXCLUSIVAMENTE decorativa — NUNCA gera variável. Ignore todas as células dessa linha.
   Exemplos de TÍTULOS: "CEDUP HERMANN HERING", "PLANO DE AULA".
   Exemplos de CAMPOS: "HABILIDADES:" → campo. "Professor(a):" → campo. "- Carga horária prevista:" → campo.
8. COLUNAS REPETIDAS: Quando o mesmo dado aparece em múltiplas colunas de uma tabela (células espelhadas), declare um ÚNICO campo — não crie chaves duplicadas. Exemplo: "Turma(s)" em 9 colunas → um único campo {{turma}}.
9. PADRÃO DE PERÍODOS/TRIMESTRES: Quando uma tabela tem cabeçalhos de período (1º, 2º, 3º trimestre; bimestres) e MÚLTIPLAS LINHAS de dados — uma por período — crie chaves com sufixo _tr1/_tr2/_tr3 (ou _bim1/_bim2). Exemplo: coluna "HABILIDADES" com 3 linhas de dados → habilidades_tr1, habilidades_tr2, habilidades_tr3. Células de marcação de trimestre (✓, "x", texto do período) → chaves {{tr1}}, {{tr2}}, {{tr3}}.
10. RANGE DE DATAS: Se o valor de um campo contém um intervalo ("13/07/2026 a 09/08/2026" ou "DD/MM - DD/MM"), declare DOIS campos separados: {base}_inicio e {base}_fim.
11. ESCOPO DE BLOCO: Campos do tipo textarea têm conteúdo que se estende até o próximo título em caixa alta ou próxima seção. Marque esses campos com type "textarea" — nunca "text" para seções de conteúdo pedagógico.
12. DEPENDÊNCIAS — aiInstructions: Para campos role "ia_sugerida", preencha 'aiInstructions' com 1 frase curta indicando quais outros campos servem de contexto. Use o mapeamento:
   • metodologia, atividade → "Elabore considerando os objetivos de aprendizagem e as habilidades definidas neste plano."
   • avaliacao, instrumentos_avaliativos → "Defina instrumentos alinhados às habilidades e objetivos do plano."
   • habilidades (incluindo _tr1/_tr2/_tr3) → "Selecione habilidades BNCC alinhadas ao componente curricular e ao período letivo."
   • objetivos, expectativa_aprendizagem → "Formule objetivos mensuráveis com verbos de ação no infinitivo, conectados às habilidades."
   • competencias → "Parafraseie competências BNCC aplicadas ao componente e nível de ensino — nunca cópia literal."
   • conteudos, conceitos_estruturantes, objeto_conhecimento, tematica → "Organize do mais básico ao mais complexo, alinhado ao período letivo e às habilidades."
   • recuperacao_paralela → "Proponha atividades diferenciadas baseadas nas dificuldades previstas pelos objetivos e avaliação."
   • Outros campos ia_sugerida → "Seja específico ao contexto da turma, disciplina e período descritos no plano."
   Campos role "manual" → aiInstructions = "".
</regras>
<raciocinio_obrigatorio>
Antes de extrair os campos, raciocine em "raciocinio" seguindo estes passos:
1. Faça uma leitura geral do documento para mapear sua estrutura (seções, rótulos, campos preenchíveis).
2. Classifique cada campo: é de identificação (professor, turma, escola, data) ou pedagógico (objetivos, habilidades, conteúdos, avaliação)?
3. Para cada campo pedagógico, determine o group correto: objetivos | competencias | habilidades | conteudos | avaliacao | outros.
4. Confirme que cada label será copiado EXATAMENTE como aparece no documento, sem normalização.
5. Identifique colunas repetidas (→ mesmo campo único), estruturas de período (→ sufixos _tr1/_tr2/_tr3) e ranges de data (→ _inicio/_fim).
6. Para CADA linha/parágrafo, aplique a Regra 13:
   • TUDO MAIÚSCULO + ":" → campo direto, variável na mesma célula.
   • TUDO MAIÚSCULO + sem ":" → título, descarta imediatamente.
   • Misto + ":" → campo.
   • Misto + sem ":" → campo SOMENTE se houver vazio adjacente; senão título.
   • Vários parágrafos "rótulo:" na mesma célula → um campo por parágrafo.
</raciocinio_obrigatorio>
<contrato_de_saida>
Responda com JSON: { "raciocinio": string, "campos": [...TemplateFieldSchema] }
</contrato_de_saida>`;

async function generateSchema(promptStr: string): Promise<string> {
  const { text } = await callAIWithFallbacks({
    systemInstruction: SYSTEM_INSTRUCTION,
    prompt: promptStr,
    temperature: 0.1,
    topP: 0.6,
    geminiSchema: INTROSPECT_RESPONSE_SCHEMA,
  });
  return text;
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
    const user = await requireCurrentUserProfile();

    const formData = await request.formData();
    const templateId = (formData.get("templateId") as string | null) ?? null;
    const file = formData.get("file") as File | null;
    const isNew = formData.get("isNew") === "true"; // flag to distinguish create vs re-introspect

    console.log("[PlanoMagistra] 2. Extraindo campos do template...", {
      templateId,
      arquivo: (file as File & { name?: string })?.name,
      modelo: MODEL_NAME,
    });

    if (!templateId || !file) {
      return NextResponse.json({ error: "templateId e arquivo PDF são obrigatórios." }, { status: 400 });
    }

    // Enforce template limit only on first introspection (template creation)
    if (isNew) {
      const limits = await getLimitsStatus(user.uid, user.plano ?? "free");
      if (!limits.canCreateTemplate) {
        return NextResponse.json(
          {
            error: `Limite de ${limits.limits.maxTemplates} templates atingido. Faça upgrade do plano.`,
            limitReached: true,
          },
          { status: 403 },
        );
      }
    }

    // Verify template ownership
    const db = getAdminDb();
    const templateSnap = await db.collection("magis_templates").doc(templateId).get();
    if (!templateSnap.exists || templateSnap.data()?.user_id !== user.uid) {
      return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
    }

    const pdfText = await extractFileText(file);

    // Few-shot: two examples covering the main structural patterns found in Brazilian school templates.
    const fewShotExamples = [
      {
        descricao: "Plano de 30 dias (CEDUP/SC) — template com campos preenchidos. Regra 10: range de datas → _inicio/_fim.",
        regra: "NUNCA invente ou normalize labels. Se o documento diz 'Área/Componente:' o label é 'Área/Componente', NÃO 'Curso' nem 'Componente curricular'.",
        campos: [
          { key: "professor", label: "Professor(a)", type: "text", required: true, role: "manual", group: "dados_turma", defaultValue: "Luiz Carlos Covre" },
          { key: "area_componente", label: "Área/Componente", type: "text", required: true, role: "manual", group: "dados_turma", defaultValue: "5421 - PRÁTICAS EM D.S.I - HTML, CSS, PHP" },
          { key: "turma", label: "Turma", type: "text", required: true, role: "manual", group: "dados_turma", defaultValue: "2º EMIEP" },
          { key: "ch_prevista", label: "Carga horária prevista", type: "text", required: true, role: "manual", group: "dados_turma" },
          { key: "data_inicio", label: "Data ou período de realização", type: "text", required: true, role: "manual", group: "dados_turma" },
          { key: "data_fim", label: "Data ou período de realização", type: "text", required: true, role: "manual", group: "dados_turma" },
          { key: "tematica_abordada", label: "TEMÁTICA ABORDADA", type: "textarea", required: true, role: "ia_sugerida", group: "conteudos" },
          { key: "conceitos_estruturantes_e_objetos_conhecimento", label: "CONCEITOS ESTRUTURANTES E OBJETOS DO CONHECIMENTO", type: "textarea", required: true, role: "ia_sugerida", group: "conteudos" },
          { key: "habilidades", label: "HABILIDADES", type: "textarea", required: true, role: "ia_sugerida", group: "habilidades" },
          { key: "objetivos_aprendizagem", label: "OBJETIVOS DE APRENDIZAGEM", type: "textarea", required: true, role: "ia_sugerida", group: "objetivos" },
          { key: "atividade_proposta_metodologia", label: "ATIVIDADE PROPOSTA/ METODOLOGIA", type: "textarea", required: true, role: "ia_sugerida", group: "conteudos" },
          { key: "avaliacao", label: "AVALIAÇÃO", type: "textarea", required: true, role: "ia_sugerida", group: "avaliacao" },
          { key: "recuperacao_paralela", label: "Recuperação paralela", type: "textarea", required: false, role: "manual", group: "outros" },
        ],
        nota: "Regra 10: 'Data ou período de realização: 13/07/2026 a 09/08/2026' → dois campos data_inicio + data_fim.",
      },
      {
        descricao: "Planejamento anual com 3 trimestres (EMIEP-2026). Regra 8: colunas repetidas → 1 campo. Regra 9: 3 linhas de dados → sufixos _tr1/_tr2/_tr3.",
        campos: [
          { key: "professor_a", label: "PROFESSOR (A)", type: "text", required: true, role: "manual", group: "dados_turma" },
          { key: "nome_curso", label: "CURSO", type: "text", required: true, role: "manual", group: "dados_turma" },
          { key: "area_conhecimento", label: "Área(s) do Conhecimento", type: "text", required: true, role: "manual", group: "dados_turma" },
          { key: "turma", label: "Turma(s)", type: "text", required: true, role: "manual", group: "dados_turma" },
          { key: "componente_curricular", label: "Componente Curricular", type: "text", required: true, role: "manual", group: "dados_turma" },
          { key: "chpresencial", label: "Carga horária presencial", type: "text", required: false, role: "manual", group: "dados_turma" },
          { key: "chnpresencial", label: "Carga horária não presencial", type: "text", required: false, role: "manual", group: "dados_turma" },
          { key: "objetivo_geral_componente", label: "OBJETIVO GERAL DO COMPONENTE", type: "textarea", required: true, role: "ia_sugerida", group: "objetivos" },
          { key: "competencias_gerais_bncc", label: "COMPETÊNCIAS GERAIS BNCC", type: "textarea", required: true, role: "ia_sugerida", group: "competencias" },
          { key: "competencias_especificas_area", label: "COMPETÊNCIAS ESPECÍFICAS DA ÁREA", type: "textarea", required: true, role: "ia_sugerida", group: "competencias" },
          { key: "conceitos_estruturantes_tr1", label: "CONCEITOS ESTRUTURANTES DA ÁREA", type: "textarea", required: true, role: "ia_sugerida", group: "conteudos" },
          { key: "habilidades_tr1", label: "HABILIDADES", type: "textarea", required: true, role: "ia_sugerida", group: "habilidades" },
          { key: "objeto_conhecimento_tr1", label: "OBJETO DE CONHECIMENTO", type: "textarea", required: true, role: "ia_sugerida", group: "conteudos" },
          { key: "tr1", label: "1º Trimestre", type: "text", required: false, role: "manual", group: "dados_turma" },
          { key: "conceitos_estruturantes_tr2", label: "CONCEITOS ESTRUTURANTES DA ÁREA", type: "textarea", required: true, role: "ia_sugerida", group: "conteudos" },
          { key: "habilidades_tr2", label: "HABILIDADES", type: "textarea", required: true, role: "ia_sugerida", group: "habilidades" },
          { key: "objeto_conhecimento_tr2", label: "OBJETO DE CONHECIMENTO", type: "textarea", required: true, role: "ia_sugerida", group: "conteudos" },
          { key: "tr2", label: "2º Trimestre", type: "text", required: false, role: "manual", group: "dados_turma" },
          { key: "conceitos_estruturantes_tr3", label: "CONCEITOS ESTRUTURANTES DA ÁREA", type: "textarea", required: true, role: "ia_sugerida", group: "conteudos" },
          { key: "habilidades_tr3", label: "HABILIDADES", type: "textarea", required: true, role: "ia_sugerida", group: "habilidades" },
          { key: "objeto_conhecimento_tr3", label: "OBJETO DE CONHECIMENTO", type: "textarea", required: true, role: "ia_sugerida", group: "conteudos" },
          { key: "tr3", label: "3º Trimestre", type: "text", required: false, role: "manual", group: "dados_turma" },
          { key: "metodologia", label: "METODOLOGIA", type: "textarea", required: true, role: "ia_sugerida", group: "conteudos" },
          { key: "avaliacao", label: "AVALIAÇÃO", type: "textarea", required: true, role: "ia_sugerida", group: "avaliacao" },
          { key: "referencias_bibliograficas", label: "REFERÊNCIAS BIBLIOGRÁFICAS", type: "textarea", required: false, role: "manual", group: "outros" },
        ],
        notas: [
          "Regra 8: PROFESSOR (A), Turma(s) etc. repetem em 9-10 colunas → 1 campo cada.",
          "Regra 9: HABILIDADES/CONCEITOS/OBJETO aparecem em 3 linhas (uma por trimestre) → sufixos _tr1/_tr2/_tr3.",
        ],
      },
    ];

    const promptStr = [
      `<instrucao>`,
      `Analise o texto em <documento> e extraia TODOS os campos visíveis. CRÍTICO: o 'label' deve ser copiado EXATAMENTE como aparece (título da seção, rótulo da linha, cabeçalho). Não normalize, não traduza, não abrevia. O 'key' é o label em snake_case sem acentos. Se o documento estiver preenchido, inclua o conteúdo como 'defaultValue'. Aplique as Regras 8 (colunas repetidas), 9 (períodos/trimestres) e 10 (range de datas).`,
      `</instrucao>`,
      `<exemplos>`,
      JSON.stringify(fewShotExamples),
      `</exemplos>`,
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

    await db.collection("magis_templates").doc(templateId).update({
      schema_campos: schema,
      fillable_status: "processando",
    });

    console.log("[PlanoMagistra] 2. Campos extraídos com sucesso", { templateId, totalCampos: (schema as unknown[]).length });

    // Generate fillable DOCX synchronously before responding so the editor
    // shows placeholders immediately when the user lands on the config page.
    try {
      const { downloadFile, uploadFile } = await import("../../../../lib/storage/blob");
      const { injectPlaceholders } = await import("../../../../lib/utils/docx-filler");
      const templateSnapFill = await db.collection("magis_templates").doc(templateId).get();
      const tData = templateSnapFill.data();
      const originalUrl = typeof tData?.arquivo_url === "string" ? tData.arquivo_url : null;
      const isDocx = originalUrl && /\.(docx|doc)(\?|$)/i.test(originalUrl);

      if (isDocx && originalUrl) {
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
        await db.collection("magis_templates").doc(templateId).update({
          arquivo_fillable_url: fillableUrl,
          fillable_status: "pronto",
        });
      } else {
        await db.collection("magis_templates").doc(templateId).update({ fillable_status: "erro" });
      }
    } catch (e) {
      console.warn("[PlanoMagistra/introspect] Falha ao gerar DOCX preenchível:", e);
      await db.collection("magis_templates").doc(templateId).update({ fillable_status: "erro" }).catch(() => {});
    }

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
