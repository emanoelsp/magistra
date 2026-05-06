import Link from "next/link";
import { BookCopy, Clock3, Download, FileText, FolderKanban, Plus, Rocket, Sparkles } from "lucide-react";

import { StatCard } from "../../components/dashboard/stat-card";
import { requireCurrentUserProfile } from "../../lib/auth/session";
import { getDashboardStats, getUserPlanosComNome } from "../../lib/services/firestore/dashboard.server";

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
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

export default async function DashboardPage() {
  const user = await requireCurrentUserProfile();
  const [stats, planos] = await Promise.all([
    getDashboardStats(user),
    getUserPlanosComNome(user.uid, 5),
  ]);

  const cards = [
    {
      title: "Templates ativos",
      value: String(stats.totalTemplates),
      description: "Estruturas disponíveis para gerar planos com consistência documental.",
      icon: FolderKanban,
    },
    {
      title: "Planos gerados no mês",
      value: String(stats.planosGeradosMes),
      description: "Planos concluídos no ciclo atual e prontos para exportação PDF/DOCX.",
      icon: BookCopy,
    },
    {
      title: "Planos em fila",
      value: String(stats.planosPendentes),
      description: "Rascunhos ou execuções aguardando geração e revisão pedagógica.",
      icon: Clock3,
    },
    {
      title: "Tokens usados no mês",
      value: String(stats.tokensUsadosMes),
      description: `Consumo do plano ${stats.planoAtual} para operações com IA neste mês.`,
      icon: Sparkles,
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      {/* Hero */}
      <section className="rounded-[2rem] bg-slate-950 px-8 py-10 text-white shadow-xl">
        <div className="flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-300">Dashboard</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">Visão geral do PlanoMagistra</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
              Acompanhe capacidade operacional, volume de geração e o estado atual dos fluxos pedagógicos.
            </p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur">
            <p className="text-sm text-slate-300">Usuário autenticado</p>
            <p className="mt-2 text-xl font-semibold">{user.nome || user.email}</p>
            <p className="mt-1 text-sm text-slate-300">{user.escola_padrao ?? "Escola padrão ainda não definida."}</p>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="grid gap-5 xl:grid-cols-4">
        {cards.map((card) => (
          <StatCard
            key={card.title}
            title={card.title}
            value={card.value}
            description={card.description}
            icon={card.icon}
          />
        ))}
      </section>

      {/* Planos recentes */}
      <section className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Recentes</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">Seus planos</h2>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard/historico"
              className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-slate-950 hover:text-slate-950"
            >
              Ver todos
            </Link>
            <Link
              href="/dashboard/gerar"
              className="flex items-center gap-1.5 rounded-xl bg-slate-950 px-3 py-2 text-xs font-medium text-white transition hover:bg-slate-800"
            >
              <Plus className="h-3.5 w-3.5" />
              Novo plano
            </Link>
          </div>
        </div>

        {planos.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-10 text-center">
            <FileText className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm font-medium text-slate-600">Nenhum plano gerado ainda.</p>
            <Link
              href="/dashboard/gerar"
              className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              Gerar primeiro plano
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {planos.map((plano) => {
              const status = STATUS_CONFIG[plano.status] ?? { label: plano.status, cls: "bg-slate-100 text-slate-600" };
              const temConteudo = Object.keys(plano.conteudo_gerado ?? {}).length > 0;
              return (
                <div
                  key={plano.id}
                  className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 rounded-xl bg-violet-50 p-2 text-violet-600">
                      <FileText className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="font-medium text-slate-900">{plano.template_nome}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {plano.escola_nome ? `${plano.escola_nome} · ` : ""}
                        {formatDate(plano.data_geracao)}
                      </p>
                      <span className={`mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${status.cls}`}>
                        {status.label}
                      </span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {plano.status === "gerado" && temConteudo && (
                      <a
                        href={`/api/planos/${plano.id}/download`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Baixar
                      </a>
                    )}
                    <Link
                      href={`/dashboard/historico/${plano.id}`}
                      className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
                    >
                      Ver detalhes
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Quick actions */}
      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <article className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Resumo operacional</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Ambiente preparado</h2>
          <p className="mt-4 text-sm leading-7 text-slate-600">
            A assistente pedagógica está pronta para elaborar planos de aula, sequências didáticas e documentos escolares com agilidade.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <div className="rounded-3xl bg-slate-50 p-5">
              <p className="text-sm font-medium text-slate-500">Plano contratado</p>
              <p className="mt-2 text-xl font-semibold text-slate-950">{stats.planoAtual}</p>
            </div>
            <div className="rounded-3xl bg-slate-50 p-5">
              <p className="text-sm font-medium text-slate-500">Escola padrão</p>
              <p className="mt-2 text-xl font-semibold text-slate-950">
                {user.escola_padrao ?? "Defina uma escola"}
              </p>
            </div>
          </div>
        </article>

        <aside className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="rounded-2xl bg-emerald-50 p-3 text-emerald-600">
              <Rocket className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Próxima ação</p>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Gerar novo plano</h2>
            </div>
          </div>
          <p className="mt-4 text-sm leading-7 text-slate-600">
            Lance um novo wizard para consolidar template, dados da turma, referências BNCC/SAEB e aprovação humana.
          </p>
          <Link
            href="/dashboard/gerar"
            className="mt-6 inline-flex items-center justify-center rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            Abrir gerador multi-step
          </Link>
        </aside>
      </section>
    </div>
  );
}
