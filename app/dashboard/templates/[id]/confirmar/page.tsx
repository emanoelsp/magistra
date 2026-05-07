import { notFound, redirect } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import Link from "next/link";

import { TemplateFieldEditor } from "../../../../../components/templates/template-field-editor";
import { requireCurrentUserProfile } from "../../../../../lib/auth/session";
import { getAdminDb } from "../../../../../lib/firebase/admin";
import type { TemplateRecord } from "../../../../../lib/types/firestore";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ConfirmarTemplatePage({ params }: PageProps) {
  const user = await requireCurrentUserProfile();
  const { id } = await params;

  const snap = await getAdminDb().collection("templates").doc(id).get();

  if (!snap.exists) {
    notFound();
  }

  const data = snap.data() as Omit<TemplateRecord, "id">;

  if (data.user_id !== user.uid) {
    redirect("/dashboard/templates");
  }

  function toIso(value: unknown): string {
    if (!value) return new Date().toISOString();
    if (typeof value === "string") return value;
    if (typeof value === "object" && value !== null && "toDate" in value) {
      return (value as { toDate: () => Date }).toDate().toISOString();
    }
    return new Date().toISOString();
  }

  const template: TemplateRecord = {
    id: snap.id,
    user_id: data.user_id,
    nome: typeof data.nome === "string" ? data.nome : "Template",
    escola_nome: typeof data.escola_nome === "string" ? data.escola_nome : null,
    tipo_plano: typeof data.tipo_plano === "string" ? data.tipo_plano : null,
    schema_campos: Array.isArray(data.schema_campos) ? data.schema_campos : [],
    data_criacao: toIso(data.data_criacao),
    arquivo_url: typeof data.arquivo_url === "string" ? data.arquivo_url : undefined,
    arquivo_fillable_url:
      typeof data.arquivo_fillable_url === "string" ? data.arquivo_fillable_url : undefined,
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3">
        <Link
          href="/dashboard/templates"
          className="inline-flex w-fit items-center gap-2 text-sm font-medium text-slate-600 transition hover:text-slate-950"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar para templates
        </Link>

        <div className="flex items-start gap-3">
          <span className="mt-0.5 rounded-2xl bg-violet-50 p-3 text-violet-600">
            <FileText className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-600">
              Confirmar campos
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
              {template.nome}
            </h1>
            {template.escola_nome && (
              <p className="text-sm text-slate-500">{template.escola_nome}</p>
            )}
            <p className="mt-1 text-sm leading-relaxed text-slate-600">
              A IA extraiu os campos abaixo do seu template. Confirme, ajuste ou adicione campos antes
              de usar o template para gerar planos.
            </p>
          </div>
        </div>
      </header>

      <TemplateFieldEditor template={template} mode="confirm" />
    </div>
  );
}
