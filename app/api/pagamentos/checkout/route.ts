import "server-only";
import { NextResponse } from "next/server";
import { MercadoPagoConfig, PreApprovalPlan, PreApproval } from "mercadopago";
import { requireCurrentUserProfile } from "../../../../lib/auth/session";
import { PLAN_PRICES_BRL, PLAN_LABELS } from "../../../../lib/services/limits";
import type { CouponRecord } from "../../../../lib/types/firestore";

const PLANOS_PAGOS = ["starter", "medio", "pro"];
const AVULSO_TIPOS = ["avulso_template", "avulso_plano"] as const;
type AvulsoTipo = (typeof AVULSO_TIPOS)[number];
const AVULSO_PRECO: Record<AvulsoTipo, number> = { avulso_template: 4, avulso_plano: 3 };
const AVULSO_LABEL: Record<AvulsoTipo, string> = {
  avulso_template: "Template extra",
  avulso_plano: "Plano extra",
};

function getMpClient() {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) throw new Error("MERCADOPAGO_ACCESS_TOKEN não configurado.");
  return new MercadoPagoConfig({ accessToken: token });
}

function resolveAppUrl(): string | null {
  const raw = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
  if (!raw || raw.includes("localhost") || raw.includes("127.0.0.1")) return null;
  return raw;
}

async function getOrCreatePlanId(client: MercadoPagoConfig, plano: string): Promise<string> {
  const price = PLAN_PRICES_BRL[plano] ?? 0;
  const label = PLAN_LABELS[plano] ?? plano;
  const appUrl = resolveAppUrl();

  const preApprovalPlan = new PreApprovalPlan(client);

  const search = await preApprovalPlan.search({ options: { limit: 20 } });
  const existing = search.results?.find((p) => p.reason === `PlanoMagistra - ${label}`);
  if (existing?.id) return existing.id;

  const created = await preApprovalPlan.create({
    body: {
      reason: `PlanoMagistra - ${label}`,
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: price,
        currency_id: "BRL",
      },
      payment_methods_allowed: {
        payment_types: [{ id: "credit_card" }, { id: "debit_card" }],
      },
      ...(appUrl ? { back_url: `${appUrl}/planos/sucesso` } : {}),
    },
  });

  if (!created.id) throw new Error("MP: falha ao criar plano de assinatura.");
  return created.id;
}

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUserProfile();
    const body = (await request.json()) as {
      plano?: string;
      tipo?: string;
      periodo?: string;
      qty?: number;
      cupom?: string;
    };

    const periodoRaw = body.periodo ?? "auto";
    const repetitions = periodoRaw !== "auto" ? parseInt(periodoRaw, 10) : undefined;
    const appUrl = resolveAppUrl();
    const client = getMpClient();
    const preApproval = new PreApproval(client);
    const couponCode = (body.cupom ?? "").trim().toUpperCase() || null;

    // Avulso checkout (template or plano slot add-on)
    if (body.tipo && (AVULSO_TIPOS as readonly string[]).includes(body.tipo)) {
      const tipo = body.tipo as AvulsoTipo;
      const precoUnit = AVULSO_PRECO[tipo];
      const label = AVULSO_LABEL[tipo];
      const qty = Math.max(1, Math.min(10, Math.round(Number(body.qty ?? 1))));
      const precoTotal = precoUnit * qty;

      const sub = await preApproval.create({
        body: {
          payer_email: user.email,
          reason: `PlanoMagistra - ${qty}x ${label}`,
          external_reference: `${user.uid}|${tipo}|${qty}`,
          ...(appUrl ? { back_url: `${appUrl}/planos/sucesso?tipo=${tipo}&qty=${qty}` } : {}),
          auto_recurring: {
            frequency: 1,
            frequency_type: "months",
            transaction_amount: precoTotal,
            currency_id: "BRL",
            ...(repetitions ? { repetitions } : {}),
          },
        },
      });

      if (!sub.init_point) throw new Error("MP: init_point não retornado.");
      return NextResponse.json({ init_point: sub.init_point });
    }

    // Plan upgrade checkout
    const plano = body.plano?.trim().toLowerCase() ?? "";
    if (!PLANOS_PAGOS.includes(plano)) {
      return NextResponse.json({ error: "Plano inválido para checkout." }, { status: 400 });
    }

    // Resolve coupon discount (server-side re-validation)
    let finalPrice = PLAN_PRICES_BRL[plano] ?? 0;
    if (couponCode) {
      const db = (await import("../../../../lib/firebase/admin")).getAdminDb();
      const couponSnap = await db.collection("magis_cupons").where("code", "==", couponCode).limit(1).get();
      if (!couponSnap.empty) {
        const coupon = couponSnap.docs[0].data() as CouponRecord;
        const now = new Date().toISOString().slice(0, 10);
        const valid =
          coupon.active &&
          now >= coupon.valid_from &&
          now <= coupon.valid_until &&
          (coupon.max_uses === null || coupon.uses < coupon.max_uses) &&
          coupon.planos.includes(plano);
        if (valid) {
          const discount =
            coupon.type === "percent"
              ? finalPrice * (coupon.value / 100)
              : coupon.value;
          finalPrice = Math.max(1, finalPrice - discount);
        }
      }
    }

    const planId = await getOrCreatePlanId(client, plano);

    const sub = await preApproval.create({
      body: {
        preapproval_plan_id: planId,
        payer_email: user.email,
        reason: `PlanoMagistra - ${PLAN_LABELS[plano]}`,
        external_reference: `${user.uid}|${plano}|${couponCode ?? ""}`,
        ...(appUrl ? { back_url: `${appUrl}/planos/sucesso?plano=${plano}` } : {}),
        auto_recurring: {
          frequency: 1,
          frequency_type: "months",
          transaction_amount: finalPrice,
          currency_id: "BRL",
          ...(repetitions ? { repetitions } : {}),
        },
      },
    });

    if (!sub.init_point) throw new Error("MP: init_point não retornado.");
    return NextResponse.json({ init_point: sub.init_point });
  } catch (err) {
    console.error("[pagamentos/checkout]", err);
    return NextResponse.json({ error: "Erro ao criar checkout." }, { status: 500 });
  }
}
