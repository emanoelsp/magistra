"use client";

import { useState } from "react";
import Link from "next/link";
import { BookOpen, Pencil, Plus, Sparkles, Trash2, UserCheck, X } from "lucide-react";
import type { EscolaRecord, EstudanteRecord, NivelSuporte, TurmaRecord } from "../../lib/types/firestore";
import { showMagisToast } from "../../lib/utils/magis-toast";
import { useRouter } from "next/navigation";

// ── Constants ────────────────────────────────────────────────────────────────

const NIVEL_LABELS: Record<NivelSuporte, string> = {
  baixo:  "Baixo suporte",
  medio:  "Médio suporte",
  alto:   "Alto suporte",
};

const NIVEL_COLORS: Record<NivelSuporte, string> = {
  baixo:  "bg-emerald-50 text-emerald-700",
  medio:  "bg-amber-50 text-amber-700",
  alto:   "bg-rose-50 text-rose-700",
};

// ── Types ────────────────────────────────────────────────────────────────────

interface EstudanteForm {
  nome: string;
  escola_id: string;
  turma_id: string;
  cid: string;
  diagnostico: string;
  necessidades: string;
  nivel_suporte: NivelSuporte | "";
  observacoes: string;
}

const EMPTY_FORM: EstudanteForm = {
  nome: "",
  escola_id: "",
  turma_id: "",
  cid: "",
  diagnostico: "",
  necessidades: "",
  nivel_suporte: "",
  observacoes: "",
};

interface Props {
  initialEstudantes: EstudanteRecord[];
  escolas: EscolaRecord[];
  turmas: TurmaRecord[];
}

// ── Modal shell ──────────────────────────────────────────────────────────────

function MagisModal({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-[5vh] backdrop-blur-sm"
      style={{ background: "rgba(0,0,0,0.55)" }}>
      <style>{`@keyframes magis-pop{from{opacity:0;transform:scale(.85) translateY(24px)}to{opacity:1;transform:scale(1) translateY(0)}}`}</style>
      <div
        className="flex w-full max-w-md max-h-[90vh] flex-col overflow-hidden rounded-3xl shadow-2xl"
        style={{ animation: "magis-pop 0.35s cubic-bezier(0.34,1.56,0.64,1) both" }}
      >
        {children}
      </div>
    </div>
  );
}

function MagisHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-3 bg-violet-700 px-5 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20">
        <Sparkles className="h-4 w-4 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white leading-tight">Magis</p>
        <p className="text-[11px] text-violet-300">{title}</p>
      </div>
      <button type="button" onClick={onClose}
        className="flex h-7 w-7 items-center justify-center rounded-full text-white/60 hover:bg-white/20 hover:text-white">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function EstudantesManager({ initialEstudantes, escolas, turmas }: Props) {
  const router = useRouter();
  const [estudantes, setEstudantes] = useState<EstudanteRecord[]>(initialEstudantes);
  const [modal, setModal] = useState<"create" | "edit" | "delete" | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<EstudanteForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const selectedEstudante = estudantes.find((e) => e.id === selectedId) ?? null;

  // Only turmas where the user is segundo_professor (those allow student association)
  const segundoProfTurmas = turmas.filter((t) => t.tipo_professor === "segundo_professor");
  const filteredTurmas = form.escola_id
    ? segundoProfTurmas.filter((t) => t.escola_id === form.escola_id)
    : segundoProfTurmas;

  function openCreate() {
    setForm(EMPTY_FORM);
    setSelectedId(null);
    setModal("create");
  }

  function openEdit(est: EstudanteRecord) {
    setSelectedId(est.id);
    setForm({
      nome: est.nome,
      escola_id: est.escola_id ?? "",
      turma_id: est.turma_id ?? "",
      cid: est.cid ?? "",
      diagnostico: est.diagnostico ?? "",
      necessidades: est.necessidades ?? "",
      nivel_suporte: est.nivel_suporte ?? "",
      observacoes: est.observacoes ?? "",
    });
    setModal("edit");
  }

  function openDelete(est: EstudanteRecord) {
    setSelectedId(est.id);
    setModal("delete");
  }

  function closeModal() {
    setModal(null);
    setSelectedId(null);
  }

  function schoolName(id: string) {
    return escolas.find((e) => e.id === id)?.nome ?? id;
  }

  function turmaName(id: string) {
    return turmas.find((t) => t.id === id)?.nome ?? id;
  }

  async function handleSave() {
    if (!form.nome.trim()) return;
    setSaving(true);
    try {
      const escolaSelecionada = escolas.find((e) => e.id === form.escola_id);
      const turmaSelecionada = turmas.find((t) => t.id === form.turma_id);
      const payload: Record<string, unknown> = {
        nome: form.nome.trim(),
        escola_id: form.escola_id || undefined,
        escola_nome: escolaSelecionada?.nome,
        turma_id: form.turma_id || undefined,
        turma_nome: turmaSelecionada?.nome,
        cid: form.cid.trim() || undefined,
        diagnostico: form.diagnostico.trim() || undefined,
        necessidades: form.necessidades.trim() || undefined,
        nivel_suporte: form.nivel_suporte || undefined,
        observacoes: form.observacoes.trim() || undefined,
      };

      if (modal === "create") {
        const res = await fetch("/api/estudantes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = (await res.json()) as EstudanteRecord & { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Erro ao criar.");
        setEstudantes((prev) => [...prev, data].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));
        showMagisToast(`"${data.nome}" cadastrado com sucesso!`, "success");
      } else if (modal === "edit" && selectedId) {
        const res = await fetch(`/api/estudantes/${selectedId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Erro ao atualizar.");
        setEstudantes((prev) =>
          prev.map((e) => e.id === selectedId ? { ...e, ...payload, id: selectedId, user_id: e.user_id, criado_em: e.criado_em } : e)
            .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
        );
        showMagisToast("Estudante atualizado com sucesso!", "success");
      }
      closeModal();
    } catch (err) {
      showMagisToast(err instanceof Error ? err.message : "Não foi possível salvar.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedId) return;
    const nome = selectedEstudante?.nome ?? "Estudante";
    setDeleting(true);
    try {
      await fetch(`/api/estudantes/${selectedId}`, { method: "DELETE" });
      setEstudantes((prev) => prev.filter((e) => e.id !== selectedId));
      showMagisToast(`"${nome}" removido.`, "success");
      router.refresh();
      closeModal();
    } catch {
      showMagisToast("Não foi possível excluir.", "error");
    } finally {
      setDeleting(false);
    }
  }

  // ── Form modal shared UI ─────────────────────────────────────────────────

  const formModal = (modal === "create" || modal === "edit") && (
    <MagisModal>
      <MagisHeader
        title={modal === "create" ? "cadastrar estudante" : "editar estudante"}
        onClose={closeModal}
      />
      <div className="flex-1 overflow-y-auto bg-[#ece5dd] px-4 py-4 space-y-3">
        {/* Nome */}
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Nome do estudante *</span>
          <input
            type="text"
            value={form.nome}
            onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
            placeholder="Nome completo"
            className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-950"
          />
        </label>

        {/* Escola */}
        {escolas.length > 0 ? (
          <label className="block">
            <span className="text-xs font-medium text-slate-700">Escola</span>
            <select
              value={form.escola_id}
              onChange={(e) => setForm((f) => ({ ...f, escola_id: e.target.value, turma_id: "" }))}
              className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-950 bg-white"
            >
              <option value="">Selecionar escola…</option>
              {escolas.map((e) => (
                <option key={e.id} value={e.id}>{e.nome}</option>
              ))}
            </select>
          </label>
        ) : (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-xs text-amber-800">
              Nenhuma escola cadastrada.{" "}
              <Link href="/dashboard/escolas" className="font-semibold underline hover:text-amber-900" onClick={closeModal}>
                Cadastre uma escola primeiro
              </Link>{" "}
              para associar o estudante.
            </p>
          </div>
        )}

        {/* Turma */}
        {segundoProfTurmas.length > 0 ? (
          <label className="block">
            <span className="text-xs font-medium text-slate-700">Turma</span>
            <select
              value={form.turma_id}
              onChange={(e) => setForm((f) => ({ ...f, turma_id: e.target.value }))}
              className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-950 bg-white"
            >
              <option value="">Selecionar turma…</option>
              {filteredTurmas.map((t) => (
                <option key={t.id} value={t.id}>{t.escola_nome} — {t.nome}</option>
              ))}
            </select>
          </label>
        ) : turmas.length > 0 ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-xs text-amber-800">
              Nenhuma turma cadastrada como <strong>2º Professor</strong>.{" "}
              <Link href="/dashboard/escolas" className="font-semibold underline hover:text-amber-900" onClick={closeModal}>
                Edite uma turma
              </Link>{" "}
              e selecione o papel de 2º Professor para associar alunos.
            </p>
          </div>
        ) : null}

        {/* CID */}
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Código CID-10</span>
          <input
            type="text"
            value={form.cid}
            onChange={(e) => setForm((f) => ({ ...f, cid: e.target.value }))}
            placeholder="Ex: F84.0, F70"
            className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-950"
          />
        </label>

        {/* Nível de suporte */}
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Nível de suporte (PAEE)</span>
          <select
            value={form.nivel_suporte}
            onChange={(e) => setForm((f) => ({ ...f, nivel_suporte: e.target.value as NivelSuporte | "" }))}
            className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-950 bg-white"
          >
            <option value="">Não informado</option>
            <option value="baixo">Baixo suporte</option>
            <option value="medio">Médio suporte</option>
            <option value="alto">Alto suporte</option>
          </select>
        </label>

        {/* Diagnóstico */}
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Diagnóstico</span>
          <textarea
            value={form.diagnostico}
            onChange={(e) => setForm((f) => ({ ...f, diagnostico: e.target.value }))}
            placeholder="Descrição clínica/pedagógica…"
            rows={2}
            className="mt-1 w-full resize-none rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-950"
          />
        </label>

        {/* Necessidades */}
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Necessidades educacionais especiais</span>
          <textarea
            value={form.necessidades}
            onChange={(e) => setForm((f) => ({ ...f, necessidades: e.target.value }))}
            placeholder="Descreva as NEE do estudante…"
            rows={2}
            className="mt-1 w-full resize-none rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-950"
          />
        </label>

        {/* Observações */}
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Observações</span>
          <textarea
            value={form.observacoes}
            onChange={(e) => setForm((f) => ({ ...f, observacoes: e.target.value }))}
            placeholder="Observações adicionais…"
            rows={2}
            className="mt-1 w-full resize-none rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-950"
          />
        </label>
      </div>

      <div className="flex shrink-0 gap-3 border-t border-slate-200 bg-white px-5 py-4">
        <button type="button" onClick={closeModal}
          className="flex-1 rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-950">
          Cancelar
        </button>
        <button type="button" onClick={() => void handleSave()} disabled={!form.nome.trim() || saving}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50">
          {saving ? "Salvando…" : modal === "create" ? "Cadastrar" : "Salvar"}
        </button>
      </div>
    </MagisModal>
  );

  // ── Delete modal ──────────────────────────────────────────────────────────

  const deleteModal = modal === "delete" && selectedEstudante && (
    <MagisModal>
      <MagisHeader title="confirmar exclusão" onClose={closeModal} />
      <div className="bg-[#ece5dd] px-4 py-5 space-y-2">
        <div className="flex items-end gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-600 shadow-sm mb-0.5">
            <Sparkles className="h-3 w-3 text-white" />
          </div>
          <div className="flex max-w-[80%] flex-col gap-1">
            <div className="rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 shadow-sm">
              <p className="text-sm text-slate-800">Você quer remover <strong>{selectedEstudante.nome}</strong>?</p>
            </div>
            <div className="rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 shadow-sm">
              <p className="text-sm text-slate-500">Os planos criados para este estudante não serão afetados.</p>
            </div>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 gap-3 border-t border-slate-200 bg-white px-5 py-4">
        <button type="button" onClick={closeModal}
          className="flex-1 rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-950">
          Cancelar
        </button>
        <button type="button" onClick={() => void handleDelete()} disabled={deleting}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-rose-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-rose-500 disabled:opacity-50">
          <Trash2 className="h-4 w-4" />
          {deleting ? "Removendo…" : "Remover"}
        </button>
      </div>
    </MagisModal>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  const hasEstudantes = estudantes.length > 0;

  return (
    <>
      {formModal}
      {deleteModal}

      {/* Magis bubble */}
      <div className="flex items-start gap-3 max-w-2xl">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-violet-600 shadow-md">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 rounded-2xl rounded-tl-none border border-violet-100 bg-violet-50 p-4 shadow-sm">
          <div className="mb-1.5 flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-violet-600" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-violet-600">Magis</span>
          </div>
          {!hasEstudantes ? (
            <p className="text-sm leading-relaxed text-slate-800">
              Aqui você cadastra os alunos com necessidades especiais. Clique no botão abaixo para adicionar o primeiro estudante e começar a criar Planos Educacionais Individualizados personalizados!
            </p>
          ) : (
            <p className="text-sm leading-relaxed text-slate-800">
              Você tem <strong>{estudantes.length} aluno{estudantes.length !== 1 ? "s" : ""}</strong> cadastrado{estudantes.length !== 1 ? "s" : ""}. Clique em <strong>Criar PEI</strong> para iniciar um plano educacional individualizado, ou cadastre um novo aluno abaixo.
            </p>
          )}
        </div>
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {estudantes.length} estudante{estudantes.length !== 1 ? "s" : ""} cadastrado{estudantes.length !== 1 ? "s" : ""}
        </p>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-1.5 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" />
          {hasEstudantes ? "Cadastrar estudante" : "Cadastrar primeiro estudante"}
        </button>
      </div>

      {/* Student list / empty state */}
      {!hasEstudantes ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-10 shadow-sm flex flex-col items-center gap-4 text-center">
          <div className="rounded-2xl bg-indigo-50 p-4 text-indigo-500">
            <UserCheck className="h-8 w-8" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-700">Nenhum estudante cadastrado ainda</p>
            <p className="mt-1 text-xs text-slate-400 max-w-sm">
              Cada aluno fica salvo aqui com seu diagnóstico, necessidades e escola — pronto para gerar PEIs de qualquer disciplina.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-indigo-500"
          >
            <Plus className="h-4 w-4" />
            Cadastrar primeiro estudante
          </button>
        </div>
      ) : (
        <ul className="space-y-3">
          {estudantes.map((est) => (
            <li key={est.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300 transition">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                {/* Info */}
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 shrink-0 rounded-xl bg-indigo-50 p-2 text-indigo-500 shadow-sm">
                    <UserCheck className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-900">{est.nome}</p>
                      {est.nivel_suporte && (
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${NIVEL_COLORS[est.nivel_suporte]}`}>
                          {NIVEL_LABELS[est.nivel_suporte]}
                        </span>
                      )}
                      {est.cid && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                          CID {est.cid}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {est.escola_id ? schoolName(est.escola_id) : (est.escola_nome ?? "Escola não informada")}
                      {est.turma_id && <>{" · "}{turmaName(est.turma_id)}</>}
                      {!est.turma_id && est.turma_nome && <>{" · "}{est.turma_nome}</>}
                    </p>
                    {est.diagnostico && (
                      <p className="mt-1 text-xs text-slate-400 line-clamp-2 max-w-sm">{est.diagnostico}</p>
                    )}
                    {est.necessidades && (
                      <p className="mt-0.5 text-xs text-indigo-400 line-clamp-1 max-w-sm">{est.necessidades}</p>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Link
                    href={`/dashboard/gerar?estudante_id=${est.id}&estudante_nome=${encodeURIComponent(est.nome)}`}
                    className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500"
                  >
                    <BookOpen className="h-3.5 w-3.5" />
                    Criar PEI
                  </Link>
                  <button type="button" onClick={() => openEdit(est)}
                    className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950">
                    <Pencil className="h-3.5 w-3.5" />
                    Editar
                  </button>
                  <button type="button" onClick={() => openDelete(est)}
                    className="flex items-center gap-1.5 rounded-xl border border-rose-200 px-3 py-2 text-xs font-medium text-rose-700 transition hover:border-rose-500 hover:bg-rose-50">
                    <Trash2 className="h-3.5 w-3.5" />
                    Remover
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
