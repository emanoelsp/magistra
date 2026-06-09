import "server-only";

import { NextResponse } from "next/server";

import { getAdminDb } from "../../../../../lib/firebase/admin";
import { downloadFile, uploadFile } from "../../../../../lib/storage/blob";
import type { TemplateRecord } from "../../../../../lib/types/firestore";

const DOCX_CT = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const wantFillable = searchParams.get("fillable") === "1";

    const db = getAdminDb();
    const snap = await db.collection("magis_templates").doc(id).get();

    if (!snap.exists) {
      return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
    }

    const template = snap.data() as TemplateRecord;

    // If fillable requested and not yet generated, generate on-the-fly from original
    if (wantFillable && !template.arquivo_fillable_url && template.arquivo_url) {
      const isDocx = /\.(docx|doc)(\?|$)/i.test(template.arquivo_url);
      const schema = Array.isArray(template.schema_campos) ? template.schema_campos : [];

      if (isDocx && schema.length > 0) {
        try {
          const { injectPlaceholders } = await import("../../../../../lib/utils/docx-filler");
          const { uploadFile: upload } = await import("../../../../../lib/storage/blob");
          const rawBuffer = await downloadFile(template.arquivo_url);
          const fillableBuffer = injectPlaceholders(rawBuffer, schema);
          const fillablePath = `templates/${id}/fillable.docx`;
          const fillableUrl = await upload({ path: fillablePath, buffer: fillableBuffer, contentType: DOCX_CT });
          await db.collection("magis_templates").doc(id).update({
            arquivo_fillable_url: fillableUrl,
            fillable_status: "pronto",
          });

          return new NextResponse(new Uint8Array(fillableBuffer), {
            headers: {
              "Content-Type": DOCX_CT,
              "Content-Disposition": `attachment; filename="template-preparado-${id.slice(0, 8)}.docx"`,
              "Cache-Control": "private, no-store",
            },
          });
        } catch (e) {
          console.warn("[arquivo] On-the-fly fillable falhou, retornando original:", e);
        }
      }
    }

    const fileUrl = wantFillable && template.arquivo_fillable_url
      ? template.arquivo_fillable_url
      : template.arquivo_url;

    if (!fileUrl) {
      return NextResponse.json({ error: "Arquivo original não disponível." }, { status: 404 });
    }

    const fileBuffer = await downloadFile(fileUrl);
    const ext = fileUrl.split(".").pop()?.toLowerCase().replace(/\?.*$/, "") ?? "pdf";
    const contentType =
      ext === "pdf"
        ? "application/pdf"
        : ext === "docx"
          ? DOCX_CT
          : "application/octet-stream";

    const suffix = wantFillable ? "-preparado" : "";

    return new NextResponse(new Uint8Array(fileBuffer), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="template${suffix}-${id.slice(0, 8)}.${ext}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    console.error("[PlanoMagistra/api/templates/[id]/arquivo] Erro:", error);
    return NextResponse.json({ error: "Falha ao carregar arquivo." }, { status: 500 });
  }
}
