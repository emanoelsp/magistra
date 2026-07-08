import "server-only";
import { NextResponse } from "next/server";
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

function getBaseUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
  if (raw) return raw;
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

function getMpToken(): string {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) throw new Error("MERCADOPAGO_ACCESS_TOKEN não configurado.");
  return token;
}

function useSandbox(): boolean {
  return process.env.MERCADOPAGO_SANDBOX === "true";
}

interface MpPreferenceResponse {
  id: string;
  init_point: string;
  sandbox_init_point?: string;
}

async function createPreference(token: string, data: object): Promise<MpPreferenceResponse> {
  const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MP API ${res.status}: ${text}`);
  }
  return res.json() as Promise<MpPreferenceResponse>;
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
    const months = periodoRaw !== "auto" ? Math.max(1, parseInt(periodoRaw, 10)) : 1;
    const BASE_URL = getBaseUrl();
    const token = getMpToken();
    const sandbox = useSandbox();
    const couponCode = (body.cupom ?? "").trim().toUpperCase() || null;
    const timestamp = Date.now();

    // Avulso checkout (template or plano slot add-on)
    if (body.tipo && (AVULSO_TIPOS as readonly string[]).includes(body.tipo)) {
      const tipo = body.tipo as AvulsoTipo;
      const precoUnit = AVULSO_PRECO[tipo];
      const label = AVULSO_LABEL[tipo];
      const qty = Math.max(1, Math.min(10, Math.round(Number(body.qty ?? 1))));
      const precoTotal = precoUnit * qty;

      const pref = await createPreference(token, {
        items: [{
          title: `PlanoMagistra - ${qty}x ${label}`,
          quantity: 1,
          unit_price: precoTotal,
          currency_id: "BRL",
        }],
        payer: { email: user.email },
        payment_methods: { installments: 1 },
        back_urls: {
          success: `${BASE_URL}/planos/sucesso?tipo=${tipo}&qty=${qty}`,
          failure: `${BASE_URL}/planos?erro=pagamento`,
          pending: `${BASE_URL}/planos/sucesso?tipo=${tipo}&qty=${qty}`,
        },
        auto_return: "approved",
        external_reference: `${user.uid}|${tipo}|${qty}|${timestamp}`,
        notification_url: `${BASE_URL}/api/pagamentos/webhook`,
        statement_descriptor: "PLANOMAGISTRA",
      });

      const init_point = sandbox && pref.sandbox_init_point ? pref.sandbox_init_point : pref.init_point;
      return NextResponse.json({ init_point });
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

    // Multi-month: charge months × monthly price upfront, allow installments up to N months
    const totalPrice = Number((finalPrice * months).toFixed(2));
    const label = PLAN_LABELS[plano] ?? plano;
    const titlePeriod = periodoRaw === "auto" ? "Mensal" : months === 1 ? "1 mês" : `${months} meses`;

    const pref = await createPreference(token, {
      items: [{
        title: `PlanoMagistra - ${label} (${titlePeriod})`,
        quantity: 1,
        unit_price: totalPrice,
        currency_id: "BRL",
      }],
      payer: { email: user.email },
      payment_methods: { installments: months },
      back_urls: {
        success: `${BASE_URL}/planos/sucesso?plano=${plano}`,
        failure: `${BASE_URL}/planos?erro=pagamento`,
        pending: `${BASE_URL}/planos/sucesso?plano=${plano}`,
      },
      auto_return: "approved",
      external_reference: `${user.uid}|${plano}|${couponCode ?? ""}|${timestamp}`,
      notification_url: `${BASE_URL}/api/pagamentos/webhook`,
      statement_descriptor: "PLANOMAGISTRA",
    });

    const init_point = sandbox && pref.sandbox_init_point ? pref.sandbox_init_point : pref.init_point;
    return NextResponse.json({ init_point });
  } catch (err) {
    console.error("[pagamentos/checkout]", err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
