import { notFound, redirect } from "next/navigation";

import { PlanEditor } from "../../../../../components/planos/plan-editor";
import { requireCurrentUserProfile } from "../../../../../lib/auth/session";
import { getAdminDb } from "../../../../../lib/firebase/admin";
import type { PlanoRecord, TemplateRecord } from "../../../../../lib/types/firestore";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditarPlanoPage({ params }: PageProps) {
  const { id } = await params;
  const user = await requireCurrentUserProfile();

  const db = getAdminDb();
  const planoSnap = await db.collection("magins_planos_aula").doc(id).get();

  if (!planoSnap.exists) notFound();

  const planoData = planoSnap.data() as Omit<PlanoRecord, "id">;

  if (planoData.user_id !== user.uid) redirect("/dashboard/historico");

  // Only allow resuming plans that are not finalized
  if (planoData.status === "gerado") {
    redirect(`/dashboard/historico/${id}`);
  }

  const templateId = typeof planoData.template_id === "string" ? planoData.template_id : "";
  if (!templateId) notFound();

  const templateSnap = await db.collection("magis_templates").doc(templateId).get();
  if (!templateSnap.exists) notFound();

  const templateData = templateSnap.data() as Omit<TemplateRecord, "id">;

  // Use the schema snapshotted at plan creation if available (survives template edits)
  const snapshotSchema = Array.isArray(planoData.schema_campos) && planoData.schema_campos.length > 0
    ? planoData.schema_campos
    : (Array.isArray(templateData.schema_campos) ? templateData.schema_campos : []);

  const template: TemplateRecord = {
    id: templateSnap.id,
    user_id: templateData.user_id,
    nome: typeof templateData.nome === "string" ? templateData.nome : "Template",
    escola_nome: typeof templateData.escola_nome === "string" ? templateData.escola_nome : null,
    tipo_plano: typeof templateData.tipo_plano === "string" ? templateData.tipo_plano : null,
    schema_campos: snapshotSchema,
    data_criacao: typeof templateData.data_criacao === "string" ? templateData.data_criacao : new Date().toISOString(),
    arquivo_url: typeof templateData.arquivo_url === "string" ? templateData.arquivo_url : undefined,
    arquivo_fillable_url: typeof templateData.arquivo_fillable_url === "string" ? templateData.arquivo_fillable_url : undefined,
    fillable_status: templateData.fillable_status,
  };

  // Extract string values from conteudo_gerado
  const conteudo = typeof planoData.conteudo_gerado === "object" && planoData.conteudo_gerado !== null
    ? planoData.conteudo_gerado
    : {};
  const initialValues: Record<string, string> = {};
  for (const [k, v] of Object.entries(conteudo)) {
    if (typeof v === "string") initialValues[k] = v;
  }

  return (
    <PlanEditor
      template={template}
      userId={user.uid}
      userName={user.nome || user.email}
      initialValues={initialValues}
      initialPlanoId={id}
      resumeDraft
    />
  );
}
