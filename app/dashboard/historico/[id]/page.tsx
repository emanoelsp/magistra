import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";

import { requireCurrentUserProfile } from "../../../../lib/auth/session";
import { getPlanoDetalhes } from "../../../../lib/services/firestore/dashboard.server";

export const dynamic = "force-dynamic";

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeStyle: "short" }).format(new Date(iso));
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

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between">
        <Link
          href="/dashboard/historico"
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition hover:text-slate-950"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar ao histórico
        </Link>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-semibold text-slate-950">{plano.template_nome}</p>
            <p className="text-xs text-slate-400">{formatDate(plano.data_geracao)}</p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`/api/planos/${plano.id}/download`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
            >
              <Download className="h-4 w-4" />
              DOCX
            </a>
            <a
              href={`/api/planos/${plano.id}/download?format=pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              <Download className="h-4 w-4" />
              PDF
            </a>
          </div>
        </div>
      </div>

      {/* Document preview iframe */}
      <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <iframe
          src={`/api/planos/${plano.id}/preview`}
          className="h-full w-full"
          style={{ minHeight: "70vh" }}
          title="Preview do plano"
        />
      </div>
    </div>
  );
}
