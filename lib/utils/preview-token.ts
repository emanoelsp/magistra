import "server-only";

import crypto from "crypto";

const SECRET = process.env.PREVIEW_TOKEN_SECRET ?? "magistra-preview-hmac-fallback";
const TTL_MS = 30 * 60 * 1000; // 30 minutes

export function createPreviewToken(templateId: string): { token: string; exp: number } {
  const exp = Date.now() + TTL_MS;
  const payload = `${templateId}:${exp}`;
  const token = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
  return { token, exp };
}

export function verifyPreviewToken(templateId: string, token: string, exp: number): boolean {
  if (Date.now() > exp) return false;
  const payload = `${templateId}:${exp}`;
  const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(token, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}
