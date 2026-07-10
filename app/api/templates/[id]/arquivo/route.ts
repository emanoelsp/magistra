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
    const wantFresh = searchParams.get("fresh") === "1"; // regenerate from original every time

    const db = getAdminDb();
    const snap = await db.collection("magis_templates").doc(id).get();

    if (!snap.exists) {
      return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
    }

    const template = snap.data() as TemplateRecord;

    // fresh=1: return the DOCX with {{tokens}} in place.
    // If a fillable DOCX exists (user has already positioned variables via the editor),
    // return it directly — re-running injectPlaceholders on the original would discard
    // all manual cell positioning stored in arquivo_fillable_url.
    // Only fall back to regenerating from the original when no fillable exists yet.
    if (wantFresh && template.arquivo_url) {
      const isDocx = /\.(docx|doc)(\?|$)/i.test(template.arquivo_url);
      const schema = Array.isArray(template.schema_campos) ? template.schema_campos : [];
      if (isDocx && schema.length > 0) {
        // Fail-explicit: nunca degradar para o original em silêncio. Servir o
        // docx SEM chips faria o professor concluir que as edições sumiram;
        // o erro 502 deixa o client mostrar o estado de erro com retry.
        try {
          const fillableUrl = typeof template.arquivo_fillable_url === "string"
            ? template.arquivo_fillable_url
            : "";
          if (fillableUrl) {
            // Blob salvo e verificado pós-save — a mesma fonte que a geração de
            // plano consome. É o que o Visualizar deve mostrar.
            const fillableBuffer = await downloadFile(fillableUrl);
            return new NextResponse(new Uint8Array(fillableBuffer), {
              headers: {
                "Content-Type": DOCX_CT,
                "Content-Disposition": `attachment; filename="template-fresh-${id.slice(0, 8)}.docx"`,
                "Cache-Control": "private, no-store",
              },
            });
          }
          // Bootstrap: template ainda sem fillable salvo — gera just-in-time.
          const { injectPlaceholders } = await import("../../../../../lib/utils/docx-filler");
          const rawBuffer = await downloadFile(template.arquivo_url);
          const freshBuffer = injectPlaceholders(rawBuffer, schema);
          return new NextResponse(new Uint8Array(freshBuffer), {
            headers: {
              "Content-Type": DOCX_CT,
              "Content-Disposition": `attachment; filename="template-fresh-${id.slice(0, 8)}.docx"`,
              "Cache-Control": "private, no-store",
            },
          });
        } catch (e) {
          console.error("[arquivo] fresh: falha ao servir fillable:", e);
          return NextResponse.json(
            { error: "Não foi possível carregar o documento preparado. Tente novamente." },
            { status: 502 },
          );
        }
      }
    }

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
