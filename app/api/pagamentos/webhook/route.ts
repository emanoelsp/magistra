import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../../../../lib/firebase/admin";

function validateMpSignature(
  xSignature: string | null,
  xRequestId: string | null,
  dataId: string,
): boolean | null {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) return null;
  if (!xSignature) return false;

  const parts = Object.fromEntries(
    xSignature.split(",").map((part) => {
      const [k, ...rest] = part.split("=");
      return [k?.trim() ?? "", rest.join("=").trim()];
    }),
  );

  const ts = parts["ts"];
  const v1 = parts["v1"];
  if (!ts || !v1) return false;

  const signed = `id:${dataId};request-id:${xRequestId ?? ""};ts:${ts};`;
  const expected = createHmac("sha256", secret).update(signed).digest("hex");

  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(v1, "hex"));
  } catch {
    return false;
  }
}

const AVULSO_TIPOS = new Set(["avulso_template", "avulso_plano"]);
const AVULSO_FIELD: Record<string, "avulso_templates" | "avulso_planos"> = {
  avulso_template: "avulso_templates",
  avulso_plano: "avulso_planos",
};

interface MpPayment {
  id: string;
  status: string;
  external_reference?: string;
  transaction_amount?: number;
}

export async function POST(request: Request) {
  try {
    const xSignature = request.headers.get("x-signature");
    const xRequestId = request.headers.get("x-request-id");

    const body = (await request.json()) as {
      id?: string | number;
      type?: string;
      action?: string;
      data?: { id?: string };
    };

    if (body.data?.id) {
      const signatureValid = validateMpSignature(xSignature, xRequestId, body.data.id);
      if (signatureValid === false) {
        console.warn("[webhook/mp] Assinatura inválida — requisição rejeitada.");
        return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
      }
      if (signatureValid === null) {
        console.warn("[webhook/mp] MERCADOPAGO_WEBHOOK_SECRET não configurado — validação ignorada.");
      }
    }

    // Preference webhooks send type = "payment"
    if (body.type !== "payment" || !body.data?.id) {
      return NextResponse.json({ ok: true });
    }

    const paymentId = body.data.id;

    // Idempotency check
    const notificationId = body.id != null ? String(body.id) : null;
    const db = getAdminDb();
    if (notificationId) {
      const eventRef = db.collection("magis_webhook_events").doc(notificationId);
      const eventSnap = await eventRef.get();
      if (eventSnap.exists) {
        console.log(`[webhook/mp] Notificação ${notificationId} já processada — ignorando.`);
        return NextResponse.json({ ok: true });
      }
      await eventRef.set({ processed_at: new Date().toISOString(), payment_id: paymentId });
    }

    // Fetch payment details from MP
    const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!token) {
      console.error("[webhook/mp] MERCADOPAGO_ACCESS_TOKEN não configurado.");
      return NextResponse.json({ ok: true });
    }

    const paymentRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!paymentRes.ok) {
      console.error("[webhook/mp] Erro ao buscar pagamento:", await paymentRes.text());
      return NextResponse.json({ error: "Erro ao buscar pagamento." }, { status: 500 });
    }
    const payment = (await paymentRes.json()) as MpPayment;

    // external_reference = "uid|tipo|extra|timestamp"
    // plano upgrade:  "uid|plano|cupom|timestamp"
    // avulso:         "uid|avulso_template|qty|timestamp"
    const ref = payment.external_reference ?? "";
    const parts = ref.split("|");
    const uid = parts[0];
    const tipo = parts[1];

    if (!uid || !tipo) {
      console.warn("[webhook/mp] external_reference inválida:", ref);
      return NextResponse.json({ ok: true });
    }

    const now = new Date().toISOString();
    const pagDocRef = db.collection("magis_pagamentos").doc(paymentId);

    // Avulso add-on
    if (AVULSO_TIPOS.has(tipo)) {
      const field = AVULSO_FIELD[tipo];
      const qty = parseInt(parts[2] ?? "1", 10);

      if (payment.status === "approved") {
        await db.collection("magis_users").doc(uid).update({
          [field]: FieldValue.increment(qty),
        });
        await pagDocRef.set({
          user_id: uid,
          mp_payment_id: paymentId,
          tipo,
          qty,
          field,
          status: "approved",
          valor_brl: payment.transaction_amount ?? 0,
          created_at: now,
          updated_at: now,
        }, { merge: true });
        console.log(`[webhook/mp] Avulso ${tipo} +${qty} para uid=${uid}`);
      } else {
        await pagDocRef.set({
          user_id: uid,
          mp_payment_id: paymentId,
          tipo,
          qty,
          status: payment.status,
          updated_at: now,
        }, { merge: true });
        console.log(`[webhook/mp] Avulso ${tipo} status=${payment.status} uid=${uid}`);
      }

      return NextResponse.json({ ok: true });
    }

    // Plan upgrade
    const plano = tipo;
    const couponCode = (parts[2] ?? "").trim().toUpperCase() || null;

    if (payment.status === "approved") {
      await db.collection("magis_users").doc(uid).update({ plano, onboarding_concluido: true });
      await pagDocRef.set({
        user_id: uid,
        mp_payment_id: paymentId,
        plano,
        cupom: couponCode,
        status: "approved",
        valor_brl: payment.transaction_amount ?? 0,
        created_at: now,
        updated_at: now,
      }, { merge: true });
      console.log(`[webhook/mp] Plano ${plano} ativado para uid=${uid}`);

      if (couponCode) {
        const couponSnap = await db.collection("magis_cupons").where("code", "==", couponCode).limit(1).get();
        if (!couponSnap.empty) {
          await couponSnap.docs[0].ref.update({ uses: FieldValue.increment(1) });
        }
      }
    } else {
      await pagDocRef.set({
        user_id: uid,
        mp_payment_id: paymentId,
        plano,
        status: payment.status,
        updated_at: now,
      }, { merge: true });
      console.log(`[webhook/mp] Pagamento ${payment.status} para uid=${uid} plano=${plano}`);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[webhook/mp]", err);
    return NextResponse.json({ error: "Erro interno." }, { status: 500 });
  }
}
