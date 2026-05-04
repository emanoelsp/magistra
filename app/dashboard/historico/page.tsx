import Link from "next/link";
import { ArrowLeft, Clock, Download, FileText } from "lucide-react";

import { requireCurrentUserProfile } from "../../../lib/auth/session";
import { getUserPlanosComNome } from "../../../lib/services/firestore/dashboard.server";

export const dynamic = "force-dynamic";

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  gerado:               { label: "Gerado",             cls: "bg-emerald-100 text-emerald-800" },
  rascunho:             { label: "Rascunho",            cls: "bg-slate-100 text-slate-700" },
  processando:          { label: "Processando",         cls: "bg-amber-100 text-amber-800" },
  aguardando_geracao:   { label: "Aguardando geração",  cls: "bg-blue-100 text-blue-700" },
  aguardando_aprovacao: { label: "Aguardando revisão",  cls: "bg-violet-100 text-violet-700" },
  erro:                 { label: "Erro",                cls: "bg-rose-100 text-rose-800" },
};

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export default async function HistoricoPage() {
  const user = await requireCurrentUserProfile();
  const planos = await getUserPlanosComNome(user.uid);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-2 text-sm font-medium text-slate-600 transition hover:text-slate-950"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar ao dashboard
        </Link>
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-slate-100 p-3 text-slate-600">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Histórico de planos</h1>
            <p className="text-sm text-slate-600">{planos.length} plano{planos.length !== 1 ? "s" : ""} encontrado{planos.length !== 1 ? "s" : ""}.</p>
          </div>
        </div>
      </div>

      {planos.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-12 text-center">
          <FileText className="mx-auto h-12 w-12 text-slate-400" />
          <h2 className="mt-4 text-lg font-semibold text-slate-950">Nenhum plano ainda</h2>
          <p className="mt-2 text-sm text-slate-600">Gere seu primeiro plano no assistente de geração.</p>
          <Link
            href="/dashboard/gerar"
            className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            Gerar plano
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {planos.map((plano) => {
            const status = STATUS_CONFIG[plano.status] ?? { label: plano.status, cls: "bg-slate-100 text-slate-600" };
            const temConteudo = Object.keys(plano.conteudo_gerado ?? {}).length > 0;
            return (
              <div
                key={plano.id}
                className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 rounded-xl bg-violet-50 p-2 text-violet-600">
                    <FileText className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="font-semibold text-slate-950">{plano.template_nome}</p>
                    <p className="mt-0.5 text-sm text-slate-500">
                      {plano.escola_nome ? `${plano.escola_nome} · ` : ""}
                      {formatDate(plano.data_geracao)}
                    </p>
                    <span className={`mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${status.cls}`}>
                      {status.label}
                    </span>
                  </div>
                </div>

                <div className="flex gap-2">
                  {plano.status === "gerado" && temConteudo && (
                    <a
                      href={`/api/planos/${plano.id}/download`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
                    >
                      <Download className="h-4 w-4" />
                      Baixar
                    </a>
                  )}
                  <Link
                    href={`/dashboard/gerar?plano=${plano.id}`}
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
                  >
                    Ver detalhes
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
