import "server-only";

import { NextResponse } from "next/server";

import { getAdminDb } from "../../../../../lib/firebase/admin";
import { uploadFile } from "../../../../../lib/storage/blob";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const db = getAdminDb();
    const snap = await db.collection("templates").doc(id).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "Arquivo é obrigatório." }, { status: 400 });
    }

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "docx";
    if (ext !== "docx" && ext !== "doc") {
      return NextResponse.json({ error: "Apenas arquivos DOCX/DOC são aceitos como template preparado." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const fillablePath = `templates/${id}/fillable.${ext}`;

    const fillableUrl = await uploadFile({ path: fillablePath, buffer, contentType });
    await db.collection("templates").doc(id).update({ arquivo_fillable_url: fillableUrl });

    return NextResponse.json({ ok: true, arquivo_fillable_url: fillableUrl });
  } catch (error) {
    console.error("[PlanoMagistra/api/templates/[id]/upload-fillable] Erro:", error);
    return NextResponse.json({ error: "Falha ao armazenar template preparado." }, { status: 500 });
  }
}
