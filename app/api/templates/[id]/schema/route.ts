import "server-only";

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { FieldValue } from "firebase-admin/firestore";

import { getAdminDb } from "../../../../../lib/firebase/admin";
import { deleteFile, downloadFile, uploadFile } from "../../../../../lib/storage/blob";
import {
  extractFieldCoords,
  extractHFFieldCoords,
  getHeaderFooterPlacedKeys,
  injectAtCell,
  injectAtCoord,
  injectAtHFCoord,
  injectRawCell,
  injectPlaceholders,
  isCoordValid,
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
        if (edit.coord.startsWith("HF:")) {
          // Header/footer structural coord — inject directly into the HF XML file.
          // Precise and immune to text-matching ambiguity in header areas.
          const prevBuf = buffer;
          buffer = injectAtHFCoord(buffer, edit.coord, edit.newContent);
          const coordWorked = buffer !== prevBuf;
          console.info(`[schema/cell_edit] hf-coord=${edit.coord} newContent=${edit.newContent.slice(0, 60)} coordWorked=${coordWorked}`);
          // Fallback: text-based (only if cell has text to match, never empty-cell mode)
          if (!coordWorked) {
            const cleanCellText = (edit.cellText ?? "")
              .replace(/\s*\{\{[A-Za-z_][A-Za-z0-9_]*\}\}\s*/g, " ")
              .replace(/\s+/g, " ")
              .trim();
            if (cleanCellText) {
              buffer = injectRawCell(buffer, cleanCellText, edit.ordinal ?? 0, edit.newContent);
              console.info(`[schema/cell_edit] hf-coord-fallback cellText="${cleanCellText.slice(0, 60)}" worked=${buffer !== prevBuf}`);
            }
          }
        } else {
          // Body structural coord (T{ti}R{ri}C{ci}).
          const labelHint = edit.contextBefore ??
            (keysInEdit.length === 1
              ? (newSchema.find((f) => f.key === keysInEdit[0])?.label ?? "")
              : "");
          const contextIsExact = !!edit.contextBefore;
          const prevBuf = buffer;
          buffer = injectAtCoord(buffer, edit.coord, edit.newContent, labelHint, edit.replaceContent, contextIsExact);
          const coordWorked = buffer !== prevBuf;
          console.info(`[schema/cell_edit] coord=${edit.coord} newContent=${edit.newContent.slice(0, 60)} coordWorked=${coordWorked}`);
          // Fallback: text-based injection (guard: only when we have cell text)
          if (!coordWorked && edit.cellText) {
            const cleanCellText = (edit.cellText)
              .replace(/\s*\{\{[A-Za-z_][A-Za-z0-9_]*\}\}\s*/g, " ")
              .replace(/\s+/g, " ")
              .trim();
            if (cleanCellText) {
              const prevBuf2 = buffer;
              buffer = injectRawCell(buffer, cleanCellText, edit.ordinal ?? 0, edit.newContent);
              console.info(`[schema/cell_edit] rawCell cellText="${cleanCellText.slice(0, 60)}" ordinal=${edit.ordinal ?? 0} worked=${buffer !== prevBuf2}`);
            }
          }
        }
      } else {
        const cleanCellText = (edit.cellText ?? "")
          .replace(/\s*\{\{[A-Za-z_][A-Za-z0-9_]*\}\}\s*/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (cleanCellText) {
          // Guard: skip when cleanCellText is empty — injectRawCell empty-cell mode
          // uses the global <w:tc> ordinal from document.xml, which for header-cell
          // placements writes into a random body cell (causing page breaks).
          const prevBuf2 = buffer;
          buffer = injectRawCell(buffer, cleanCellText, edit.ordinal ?? 0, edit.newContent);
          console.info(`[schema/cell_edit] no-coord rawCell cellText="${cleanCellText.slice(0, 60)}" ordinal=${edit.ordinal ?? 0} worked=${buffer !== prevBuf2}`);
        } else {
          console.info(`[schema/cell_edit] skip empty-cellText no-coord keys=${keysInEdit.join(",")}`);
        }
      }
      // Only mark keys as placed if at least one injection actually modified the buffer.
      // If all paths returned the same buffer, the cell was not found. Leaving those
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
          if (pos.coord.startsWith("HF:")) {
            // Header/footer structural coord.
            // • Empty original cell → inject just the chip via HF coord (precise).
            // • Non-empty original cell → use injectRawCell Pass 3 which appends the
            //   token while preserving surrounding text (title + chip side by side).
            //   injectAtHFCoord would wipe the surrounding text with clearAndSetCellText.
            const prevBuf = buffer;
            if (!cleanCellText) {
              buffer = injectAtHFCoord(buffer, pos.coord, `{{${key}}}`);
            } else {
              buffer = injectRawCell(buffer, cleanCellText, pos.ordinal, `{{${key}}}`);
            }
            console.info(`[schema/1b] key=${key} hf-coord=${pos.coord} cleanCellText="${cleanCellText.slice(0, 40)}" changed=${buffer !== prevBuf}`);
          } else {
            // Body structural coord: validate before use to detect stale coords.
            // For empty cleanCellText: validate that the target cell is also empty.
            // Stale coords (from previous empty-cell-mode mis-injections) point to
            // body label/value cells; isCoordValid returns false for those.
            const coordOk = isCoordValid(buffer, pos.coord, cleanCellText);
            const fieldLabel = newSchema.find((f) => f.key === key)?.label ?? "";
            const prevBuf = buffer;
            if (coordOk) {
              buffer = injectAtCoord(buffer, pos.coord, `{{${key}}}`, fieldLabel);
            }
            // Coord invalid/stale OR injectAtCoord found nothing — fall back to text-based.
            // Guard: skip both injectAtCell and injectRawCell when cleanCellText is empty
            // to prevent empty-cell mode from writing into a random body cell.
            if (buffer === prevBuf && cleanCellText) {
              buffer = injectAtCell(buffer, cleanCellText, pos.ordinal, key, hasInlineToken && cleanCellText.length > 0);
              if (buffer === prevBuf) {
                buffer = injectRawCell(buffer, cleanCellText, pos.ordinal, `{{${key}}}`);
              }
            }
            console.info(`[schema/1b] key=${key} coord=${pos.coord} coordOk=${coordOk} changed=${buffer !== prevBuf}`);
          }
        } else {
          const prevBuf = buffer;
          // Guard: only attempt text-based injection when we have cell text.
          // Empty cleanCellText + no coord would trigger injectAtCell/injectRawCell
          // empty-cell mode, which uses the global body <w:tc> ordinal and writes
          // into a wrong body cell — the page-break root cause.
          if (cleanCellText) {
            buffer = injectAtCell(buffer, cleanCellText, pos.ordinal, key, hasInlineToken && cleanCellText.length > 0);
            if (buffer === prevBuf) {
              buffer = injectRawCell(buffer, cleanCellText, pos.ordinal, `{{${key}}}`);
            }
          }
          console.info(`[schema/1b] key=${key} no-coord changed=${buffer !== prevBuf}`);
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
    // Exclude keys already placed in header/footer files: injectPlaceholders only
    // checks document.xml for idempotency, so it would re-inject those keys into
    // the body, creating duplicate chips (one in header, one in body).
    const hfPlaced = getHeaderFooterPlacedKeys(buffer, autoPlaceKeys);
    const schemaForAutoPlace = newSchema.filter((f) => autoPlaceKeys.has(f.key) && !hfPlaced.has(f.key));
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
    // Includes both body coords (T{ti}R{ri}C{ci}) from document.xml and HF coords
    // (HF:{n}) from header/footer files. On the next save the stored coord is used
    // for direct injection, bypassing fragile text matching.
    const extractedCoords = { ...extractFieldCoords(buffer), ...extractHFFieldCoords(buffer) };
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
