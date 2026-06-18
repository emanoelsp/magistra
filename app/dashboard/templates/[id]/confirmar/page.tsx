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

  const snap = await getAdminDb().collection("magis_templates").doc(id).get();

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
    estado: typeof data.estado === "string" ? data.estado : null,
    schema_campos: Array.isArray(data.schema_campos) ? data.schema_campos : [],
    data_criacao: toIso(data.data_criacao),
    arquivo_url: typeof data.arquivo_url === "string" ? data.arquivo_url : undefined,
    arquivo_fillable_url:
      typeof data.arquivo_fillable_url === "string" ? data.arquivo_fillable_url : undefined,
  };

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-4">
      <header className="shrink-0 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/dashboard/templates"
            className="flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-950 shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
            Templates
          </Link>
          <span className="text-slate-300 shrink-0">/</span>
          <span className="rounded-2xl bg-violet-50 px-2 py-0.5 text-xs font-semibold uppercase tracking-widest text-violet-600 shrink-0">
            Confirmar campos
          </span>
          <span className="text-sm font-semibold text-slate-900 truncate">{template.nome}</span>
        </div>
        <div id="template-header-actions" className="flex shrink-0 items-center gap-1.5" />
      </header>

      <div className="flex-1 min-h-0">
        <TemplateFieldEditor template={template} mode="confirm" />
      </div>
    </div>
  );
}
