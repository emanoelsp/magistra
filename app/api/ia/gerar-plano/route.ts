/**
 * POST /api/ia/gerar-plano
 *
 * Batch endpoint for generating suggestions for all pedagogico fields in a plan.
 * Key difference from /api/ia/campo: does ONE Pinecone retrieval shared across
 * all fields, then fans out to parallel AI calls (concurrency 3).
 *
 * This saves N-1 Pinecone queries per batch and enables the review-before-insert
 * flow in the plan editor.
 *
 * Request body:
 *   { templateId, metadata, fieldKeys?, estudanteNome?, estudanteContexto? }
 *
 * Response:
 *   { fields: { [key]: { label, sugestoes, error? } }, quotaConsumed: number }
 */
import "server-only";

import { NextResponse } from "next/server";
import { SchemaType } from "@google/generative-ai";
import type { ResponseSchema } from "@google/generative-ai";

import { getAdminDb } from "../../../../lib/firebase/admin";
import { requireCurrentUserProfile } from "../../../../lib/auth/session";
import { callAIWithFallbacks } from "../../../../lib/ai/provider";
import { checkRateLimit } from "../../../../lib/services/rate-limit.server";
import { PLAN_LIMITS, normalizePlanKey } from "../../../../lib/services/plan-config";
import { validateSugestoes } from "../../../../lib/services/suggestion-validator";
import {
  retrieveAllCurriculumContext,
  pruneCurriculumContext,
  buildRagQuery,
  buildNamespaceLookup,
  resolveNamespace,
  matchComponente,
} from "../../../../lib/services/bncc-rag.server";
import { anexarCodigosOficiais, buildAllowedCodes, filterWithRetry } from "../../../../lib/services/bncc-validator";
import { inferirClasse } from "../../../../lib/utils/field-taxonomy";
import { FieldValue } from "firebase-admin/firestore";
import type { IaSugestao, TemplateRecord, TemplateFieldSchema } from "../../../../lib/types/firestore";

const CONCURRENCY = 3;
const MODEL_NAME = process.env.GOOGLE_GEMINI_MODEL ?? "gemini-2.0-flash";

const SUGESTAO_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  required: ["raciocinio", "sugestoes"],
  properties: {
    raciocinio: { type: SchemaType.STRING },
    sugestoes: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        required: ["id", "label", "descricao", "fonte"],
        properties: {
          id:        { type: SchemaType.STRING },
          label:     { type: SchemaType.STRING },
          descricao: { type: SchemaType.STRING },
          fonte:     { type: SchemaType.STRING },
          aviso:     { type: SchemaType.STRING },
        },
      },
    },
  },
};

function sanitize(s: string): string {
  return s.replace(/<\/?[^>]+>/g, "").replace(/[{}]/g, "").trim();
}

function instrucaoField(label: string, group: string | undefined, isPei: boolean): string {
  const g = group ?? "outros";

  if (g === "objetivos")
    return isPei
      ? `O campo "${label}" é de OBJETIVOS DO PEI. Gere objetivos funcionais e pedagógicos adaptados ao perfil de suporte do estudante. label = objetivo iniciando com verbo no infinitivo, mensurável; descricao = como verificar o alcance e a estratégia de suporte; fonte = 'PEI', 'AEE' ou 'BNCC adaptada'.`
      : `O campo "${label}" é de OBJETIVOS DE APRENDIZAGEM. label = objetivo iniciando com verbo no infinitivo (Identificar, Analisar, Resolver, Produzir, Aplicar, Criar, Comparar); descricao = conexão com habilidades BNCC e cotidiano do aluno; fonte = 'BNCC [código]' ou 'Objetivo pedagógico'.`;

  if (g === "habilidades")
    return isPei
      ? `O campo "${label}" é de HABILIDADES DO PEI. label = habilidade adaptada ao nível de funcionalidade do estudante; descricao = estratégia pedagógica ou recurso de acessibilidade; fonte = 'BNCC adaptada', 'AEE' ou 'Currículo funcional'.`
      : `O campo "${label}" é de HABILIDADES BNCC. Use EXCLUSIVAMENTE os códigos listados em <habilidades_bncc>. label = 'CÓDIGO — descrição parafraseada'; descricao = como desenvolver com a turma; fonte = 'BNCC [código]'.`;

  if (g === "competencias")
    return isPei
      ? `O campo "${label}" é de COMPETÊNCIAS DO PEI. label = competência funcional iniciando com verbo no infinitivo; descricao = como desenvolver em sala inclusiva; fonte = 'Competência PEI' ou 'BNCC adaptada'.`
      : `O campo "${label}" é de COMPETÊNCIAS. Sempre parafraseadas — nunca cópia literal. label = competência iniciando com verbo no infinitivo; descricao = como se manifesta nas atividades desta turma; fonte = 'Competência Geral BNCC N°X'.`;

  if (g === "conteudos")
    return isPei
      ? `O campo "${label}" é de CONTEÚDOS/ATIVIDADES DO PEI. label = atividade adaptada iniciando com verbo no infinitivo; descricao = como realizar e recursos de acessibilidade; fonte = 'Currículo adaptado' ou 'AEE'.`
      : `O campo "${label}" é de CONTEÚDOS PROGRAMÁTICOS. label = tópico iniciando com verbo no infinitivo, do mais básico ao mais complexo; descricao = conexão com cotidiano e currículo territorial; fonte = 'Currículo [componente]'.`;

  if (g === "avaliacao")
    return isPei
      ? `O campo "${label}" é de AVALIAÇÃO DO PEI. label = forma de avaliação adaptada iniciando com verbo; descricao = o que observar e o que indica progresso no PEI; fonte = 'Avaliação descritiva' ou 'Portfólio'.`
      : `O campo "${label}" é de AVALIAÇÃO. label = instrumento avaliativo iniciando com verbo no infinitivo; descricao = como aplicar e o que evidencia aprendizagem; fonte = 'Avaliação formativa', 'Avaliação somativa' ou 'SAEB'.`;

  return `O campo a ser preenchido é: "${label}" (categoria: ${g}). label = texto iniciando com verbo no infinitivo pronto para inserção; descricao = justificativa pedagógica; fonte = referência curricular.`;
}

async function generateForField(
  field: TemplateFieldSchema,
  sharedContext: {
    templateId: string;
    isPei: boolean;
    contexto: string;
    anoLetivo: number;
    bnccContexto: string | null;
    saebContexto: string | null;
    estadualContexto: string | null;
    cnctContexto: string | null;
    digitalContexto: string | null;
    estado: string | undefined;
    allowedCodes: Set<string>;
    nsLookup: ReturnType<typeof buildNamespaceLookup>;
    curriculum: {
      bncc: Array<{ codigo: string; texto: string }>;
      saeb: Array<{ codigo: string; texto: string }>;
    };
  },
): Promise<{ sugestoes: IaSugestao[]; error?: string; precisaRevisao?: boolean; raciocinio?: string }> {
  const label = sanitize(field.label);
  const instrucao = instrucaoField(label, field.group, sharedContext.isPei);

  const systemInstruction = `<persona>Você é um pedagogo sênior com 15 anos de experiência em planejamento de aulas para a educação básica brasileira. Domina a BNCC, o SAEB e currículos territoriais com profundidade técnica.${sharedContext.isPei ? " Também é especialista em Educação Especial e Inclusiva: domina AEE, coensino, adaptações curriculares, Tecnologia Assistiva e CAA." : ""}</persona>
<tarefa>Gere de 3 a 5 sugestões de preenchimento para o campo indicado em <campo>.</tarefa>
<regras>
1. NUNCA copie trechos literais de documentos oficiais — parafraseie sempre.
2. NUNCA invente códigos BNCC ou SAEB — use SOMENTE os listados em <habilidades_bncc> ou <descritores_saeb>.
3. SEMPRE inicie o campo "label" com verbo de ação no infinitivo.
4. Ano letivo: ${sharedContext.anoLetivo}. Use versões e atualizações mais recentes da BNCC.
5. Habilidades de outro componente marcadas com [ComponenteX → adaptável] devem ter aviso explicando a adaptação.
</regras>
<contrato_de_saida>Responda SOMENTE com JSON: { "raciocinio": string, "sugestoes": [{ "id": string, "label": string, "descricao": string, "fonte": string, "aviso"?: string }] }</contrato_de_saida>`;

  const prompt = [
    `<campo><nome>${label}</nome><categoria>${field.group ?? "outros"}</categoria><instrucao>${instrucao}</instrucao></campo>`,
    `<contexto><template>Plano de aula</template><turma>${sharedContext.contexto}</turma><ano_letivo>${sharedContext.anoLetivo}</ano_letivo></contexto>`,
    ...(sharedContext.bnccContexto    ? [`<habilidades_bncc>\n${sharedContext.bnccContexto}\n</habilidades_bncc>`]            : []),
    ...(sharedContext.saebContexto    ? [`<descritores_saeb>\n${sharedContext.saebContexto}\n</descritores_saeb>`]            : []),
    ...(sharedContext.estadualContexto? [`<curriculo_${sharedContext.estado ?? "estadual"}>\n${sharedContext.estadualContexto}\n</curriculo_${sharedContext.estado ?? "estadual"}>`] : []),
    ...(sharedContext.cnctContexto    ? [`<catalogo_tecnico_cnct>\n${sharedContext.cnctContexto}\n</catalogo_tecnico_cnct>`]  : []),
    ...(sharedContext.digitalContexto ? [`<curriculo_educacao_digital>\n${sharedContext.digitalContexto}\n</curriculo_educacao_digital>`] : []),
  ].join("\n");

  async function callAndParse(p: string): Promise<{ sugestoes: IaSugestao[]; raciocinio?: string }> {
    const { text } = await callAIWithFallbacks({
      systemInstruction,
      prompt: p,
      temperature: 0.35,
      topP: 0.8,
      geminiSchema: SUGESTAO_SCHEMA,
    });
    let parsedInner: { raciocinio?: string; sugestoes: IaSugestao[] };
    try {
      parsedInner = JSON.parse(text) as typeof parsedInner;
    } catch {
      const fb = text.indexOf("{");
      const lb = text.lastIndexOf("}");
      if (fb === -1 || lb <= fb) throw new Error("JSON inválido");
      parsedInner = JSON.parse(text.slice(fb, lb + 1)) as typeof parsedInner;
    }
    const raw = Array.isArray(parsedInner?.sugestoes) ? parsedInner.sugestoes : [];
    return {
      sugestoes: validateSugestoes(raw, { templateId: sharedContext.templateId, fieldKey: field.key })
        .map((s) => ({ ...s, namespace: resolveNamespace(s.fonte ?? "", sharedContext.nsLookup) })),
      ...(typeof parsedInner.raciocinio === "string" && parsedInner.raciocinio
        ? { raciocinio: parsedInner.raciocinio }
        : {}),
    };
  }

  try {
    const first = await callAndParse(prompt);
    // filterWithRetry runs the fail-visible flow: filter → ONE regeneration → precisaRevisao.
    const result = await filterWithRetry(
      first.sugestoes,
      sharedContext.allowedCodes,
      (correcao) => callAndParse(correcao + prompt).then((r) => r.sugestoes),
      `ia/gerar-plano field="${field.key}"`,
    );
    return {
      sugestoes: anexarCodigosOficiais(result.sugestoes, sharedContext.curriculum),
      ...(first.raciocinio ? { raciocinio: first.raciocinio } : {}),
      ...(result.precisaRevisao ? { precisaRevisao: true } : {}),
    };
  } catch (err) {
    return { sugestoes: [], error: (err as Error).message ?? "Falha na geração" };
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUserProfile();

    const rl = await checkRateLimit(user.uid, user.plano ?? "free", "ia_campo");
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Limite atingido. Tente novamente após ${new Date(rl.resetAt).toLocaleTimeString("pt-BR")}.` },
        { status: 429 },
      );
    }

    const body = (await request.json()) as {
      templateId?: string;
      fieldKeys?: string[];
      metadata?: Record<string, string>;
      estudanteNome?: string;
      estudanteContexto?: string;
    };

    const { templateId, fieldKeys, metadata = {}, estudanteNome, estudanteContexto } = body;
    if (!templateId) {
      return NextResponse.json({ error: "templateId é obrigatório." }, { status: 400 });
    }

    const db = getAdminDb();
    const snap = await db.collection("magis_templates").doc(templateId).get();
    if (!snap.exists) return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });

    const template = snap.data() as TemplateRecord;
    if (template.user_id !== user.uid) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

    const isPei = template.template_type === "plano_educacional_individualizado";
    const allSchema: TemplateFieldSchema[] = Array.isArray(template.schema_campos) ? template.schema_campos : [];

    // Resolve which fields to generate: explicit list, or auto-detect pedagogico/ia_sugerida
    const targetFields = allSchema.filter((f) => {
      if (fieldKeys && fieldKeys.length > 0) return fieldKeys.includes(f.key);
      const cl = f.classe ?? inferirClasse(f.key, f.role ?? "manual");
      return cl === "pedagogico" || f.role === "ia_sugerida";
    });

    if (targetFields.length === 0) {
      return NextResponse.json({ fields: {}, quotaConsumed: 0 });
    }

    // Respect monthly quota — check before proceeding (N fields = N quota points)
    const currentMonth = new Date().toISOString().slice(0, 7);
    const planoKey = normalizePlanKey(user.plano);
    const limitesMes = (PLAN_LIMITS[planoKey] ?? PLAN_LIMITS.free).maxIaCampoCallsPerMonth;
    const callsMes = user.ia_campo_mes === currentMonth ? (user.ia_campo_calls_mes ?? 0) : 0;
    if (callsMes + targetFields.length > limitesMes) {
      const canGen = Math.max(0, limitesMes - callsMes);
      return NextResponse.json(
        { error: `Cota insuficiente. Você pode gerar mais ${canGen} campo(s) este mês.`, quotaRemaining: canGen },
        { status: 403 },
      );
    }

    // ── Shared context ──────────────────────────────────────────────────────────

    const sanitizedMeta = Object.fromEntries(
      Object.entries(metadata).map(([k, v]) => [sanitize(k), sanitize(v)])
    );
    const metaLines = Object.entries(sanitizedMeta).filter(([, v]) => v.trim()).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`);
    if (template.escola_nome && !metaLines.some((l) => l.startsWith("escola"))) metaLines.unshift(`escola: ${template.escola_nome}`);
    if (template.tipo_plano   && !metaLines.some((l) => /nível|nivel|ensino|etapa/.test(l))) metaLines.unshift(`nível de ensino: ${template.tipo_plano}`);
    if (estudanteNome) metaLines.push(`estudante: ${sanitize(estudanteNome)}`);
    if (estudanteContexto) metaLines.push(`perfil do estudante: ${sanitize(estudanteContexto).slice(0, 400)}`);
    const contexto = metaLines.join(" | ") || "Sem contexto fornecido";

    const componente = sanitizedMeta["componente_curricular"] ?? sanitizedMeta["componente"] ?? sanitizedMeta["disciplina"] ?? "";
    const estado = typeof template.estado === "string" ? template.estado : undefined;
    const tipoPlano = typeof template.tipo_plano === "string" ? template.tipo_plano : "";

    const etapaRaw = (tipoPlano + " " + (sanitizedMeta["etapa"] ?? sanitizedMeta["ano"] ?? "")).toLowerCase();
    const etapa: "EF" | "EM" | undefined =
      /médi|medio|ensino.?médi|\bem\b/.test(etapaRaw) ? "EM"
      : /fund|\bef\b|[1-9]/.test(etapaRaw) ? "EF"
      : undefined;

    const ragQuery = buildRagQuery({
      fieldLabel: targetFields.map((f) => f.label).join(", "),
      fieldGroup: targetFields[0]?.group ?? undefined,
      componente,
      tipoPlano,
      pedagogicalContext: contexto,
      currentValuesContext: "",
    });

    // ONE Pinecone retrieval shared across all fields
    const curriculumRaw = await retrieveAllCurriculumContext(ragQuery, { componente, etapa, estado });
    const curriculum = pruneCurriculumContext(curriculumRaw);
    const allowedCodes = buildAllowedCodes(curriculum);
    const nsLookup = buildNamespaceLookup(curriculum);

    const requestedComp = matchComponente(componente);
    const normC = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

    const bnccContexto = curriculum.bncc.length > 0
      ? curriculum.bncc.map((c) => {
          const cross = requestedComp && c.componente && normC(c.componente) !== normC(requestedComp);
          return `${c.codigo}${cross ? ` [${c.componente} → adaptável para ${requestedComp}]` : ""}: ${c.texto}`;
        }).join("\n")
      : null;
    const saebContexto = curriculum.saeb.length > 0
      ? curriculum.saeb.map((c) => {
          const cross = requestedComp && c.componente && normC(c.componente) !== normC(requestedComp);
          return `${c.codigo}${cross ? ` [${c.componente} → adaptável]` : ""}: ${c.texto}`;
        }).join("\n")
      : null;
    const estadualContexto = curriculum.curriculo_estadual.length > 0 ? curriculum.curriculo_estadual.map((c) => c.texto).join("\n") : null;
    const cnctContexto    = curriculum.cnct.length > 0 ? curriculum.cnct.map((c) => `${c.curso}: ${c.texto}`).join("\n") : null;
    const digitalContexto = curriculum.curriculo_digital.length > 0 ? curriculum.curriculo_digital.map((c) => `${c.codigo ? c.codigo + ": " : ""}${c.texto}`).join("\n") : null;

    const sharedCtx = {
      templateId,
      isPei,
      contexto,
      anoLetivo: new Date().getFullYear(),
      bnccContexto,
      saebContexto,
      estadualContexto,
      cnctContexto,
      digitalContexto,
      estado,
      allowedCodes,
      nsLookup,
      curriculum,
    };

    // ── Fan-out com concorrência limitada ─────────────────────────────────────

    const results: Record<string, { label: string; sugestoes: IaSugestao[]; error?: string; precisaRevisao?: boolean; raciocinio?: string }> = {};

    async function runBatch(fields: TemplateFieldSchema[]) {
      for (let i = 0; i < fields.length; i += CONCURRENCY) {
        const chunk = fields.slice(i, i + CONCURRENCY);
        await Promise.all(
          chunk.map(async (field) => {
            const result = await generateForField(field, sharedCtx);
            results[field.key] = { label: field.label, ...result };
          }),
        );
      }
    }

    await runBatch(targetFields);

    // ── Increment quota atomically ────────────────────────────────────────────

    const consumed = targetFields.length;
    try {
      await db.runTransaction(async (tx) => {
        const ref = db.collection("magis_users").doc(user.uid);
        const snap2 = await tx.get(ref);
        const d = snap2.data() ?? {};
        const storedMonth = (d.ia_campo_mes as string | undefined) ?? "";
        const currentCount = storedMonth === currentMonth ? ((d.ia_campo_calls_mes as number | undefined) ?? 0) : 0;
        tx.update(ref, {
          ia_campo_calls_mes: currentCount + consumed,
          ia_campo_mes: currentMonth,
        });
      });
    } catch { /* non-fatal */ }

    void db.collection("magis_usage").add({
      user_id: user.uid,
      action: "gerar_plano",
      model: MODEL_NAME,
      provider: "gemini",
      tokens_input: 0,
      tokens_output: 0,
      fields_generated: consumed,
      created_at: FieldValue.serverTimestamp(),
    }).catch(() => {});

    return NextResponse.json({
      fields: results,
      quotaConsumed: consumed,
      quotaRemaining: Math.max(0, limitesMes - callsMes - consumed),
    });
  } catch (error) {
    console.error("[ia/gerar-plano] Erro:", error);
    return NextResponse.json({ error: "Falha na geração em lote." }, { status: 500 });
  }
}
