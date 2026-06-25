import PizZip from "pizzip";

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const WORD_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;

/** Wraps a word/document.xml string in a minimal valid DOCX zip. */
export function makeDocx(documentXml: string): Buffer {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", RELS);
  zip.file("word/_rels/document.xml.rels", WORD_RELS);
  zip.file("word/document.xml", documentXml);
  return Buffer.from(zip.generate({ type: "nodebuffer" }));
}

/** Extracts word/document.xml text from a DOCX buffer. */
export function extractDocumentXml(docxBuffer: Buffer): string {
  const zip = new PizZip(docxBuffer);
  const entry = zip.files["word/document.xml"];
  if (!entry) throw new Error("word/document.xml not found in output");
  return entry.asText();
}
