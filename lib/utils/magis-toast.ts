export type MagisToastVariant = "success" | "error" | "info";

export interface MagisToastPayload {
  id: string;
  message: string;
  variant: MagisToastVariant;
}

export const MAGIS_TOAST_EVENT = "magis:toast" as const;

export function showMagisToast(message: string, variant: MagisToastVariant = "info") {
  if (typeof window === "undefined") return;
  const payload: MagisToastPayload = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    message,
    variant,
  };
  window.dispatchEvent(new CustomEvent(MAGIS_TOAST_EVENT, { detail: payload }));
}
