import "server-only";

import { NextResponse } from "next/server";

import { FieldValue } from "firebase-admin/firestore";

import { getAdminDb } from "../../../../../lib/firebase/admin";
import { downloadFile, uploadFile } from "../../../../../lib/storage/blob";
import {
  injectAtCell,
  injectPlaceholders,
  removePlaceholder,
  reportInjections,
} from "../../../../../lib/utils/docx-filler";
import { requireCurrentUserProfile } from "../../../../../lib/auth/session";
import type { TemplateFieldSchema } from "../../../../../lib/types/firestore";

interface FieldPosition {
  cellText: string;
  ordinal: number;
}

interface SchemaBody {
  nome?: string;
  estado?: string | null;
  schema_campos?: TemplateFieldSchema[];
  field_positions?: Record<string, FieldPosition>;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    let user: Awaited<ReturnType<typeof requireCurrentUserProfile>>;
    try {
      user = await requireCurrentUserProfile();
    } catch {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }
    const { id } = await params;

    const db = getAdminDb();
    const snap = await db.collection("magis_templates").doc(id).get();

    if (!snap.exists) {
      return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
    }

    const data = snap.data()!;
    if (data.user_id !== user.uid) {
      return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
    }

    const body = (await request.json()) as SchemaBody;
    const newSchema: TemplateFieldSchema[] = Array.isArray(body.schema_campos)
      ? body.schema_campos
      : (Array.isArray(data.schema_campos) ? data.schema_campos : []);
    const nome: string = typeof body.nome === "string" && body.nome.trim()
      ? body.nome.trim()
      : (typeof data.nome === "string" ? data.nome : "Template");
    const estado: string | null = body.estado !== undefined
      ? (body.estado || null)
      : (typeof data.estado === "string" ? data.estado : null);
    const fieldPositions: Record<string, FieldPosition> = body.field_positions ?? {};

    // Identify deleted keys (were in old schema, not in new)
    const oldSchema: TemplateFieldSchema[] = Array.isArray(data.schema_campos)
      ? (data.schema_campos as TemplateFieldSchema[])
      : [];
    const oldKeys = new Set<string>(oldSchema.map((f) => f.key));
    const newKeys = new Set(newSchema.map((f) => f.key));
    const deletedKeys = [...oldKeys].filter((k) => !newKeys.has(k));

    // Item 1: detect key renames (same label, different key) → log as corrections
    const oldLabelToKey = new Map(oldSchema.map((f) => [f.label, f.key]));
    const corrections: { label: string; extracted_key: string; correct_key: string }[] = [];
    for (const f of newSchema) {
      const prevKey = oldLabelToKey.get(f.label);
      if (prevKey && prevKey !== f.key && !newKeys.has(prevKey)) {
        corrections.push({ label: f.label, extracted_key: prevKey, correct_key: f.key });
      }
    }

    // Download current DOCX (fillable if available, else original)
    const arquivoUrl = typeof data.arquivo_url === "string" ? data.arquivo_url : "";
    const fillableUrl = typeof data.arquivo_fillable_url === "string" ? data.arquivo_fillable_url : "";

    const isDocx = /\.(docx|doc)$/i.test(arquivoUrl.split("?")[0]);
    if (!isDocx || !arquivoUrl) {
      // Non-DOCX template: just update Firestore schema
      await db.collection("magis_templates").doc(id).update({ nome, estado, schema_campos: newSchema });
      return NextResponse.json({ ok: true });
    }

    // Use fillable as base if it exists; otherwise use original
    const sourceUrl = fillableUrl || arquivoUrl;
    let buffer = await downloadFile(sourceUrl);

    // 1. Remove placeholders for deleted fields
    for (const key of deletedKeys) {
      buffer = removePlaceholder(buffer, key);
    }

    // 2. Direct injection at clicked positions (for newly added fields)
    for (const [key, pos] of Object.entries(fieldPositions)) {
      if (newKeys.has(key) && pos.cellText.trim()) {
        buffer = injectAtCell(buffer, pos.cellText, pos.ordinal, key);
      }
    }

    // 3. Label-based injection for any remaining fields without placeholders
    buffer = injectPlaceholders(buffer, newSchema);

    // 4. Post-injection validation: report which fields got placed and which didn't
    const { missing: camposSemPlaceholder } = reportInjections(buffer, newSchema);
    if (camposSemPlaceholder.length > 0) {
      console.info(`[templates/schema] Campos sem placeholder automático: ${camposSemPlaceholder.join(", ")}`);
    }

    // 5. Upload as the new fillable DOCX
    const fillablePath = `templates/${id}/fillable.docx`;
    const newFillableUrl = await uploadFile({
      path: fillablePath,
      buffer,
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    // 6. Update Firestore (include corrections if any were detected)
    const firestoreUpdate: Record<string, unknown> = {
      nome,
      estado,
      schema_campos: newSchema,
      arquivo_fillable_url: newFillableUrl,
      fillable_status: "pronto",
    };
    if (corrections.length > 0) {
      firestoreUpdate.campo_corrections = FieldValue.arrayUnion(...corrections);
    }
    await db.collection("magis_templates").doc(id).update(firestoreUpdate);

    return NextResponse.json({
      ok: true,
      arquivo_fillable_url: newFillableUrl,
      campos_sem_placeholder: camposSemPlaceholder,
    });
  } catch (error) {
    console.error("[templates/schema] Erro:", error);
    return NextResponse.json(
      { error: "Falha ao salvar schema do template." },
      { status: 500 },
    );
  }
}
