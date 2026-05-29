import "server-only";

import { NextResponse } from "next/server";

import { getAdminDb } from "../../../../../lib/firebase/admin";
import { downloadFile } from "../../../../../lib/storage/blob";
import type { TemplateRecord } from "../../../../../lib/types/firestore";

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
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/octet-stream";

    const suffix = wantFillable ? "-preparado" : "";
    const blob = new Blob([new Uint8Array(fileBuffer)], { type: contentType });

    return new NextResponse(blob, {
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
