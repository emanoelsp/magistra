import "server-only";

import { NextResponse } from "next/server";

import { getAdminDb } from "../../../../lib/firebase/admin";
import { uploadFile } from "../../../../lib/storage/blob";
import { injectPlaceholders, scanPlaceholders } from "../../../../lib/utils/docx-filler";
import type { TemplateFieldSchema } from "../../../../lib/types/firestore";

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

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const templateId = formData.get("templateId") as string | null;
    const file = formData.get("file") as File | null;

    if (!templateId || !file) {
      return NextResponse.json({ error: "templateId e file são obrigatórios." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || "application/pdf";
    const ext = (file.name.split(".").pop()?.toLowerCase() ?? "pdf") as string;
    const storagePath = `templates/${templateId}/original.${ext}`;

    const originalUrl = await uploadFile({ path: storagePath, buffer, contentType: mimeType });

    let fillableUrl: string | null = null;
    let detectedSchema: TemplateFieldSchema[] = [];

    if (ext === "docx" || ext === "doc") {
      try {
        // Check if user pre-annotated the file with {{variable}} patterns
        const scannedKeys = scanPlaceholders(buffer);
        if (scannedKeys.length > 0) {
          detectedSchema = scannedKeys.map(keyToField);
          // File already has {{...}} — it IS the fillable; store as both
          fillableUrl = originalUrl;
        } else {
          // No annotations: use existing schema for fillable generation
          const db = getAdminDb();
          const snap = await db.collection("magis_templates").doc(templateId).get();
          const rawSchema = snap.data()?.schema_campos;
          const schema: TemplateFieldSchema[] = Array.isArray(rawSchema) ? rawSchema : [];
          if (schema.length > 0) {
            const fillableBuffer = injectPlaceholders(buffer, schema);
            const fillablePath = `templates/${templateId}/fillable.${ext}`;
            fillableUrl = await uploadFile({ path: fillablePath, buffer: fillableBuffer, contentType: mimeType });
          }
        }
      } catch (docxErr) {
        console.warn("[PlanoMagistra/upload-arquivo] Falha ao gerar DOCX preenchível:", docxErr);
      }
    }

    const db = getAdminDb();
    const updateData: Record<string, unknown> = { arquivo_url: originalUrl };
    if (fillableUrl) updateData.arquivo_fillable_url = fillableUrl;
    if (detectedSchema.length > 0) {
      updateData.schema_campos = detectedSchema;
      updateData.fillable_status = "pronto";
    }
    await db.collection("magis_templates").doc(templateId).update(updateData);

    return NextResponse.json({ ok: true, arquivo_url: originalUrl, arquivo_fillable_url: fillableUrl });
  } catch (error) {
    console.error("[PlanoMagistra/api/templates/upload-arquivo] Erro:", error);
    return NextResponse.json({ error: "Falha ao armazenar arquivo do template." }, { status: 500 });
  }
}
