import "server-only";

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { FieldValue } from "firebase-admin/firestore";

import { getAdminDb } from "../../../../../lib/firebase/admin";
import { downloadFile, uploadFile } from "../../../../../lib/storage/blob";
import {
  appendOrphanField,
  injectAtCell,
  injectPlaceholders,
  reportInjections,
  stripNonSchemaTokens,
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

    const arquivoUrl = typeof data.arquivo_url === "string" ? data.arquivo_url : "";

    const isDocx = /\.(docx|doc)$/i.test(arquivoUrl.split("?")[0]);
    if (!isDocx || !arquivoUrl) {
      await db.collection("magis_templates").doc(id).update({ nome, estado, schema_campos: newSchema });
      return NextResponse.json({ ok: true });
    }

    // ── Immutable Base Pattern ───────────────────────────────────────────────
    // ALWAYS regenerate the fillable from the original (clean, token-free) DOCX.
    //
    // Why: using the previous fillable as base causes three classes of bugs:
    //   1. Ghost variables — tokens from deleted fields survive across saves
    //      because removePlaceholder fails on OOXML-fragmented tokens.
    //   2. Position drift — re-running injectPlaceholders on a document that
    //      already has {{tokens}} may reposition them when the label heuristic
    //      scores a different cell.
    //   3. State accumulation — each save compounds errors from prior saves.
    //
    // With the original as base + stripNonSchemaTokens pre-pass, the fillable
    // is always a pure function of (original DOCX, current schema, current positions).
    // Pre-existing {{tokens}} typed by the user in the original are removed for
    // deleted keys, making ghost variables impossible even for pre-annotated files.
    let buffer = await downloadFile(arquivoUrl);

    // ── Strip tokens not in the new schema ───────────────────────────────────
    // The original DOCX may already contain {{placeholders}} typed by the user.
    // Remove any token whose key is not in newKeys so deleted fields are truly
    // gone even when they were pre-existing in the uploaded file.
    buffer = stripNonSchemaTokens(buffer, newKeys);

    // ── Merge field positions: Firestore (historical) + request (this save) ─
    // field_positions are persisted so manual cell-click placements survive
    // across page reloads and metadata-only saves.
    type FieldPosition = { cellText: string; ordinal: number };
    const stored = (typeof data.field_positions === "object" && data.field_positions !== null)
      ? (data.field_positions as Record<string, FieldPosition>)
      : {};

    const allPositions: Record<string, FieldPosition> = { ...stored };
    for (const [k, v] of Object.entries(fieldPositions)) {
      allPositions[k] = v;                    // new/override from this save
    }
    for (const key of deletedKeys) {
      delete allPositions[key];               // removed field → forget position
    }
    for (const key of Object.keys(allPositions)) {
      if (!newKeys.has(key)) delete allPositions[key]; // stale cleanup
    }

    // 1. Apply all known positions via injectAtCell (most precise — exact cell).
    for (const [key, pos] of Object.entries(allPositions)) {
      if (newKeys.has(key)) {
        buffer = injectAtCell(buffer, pos.cellText, pos.ordinal, key);
      }
    }

    // 2. Label-based injection for any remaining fields without explicit positions.
    buffer = injectPlaceholders(buffer, newSchema);

    // 3. Post-injection validation: report which fields got placed and which didn't
    const { missing: camposSemPlaceholder } = reportInjections(buffer, newSchema);
    if (camposSemPlaceholder.length > 0) {
      console.info(`[templates/schema] Campos sem placeholder automático: ${camposSemPlaceholder.join(", ")}`);
    }

    // 4. Tier 2 orphan fallback: fields still missing AND not in allPositions
    //    → append a labeled row so docxtemplater always has a valid target.
    const positionedKeys = new Set(Object.keys(allPositions));
    for (const key of camposSemPlaceholder) {
      if (positionedKeys.has(key)) continue;
      const field = newSchema.find((f) => f.key === key);
      if (!field) continue;
      buffer = appendOrphanField(buffer, key, field.label);
    }

    // 5. Upload as the new fillable DOCX
    const fillablePath = `templates/${id}/fillable.docx`;
    const newFillableUrl = await uploadFile({
      path: fillablePath,
      buffer,
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    // 6. Update Firestore (persist merged positions + corrections audit log)
    const firestoreUpdate: Record<string, unknown> = {
      nome,
      estado,
      schema_campos: newSchema,
      arquivo_fillable_url: newFillableUrl,
      fillable_status: "pronto",
      field_positions: allPositions,    // source of truth for placement
    };
    if (corrections.length > 0) {
      firestoreUpdate.campo_corrections = FieldValue.arrayUnion(...corrections);
    }
    await db.collection("magis_templates").doc(id).update(firestoreUpdate);

    // Bust Next.js Router Cache so server components re-read fresh Firestore data
    revalidatePath(`/dashboard/templates/${id}`);
    revalidatePath(`/dashboard/templates/${id}/editar`);
    revalidatePath(`/dashboard/templates/${id}/visualizar`);
    revalidatePath(`/dashboard/templates/${id}/confirmar`);

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
