import "server-only";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

import { getAdminDb } from "../../../../lib/firebase/admin";
import { getCurrentSession, getCurrentUserProfile } from "../../../../lib/auth/session";
import type { CouponRecord } from "../../../../lib/types/firestore";

async function requireAdmin() {
  const [session, profile] = await Promise.all([getCurrentSession(), getCurrentUserProfile()]);
  if (!session || profile?.role !== "admin") return null;
  return session;
}

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Não autorizado." }, { status: 403 });

  const db = getAdminDb();
  const snap = await db.collection("magis_cupons").orderBy("created_at", "desc").get();
  const cupons = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as CouponRecord[];
  return NextResponse.json({ cupons });
}

export async function POST(request: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Não autorizado." }, { status: 403 });

  const body = (await request.json()) as {
    code?: string;
    type?: string;
    value?: number;
    planos?: string[];
    valid_from?: string;
    valid_until?: string;
    max_uses?: number | null;
  };

  const code = (body.code ?? "").trim().toUpperCase();
  if (!code || code.length < 3) {
    return NextResponse.json({ error: "Código inválido (mínimo 3 caracteres)." }, { status: 400 });
  }
  if (body.type !== "percent" && body.type !== "fixed") {
    return NextResponse.json({ error: "Tipo de desconto inválido." }, { status: 400 });
  }
  if (typeof body.value !== "number" || body.value <= 0) {
    return NextResponse.json({ error: "Valor do desconto inválido." }, { status: 400 });
  }
  if (!Array.isArray(body.planos) || body.planos.length === 0) {
    return NextResponse.json({ error: "Selecione ao menos um plano." }, { status: 400 });
  }
  if (!body.valid_from || !body.valid_until || body.valid_from >= body.valid_until) {
    return NextResponse.json({ error: "Período de validade inválido." }, { status: 400 });
  }

  const db = getAdminDb();

  // Check for duplicate code
  const existing = await db.collection("magis_cupons").where("code", "==", code).limit(1).get();
  if (!existing.empty) {
    return NextResponse.json({ error: "Já existe um cupom com este código." }, { status: 409 });
  }

  const doc: Omit<CouponRecord, "id"> = {
    code,
    type: body.type,
    value: body.value,
    planos: body.planos,
    valid_from: body.valid_from,
    valid_until: body.valid_until,
    max_uses: body.max_uses ?? null,
    uses: 0,
    active: true,
    created_at: new Date().toISOString(),
    created_by: session.uid,
  };

  const ref = await db.collection("magis_cupons").add(doc);
  return NextResponse.json({ id: ref.id, ...doc });
}
