import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BookOpen, Calendar, School } from "lucide-react";

import { requireCurrentUserProfile } from "../../../../lib/auth/session";
import { getPlanoDetalhes } from "../../../../lib/services/firestore/dashboard.server";
import { DownloadPlanButton } from "../../../../components/planos/download-plan-button";
import { OfficeInlineViewer } from "../../../../components/shared/office-inline-viewer";

export const dynamic = "force-dynamic";

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  gerado:               { label: "Gerado",            cls: "bg-emerald-100 text-emerald-700" },
  rascunho:             { label: "Rascunho",           cls: "bg-slate-100 text-slate-600" },
  processando:          { label: "Processando",        cls: "bg-amber-100 text-amber-700" },
  aguardando_geracao:   { label: "Aguardando geração", cls: "bg-blue-100 text-blue-700" },
  aguardando_aprovacao: { label: "Aguardando revisão", cls: "bg-violet-100 text-violet-700" },
  erro:                 { label: "Erro",               cls: "bg-rose-100 text-rose-700" },
};

// Groups and their display order for the field summary panel
const GROUP_ORDER = [
  "dados_turma", "objetivos", "competencias", "habilidades",
  "conteudos", "avaliacao", "outros",
];
const GROUP_LABELS: Record<string, string> = {
  dados_turma:  "Dados da turma",
  objetivos:    "Objetivos",
  competencias: "Competências",
  habilidades:  "Habilidades",
  conteudos:    "Conteúdos",
  avaliacao:    "Avaliação",
  outros:       "Outros campos",
};

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeStyle: "short" }).format(new Date(iso));
}

function htmlToText(raw: string): string {
  if (!raw?.trim().startsWith("<")) return raw ?? "";
  return raw
    .replace(/<li>/gi, "• ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n").trim();
}

export default async function PlanoDetalhesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireCurrentUserProfile();
  const plano = await getPlanoDetalhes(id, user.uid);

  if (!plano) notFound();

  const conteudo = plano.conteudo_gerado as Record<string, unknown>;
  const planoTitulo = typeof conteudo._plano_titulo === "string" && conteudo._plano_titulo.trim()
    ? conteudo._plano_titulo.trim()
    : plano.template_nome;

  const status = STATUS_CONFIG[plano.status] ?? { label: plano.status, cls: "bg-slate-100 text-slate-600" };

  // Build field summary grouped by schema group
  const schema = plano.schema_campos;
  const fieldsByGroup = new Map<string, { label: string; value: string }[]>();
  for (const field of schema) {
    const val = typeof conteudo[field.key] === "string" ? htmlToText(conteudo[field.key] as string) : "";
    if (!val.trim()) continue;
    const group = field.group ?? "outros";
    if (!fieldsByGroup.has(group)) fieldsByGroup.set(group, []);
    fieldsByGroup.get(group)!.push({ label: field.label, value: val });
  }

  const orderedGroups = [
    ...GROUP_ORDER.filter((g) => fieldsByGroup.has(g)),
    ...[...fieldsByGroup.keys()].filter((g) => !GROUP_ORDER.includes(g)),
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* ── Back link ── */}
      <Link
        href="/dashboard/historico"
        className="inline-flex w-fit items-center gap-2 text-sm font-medium text-slate-600 transition hover:text-slate-950"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar ao histórico
      </Link>

      {/* ── Header card ── */}
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.cls}`}>
                {status.label}
              </span>
              {plano.template_deletado && (
                <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-500">
                  template excluído
                </span>
              )}
            </div>
            <h1 className="mt-2 text-xl font-semibold leading-snug text-slate-950">{planoTitulo}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-slate-500">
              {plano.escola_nome && (
                <span className="flex items-center gap-1.5">
                  <School className="h-3.5 w-3.5 shrink-0" />
                  {plano.escola_nome}
                </span>
              )}
              {plano.tipo_plano && (
                <span className="flex items-center gap-1.5">
                  <BookOpen className="h-3.5 w-3.5 shrink-0" />
                  {plano.tipo_plano}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 shrink-0" />
                {formatDate(plano.data_geracao)}
              </span>
            </div>
          </div>

          {/* Download buttons */}
          <div className="flex shrink-0 flex-wrap gap-2">
            <DownloadPlanButton
              planoId={plano.id}
              format="docx"
              label="DOCX"
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950 disabled:opacity-50"
            />
            <DownloadPlanButton
              planoId={plano.id}
              format="pdf"
              label="PDF"
              className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-60"
            />
          </div>
        </div>
      </div>

      {/* ── Main content: viewer + field summary ── */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Document viewer */}
        <div
          className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:flex-1"
          style={{ minHeight: "72vh" }}
        >
          <OfficeInlineViewer
            tokenEndpoint={`/api/planos/${plano.id}/preview-token`}
            previewPublicoPath={`/api/planos/${plano.id}/preview-publico`}
            fallbackSrc={`/api/planos/${plano.id}/preview`}
            title="Visualização do plano"
            className="h-full"
          />
        </div>

        {/* Field summary panel */}
        {orderedGroups.length > 0 && (
          <div className="shrink-0 space-y-4 lg:w-80 xl:w-96">
            <h2 className="text-sm font-semibold text-slate-700">Campos preenchidos</h2>
            {orderedGroups.map((group) => {
              const groupFields = fieldsByGroup.get(group)!;
              return (
                <div key={group} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">
                    {GROUP_LABELS[group] ?? group}
                  </p>
                  <div className="space-y-3">
                    {groupFields.map(({ label, value }) => (
                      <div key={label}>
                        <p className="mb-0.5 text-xs font-semibold text-slate-600">{label}</p>
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
