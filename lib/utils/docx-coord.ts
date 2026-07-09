/**
 * docx-coord — browser-side utility
 *
 * Assigns structural XML coordinates to DOM <td> elements rendered by
 * docx-preview so that cell edits can be routed back to the exact
 * <w:tc> in word/document.xml regardless of header/footer offsets or
 * vMerge continuation cells that exist in XML but are hidden in the DOM.
 *
 * Coordinate format: "T{tableIndex}R{rowIndex}C{cellIndex}"
 * All indices are 0-based and refer to positions inside word/document.xml.
 *
 * Algorithm per table:
 *   for each XML row i:
 *     xmlCi = 0, domCi = 0
 *     for each XML cell in row i:
 *       if vMerge continuation → xmlCi++, skip (no DOM counterpart)
 *       else → assign coord T{ti}R{i}C{xmlCi} to DOM cell domCi; xmlCi++, domCi++
 */

const VMERGE_CONT_RE = /<w:vMerge(?:\s[^>]*)?\/?>/;
const VMERGE_RESTART_RE = /w:val="restart"/;

function isVMergeContinuation(tcXml: string): boolean {
  const m = tcXml.match(VMERGE_CONT_RE);
  if (!m) return false;
  return !VMERGE_RESTART_RE.test(m[0]);
}

function parseTables(docXml: string): string[][] {
  // tables[ti] = array of row XML strings
  const tables: string[][] = [];
  for (const tblM of docXml.matchAll(/<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/g)) {
    const rows: string[] = [];
    for (const trM of tblM[0].matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)) {
      rows.push(trM[0]);
    }
    tables.push(rows);
  }
  return tables;
}

function parseCells(rowXml: string): string[] {
  return [...rowXml.matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)].map((m) => m[0]);
}

/** Returns DOM tables that are NOT inside a <header> or <footer> element. */
function mainDocumentTables(container: HTMLElement): HTMLTableElement[] {
  return (Array.from(container.querySelectorAll("table")) as HTMLTableElement[]).filter(
    (t) => !t.closest("header") && !t.closest("footer"),
  );
}

/** Returns the direct rows of a DOM table (handles optional <tbody>). */
function domRows(table: HTMLTableElement): HTMLTableRowElement[] {
  return Array.from(table.rows) as HTMLTableRowElement[];
}

/**
 * Assigns `data-hf-coord="HF:{n}"` to header/footer table cells in the DOM.
 *
 * n is a sequential 0-based index across all cells in all header/footer XML
 * files (sorted alphabetically), matching the order scanned by injectAtHFCoord
 * and extractHFFieldCoords. This enables precise server-side injection into
 * header/footer cells without text-matching (which is fragile for header cells
 * that often contain all-caps labels with no distinguishing adjacent text).
 *
 * Must be called after docx-preview has finished rendering.
 */
export function assignHFCellCoords(container: HTMLElement): void {
  const domHfCells = Array.from(
    container.querySelectorAll("header td, footer td"),
  ) as HTMLElement[];
  domHfCells.forEach((td, i) => td.setAttribute("data-hf-coord", `HF:${i}`));
}

/**
 * Parses the DOCX buffer, extracts table/row/cell structure from
 * word/document.xml, and assigns `data-xml-coord` attributes to the
 * matching DOM <td>/<th> elements inside `container`.
 *
 * Must be called after docx-preview has finished rendering.
 */
export async function assignDocxCellCoords(
  buffer: ArrayBuffer,
  container: HTMLElement,
): Promise<void> {
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buffer);

    const docFile = zip.files["word/document.xml"];
    if (!docFile) return;

    const docXml = await docFile.async("string");
    const xmlTables = parseTables(docXml);
    const domTableEls = mainDocumentTables(container);

    const tableCount = Math.min(xmlTables.length, domTableEls.length);

    for (let ti = 0; ti < tableCount; ti++) {
      const xmlRows = xmlTables[ti];
      const domRowEls = domRows(domTableEls[ti]);

      // Match XML row i ↔ DOM row i (row count should be equal or close)
      const rowCount = Math.min(xmlRows.length, domRowEls.length);

      for (let ri = 0; ri < rowCount; ri++) {
        const xmlCells = parseCells(xmlRows[ri]);
        const domCells = Array.from(domRowEls[ri].cells) as HTMLTableCellElement[];

        let domCi = 0;
        for (let xmlCi = 0; xmlCi < xmlCells.length; xmlCi++) {
          if (isVMergeContinuation(xmlCells[xmlCi])) {
            // No DOM counterpart — increment only the XML index
            continue;
          }
          const domCell = domCells[domCi];
          if (domCell) {
            domCell.setAttribute("data-xml-coord", `T${ti}R${ri}C${xmlCi}`);
          }
          domCi++;
        }
      }
    }
  } catch {
    // Non-fatal — editor falls back to text/ordinal matching
  }
}
