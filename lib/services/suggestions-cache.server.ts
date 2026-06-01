import "server-only";

import { createHash } from "crypto";

import { getAdminDb } from "../firebase/admin";
import type { IaSugestao } from "../types/firestore";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

export function buildCacheKey(
  fieldKey: string,
  templateId: string,
  metadata: Record<string, string>,
  userId: string,
  schemaHash?: string,
  extraContext?: string,
): string {
  const metaStr = Object.entries(metadata)
    .filter(([, v]) => v.trim())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v.trim().toLowerCase()}`)
    .join("|");
  const raw = `${userId}::${templateId}::${fieldKey}::${schemaHash ?? ""}::${metaStr}::${extraContext?.trim() ?? ""}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

export async function getCachedSuggestions(cacheKey: string): Promise<IaSugestao[] | null> {
  const db = getAdminDb();
  const doc = await db.collection("magis_suggestions_cache").doc(cacheKey).get();
  if (!doc.exists) return null;
  const data = doc.data();
  if (!data) return null;
  const expiresAt = (data.expires_at as { toMillis?: () => number })?.toMillis?.() ?? 0;
  if (Date.now() > expiresAt) {
    void doc.ref.delete();
    return null;
  }
  return Array.isArray(data.sugestoes) ? (data.sugestoes as IaSugestao[]) : null;
}

export async function setCachedSuggestions(
  cacheKey: string,
  sugestoes: IaSugestao[],
  meta: { fieldKey: string; templateId: string; userId: string },
): Promise<void> {
  const db = getAdminDb();
  await db.collection("magis_suggestions_cache").doc(cacheKey).set({
    sugestoes,
    field_key: meta.fieldKey,
    template_id: meta.templateId,
    user_id: meta.userId,
    created_at: new Date(),
    expires_at: new Date(Date.now() + CACHE_TTL_MS),
  });
}
