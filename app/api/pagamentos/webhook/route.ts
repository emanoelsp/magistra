import "server-only";
import { NextResponse } from "next/server";
import { MercadoPagoConfig, PreApproval } from "mercadopago";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../../../../lib/firebase/admin";

function getMpClient() {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) throw new Error("MERCADOPAGO_ACCESS_TOKEN não configurado.");
  return new MercadoPagoConfig({ accessToken: token });
}

const AVULSO_TIPOS = new Set(["avulso_template", "avulso_plano"]);
const AVULSO_FIELD: Record<string, "avulso_templates" | "avulso_planos"> = {
  avulso_template: "avulso_templates",
  avulso_plano: "avulso_planos",
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      type?: string;
      action?: string;
      data?: { id?: string };
    };

    // MP envia type = "subscription_preapproval" para eventos de assinatura
    if (body.type !== "subscription_preapproval" || !body.data?.id) {
      return NextResponse.json({ ok: true });
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

    if (sub.status === "authorized") {
      await db.collection("magis_users").doc(uid).update({ plano });
      await subDocRef.set({
        user_id: uid,
        mp_preapproval_id: body.data.id,
        plano,
        status: "authorized",
        valor_brl: sub.auto_recurring?.transaction_amount ?? 0,
        created_at: now,
        updated_at: now,
      }, { merge: true });
      console.log(`[webhook/mp] Plano ${plano} ativado para uid=${uid}`);
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
