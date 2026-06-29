import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

import { getAdminDb } from "../../../../lib/firebase/admin";
import { requireCurrentUserProfile } from "../../../../lib/auth/session";
import { getLimitsStatus } from "../../../../lib/services/limits";
import { getPlanCapabilities } from "../../../../lib/services/plan-capabilities";
import { uploadFile } from "../../../../lib/storage/blob";
import { scanPlaceholders } from "../../../../lib/utils/docx-filler";
import type { TemplateFieldSchema } from "../../../../lib/types/firestore";

const TEMPLATE_META: Record<string, { nome: string; tipo_plano: string; arquivoComVariaveis: string }> = {
  "plano-aula": {
    nome: "Plano de Aula",
    tipo_plano: "plano_aula",
    arquivoComVariaveis: "Plano de aula - com variaveis.docx",
  },
  "planejamento-anual-emiep": {
    nome: "Planejamento Anual EMIEP",
    tipo_plano: "planejamento_anual",
    arquivoComVariaveis: "C-Planejamento anual - EMIEP-2026 - com variaveis.docx",
  },
  "planejamento-cre-emiep": {
    nome: "Planejamento CRE EMIEP 2026",
    tipo_plano: "planejamento_anual",
    arquivoComVariaveis: "PLANEJAMENTO EMIEP 2026 CRE - com variaveis.docx",
  },
  "plano-30-dias": {
    nome: "Plano de 30 Dias",
    tipo_plano: "sequencia_didatica",
    arquivoComVariaveis: "Plano_30dias_5421_13-07_a_09-08_2026 - com variaveis.docx",
  },
};

function keyToField(key: string): TemplateFieldSchema {
  const label = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  let role: TemplateFieldSchema["role"] = "manual";
  let group: TemplateFieldSchema["group"] = "dados_turma";
  const k = key.toLowerCase();
  if (/habilidade|competencia|objetivo|avaliacao|conteudo|tematica|metodologia|atividade|pratica/.test(k)) {
    role = "ia_sugerida";
    if (/habilidade|bncc|saeb/.test(k)) group = "habilidades";
    else if (/competencia/.test(k)) group = "competencias";
    else if (/objetivo/.test(k)) group = "objetivos";
    else if (/avaliacao/.test(k)) group = "avaliacao";
    else group = "conteudos";
  }
  return { key, label, type: "text", required: true, role, group, placeholder: "", helperText: "", aiInstructions: "" };
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireCurrentUserProfile();
    const caps = getPlanCapabilities(user.plano ?? "free");
    if (!caps.canAccessBiblioteca) {
      return NextResponse.json({ error: "Plano Regente necessário" }, { status: 403 });
    }

    const limits = await getLimitsStatus(user.uid, user.plano);
    if (!limits.canCreateTemplate) {
      return NextResponse.json({ error: "Limite de templates atingido" }, { status: 429 });
    }

    const body = (await req.json()) as { templateId?: string };
    const templateId = body.templateId ?? "";
    const meta = TEMPLATE_META[templateId];
    if (!meta) {
      return NextResponse.json({ error: "Template não encontrado na biblioteca" }, { status: 404 });
    }

    const filePath = path.join(process.cwd(), "template_originais", meta.arquivoComVariaveis);
    const buffer = await readFile(filePath);

    const db = getAdminDb();
    const docRef = db.collection("magis_templates").doc();
    const newId = docRef.id;

    const storagePath = `templates/${newId}/original.docx`;
    const arquivoUrl = await uploadFile({
      path: storagePath,
      buffer,
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    const scannedKeys = scanPlaceholders(buffer);
    const schema: TemplateFieldSchema[] = scannedKeys.map(keyToField);

    await docRef.set({
      user_id: user.uid,
      nome: meta.nome,
      tipo_plano: meta.tipo_plano,
      arquivo_url: arquivoUrl,
      arquivo_fillable_url: arquivoUrl,
      schema_campos: schema,
      fillable_status: schema.length > 0 ? "pronto" : "processando",
      biblioteca_origem: templateId,
      data_criacao: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, id: newId });
  } catch (err) {
    console.error("[biblioteca/adicionar]", err);
    const msg = err instanceof Error ? err.message : "Erro ao adicionar template";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
