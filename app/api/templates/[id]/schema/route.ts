import "server-only";

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { FieldValue } from "firebase-admin/firestore";

import { getAdminDb } from "../../../../../lib/firebase/admin";
import { deleteFile, downloadFile, uploadFile } from "../../../../../lib/storage/blob";
import {
  extractFieldCoords,
  injectAtCell,
  injectAtCoord,
  injectRawCell,
  injectPlaceholders,
  reportInjections,
  stripNonSchemaTokens,
} from "../../../../../lib/utils/docx-filler";
import { requireCurrentUserProfile } from "../../../../../lib/auth/session";
import type { TemplateFieldSchema } from "../../../../../lib/types/firestore";

interface FieldPosition {
  cellText: string;
  ordinal: number;
  coord?: string;  // "T{ti}R{ri}C{ci}" — preferred over text/ordinal
}

interface CellEdit {
  cellText: string;       // original cell text (stripped of {{key}} chips by client)
  ordinal: number;
  newContent: string;     // full edited cell text with all {{key}} tokens
  coord?: string;         // "T{ti}R{ri}C{ci}" — preferred injection path
  contextBefore?: string; // text on the same visual line immediately before {{key}} — injection anchor
  replaceContent?: boolean; // true → clear existing cell text before injecting (user deleted all text)
}

interface SchemaBody {
  nome?: string;
  estado?: string | null;
  tipo_plano?: string | null;
  metadata_padrao?: Record<string, string> | null;
  schema_campos?: TemplateFieldSchema[];
  field_positions?: Record<string, FieldPosition>;
  cell_edits?: CellEdit[];
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
    const tipo_plano: string | null = body.tipo_plano !== undefined
      ? (body.tipo_plano || null)
      : (typeof data.tipo_plano === "string" ? data.tipo_plano : null);
    const metadata_padrao: Record<string, string> = body.metadata_padrao !== undefined
      ? {
          ...(typeof data.metadata_padrao === "object" && data.metadata_padrao !== null
            ? (data.metadata_padrao as Record<string, string>)
            : {}),
          ...(body.metadata_padrao ?? {}),
        }
      : (typeof data.metadata_padrao === "object" && data.metadata_padrao !== null
          ? (data.metadata_padrao as Record<string, string>)
          : {});
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
      await db.collection("magis_templates").doc(id).update({
        nome, estado, tipo_plano, metadata_padrao, schema_campos: newSchema,
      });
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

    // ── cell_edits must be parsed BEFORE stripNonSchemaTokens ────────────────
    // When the user moves a chip from cell A to cell B in the editor, the original
    // DOCX may still have {{key}} at cell A (pre-annotated file). stripNonSchemaTokens
    // would keep it (key is still in newKeys) — so the token would survive in A AND
    // get re-injected in B, causing duplication. Fix: strip repositioned keys from
    // the original as well, by passing (newKeys − repositionedKeys) to the strip pass.
    // After stripping, cell_edits inject them at the correct new locations.
    const cellEditsPayload: CellEdit[] = Array.isArray(body.cell_edits) ? body.cell_edits : [];
    const repositionedKeys = new Set<string>(
      cellEditsPayload.flatMap((edit) =>
        [...(edit.newContent ?? "").matchAll(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g)].map((m) => m[1]),
      ),
    );
    const validBeforeCellEdits = new Set([...newKeys].filter((k) => !repositionedKeys.has(k)));

    // ── Strip tokens not in the new schema ───────────────────────────────────
    // The original DOCX may already contain {{placeholders}} typed by the user.
    // Remove any token whose key is not in newKeys so deleted fields are truly
    // gone even when they were pre-existing in the uploaded file.
    // validBeforeCellEdits excludes repositioned keys so they are stripped from their
    // old positions before cell_edits injects them at the new positions.
    buffer = stripNonSchemaTokens(buffer, validBeforeCellEdits);

    // ── Merge field positions: Firestore (historical) + request (this save) ─
    // field_positions are persisted so manual cell-click placements survive
    // across page reloads and metadata-only saves.
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
    // Invalidate historical positions for keys being repositioned by cell_edits.
    // Without this, when injectAtCoord fails (wrong coord from a stale save), the
    // key is NOT added to placedByCellEdits and step 1b falls back to the old
    // Firestore coord — ghost-injecting the field at the previous location instead
    // of the new one the user chose. Removing here means a failed reposition simply
    // leaves the field unplaced (logged in camposSemPlaceholder) rather than reverting
    // it silently to the old position.
    for (const key of repositionedKeys) {
      delete allPositions[key];
    }

    // 1a. Apply verbatim cell-content overrides from the interactive editor.
    // Coord path (preferred): uses structural coordinates — immune to text-match
    // ambiguity and header/footer index offsets.
    // Text path (fallback): matches by normalised cell text + occurrence ordinal.
    const placedByCellEdits = new Set<string>();
    for (const edit of cellEditsPayload) {
      if (!edit.newContent?.trim()) continue;
      const keysInEdit = [...edit.newContent.matchAll(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g)].map((m) => m[1]);
      const prevBufBeforeEdit = buffer;
      if (edit.coord) {
        // contextBefore (text on the same line before {{key}} in the DOM) is a more
        // precise anchor than the field label: it matches exactly the segment where
        // the user typed. Fall back to field label for placement-mode clicks (no context).
        const labelHint = edit.contextBefore ??
          (keysInEdit.length === 1
            ? (newSchema.find((f) => f.key === keysInEdit[0])?.label ?? "")
            : "");
        // contextIsExact=true when labelHint comes from the user's DOM context (contextBefore),
        // meaning the chip is placed right after that text — override ALL CAPS heuristics.
        const contextIsExact = !!edit.contextBefore;
        const prevBuf = buffer;
        buffer = injectAtCoord(buffer, edit.coord, edit.newContent, labelHint, edit.replaceContent, contextIsExact);
        const coordWorked = buffer !== prevBuf;
        console.info(`[schema/cell_edit] coord=${edit.coord} newContent=${edit.newContent.slice(0, 60)} coordWorked=${coordWorked}`);
        // If coord lookup failed (returned same buffer), fall back to text-based injection
        if (!coordWorked && edit.cellText) {
          const cleanCellText = (edit.cellText)
            .replace(/\s*\{\{[A-Za-z_][A-Za-z0-9_]*\}\}\s*/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          const prevBuf2 = buffer;
          buffer = injectRawCell(buffer, cleanCellText, edit.ordinal ?? 0, edit.newContent);
          console.info(`[schema/cell_edit] rawCell cellText="${cleanCellText.slice(0, 60)}" ordinal=${edit.ordinal ?? 0} worked=${buffer !== prevBuf2}`);
        }
      } else {
        const cleanCellText = (edit.cellText ?? "")
          .replace(/\s*\{\{[A-Za-z_][A-Za-z0-9_]*\}\}\s*/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const prevBuf2 = buffer;
        buffer = injectRawCell(buffer, cleanCellText, edit.ordinal ?? 0, edit.newContent);
        console.info(`[schema/cell_edit] no-coord rawCell cellText="${cleanCellText.slice(0, 60)}" ordinal=${edit.ordinal ?? 0} worked=${buffer !== prevBuf2}`);
      }
      // Only mark keys as placed if at least one injection actually modified the buffer.
      // If both injectAtCoord and injectRawCell returned the same buffer, the cell was
      // not found (e.g. it lives in a header file or normText collision). Leaving those
      // keys out of placedByCellEdits lets injectPlaceholders attempt them as a fallback.
      if (buffer !== prevBufBeforeEdit) {
        for (const k of keysInEdit) placedByCellEdits.add(k);
      }
    }

    // 1b. Apply all known positions via injectAtCoord (coord) or injectAtCell (text fallback).
    // Coord path avoids text-matching entirely — the structural position is stable.
    // Text path: strip {{key}} chips from stored cellText so it matches the original DOCX.
    for (const [key, pos] of Object.entries(allPositions)) {
      if (newKeys.has(key) && !placedByCellEdits.has(key)) {
        const phToken = `{{${key}}}`;
        const hasInlineToken = pos.cellText.includes(phToken);
        const cleanCellText = pos.cellText
          .replace(/\s*\{\{[A-Za-z_][A-Za-z0-9_]*\}\}\s*/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (pos.coord) {
          const fieldLabel = newSchema.find((f) => f.key === key)?.label ?? "";
          const prevBuf = buffer;
          buffer = injectAtCoord(buffer, pos.coord, `{{${key}}}`, fieldLabel);
          // Coord lookup failed — fall back to text-based injection
          if (buffer === prevBuf) {
            buffer = injectAtCell(buffer, cleanCellText, pos.ordinal, key, hasInlineToken && cleanCellText.length > 0);
          }
        } else {
          const prevBuf = buffer;
          buffer = injectAtCell(buffer, cleanCellText, pos.ordinal, key, hasInlineToken && cleanCellText.length > 0);
          // injectAtCell only searches document.xml — if the cell lives in a header/footer
          // file, fall back to injectRawCell which has a Pass 3 for those files.
          if (buffer === prevBuf && cleanCellText) {
            buffer = injectRawCell(buffer, cleanCellText, pos.ordinal, `{{${key}}}`);
          }
        }
      }
    }

    // 2. Label-based injection for fields with structural context.
    // Manually-added fields (no injection_pattern, no ai_confidence, no stored position)
    // are excluded here — they are simply skipped if no placement exists yet.
    const autoPlaceKeys = new Set<string>([
      ...placedByCellEdits,
      ...Object.keys(allPositions),
      ...newSchema
        .filter((f) => f.injection_pattern !== undefined || f.ai_confidence !== undefined)
        .map((f) => f.key),
    ]);
    const schemaForAutoPlace = newSchema.filter((f) => autoPlaceKeys.has(f.key));
    buffer = injectPlaceholders(buffer, schemaForAutoPlace);

    // 3. Post-injection validation: report which fields got placed and which didn't
    const { missing: camposSemPlaceholder } = reportInjections(buffer, newSchema);
    if (camposSemPlaceholder.length > 0) {
      console.info(`[templates/schema] Campos sem placeholder automático: ${camposSemPlaceholder.join(", ")}`);
    }

    // 4. Upload as the new fillable DOCX.
    // Use a timestamped path so each save produces a unique URL — this eliminates
    // any CDN/storage propagation delay that could serve stale content when the
    // preview re-fetches immediately after the overwrite.
    const oldFillableUrl = typeof data.arquivo_fillable_url === "string" ? data.arquivo_fillable_url : "";
    const fillablePath = `templates/${id}/fillable_${Date.now()}.docx`;
    const newFillableUrl = await uploadFile({
      path: fillablePath,
      buffer,
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    // Delete the previous fillable (best-effort — stale storage is non-critical)
    if (oldFillableUrl && oldFillableUrl !== newFillableUrl) {
      void deleteFile(oldFillableUrl).catch(() => {/* non-fatal */});
    }

    // 5b. Extract structural coords from the final DOCX and merge into allPositions.
    // This ensures every {{key}} — including those placed by injectPlaceholders
    // (auto-detection) — gets a coord stored in Firestore. On the next save the
    // injectAtCoord path will be used instead of fragile text matching.
    const extractedCoords = extractFieldCoords(buffer);
    for (const [key, coord] of Object.entries(extractedCoords)) {
      if (allPositions[key]) {
        allPositions[key] = { ...allPositions[key], coord };
      } else {
        // Field was placed by injectPlaceholders — create a position entry with coord only
        allPositions[key] = { cellText: "", ordinal: 0, coord };
      }
    }

    // 6. Update Firestore (persist merged positions + corrections audit log)
    const firestoreUpdate: Record<string, unknown> = {
      nome,
      estado,
      tipo_plano,
      metadata_padrao,
      schema_campos: newSchema,
      arquivo_fillable_url: newFillableUrl,
      fillable_status: "pronto",
      field_positions: allPositions,    // source of truth for placement, now includes coords
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
    revalidatePath("/dashboard/gerar");

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
