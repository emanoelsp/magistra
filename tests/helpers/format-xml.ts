/**
 * Formats OOXML into indented lines so Vitest snapshot diffs show exactly
 * which <w:t> or <w:tc> changed — not a 50 000-char red line.
 */
export function formatXmlForSnapshot(xml: string): string {
  const lined = xml.replace(/>\s*</g, ">\n<");
  let depth = 0;
  return lined
    .split("\n")
    .map((raw) => {
      const line = raw.trim();
      if (!line) return null;

      // Closing tag: dedent before printing
      if (line.startsWith("</")) {
        depth = Math.max(0, depth - 1);
        return "  ".repeat(depth) + line;
      }

      const out = "  ".repeat(depth) + line;

      // Opening tag (not declaration, not self-closing, not already closed inline)
      if (
        line.startsWith("<") &&
        !line.startsWith("<?") &&
        !line.startsWith("<!") &&
        !line.endsWith("/>") &&
        !line.includes("</")
      ) {
        depth++;
      }

      return out;
    })
    .filter((l): l is string => l !== null)
    .join("\n");
}
