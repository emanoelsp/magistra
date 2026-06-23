import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { MercadoPagoConfig, PreApproval } from "mercadopago";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../../../../lib/firebase/admin";

function getMpClient() {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) throw new Error("MERCADOPAGO_ACCESS_TOKEN não configurado.");
  return new MercadoPagoConfig({ accessToken: token });
}

/**
 * Validates the x-signature header sent by MercadoPago.
 * Format: "ts=<timestamp>,v1=<hmac-sha256-hex>"
 * Signed string: "id:<dataId>;request-id:<xRequestId>;ts:<ts>;"
 * Returns true if valid, false if invalid, null if secret not configured (skip validation).
 */
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

    // Valida assinatura HMAC-SHA256 quando MERCADOPAGO_WEBHOOK_SECRET está configurado
    if (body.data?.id) {
      const signatureValid = validateMpSignature(xSignature, xRequestId, body.data.id);
      if (signatureValid === false) {
        console.warn("[webhook/mp] Assinatura inválida — requisição rejeitada.");
        return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
      }
      if (signatureValid === null) {
        console.warn("[webhook/mp] MERCADOPAGO_WEBHOOK_SECRET não configurado — validação de assinatura ignorada.");
      }
    }

    // MP envia type = "subscription_preapproval" para eventos de assinatura
    if (body.type !== "subscription_preapproval" || !body.data?.id) {
      return NextResponse.json({ ok: true });
    }

    // Idempotência: cada notificação tem um id único enviado pelo MP
    const notificationId = body.id != null ? String(body.id) : null;
    if (notificationId) {
      const db = getAdminDb();
      const eventRef = db.collection("magis_webhook_events").doc(notificationId);
      const eventSnap = await eventRef.get();
      if (eventSnap.exists) {
        console.log(`[webhook/mp] Notificação ${notificationId} já processada — ignorando.`);
        return NextResponse.json({ ok: true });
      }
      // Reserva o slot antes de processar para evitar race condition
      await eventRef.set({ processed_at: new Date().toISOString(), subscription_id: body.data.id });
    }

    const client = getMpClient();
    const preApproval = new PreApproval(client);
    const sub = await preApproval.get({ id: body.data.id });

    // external_reference = "uid|plano" or "uid|avulso_template|qty" or "uid|avulso_plano|qty"
    const ref = sub.external_reference ?? "";
    const parts = ref.split("|");
    const uid = parts[0];
    const tipo = parts[1];

    if (!uid || !tipo) {
      console.warn("[webhook/mp] external_reference inválida:", ref);
      return NextResponse.json({ ok: true });
    }

    const db = getAdminDb();
    const now = new Date().toISOString();
    const subDocRef = db.collection("magis_assinaturas").doc(body.data.id);

    // Avulso add-on handling
    if (AVULSO_TIPOS.has(tipo)) {
      const field = AVULSO_FIELD[tipo];
      const qty = parseInt(parts[2] ?? "1", 10);

      if (sub.status === "authorized") {
        await db.collection("magis_users").doc(uid).update({
          [field]: FieldValue.increment(qty),
        });
        await subDocRef.set({
          user_id: uid,
          mp_preapproval_id: body.data.id,
          tipo,
          qty,
          field,
          status: "authorized",
          valor_brl: sub.auto_recurring?.transaction_amount ?? 0,
          created_at: now,
          updated_at: now,
        }, { merge: true });
        console.log(`[webhook/mp] Avulso ${tipo} +${qty} para uid=${uid}`);
      }

      if (sub.status === "cancelled" || sub.status === "paused") {
        // Retrieve stored qty in case external_reference differs
        const subSnap = await subDocRef.get();
        const storedQty = (subSnap.data()?.qty as number | undefined) ?? qty;
        await db.collection("magis_users").doc(uid).update({
          [field]: FieldValue.increment(-storedQty),
        });
        await subDocRef.update({ status: sub.status, updated_at: now });
        console.log(`[webhook/mp] Avulso ${tipo} -${storedQty} (${sub.status}) uid=${uid}`);
      }

      return NextResponse.json({ ok: true });
    }

    // Plan subscription handling
    const plano = tipo;
    const couponCode = (parts[2] ?? "").trim().toUpperCase() || null;

    if (sub.status === "authorized") {
      await db.collection("magis_users").doc(uid).update({ plano, onboarding_concluido: true });
      await subDocRef.set({
        user_id: uid,
        mp_preapproval_id: body.data.id,
        plano,
        status: "authorized",
        valor_brl: sub.auto_recurring?.transaction_amount ?? 0,
        cupom: couponCode,
        created_at: now,
        updated_at: now,
      }, { merge: true });
      console.log(`[webhook/mp] Plano ${plano} ativado para uid=${uid}`);

      // Increment coupon usage
      if (couponCode) {
        const couponSnap = await db.collection("magis_cupons").where("code", "==", couponCode).limit(1).get();
        if (!couponSnap.empty) {
          await couponSnap.docs[0].ref.update({ uses: FieldValue.increment(1) });
        }
      }
    }

    if (sub.status === "cancelled" || sub.status === "paused") {
      await db.collection("magis_users").doc(uid).update({ plano: "free" });
      await subDocRef.update({ status: sub.status, updated_at: now });
      console.log(`[webhook/mp] Assinatura ${sub.status} — uid=${uid} → plano free`);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[webhook/mp]", err);
    return NextResponse.json({ error: "Erro interno." }, { status: 500 });
  }
}
