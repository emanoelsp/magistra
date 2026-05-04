import { notFound, redirect } from "next/navigation";

import { PlanEditor } from "../../../../components/planos/plan-editor";
import { requireCurrentUserProfile } from "../../../../lib/auth/session";
import { getAdminDb } from "../../../../lib/firebase/admin";
import { getLimitsStatus } from "../../../../lib/services/limits";
import type { TemplateRecord } from "../../../../lib/types/firestore";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ template?: string }>;
}

export default async function NovoPlanoPage({ searchParams }: PageProps) {
  const user = await requireCurrentUserProfile();
  const { template: templateId } = await searchParams;

  if (!templateId) {
    redirect("/dashboard/templates");
  }

  const [limitsStatus, templateSnap] = await Promise.all([
    getLimitsStatus(user.uid, user.plano),
    getAdminDb().collection("templates").doc(templateId).get(),
  ]);

  if (!templateSnap.exists) {
    notFound();
  }

  const templateData = templateSnap.data() as Omit<TemplateRecord, "id">;

  if (templateData.user_id !== user.uid) {
    redirect("/dashboard/templates");
  }

  if (!limitsStatus.canCreatePlano) {
    redirect(
      `/dashboard/templates?erro=limite_planos&usados=${limitsStatus.currentPlanosThisMonth}&max=${limitsStatus.limits.maxPlanosPerMonth}`,
    );
  }

  const template: TemplateRecord = {
    id: templateSnap.id,
    user_id: templateData.user_id,
    nome: typeof templateData.nome === "string" ? templateData.nome : "Template",
    escola_nome: typeof templateData.escola_nome === "string" ? templateData.escola_nome : null,
    tipo_plano: typeof templateData.tipo_plano === "string" ? templateData.tipo_plano : null,
    schema_campos: Array.isArray(templateData.schema_campos) ? templateData.schema_campos : [],
    data_criacao: typeof templateData.data_criacao === "string" ? templateData.data_criacao : new Date().toISOString(),
  };

  return (
    <PlanEditor
      template={template}
      userId={user.uid}
      userName={user.nome || user.email}
    />
  );
}
