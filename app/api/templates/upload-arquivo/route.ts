import "server-only";

import { NextResponse } from "next/server";

import { getAdminDb } from "../../../../lib/firebase/admin";
import { uploadFile } from "../../../../lib/storage/blob";
import { injectPlaceholders } from "../../../../lib/utils/docx-filler";
import type { TemplateFieldSchema } from "../../../../lib/types/firestore";

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
    if (ext === "docx" || ext === "doc") {
      try {
        const db = getAdminDb();
        const snap = await db.collection("magis_templates").doc(templateId).get();
        const rawSchema = snap.data()?.schema_campos;
        const schema: TemplateFieldSchema[] = Array.isArray(rawSchema) ? rawSchema : [];

        const fillableBuffer = injectPlaceholders(buffer, schema);
        const fillablePath = `templates/${templateId}/fillable.${ext}`;
        fillableUrl = await uploadFile({ path: fillablePath, buffer: fillableBuffer, contentType: mimeType });
      } catch (docxErr) {
        console.warn("[PlanoMagistra/upload-arquivo] Falha ao gerar DOCX preenchível:", docxErr);
      }
    }

    const db = getAdminDb();
    const updateData: Record<string, string> = { arquivo_url: originalUrl };
    if (fillableUrl) updateData.arquivo_fillable_url = fillableUrl;
    await db.collection("magis_templates").doc(templateId).update(updateData);

    return NextResponse.json({ ok: true, arquivo_url: originalUrl, arquivo_fillable_url: fillableUrl });
  } catch (error) {
    console.error("[PlanoMagistra/api/templates/upload-arquivo] Erro:", error);
    return NextResponse.json({ error: "Falha ao armazenar arquivo do template." }, { status: 500 });
  }
}
