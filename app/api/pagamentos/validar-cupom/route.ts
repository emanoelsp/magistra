import "server-only";

import { NextResponse } from "next/server";

import { getAdminDb } from "../../../../lib/firebase/admin";
import { getCurrentSession } from "../../../../lib/auth/session";
import { PLAN_PRICES_BRL } from "../../../../lib/services/plan-config";
import type { CouponRecord } from "../../../../lib/types/firestore";

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  const body = (await request.json()) as { code?: string; plano?: string };
  const code = (body.code ?? "").trim().toUpperCase();
  const plano = (body.plano ?? "").trim().toLowerCase();

  if (!code || !plano) {
    return NextResponse.json({ error: "Código e plano são obrigatórios." }, { status: 400 });
  }

  const db = getAdminDb();
  const snap = await db.collection("magis_cupons").where("code", "==", code).limit(1).get();

  if (snap.empty) {
    return NextResponse.json({ ok: false, error: "Cupom não encontrado." }, { status: 404 });
  }

  const doc = snap.docs[0];
  const coupon = { id: doc.id, ...doc.data() } as CouponRecord;

  if (!coupon.active) {
    return NextResponse.json({ ok: false, error: "Cupom inativo." });
  }

  const now = new Date().toISOString().slice(0, 10);
  if (now < coupon.valid_from || now > coupon.valid_until) {
    return NextResponse.json({ ok: false, error: "Cupom fora do período de validade." });
  }

  if (coupon.max_uses !== null && coupon.uses >= coupon.max_uses) {
    return NextResponse.json({ ok: false, error: "Cupom esgotado." });
  }

  if (!coupon.planos.includes(plano)) {
    return NextResponse.json({
      ok: false,
      error: "Este cupom não é válido para o plano selecionado.",
    });
  }

  const basePrice = PLAN_PRICES_BRL[plano] ?? 0;
  const discount =
    coupon.type === "percent"
      ? basePrice * (coupon.value / 100)
      : coupon.value;
  const finalPrice = Math.max(1, basePrice - discount);

  return NextResponse.json({
    ok: true,
    couponId: coupon.id,
    type: coupon.type,
    value: coupon.value,
    basePrice,
    discount: Math.min(discount, basePrice - 1),
    finalPrice,
  });
}
