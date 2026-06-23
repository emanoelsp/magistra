"use client";

import { useState, useRef, useEffect } from "react";
import {
  Building2,
  Plus,
  Pencil,
  Trash2,
  X,
  Sparkles,
  BookOpen,
} from "lucide-react";
import type { EscolaRecord, TurmaRecord } from "../../lib/types/firestore";

interface Props {
  initialEscolas: EscolaRecord[];
  initialTurmas: TurmaRecord[];
}

// ---------------------------------------------------------------------------
// Modal primitives
// ---------------------------------------------------------------------------

function MagisModal({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 pt-8 backdrop-blur-sm"
      style={{ background: "rgba(0,0,0,0.55)" }}
    >
      <style>{`@keyframes magis-pop { from { opacity: 0; transform: scale(0.85) translateY(24px); } to { opacity: 1; transform: scale(1) translateY(0); } }`}</style>
      <div
        className="flex w-full max-w-sm flex-col overflow-hidden rounded-3xl shadow-2xl"
        style={{ animation: "magis-pop 0.35s cubic-bezier(0.34,1.56,0.64,1) both" }}
      >
        {children}
      </div>
    </div>
  );
}

function MagisHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-3 bg-violet-700 px-5 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20">
        <Sparkles className="h-4 w-4 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white leading-tight">Magis</p>
        <p className="text-[11px] text-violet-300">assistente de planos</p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="flex h-7 w-7 items-center justify-center rounded-full text-white/60 hover:bg-white/20 hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function MagisBubble({
  text,
  variant = "default",
}: {
  text: string;
  variant?: "default" | "warning";
}) {
  return (
    <div className="flex items-end gap-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-600 shadow-sm mb-0.5">
        <Sparkles className="h-3 w-3 text-white" />
      </div>
      <div className="flex max-w-[80%] flex-col gap-1">
        <div
          className={`rounded-2xl rounded-bl-sm px-4 py-2.5 shadow-sm ${
            variant === "warning" ? "bg-amber-50" : "bg-white"
          }`}
        >
          <p className={`text-sm ${variant === "warning" ? "text-amber-800" : "text-slate-800"}`}>
            {text}
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add/Edit Escola Modal
// ---------------------------------------------------------------------------

interface EscolaModalProps {
  target: EscolaRecord | null;
  onClose: () => void;
  onSaved: (escola: EscolaRecord) => void;
}

function EscolaModal({ target, onClose, onSaved }: EscolaModalProps) {
  const [nome, setNome] = useState(target?.nome ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = nome.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      if (target) {
        const res = await fetch(`/api/escolas/${target.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nome: trimmed }),
        });
        if (!res.ok) {
          const d = (await res.json()) as { error?: string };
          throw new Error(d.error ?? "Falha ao atualizar.");
        }
        onSaved({ ...target, nome: trimmed });
      } else {
        const res = await fetch("/api/escolas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nome: trimmed }),
        });
        if (!res.ok) {
          const d = (await res.json()) as { error?: string };
          throw new Error(d.error ?? "Falha ao criar.");
        }
        const d = (await res.json()) as { id: string; nome: string; criado_em: string };
        onSaved({ id: d.id, user_id: "", nome: d.nome, criado_em: d.criado_em });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <MagisModal>
      <MagisHeader onClose={onClose} />
      <div className="bg-[#ece5dd] px-4 py-5 space-y-2">
        <MagisBubble
          text={
            target
              ? "Qual o novo nome para a escola?"
              : "Qual é o nome da escola?"
          }
        />
      </div>
      <form onSubmit={handleSubmit} className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 space-y-3">
        {error && (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>
        )}
        <input
          ref={inputRef}
          type="text"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Ex: E.E. Prof. João Alves"
          className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-950"
        />
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving || !nome.trim()}
            className="flex-1 rounded-2xl bg-slate-950 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </form>
    </MagisModal>
  );
}

// ---------------------------------------------------------------------------
// Delete Escola Modal
// ---------------------------------------------------------------------------

interface DeleteEscolaModalProps {
  escola: EscolaRecord;
  turmaCount: number;
  onClose: () => void;
  onDeleted: () => void;
}

function DeleteEscolaModal({ escola, turmaCount, onClose, onDeleted }: DeleteEscolaModalProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/escolas/${escola.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? "Falha ao excluir.");
      }
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
      setSaving(false);
    }
  }

  return (
    <MagisModal>
      <MagisHeader onClose={onClose} />
      <div className="bg-[#ece5dd] px-4 py-5 space-y-2">
        <MagisBubble text={`Tem certeza que deseja excluir "${escola.nome}"?`} />
        {turmaCount > 0 && (
          <MagisBubble
            text={`Isso também removerá ${turmaCount === 1 ? "a 1 turma vinculada" : `as ${turmaCount} turmas vinculadas`}.`}
            variant="warning"
          />
        )}
      </div>
      <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 space-y-3">
        {error && (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={saving}
            className="flex-1 rounded-2xl bg-rose-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Excluindo…" : "Excluir"}
          </button>
        </div>
      </div>
    </MagisModal>
  );
}

// ---------------------------------------------------------------------------
// Add Turma Modal
// ---------------------------------------------------------------------------

interface AddTurmaModalProps {
  escola: EscolaRecord;
  onClose: () => void;
  onAdded: (turma: TurmaRecord) => void;
}

function AddTurmaModal({ escola, onClose, onAdded }: AddTurmaModalProps) {
  const currentYear = new Date().getFullYear();
  const [nomeTurma, setNomeTurma] = useState("");
  const [disciplina, setDisciplina] = useState("");
  const [anoLetivo, setAnoLetivo] = useState(currentYear);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedNome = nomeTurma.trim();
    if (!trimmedNome) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/turmas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          escola_id: escola.id,
          escola_nome: escola.nome,
          nome: trimmedNome,
          disciplina: disciplina.trim() || undefined,
          ano_letivo: anoLetivo,
        }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? "Falha ao criar turma.");
      }
      const d = (await res.json()) as {
        id: string;
        escola_id: string;
        escola_nome: string;
        nome: string;
        ano_letivo: number;
        disciplina?: string;
        criado_em: string;
      };
      onAdded({
        id: d.id,
        user_id: "",
        escola_id: d.escola_id,
        escola_nome: d.escola_nome,
        nome: d.nome,
        ano_letivo: d.ano_letivo,
        disciplina: d.disciplina,
        criado_em: d.criado_em,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <MagisModal>
      <MagisHeader onClose={onClose} />
      <div className="bg-[#ece5dd] px-4 py-5 space-y-2">
        <MagisBubble text="Qual é o nome da turma? Por exemplo: 5º A, 8º B Vespertino." />
        <MagisBubble text="Qual disciplina você leciona nessa turma? (opcional)" />
      </div>
      <form onSubmit={handleSubmit} className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 space-y-3">
        {error && (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>
        )}
        <input
          ref={inputRef}
          type="text"
          value={nomeTurma}
          onChange={(e) => setNomeTurma(e.target.value)}
          placeholder="Ex: 5º A, 8º B Vespertino"
          className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-950"
        />
        <input
          type="text"
          value={disciplina}
          onChange={(e) => setDisciplina(e.target.value)}
          placeholder="Ex: Matemática (opcional)"
          className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-950"
        />
        <div className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-2.5">
          <span className="text-sm text-slate-600">Ano letivo</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAnoLetivo((y) => y - 1)}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 text-slate-600 hover:bg-slate-50 text-base leading-none"
            >
              −
            </button>
            <span className="w-12 text-center text-sm font-medium text-slate-900">{anoLetivo}</span>
            <button
              type="button"
              onClick={() => setAnoLetivo((y) => y + 1)}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 text-slate-600 hover:bg-slate-50 text-base leading-none"
            >
              +
            </button>
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving || !nomeTurma.trim()}
            className="flex-1 rounded-2xl bg-violet-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Adicionando…" : "Adicionar turma"}
          </button>
        </div>
      </form>
    </MagisModal>
  );
}

// ---------------------------------------------------------------------------
// Delete Turma Modal
// ---------------------------------------------------------------------------

interface DeleteTurmaModalProps {
  turma: TurmaRecord;
  onClose: () => void;
  onDeleted: () => void;
}

function DeleteTurmaModal({ turma, onClose, onDeleted }: DeleteTurmaModalProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/turmas/${turma.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? "Falha ao excluir turma.");
      }
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
      setSaving(false);
    }
  }

  return (
    <MagisModal>
      <MagisHeader onClose={onClose} />
      <div className="bg-[#ece5dd] px-4 py-5 space-y-2">
        <MagisBubble text={`Deseja excluir a turma "${turma.nome}"?`} />
      </div>
      <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 space-y-3">
        {error && (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={saving}
            className="flex-1 rounded-2xl bg-rose-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Excluindo…" : "Excluir"}
          </button>
        </div>
      </div>
    </MagisModal>
  );
}

// ---------------------------------------------------------------------------
// Main EscolasManager
// ---------------------------------------------------------------------------

export function EscolasManager({ initialEscolas, initialTurmas }: Props) {
  const [escolas, setEscolas] = useState<EscolaRecord[]>(initialEscolas);
  const [turmas, setTurmas] = useState<TurmaRecord[]>(initialTurmas);

  const [addEscolaOpen, setAddEscolaOpen] = useState(false);
  const [editEscolaTarget, setEditEscolaTarget] = useState<EscolaRecord | null>(null);
  const [deleteEscolaTarget, setDeleteEscolaTarget] = useState<EscolaRecord | null>(null);

  const [addTurmaEscolaId, setAddTurmaEscolaId] = useState<string | null>(null);
  const [deleteTurmaTarget, setDeleteTurmaTarget] = useState<TurmaRecord | null>(null);

  function turmasForEscola(escolaId: string) {
    return turmas.filter((t) => t.escola_id === escolaId);
  }

  function handleEscolaSaved(saved: EscolaRecord) {
    if (editEscolaTarget) {
      setEscolas((prev) =>
        prev.map((e) => (e.id === saved.id ? saved : e)).sort((a, b) =>
          a.nome.localeCompare(b.nome, "pt-BR")
        )
      );
      setTurmas((prev) =>
        prev.map((t) => (t.escola_id === saved.id ? { ...t, escola_nome: saved.nome } : t))
      );
      setEditEscolaTarget(null);
    } else {
      setEscolas((prev) =>
        [...prev, saved].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
      );
      setAddEscolaOpen(false);
    }
  }

  function handleEscolaDeleted(escolaId: string) {
    setEscolas((prev) => prev.filter((e) => e.id !== escolaId));
    setTurmas((prev) => prev.filter((t) => t.escola_id !== escolaId));
    setDeleteEscolaTarget(null);
  }

  function handleTurmaAdded(turma: TurmaRecord) {
    setTurmas((prev) =>
      [...prev, turma].sort(
        (a, b) =>
          a.escola_nome.localeCompare(b.escola_nome, "pt-BR") ||
          a.nome.localeCompare(b.nome, "pt-BR")
      )
    );
    setAddTurmaEscolaId(null);
  }

  function handleTurmaDeleted(turmaId: string) {
    setTurmas((prev) => prev.filter((t) => t.id !== turmaId));
    setDeleteTurmaTarget(null);
  }

  const addTurmaEscola = escolas.find((e) => e.id === addTurmaEscolaId) ?? null;

  return (
    <>
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Escolas</h2>
        <button
          type="button"
          onClick={() => setAddEscolaOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium text-white"
        >
          <Plus className="h-4 w-4" />
          Nova escola
        </button>
      </div>

      {/* Empty state */}
      {escolas.length === 0 && (
        <div className="mt-8 flex flex-col items-center gap-6">
          <div className="flex w-full max-w-sm flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="flex shrink-0 items-center gap-3 bg-violet-700 px-5 py-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20">
                <Sparkles className="h-4 w-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white leading-tight">Magis</p>
                <p className="text-[11px] text-violet-300">assistente de planos</p>
              </div>
            </div>
            <div className="bg-[#ece5dd] px-4 py-5">
              <div className="flex items-end gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-600 shadow-sm mb-0.5">
                  <Sparkles className="h-3 w-3 text-white" />
                </div>
                <div className="max-w-[80%]">
                  <div className="rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 shadow-sm">
                    <p className="text-sm text-slate-800">
                      Você ainda não tem nenhuma escola cadastrada. Adicione sua primeira escola para começar a organizar suas turmas e planos!
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setAddEscolaOpen(true)}
            className="inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-4 py-2 text-sm font-medium text-white"
          >
            <Plus className="h-4 w-4" />
            Adicionar escola
          </button>
        </div>
      )}

      {/* Escola cards */}
      <div className="space-y-4">
        {escolas.map((escola) => {
          const escolaTurmas = turmasForEscola(escola.id);
          return (
            <div
              key={escola.id}
              className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              {/* School header */}
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
                  <Building2 className="h-5 w-5" />
                </div>
                <p className="flex-1 font-semibold text-slate-900 leading-tight">{escola.nome}</p>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setEditEscolaTarget(escola)}
                    className="inline-flex items-center gap-1 rounded-2xl border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Pencil className="h-3 w-3" />
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteEscolaTarget(escola)}
                    className="inline-flex items-center gap-1 rounded-2xl border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50"
                  >
                    <Trash2 className="h-3 w-3" />
                    Excluir
                  </button>
                </div>
              </div>

              {/* Divider */}
              <div className="my-4 border-t border-slate-100" />

              {/* Turmas section */}
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Turmas
                </p>
                <div className="flex flex-wrap gap-2">
                  {escolaTurmas.map((turma) => (
                    <div
                      key={turma.id}
                      className="inline-flex items-center gap-1.5 rounded-2xl bg-slate-100 px-3 py-1.5 text-sm"
                    >
                      <BookOpen className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      <span className="text-slate-800 font-medium">{turma.nome}</span>
                      {turma.disciplina && (
                        <span className="text-slate-500 text-xs">· {turma.disciplina}</span>
                      )}
                      <button
                        type="button"
                        onClick={() => setDeleteTurmaTarget(turma)}
                        className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-slate-400 hover:bg-slate-300 hover:text-slate-700"
                        aria-label={`Excluir turma ${turma.nome}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setAddTurmaEscolaId(escola.id)}
                    className="inline-flex items-center gap-1.5 rounded-2xl border border-dashed border-violet-300 px-3 py-1.5 text-sm font-medium text-violet-600 hover:border-violet-400 hover:bg-violet-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Nova turma
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modals */}
      {addEscolaOpen && (
        <EscolaModal
          target={null}
          onClose={() => setAddEscolaOpen(false)}
          onSaved={handleEscolaSaved}
        />
      )}

      {editEscolaTarget && (
        <EscolaModal
          target={editEscolaTarget}
          onClose={() => setEditEscolaTarget(null)}
          onSaved={handleEscolaSaved}
        />
      )}

      {deleteEscolaTarget && (
        <DeleteEscolaModal
          escola={deleteEscolaTarget}
          turmaCount={turmasForEscola(deleteEscolaTarget.id).length}
          onClose={() => setDeleteEscolaTarget(null)}
          onDeleted={() => handleEscolaDeleted(deleteEscolaTarget.id)}
        />
      )}

      {addTurmaEscola && (
        <AddTurmaModal
          escola={addTurmaEscola}
          onClose={() => setAddTurmaEscolaId(null)}
          onAdded={handleTurmaAdded}
        />
      )}

      {deleteTurmaTarget && (
        <DeleteTurmaModal
          turma={deleteTurmaTarget}
          onClose={() => setDeleteTurmaTarget(null)}
          onDeleted={() => handleTurmaDeleted(deleteTurmaTarget.id)}
        />
      )}
    </>
  );
}
