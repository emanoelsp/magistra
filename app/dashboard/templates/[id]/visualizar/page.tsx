import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Edit2 } from "lucide-react";

import { TemplatePreviewClient } from "../../../../../components/templates/template-preview-client";
import { requireCurrentUserProfile } from "../../../../../lib/auth/session";
import { getAdminDb } from "../../../../../lib/firebase/admin";
import type { TemplateRecord } from "../../../../../lib/types/firestore";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function VisualizarTemplatePage({ params }: PageProps) {
  const user = await requireCurrentUserProfile();
  const { id } = await params;

  const snap = await getAdminDb().collection("magis_templates").doc(id).get();
  if (!snap.exists) notFound();

  const data = snap.data() as Omit<TemplateRecord, "id">;
  if (data.user_id !== user.uid) redirect("/dashboard/templates");

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
    arquivo_fillable_url: typeof data.arquivo_fillable_url === "string" ? data.arquivo_fillable_url : undefined,
    fillable_status: typeof data.fillable_status === "string" ? data.fillable_status as TemplateRecord["fillable_status"] : undefined,
  };

  const isDocx = (template.arquivo_url ?? "").match(/\.(docx|doc)$/i) !== null;
  const hasFillable = !!template.arquivo_fillable_url && template.fillable_status === "pronto";

  const manualCount = template.schema_campos.filter(
    (f) => f.role === "manual" || f.group === "dados_turma",
  ).length;
  const iaCount = template.schema_campos.filter((f) => f.role === "ia_sugerida").length;

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <header className="flex flex-col gap-3">
        <Link
          href="/dashboard/templates"
          className="inline-flex w-fit items-center gap-2 text-sm font-medium text-slate-600 transition hover:text-slate-950"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar para templates
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Visualização do template
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
              {template.nome}
            </h1>
            {template.escola_nome && (
              <p className="text-sm text-slate-500">{template.escola_nome}</p>
            )}
          </div>

          <Link
            href={`/dashboard/templates/${template.id}/editar`}
            className="flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
          >
            <Edit2 className="h-4 w-4" />
            Editar campos
          </Link>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <span className="text-xs font-medium text-slate-500">Legenda:</span>
          <span className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-sm border-l-2 border-amber-400 bg-amber-50" />
            <span className="text-xs text-slate-700">
              Campo fixo — professor preenche
              {manualCount > 0 && (
                <span className="ml-1 font-semibold text-amber-700">({manualCount})</span>
              )}
            </span>
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-sm border-l-2 border-violet-500 bg-violet-50" />
            <span className="text-xs text-slate-700">
              Campo IA — sugestão automática
              {iaCount > 0 && (
                <span className="ml-1 font-semibold text-violet-700">({iaCount})</span>
              )}
            </span>
          </span>
          <span className="ml-auto text-xs text-slate-400">
            {!isDocx
              ? "Template PDF — visualização aproximada"
              : hasFillable
                ? "Preview Word com {{variáveis}} visíveis no documento"
                : "Preview Word do arquivo original"}
          </span>
        </div>
      </header>

      {/* Document preview */}
      <TemplatePreviewClient
        templateId={template.id}
        schema={template.schema_campos}
        isDocx={isDocx}
        hasFillable={hasFillable}
      />
    </div>
  );
}
