import "server-only";
import { NextResponse } from "next/server";
import { MercadoPagoConfig, PreApprovalPlan, PreApproval } from "mercadopago";
import { requireCurrentUserProfile } from "../../../../lib/auth/session";
import { PLAN_PRICES_BRL, PLAN_LABELS } from "../../../../lib/services/limits";

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

async function getOrCreatePlanId(client: MercadoPagoConfig, plano: string): Promise<string> {
  const price = PLAN_PRICES_BRL[plano] ?? 0;
  const label = PLAN_LABELS[plano] ?? plano;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://planomagistra.com.br";

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
      back_url: `${appUrl}/planos/sucesso`,
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
    };

    const periodoRaw = body.periodo ?? "auto";
    const repetitions = periodoRaw !== "auto" ? parseInt(periodoRaw, 10) : undefined;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://planomagistra.com.br";
    const client = getMpClient();
    const preApproval = new PreApproval(client);

    // Avulso checkout (template or plano slot add-on)
    if (body.tipo && (AVULSO_TIPOS as readonly string[]).includes(body.tipo)) {
      const tipo = body.tipo as AvulsoTipo;
      const preco = AVULSO_PRECO[tipo];
      const label = AVULSO_LABEL[tipo];

      const sub = await preApproval.create({
        body: {
          payer_email: user.email,
          reason: `PlanoMagistra - ${label}`,
          external_reference: `${user.uid}|${tipo}|1`,
          back_url: `${appUrl}/planos/sucesso?tipo=${tipo}`,
          auto_recurring: {
            frequency: 1,
            frequency_type: "months",
            transaction_amount: preco,
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

    const planId = await getOrCreatePlanId(client, plano);

    const sub = await preApproval.create({
      body: {
        preapproval_plan_id: planId,
        payer_email: user.email,
        reason: `PlanoMagistra - ${PLAN_LABELS[plano]}`,
        external_reference: `${user.uid}|${plano}`,
        back_url: `${appUrl}/planos/sucesso?plano=${plano}`,
        auto_recurring: {
          frequency: 1,
          frequency_type: "months",
          transaction_amount: PLAN_PRICES_BRL[plano],
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
