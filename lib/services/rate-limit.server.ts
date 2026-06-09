import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../firebase/admin";

const LIMITS_PER_HOUR: Record<string, number> = {
  free:    20,
  starter: 60,
  medio:   60,
  pro:     120,
  avancado: 120,
  premium:  120,
  escola:   999,
};

export async function checkRateLimit(
  userId: string,
  plano: string,
  action: string,
): Promise<{ allowed: boolean; remaining: number; resetAt: string }> {
  const db = getAdminDb();
  const maxPerHour = LIMITS_PER_HOUR[plano?.toLowerCase()] ?? 20;

  const now = Date.now();
  const windowStart = now - 60 * 60 * 1000; // 1 hora atrás
  const docId = `${userId}::${action}`;

  const ref = db.collection("magis_rate_limits").doc(docId);

  const snap = await ref.get();
  const data = snap.data();

  // Timestamps of past calls within the current window
  const timestamps: number[] = Array.isArray(data?.timestamps)
    ? (data.timestamps as number[]).filter((t) => t > windowStart)
    : [];

  if (timestamps.length >= maxPerHour) {
    const oldestInWindow = Math.min(...timestamps);
    const resetAt = new Date(oldestInWindow + 60 * 60 * 1000).toISOString();
    return { allowed: false, remaining: 0, resetAt };
  }

  // Record this call (fire-and-forget)
  void ref.set(
    {
      timestamps: FieldValue.arrayUnion(now),
      user_id: userId,
      plano,
      last_action: action,
      updated_at: new Date().toISOString(),
    },
    { merge: true },
  );

  return {
    allowed: true,
    remaining: maxPerHour - timestamps.length - 1,
    resetAt: new Date(now + 60 * 60 * 1000).toISOString(),
  };
}
