import "server-only";

import { NextResponse } from "next/server";

import { getAdminDb } from "../../../../../lib/firebase/admin";
import { downloadFile } from "../../../../../lib/storage/blob";
import { verifyPreviewToken } from "../../../../../lib/utils/preview-token";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token") ?? "";
  const exp = parseInt(searchParams.get("exp") ?? "0", 10);

  if (!verifyPreviewToken(id, token, exp)) {
    return new NextResponse("Token inválido ou expirado.", { status: 401 });
  }

  const fillable = searchParams.get("fillable") === "1";

  try {
    const db = getAdminDb();
    const snap = await db.collection("magis_templates").doc(id).get();

    if (!snap.exists) {
      return new NextResponse("Template não encontrado.", { status: 404 });
    }

    const data = snap.data()!;
    const fillableUrl = data.arquivo_fillable_url as string | undefined;
    const arquivoUrl = data.arquivo_url as string | undefined;
    const fileUrl = (fillable && fillableUrl) ? fillableUrl : (arquivoUrl ?? "");
    if (!fileUrl) {
      return new NextResponse("Arquivo não disponível.", { status: 404 });
    }

    const buffer = await downloadFile(fileUrl);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `inline; filename="template-${id.slice(0, 8)}.docx"`,
        "Cache-Control": "private, max-age=1800",
      },
    });
  } catch (error) {
    console.error("[preview-publico] Erro:", error);
    return new NextResponse("Erro ao carregar arquivo.", { status: 500 });
  }
}
