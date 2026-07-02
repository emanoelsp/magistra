import "server-only";

import { NextResponse } from "next/server";
import mammoth from "mammoth";
import pdf from "pdf-parse";

import { requireCurrentUserProfile } from "../../../../lib/auth/session";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_CHARS = 12_000; // trim to keep prompt reasonable

async function extractText(buffer: Buffer, filename: string): Promise<string> {
  const lower = filename.toLowerCase().split("?")[0];
  if (lower.endsWith(".docx") || lower.endsWith(".doc")) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  const data = await pdf(buffer);
  return data.text;
}

export async function POST(request: Request) {
  try {
    await requireCurrentUserProfile();

    const formData = await request.formData();
    const files = formData.getAll("files") as File[];

    if (!files.length) {
      return NextResponse.json({ error: "Nenhum arquivo enviado." }, { status: 400 });
    }

    const parts: string[] = [];

    for (const file of files) {
      if (file.size > MAX_BYTES) {
        return NextResponse.json(
          { error: `Arquivo "${file.name}" excede o limite de 10 MB.` },
          { status: 413 },
        );
      }
      const ext = file.name.toLowerCase();
      if (!ext.endsWith(".pdf") && !ext.endsWith(".docx") && !ext.endsWith(".doc")) {
        return NextResponse.json(
          { error: `Formato não suportado: "${file.name}". Use PDF ou DOCX.` },
          { status: 400 },
        );
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const text = await extractText(buffer, file.name);
      if (text.trim()) {
        parts.push(`=== ${file.name} ===\n${text.trim()}`);
      }
    }

    if (!parts.length) {
      return NextResponse.json({ error: "Não foi possível extrair texto dos arquivos enviados." }, { status: 422 });
    }

    let contexto = parts.join("\n\n");
    if (contexto.length > MAX_CHARS) {
      contexto = contexto.slice(0, MAX_CHARS) + "\n[... texto truncado ...]";
    }

    return NextResponse.json({ ok: true, contexto, chars: contexto.length });
  } catch (error) {
    console.error("[introspect-plano-regente]", error);
    return NextResponse.json({ error: "Falha ao processar arquivo." }, { status: 500 });
  }
}
