import "server-only";

import { NextResponse } from "next/server";
import mammoth from "mammoth";

import { getAdminDb } from "../../../../../lib/firebase/admin";
import { downloadFile } from "../../../../../lib/storage/blob";
import type { TemplateFieldSchema, TemplateRecord } from "../../../../../lib/types/firestore";

function normText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textFromHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// Finds schema field value cells in mammoth HTML and annotates them with data-field-key.
// Handles both 2-column rows (label | value) and single-column header + value row below.
function annotateFields(html: string, schema: TemplateFieldSchema[]): string {
  // Collect all <td> elements with position and text
  const tdRegex = /<td([^>]*)>([\s\S]*?)<\/td>/gi;
  const tds: {
    fullMatch: string;
    index: number;
    attrs: string;
    inner: string;
    text: string;
  }[] = [];

  let m: RegExpExecArray | null;
  tdRegex.lastIndex = 0;
  while ((m = tdRegex.exec(html)) !== null) {
    tds.push({
      fullMatch: m[0],
      index: m.index,
      attrs: m[1],
      inner: m[2],
      text: normText(textFromHtml(m[2])),
    });
  }

  // Map: td-index → field (the cell at that index becomes the editable value cell)
  const valueMap = new Map<number, TemplateFieldSchema>();
  const usedAsLabel = new Set<number>();

  for (const field of schema) {
    const labelNorm = normText(field.label);
    if (!labelNorm || labelNorm.length < 2) continue;
    const labelWords = labelNorm.split(/\s+/).filter((w) => w.length > 2);
    if (labelWords.length === 0) continue;

    let bestIdx = -1;
    let bestScore = 0;

    for (let i = 0; i < tds.length; i++) {
      if (usedAsLabel.has(i)) continue;
      const td = tds[i];
      // Label cells are short; skip long content cells (they're values)
      if (td.text.length > 90) continue;
      if (!td.text) continue;

      const matched = labelWords.filter((w) => td.text.includes(w)).length;
      const score = matched / labelWords.length;
      if (score > bestScore && score >= 0.5) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx < 0) continue;
    usedAsLabel.add(bestIdx);

    // Next td is the value cell
    const nextIdx = bestIdx + 1;
    if (nextIdx < tds.length && !valueMap.has(nextIdx) && !usedAsLabel.has(nextIdx)) {
      valueMap.set(nextIdx, field);
    }
  }

  // Apply annotations from end to start (preserves positions)
  const replacements = [...valueMap.entries()]
    .map(([idx, field]) => ({
      index: tds[idx].index,
      len: tds[idx].fullMatch.length,
      replacement: `<td${tds[idx].attrs} data-field-key="${field.key}" data-field-label="${field.label}" data-field-role="${field.role ?? ""}">${tds[idx].inner}</td>`,
    }))
    .sort((a, b) => b.index - a.index);

  let result = html;
  for (const { index, len, replacement } of replacements) {
    result = result.slice(0, index) + replacement + result.slice(index + len);
  }

  return result;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const db = getAdminDb();
    const snap = await db.collection("templates").doc(id).get();
    if (!snap.exists) {
      return NextResponse.json({ html: null, reason: "not_found" }, { status: 404 });
    }

    const template = snap.data() as TemplateRecord;
    const arquivoUrl = template.arquivo_url ?? "";
    const ext = arquivoUrl.split(".").pop()?.toLowerCase() ?? "";

    if ((ext !== "docx" && ext !== "doc") || !arquivoUrl) {
      return NextResponse.json({ html: null, reason: "not_docx" });
    }

    const schema: TemplateFieldSchema[] = Array.isArray(template.schema_campos)
      ? template.schema_campos
      : [];

    const buf = await downloadFile(arquivoUrl);
    const { value: rawHtml } = await mammoth.convertToHtml(
      { buffer: buf },
      {
        styleMap: [
          "b => strong",
          "i => em",
          "u => u",
          "strike => s",
          "p[style-name='Heading 1'] => h1:fresh",
          "p[style-name='Heading 2'] => h2:fresh",
          "p[style-name='Heading 3'] => h3:fresh",
          "p[style-name='Title'] => h1:fresh",
          "p[style-name='Subtitle'] => h2:fresh",
          "p[style-name='Normal'] => p:fresh",
        ],
        includeDefaultStyleMap: true,
      },
    );

    const annotated = annotateFields(rawHtml, schema);

    return NextResponse.json({ html: annotated });
  } catch (err) {
    console.error("[PlanoMagistra/editor-html]", err);
    return NextResponse.json({ html: null, reason: "error" }, { status: 500 });
  }
}
