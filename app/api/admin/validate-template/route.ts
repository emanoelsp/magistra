import "server-only";

import { NextResponse } from "next/server";
import PizZip from "pizzip";

import { getCurrentSession as getSession } from "../../../../lib/auth/session";
import {
  scanDocxStructure,
  injectPlaceholders,
  scanPlaceholders,
} from "../../../../lib/utils/docx-filler";
import type { TemplateFieldSchema } from "../../../../lib/types/firestore";

function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase());
  return admins.includes(email.toLowerCase());
}

// ── Key derivation ────────────────────────────────────────────────────────────

function labelToKey(label: string, index: number): string {
  const derived = label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return derived || `campo_${index}`;
}

// ── Lint helpers ─────────────────────────────────────────────────────────────

/** Extracts plain text by joining all <w:t> content across run boundaries. */
function projectedText(xml: string): string {
  return (xml.match(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g) ?? [])
    .map((m) => m.replace(/<[^>]+>/g, ""))
    .join("");
}

/**
 * Scans for single-brace patterns `{key}` that are NOT part of `{{key}}`.
 * These are docxtemplater syntax errors (user forgot to double the braces).
 */
function findMalformedTags(xml: string): string[] {
  const found = new Set<string>();
  const re = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    // Skip if the preceding or following character is also a brace (part of {{...}})
    const pre  = xml[m.index - 1];
    const post = xml[m.index + m[0].length];
    if (pre === "{" || post === "}") continue;
    found.add(m[1]);
  }
  return [...found];
}

/**
 * Detects placeholders that appear in the projected (run-joined) text but NOT
 * in the raw XML. These are tokens fragmented across multiple <w:r> run nodes
 * by Word's spell-check or partial formatting — invisible to simple indexOf.
 */
function findFragmentedTokens(xml: string): string[] {
  const rawSet = new Set(
    [...xml.matchAll(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g)].map((m) => m[1]),
  );
  const projected = projectedText(xml);
  const projSet = new Set(
    [...projected.matchAll(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g)].map((m) => m[1]),
  );
  return [...projSet].filter((k) => !rawSet.has(k));
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  // Admin-only guard
  const session = await getSession();
  if (!isAdmin(session?.email)) {
    return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("docx");

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: "Campo 'docx' obrigatório (multipart/form-data)." },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // ── Step 1: Validate ZIP / OOXML structure ────────────────────────────
    let xml: string;
    try {
      const zip = new PizZip(buffer);
      xml = zip.files["word/document.xml"]?.asText() ?? "";
      if (!xml) {
        return NextResponse.json(
          { error: "DOCX inválido: word/document.xml não encontrado." },
          { status: 422 },
        );
      }
    } catch {
      return NextResponse.json(
        { error: "Arquivo inválido — não é um ZIP/DOCX bem formado." },
        { status: 422 },
      );
    }

    // ── Step 2: Pre-existing placeholders (user may have pre-annotated) ───
    const preExisting = scanPlaceholders(buffer);

    // ── Step 3: Structural scan — what the parser sees ────────────────────
    const pairs = scanDocxStructure(buffer);

    // ── Step 4: Build a synthetic schema from detected pairs ──────────────
    const syntheticSchema: TemplateFieldSchema[] = pairs.map((pair, i) => ({
      key:    labelToKey(pair.label, i),
      label:  pair.label,
      type:   "text" as const,
      required: false,
      role:   "manual" as const,
      group:  "dados_turma" as const,
    }));

    // ── Step 5: Simulate injection ────────────────────────────────────────
    let injected: string[] = [];
    let missing: Array<{ key: string; label: string; pattern: string }> = [];
    let injectionError: string | null = null;

    try {
      const injectedBuffer = injectPlaceholders(buffer, syntheticSchema);
      const afterKeys = new Set(scanPlaceholders(injectedBuffer));
      injected = syntheticSchema.map((f) => f.key).filter((k) => afterKeys.has(k));
      missing  = syntheticSchema
        .filter((f) => !afterKeys.has(f.key))
        .map((f) => ({
          key:     f.key,
          label:   f.label,
          pattern: pairs.find((p) => labelToKey(p.label, 0) === f.key || p.label === f.label)?.pattern ?? "unknown",
        }));
    } catch (err) {
      injectionError = err instanceof Error ? err.message : String(err);
      missing = syntheticSchema.map((f) => ({
        key:     f.key,
        label:   f.label,
        pattern: "unknown",
      }));
    }

    // ── Step 6: Lint checks ───────────────────────────────────────────────
    const malformed   = findMalformedTags(xml);
    const fragmented  = findFragmentedTokens(xml);

    // Duplicate key detection in the synthetic schema
    const keyCounts = new Map<string, number>();
    for (const f of syntheticSchema) keyCounts.set(f.key, (keyCounts.get(f.key) ?? 0) + 1);
    const duplicateKeys = [...keyCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([key]) => key);

    // ── Step 7: Structured lint report ───────────────────────────────────
    return NextResponse.json({
      status: injectionError ? "error" : missing.length === 0 ? "ok" : "partial",
      summary: {
        pairs_detected:             pairs.length,
        injected_count:             injected.length,
        missing_count:              missing.length,
        pre_existing_placeholders:  preExisting.length,
        malformed_tags:             malformed.length,
        fragmented_tokens:          fragmented.length,
        duplicate_keys:             duplicateKeys.length,
      },
      // What the structural scanner found
      pairs,
      // Successfully injected field keys
      injected,
      // Fields that could not be auto-placed (need manual positioning)
      missing,
      // Placeholders already present in the template before injection
      pre_existing: preExisting,
      // Single-brace tags {key} — likely docxtemplater syntax errors
      malformed,
      // Tokens split across Word run nodes (OOXML fragmentation)
      fragmented,
      // Keys that collide after label→key normalization
      duplicate_keys: duplicateKeys,
      // Non-null only if injectPlaceholders threw
      injection_error: injectionError,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:  "Falha ao processar o arquivo.",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
