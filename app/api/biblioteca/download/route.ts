import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

import { requireCurrentUserProfile } from "../../../../lib/auth/session";
import { getPlanCapabilities } from "../../../../lib/services/plan-capabilities";

const ALLOWED_FILES = new Set([
  "Plano de aula Em branco.docx",
  "C-Planejamento anual - EMIEP-2026 Em branco .docx",
  "PLANEJAMENTO EMIEP 2026 CRE Em branco.docx",
  "Plano_30dias_5421_13-07_a_09-08_2026 Em branco.docx",
  "Plano de aula - com variaveis.docx",
  "C-Planejamento anual - EMIEP-2026 - com variaveis.docx",
  "PLANEJAMENTO EMIEP 2026 CRE - com variaveis.docx",
  "Plano_30dias_5421_13-07_a_09-08_2026 - com variaveis.docx",
]);

export async function GET(req: NextRequest) {
  try {
    const user = await requireCurrentUserProfile();
    const caps = getPlanCapabilities(user.plano ?? "free");
    if (!caps.canAccessBiblioteca) {
      return NextResponse.json({ error: "Plano Regente necessário" }, { status: 403 });
    }

    const arquivo = req.nextUrl.searchParams.get("arquivo") ?? "";
    if (!ALLOWED_FILES.has(arquivo)) {
      return NextResponse.json({ error: "Arquivo não permitido" }, { status: 400 });
    }

    const filePath = path.join(process.cwd(), "template_originais", arquivo);
    const buffer = await readFile(filePath);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${arquivo}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao baixar arquivo";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
