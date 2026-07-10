/**
 * Marker appended by /api/ia/campo (streaming mode) after the raw model
 * output. Everything before it is a live preview (drives the typing UX);
 * everything after is the authoritative payload — validated closed-world,
 * enriched with codigosOficiais and raciocinio. The client must render only
 * the final payload and fall back to parsing the raw text when the marker is
 * absent (older server during deploy, or stream aborted mid-flight).
 */
export const MAGIS_FINAL_MARKER = "\n@@MAGIS_FINAL@@\n";

export interface MagisFinalPayload {
  sugestoes: import("../types/firestore").IaSugestao[];
  raciocinio?: string;
  precisaRevisao?: boolean;
}
