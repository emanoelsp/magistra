"use client";

import { useState, useRef, useEffect } from "react";
import {
  Building2,
  ChevronDown,
  Plus,
  Pencil,
  Trash2,
  X,
  Sparkles,
  Users,
  Unlink,
  AlertCircle,
} from "lucide-react";
import type { CursoEntry, CursoTipo, EscolaRecord, TurmaRecord } from "../../lib/types/firestore";
import { showMagisToast } from "../../lib/utils/magis-toast";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CURSO_TIPOS: CursoTipo[] = ["fundamental", "medio", "medio_tecnico", "superior"];

const CURSO_LABELS: Record<CursoTipo, string> = {
  fundamental: "Ensino Fundamental",
  medio: "Ensino Médio",
  medio_tecnico: "Ensino Médio Técnico",
  superior: "Ensino Superior",
};

const CURSO_COLORS: Record<CursoTipo, string> = {
  fundamental: "bg-sky-100 text-sky-700 border-sky-200",
  medio: "bg-emerald-100 text-emerald-700 border-emerald-200",
  medio_tecnico: "bg-amber-100 text-amber-700 border-amber-200",
  superior: "bg-violet-100 text-violet-700 border-violet-200",
};

function cursoLabel(c: CursoEntry): string {
  if ((c.tipo === "medio_tecnico" || c.tipo === "superior") && c.nome)
    return `${CURSO_LABELS[c.tipo]} – ${c.nome}`;
  return CURSO_LABELS[c.tipo];
}

// deterministic group id: same escola + same tipo_curso + same série prefix → same group
function computeGrupoId(escolaId: string, tipoCurso: string, nomeTurma: string): string {
  const m = nomeTurma.trim().match(/^(\d+)/);
  const serie = m ? m[1] : nomeTurma.trim().slice(0, 3).toLowerCase();
  return `g_${escolaId.slice(-6)}_${tipoCurso}_${serie}`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  initialEscolas: EscolaRecord[];
  initialTurmas: TurmaRecord[];
  initialEscolaPadrao: string | null;
}

// ---------------------------------------------------------------------------
// Modal shell
// ---------------------------------------------------------------------------

function MagisModal({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 pt-8 backdrop-blur-sm"
      style={{ background: "rgba(0,0,0,0.55)" }}
    >
      <style>{`@keyframes magis-pop { from { opacity:0;transform:scale(.85) translateY(24px)} to { opacity:1;transform:scale(1) translateY(0)} }`}</style>
      <div
        className={`flex w-full flex-col overflow-hidden rounded-3xl shadow-2xl ${wide ? "max-w-md" : "max-w-sm"}`}
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

function MagisBubble({ text, variant = "default" }: { text: string; variant?: "default" | "warning" }) {
  return (
    <div className="flex items-end gap-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-600 shadow-sm mb-0.5">
        <Sparkles className="h-3 w-3 text-white" />
      </div>
      <div className="max-w-[82%]">
        <div className={`rounded-2xl rounded-bl-sm px-4 py-2.5 shadow-sm ${variant === "warning" ? "bg-amber-50" : "bg-white"}`}>
          <p className={`text-sm leading-snug ${variant === "warning" ? "text-amber-800" : "text-slate-800"}`}>{text}</p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EscolaModal — multi-step: nome → cursos → turmas (per curso) → confirm_default
// ---------------------------------------------------------------------------

type EscolaStep = "nome" | "cursos" | "turmas" | "confirm_default";

interface EscolaModalProps {
  target: EscolaRecord | null;
  hasEscolaPadrao: boolean;
  onClose: () => void;
  onSaved: (escola: EscolaRecord) => void;
  onTurmaAdded: (turma: TurmaRecord) => void;
  onSetEscolaPadrao: (nome: string) => void;
}

function EscolaModal({ target, hasEscolaPadrao, onClose, onSaved, onTurmaAdded, onSetEscolaPadrao }: EscolaModalProps) {
  const [step, setStep] = useState<EscolaStep>("nome");
  const [nome, setNome] = useState(target?.nome ?? "");
  const [cursos, setCursos] = useState<CursoEntry[]>(target?.cursos ?? []);
  const [cursoIdx, setCursoIdx] = useState(0);
  const [turmaInput, setTurmaInput] = useState("");
  const [disciplinaInput, setDisciplinaInput] = useState("");
  const [turmasAdicionadas, setTurmasAdicionadas] = useState<Record<number, TurmaRecord[]>>({});
  const [createdEscola, setCreatedEscola] = useState<EscolaRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [addingTurma, setAddingTurma] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingDefault, setSettingDefault] = useState(false);
  const nomeRef = useRef<HTMLInputElement>(null);
  const turmaRef = useRef<HTMLInputElement>(null);

  useEffect(() => { nomeRef.current?.focus(); }, []);
  useEffect(() => { if (step === "turmas") turmaRef.current?.focus(); }, [step, cursoIdx]);

  // ── Step: nome ──────────────────────────────────────────────────────────
  function handleSubmitNome(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    setStep("cursos");
  }

  // ── Step: cursos ─────────────────────────────────────────────────────────
  function toggleCurso(tipo: CursoTipo) {
    setCursos((prev) => {
      const exists = prev.find((c) => c.tipo === tipo);
      if (exists) return prev.filter((c) => c.tipo !== tipo);
      return [...prev, { tipo }];
    });
  }

  function setCursoNome(tipo: CursoTipo, cursNome: string) {
    setCursos((prev) => prev.map((c) => c.tipo === tipo ? { ...c, nome: cursNome } : c));
  }

  async function handleSubmitCursos() {
    setSaving(true);
    setError(null);
    try {
      if (target) {
        // Edit: PATCH escola and done
        const res = await fetch(`/api/escolas/${target.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nome: nome.trim(), cursos }),
        });
        if (!res.ok) {
          const d = (await res.json()) as { error?: string };
          throw new Error(d.error ?? "Falha ao atualizar.");
        }
        onSaved({ ...target, nome: nome.trim(), cursos });
        onClose();
      } else {
        // Create: POST escola
        const res = await fetch("/api/escolas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nome: nome.trim(), cursos }),
        });
        if (!res.ok) {
          const d = (await res.json()) as { error?: string };
          throw new Error(d.error ?? "Falha ao criar.");
        }
        const d = (await res.json()) as { id: string; nome: string; criado_em: string };
        const escola: EscolaRecord = { id: d.id, user_id: "", nome: d.nome, cursos, criado_em: d.criado_em };
        setCreatedEscola(escola);
        onSaved(escola);

        if (cursos.length > 0) {
          setCursoIdx(0);
          setStep("turmas");
        } else if (!hasEscolaPadrao) {
          setStep("confirm_default");
        } else {
          onClose();
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
    } finally {
      setSaving(false);
    }
  }

  // ── Step: turmas ─────────────────────────────────────────────────────────
  async function handleAddTurma(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = turmaInput.trim();
    const disciplina = disciplinaInput.trim() || undefined;
    if (!trimmed || !createdEscola) return;
    setAddingTurma(true);
    setError(null);
    try {
      const curso = cursos[cursoIdx];
      const grupoId = computeGrupoId(createdEscola.id, curso.tipo, trimmed);
      const res = await fetch("/api/turmas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          escola_id: createdEscola.id,
          escola_nome: createdEscola.nome,
          nome: trimmed,
          disciplina,
          tipo_curso: curso.tipo,
          curso_nome: curso.nome || undefined,
          grupo_id: grupoId,
          ano_letivo: new Date().getFullYear(),
        }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? "Falha ao criar turma.");
      }
      const d = (await res.json()) as Record<string, unknown>;
      const turma: TurmaRecord = {
        id: d.id as string,
        user_id: "",
        escola_id: createdEscola.id,
        escola_nome: createdEscola.nome,
        nome: trimmed,
        disciplina,
        ano_letivo: new Date().getFullYear(),
        tipo_curso: curso.tipo,
        curso_nome: curso.nome || undefined,
        grupo_id: grupoId,
        criado_em: d.criado_em as string,
      };
      setTurmasAdicionadas((prev) => ({ ...prev, [cursoIdx]: [...(prev[cursoIdx] ?? []), turma] }));
      onTurmaAdded(turma);
      setTurmaInput("");
      setDisciplinaInput("");
      turmaRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
    } finally {
      setAddingTurma(false);
    }
  }

  function handleAdvanceCurso() {
    if (cursoIdx < cursos.length - 1) {
      setCursoIdx((i) => i + 1);
      setTurmaInput("");
      setDisciplinaInput("");
      setError(null);
    } else {
      // All cursos done
      if (!hasEscolaPadrao && createdEscola) {
        setStep("confirm_default");
      } else {
        onClose();
      }
    }
  }

  // ── Step: confirm_default ─────────────────────────────────────────────────
  async function handleSetDefault() {
    if (!createdEscola) return;
    setSettingDefault(true);
    try {
      await fetch("/api/user/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ escola_padrao: createdEscola.nome }),
      });
      onSetEscolaPadrao(createdEscola.nome);
    } finally {
      setSettingDefault(false);
      onClose();
    }
  }

  // ── Renders ───────────────────────────────────────────────────────────────

  if (step === "confirm_default") {
    return (
      <MagisModal>
        <MagisHeader onClose={onClose} />
        <div className="bg-[#ece5dd] px-4 py-5 space-y-2">
          <MagisBubble text={`"${createdEscola?.nome}" foi adicionada com sucesso! 🏫`} />
          <MagisBubble text="Quer defini-la como sua escola padrão? Isso vai pré-preencher automaticamente nos seus próximos planos." />
        </div>
        <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => void handleSetDefault()}
            disabled={settingDefault}
            className="w-full rounded-2xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-60"
          >
            {settingDefault ? "Salvando…" : "Sim, definir como padrão"}
          </button>
          <button type="button" onClick={onClose} className="w-full rounded-2xl border border-slate-200 px-5 py-2.5 text-sm font-medium text-slate-600 hover:border-slate-400">
            Não por agora
          </button>
        </div>
      </MagisModal>
    );
  }

  if (step === "turmas") {
    const curso = cursos[cursoIdx];
    const jaAdicionadas = turmasAdicionadas[cursoIdx] ?? [];
    const isLast = cursoIdx === cursos.length - 1;

    return (
      <MagisModal wide>
        <MagisHeader onClose={onClose} />
        <div className="bg-[#ece5dd] px-4 py-5 space-y-2 max-h-56 overflow-y-auto">
          <MagisBubble text={`Ótimo! Agora adicione as turmas e disciplinas de ${cursoLabel(curso)}. Ex: turma "1º A" com disciplina "Matemática".`} />
          {jaAdicionadas.length > 0 && (
            <MagisBubble text={`Adicionadas: ${jaAdicionadas.map((t) => t.disciplina ? `${t.nome} · ${t.disciplina}` : t.nome).join(", ")} 👍`} />
          )}
        </div>
        <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 space-y-3">
          {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
          {jaAdicionadas.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {jaAdicionadas.map((t) => (
                <span key={t.id} className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-700">
                  {t.nome}{t.disciplina ? ` · ${t.disciplina}` : ""}
                </span>
              ))}
            </div>
          )}
          <form onSubmit={handleAddTurma} className="space-y-2">
            <div className="flex gap-2">
              <input
                ref={turmaRef}
                type="text"
                value={turmaInput}
                onChange={(e) => setTurmaInput(e.target.value)}
                placeholder="Turma · Ex: 1º A"
                className="flex-1 rounded-2xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-slate-950"
              />
              <input
                type="text"
                value={disciplinaInput}
                onChange={(e) => setDisciplinaInput(e.target.value)}
                placeholder="Disciplina · Ex: Matemática"
                className="flex-1 rounded-2xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-slate-950"
              />
            </div>
            <button
              type="submit"
              disabled={addingTurma || !turmaInput.trim()}
              className="w-full rounded-2xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {addingTurma ? "Adicionando…" : "+ Adicionar turma"}
            </button>
          </form>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={handleAdvanceCurso} className="flex-1 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:border-slate-400">
              Pular
            </button>
            <button type="button" onClick={handleAdvanceCurso} className="flex-1 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white">
              {isLast ? "Concluir" : `Próximo: ${cursoLabel(cursos[cursoIdx + 1])}`}
            </button>
          </div>
          <p className="text-center text-xs text-slate-400">
            {cursoIdx + 1} de {cursos.length} modalidades
          </p>
        </div>
      </MagisModal>
    );
  }

  if (step === "cursos") {
    const hasTecNome = cursos.find((c) => c.tipo === "medio_tecnico");
    const hasSupNome = cursos.find((c) => c.tipo === "superior");

    return (
      <MagisModal wide>
        <MagisHeader onClose={onClose} />
        <div className="bg-[#ece5dd] px-4 py-5 space-y-2">
          <MagisBubble text={`"${nome.trim()}" — quais modalidades você leciona nessa escola?`} />
          <MagisBubble text="Pode selecionar mais de uma." />
        </div>
        <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 space-y-3">
          {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
          <div className="space-y-2">
            {CURSO_TIPOS.map((tipo) => {
              const checked = !!cursos.find((c) => c.tipo === tipo);
              const needsNome = tipo === "medio_tecnico" || tipo === "superior";
              const entry = cursos.find((c) => c.tipo === tipo);
              return (
                <div key={tipo}>
                  <label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-2.5 cursor-pointer hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleCurso(tipo)}
                      className="h-4 w-4 rounded accent-violet-600"
                    />
                    <span className="text-sm font-medium text-slate-800">{CURSO_LABELS[tipo]}</span>
                    {needsNome && checked && (
                      <span className="ml-auto text-xs text-slate-400">nome →</span>
                    )}
                  </label>
                  {needsNome && checked && (
                    <input
                      type="text"
                      value={entry?.nome ?? ""}
                      onChange={(e) => setCursoNome(tipo, e.target.value)}
                      placeholder={tipo === "medio_tecnico" ? "Ex: Informática, Enfermagem…" : "Ex: Pedagogia, Direito…"}
                      className="mt-1 w-full rounded-2xl border border-violet-200 bg-violet-50 px-4 py-2 text-sm outline-none focus:border-violet-400"
                    />
                  )}
                </div>
              );
            })}
          </div>
          {/* Validate: if tecnico/superior checked but no nome, warn but don't block */}
          {((hasTecNome && !hasTecNome.nome?.trim()) || (hasSupNome && !hasSupNome.nome?.trim())) && (
            <p className="text-xs text-amber-600">Informe o nome do curso para as modalidades técnicas/superior.</p>
          )}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => setStep("nome")} className="flex-1 rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700">
              Voltar
            </button>
            <button
              type="button"
              onClick={() => void handleSubmitCursos()}
              disabled={saving}
              className="flex-1 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "Salvando…" : cursos.length > 0 ? "Próximo →" : "Salvar sem modalidades"}
            </button>
          </div>
        </div>
      </MagisModal>
    );
  }

  // step === "nome"
  return (
    <MagisModal>
      <MagisHeader onClose={onClose} />
      <div className="bg-[#ece5dd] px-4 py-5 space-y-2">
        <MagisBubble text={target ? "Qual o novo nome para a escola?" : "Vamos lá! Qual é o nome da escola?"} />
      </div>
      <form onSubmit={handleSubmitNome} className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 space-y-3">
        {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
        <input
          ref={nomeRef}
          type="text"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Ex: E.E. Prof. João Alves"
          className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-950"
        />
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">
            Cancelar
          </button>
          <button type="submit" disabled={!nome.trim()} className="flex-1 rounded-2xl bg-slate-950 px-5 py-2 text-sm font-medium text-white disabled:opacity-50">
            Próximo →
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
      showMagisToast(`"${escola.nome}" excluída com sucesso.`, "success");
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
        {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleDelete()}
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
// Add Curso Modal (for "Novo curso" button on existing escola)
// ---------------------------------------------------------------------------

interface AddCursoModalProps {
  escola: EscolaRecord;
  onClose: () => void;
  onCursoAdded: (updatedEscola: EscolaRecord, newCurso: CursoEntry) => void;
}

function AddCursoModal({ escola, onClose, onCursoAdded }: AddCursoModalProps) {
  const existingTipos = (escola.cursos ?? []).map((c) => c.tipo);
  const availableTipos = CURSO_TIPOS.filter((t) => !existingTipos.includes(t));

  const [selectedTipo, setSelectedTipo] = useState<CursoTipo | null>(availableTipos[0] ?? null);
  const [cursoNome, setCursoNome] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsNome = selectedTipo === "medio_tecnico" || selectedTipo === "superior";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTipo) return;
    if (needsNome && !cursoNome.trim()) {
      setError("Informe o nome do curso.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const newCurso: CursoEntry = { tipo: selectedTipo, ...(needsNome && cursoNome.trim() ? { nome: cursoNome.trim() } : {}) };
      const updatedCursos = [...(escola.cursos ?? []), newCurso];
      const res = await fetch(`/api/escolas/${escola.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: escola.nome, cursos: updatedCursos }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? "Falha ao atualizar escola.");
      }
      const updatedEscola: EscolaRecord = { ...escola, cursos: updatedCursos };
      onCursoAdded(updatedEscola, newCurso);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
    } finally {
      setSaving(false);
    }
  }

  if (availableTipos.length === 0) {
    return (
      <MagisModal>
        <MagisHeader onClose={onClose} />
        <div className="bg-[#ece5dd] px-4 py-5 space-y-2">
          <MagisBubble text={`"${escola.nome}" já tem todas as modalidades cadastradas!`} />
        </div>
        <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4">
          <button type="button" onClick={onClose} className="w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Fechar
          </button>
        </div>
      </MagisModal>
    );
  }

  return (
    <MagisModal>
      <MagisHeader onClose={onClose} />
      <div className="bg-[#ece5dd] px-4 py-5 space-y-2">
        <MagisBubble text={`Qual nova modalidade você vai adicionar em ${escola.nome}?`} />
      </div>
      <form onSubmit={handleSubmit} className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 space-y-3">
        {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
        <div className="space-y-2">
          {availableTipos.map((tipo) => (
            <label key={tipo} className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-2.5 cursor-pointer hover:bg-slate-50">
              <input
                type="radio"
                name="tipo"
                value={tipo}
                checked={selectedTipo === tipo}
                onChange={() => { setSelectedTipo(tipo); setCursoNome(""); setError(null); }}
                className="h-4 w-4 accent-violet-600"
              />
              <span className="text-sm font-medium text-slate-800">{CURSO_LABELS[tipo]}</span>
            </label>
          ))}
        </div>
        {needsNome && (
          <input
            type="text"
            value={cursoNome}
            onChange={(e) => { setCursoNome(e.target.value); setError(null); }}
            placeholder={selectedTipo === "medio_tecnico" ? "Ex: Informática, Enfermagem…" : "Ex: Pedagogia, Direito…"}
            autoFocus
            className="w-full rounded-2xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm outline-none focus:border-violet-400"
          />
        )}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving || !selectedTipo || (needsNome && !cursoNome.trim())}
            className="flex-1 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Salvando…" : "Adicionar →"}
          </button>
        </div>
      </form>
    </MagisModal>
  );
}

// ---------------------------------------------------------------------------
// Add Turma Modal (for "Nova turma" button on existing escola)
// ---------------------------------------------------------------------------

interface AddTurmaModalProps {
  escola: EscolaRecord;
  tipoCurso?: CursoEntry | null;
  onClose: () => void;
  onAdded: (turma: TurmaRecord) => void;
}

function AddTurmaModal({ escola, tipoCurso, onClose, onAdded }: AddTurmaModalProps) {
  const currentYear = new Date().getFullYear();
  const [nomeTurma, setNomeTurma] = useState("");
  const [disciplina, setDisciplina] = useState("");
  const [anoLetivo, setAnoLetivo] = useState(currentYear);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedNome = nomeTurma.trim();
    if (!trimmedNome) return;
    setSaving(true);
    setError(null);
    try {
      const grupoId = tipoCurso
        ? computeGrupoId(escola.id, tipoCurso.tipo, trimmedNome)
        : undefined;
      const res = await fetch("/api/turmas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          escola_id: escola.id,
          escola_nome: escola.nome,
          nome: trimmedNome,
          disciplina: disciplina.trim() || undefined,
          ano_letivo: anoLetivo,
          tipo_curso: tipoCurso?.tipo,
          curso_nome: tipoCurso?.nome || undefined,
          grupo_id: grupoId,
        }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? "Falha ao criar turma.");
      }
      const d = (await res.json()) as Record<string, unknown>;
      onAdded({
        id: d.id as string,
        user_id: "",
        escola_id: escola.id,
        escola_nome: escola.nome,
        nome: trimmedNome,
        ano_letivo: anoLetivo,
        disciplina: disciplina.trim() || undefined,
        tipo_curso: tipoCurso?.tipo,
        curso_nome: tipoCurso?.nome || undefined,
        grupo_id: grupoId ?? null,
        criado_em: d.criado_em as string,
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
        {tipoCurso && (
          <div className="self-start ml-9">
            <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${CURSO_COLORS[tipoCurso.tipo]}`}>
              {cursoLabel(tipoCurso)}
            </span>
          </div>
        )}
        <MagisBubble text="Qual é o nome da turma? Ex: 1º A, 2º B Vespertino." />
      </div>
      <form onSubmit={handleSubmit} className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 space-y-3">
        {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
        <input
          ref={inputRef}
          type="text"
          value={nomeTurma}
          onChange={(e) => setNomeTurma(e.target.value)}
          placeholder="Ex: 1º A, 2º B Vespertino"
          className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-950"
        />
        {!tipoCurso && (
          <input
            type="text"
            value={disciplina}
            onChange={(e) => setDisciplina(e.target.value)}
            placeholder="Disciplina (opcional)"
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-950"
          />
        )}
        <div className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-2.5">
          <span className="text-sm text-slate-600">Ano letivo</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setAnoLetivo((y) => y - 1)} className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 text-slate-600 hover:bg-slate-50">−</button>
            <span className="w-12 text-center text-sm font-medium text-slate-900">{anoLetivo}</span>
            <button type="button" onClick={() => setAnoLetivo((y) => y + 1)} className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 text-slate-600 hover:bg-slate-50">+</button>
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">
            Cancelar
          </button>
          <button type="submit" disabled={saving || !nomeTurma.trim()} className="flex-1 rounded-2xl bg-violet-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {saving ? "Adicionando…" : "Adicionar"}
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
        {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleDelete()}
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
// EditTurmaModal
// ---------------------------------------------------------------------------

interface EditTurmaModalProps {
  turma: TurmaRecord;
  onClose: () => void;
  onUpdated: (updated: TurmaRecord) => void;
}

function EditTurmaModal({ turma, onClose, onUpdated }: EditTurmaModalProps) {
  const [nome, setNome] = useState(turma.nome);
  const [disciplina, setDisciplina] = useState(turma.disciplina ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/turmas/${turma.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: nome.trim(), disciplina: disciplina.trim() || "" }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? "Falha ao atualizar.");
      }
      showMagisToast(`Turma "${nome.trim()}" atualizada.`, "success");
      onUpdated({ ...turma, nome: nome.trim(), disciplina: disciplina.trim() || undefined });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
      setSaving(false);
    }
  }

  return (
    <MagisModal>
      <MagisHeader onClose={onClose} />
      <div className="bg-[#ece5dd] px-4 py-5">
        <MagisBubble text={`Editar turma "${turma.nome}"`} />
      </div>
      <form onSubmit={(e) => void handleSave(e)} className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 space-y-3">
        {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
        <input
          type="text"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Turma · Ex: 1º A"
          className="w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-slate-950"
          autoFocus
        />
        <input
          type="text"
          value={disciplina}
          onChange={(e) => setDisciplina(e.target.value)}
          placeholder="Disciplina · Ex: Matemática"
          className="w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-slate-950"
        />
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">
            Cancelar
          </button>
          <button type="submit" disabled={saving || !nome.trim()} className="flex-1 rounded-2xl bg-slate-950 px-5 py-2 text-sm font-medium text-white disabled:opacity-50">
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </form>
    </MagisModal>
  );
}

// ---------------------------------------------------------------------------
// EditCursoModal
// ---------------------------------------------------------------------------

interface EditCursoModalProps {
  escola: EscolaRecord;
  curso: CursoEntry;
  onClose: () => void;
  onUpdated: (updatedCurso: CursoEntry) => void;
}

function EditCursoModal({ escola, curso, onClose, onUpdated }: EditCursoModalProps) {
  const [nome, setNome] = useState(curso.nome ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const updatedCurso: CursoEntry = { ...curso, nome: nome.trim() || undefined };
    const updatedCursos = (escola.cursos ?? []).map((c) => c.tipo === curso.tipo ? updatedCurso : c);
    try {
      const res = await fetch(`/api/escolas/${escola.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: escola.nome, cursos: updatedCursos }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? "Falha ao atualizar.");
      }
      showMagisToast("Curso atualizado.", "success");
      onUpdated(updatedCurso);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
      setSaving(false);
    }
  }

  return (
    <MagisModal>
      <MagisHeader onClose={onClose} />
      <div className="bg-[#ece5dd] px-4 py-5">
        <MagisBubble text="Editar nome do curso" />
      </div>
      <form onSubmit={(e) => void handleSave(e)} className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 space-y-3">
        {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
        <input
          type="text"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Nome do curso · Ex: Análise e Desenvolvimento de Sistemas"
          className="w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-slate-950"
          autoFocus
        />
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="flex-1 rounded-2xl bg-slate-950 px-5 py-2 text-sm font-medium text-white disabled:opacity-50">
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </form>
    </MagisModal>
  );
}

// ---------------------------------------------------------------------------
// DeleteCursoModal
// ---------------------------------------------------------------------------

interface DeleteCursoModalProps {
  escola: EscolaRecord;
  curso: CursoEntry;
  turmaCount: number;
  onClose: () => void;
  onDeleted: () => void;
}

function DeleteCursoModal({ escola, curso, turmaCount, onClose, onDeleted }: DeleteCursoModalProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setSaving(true);
    setError(null);
    const updatedCursos = (escola.cursos ?? []).filter((c) => c.tipo !== curso.tipo);
    try {
      const res = await fetch(`/api/escolas/${escola.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: escola.nome, cursos: updatedCursos }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? "Falha ao excluir.");
      }
      showMagisToast(`Curso "${cursoLabel(curso)}" excluído.`, "success");
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
        <MagisBubble text={`Tem certeza que deseja excluir o curso "${cursoLabel(curso)}"?`} />
        {turmaCount > 0 && (
          <MagisBubble
            text={`Isso também removerá ${turmaCount === 1 ? "a 1 turma vinculada" : `as ${turmaCount} turmas vinculadas`}.`}
            variant="warning"
          />
        )}
      </div>
      <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 space-y-3">
        {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">
            Cancelar
          </button>
          <button type="button" onClick={() => void handleDelete()} disabled={saving} className="flex-1 rounded-2xl bg-rose-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-50">
            {saving ? "Excluindo…" : "Excluir"}
          </button>
        </div>
      </div>
    </MagisModal>
  );
}

// ---------------------------------------------------------------------------
// TurmaSection — renders turmas for one curso inside an escola card
// ---------------------------------------------------------------------------

interface TurmaSectionProps {
  curso: CursoEntry;
  turmas: TurmaRecord[];
  onAddTurma: () => void;
  onEditTurma: (t: TurmaRecord) => void;
  onDeleteTurma: (t: TurmaRecord) => void;
  onDesagrupar: (t: TurmaRecord) => void;
  onEditCurso: () => void;
  onDeleteCurso: () => void;
}

function TurmaSection({ curso, turmas, onAddTurma, onEditTurma, onDeleteTurma, onDesagrupar, onEditCurso, onDeleteCurso }: TurmaSectionProps) {
  const groups = new Map<string, TurmaRecord[]>();
  const solos: TurmaRecord[] = [];

  for (const t of turmas) {
    if (t.grupo_id) {
      const g = groups.get(t.grupo_id) ?? [];
      g.push(t);
      groups.set(t.grupo_id, g);
    } else {
      solos.push(t);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${CURSO_COLORS[curso.tipo]}`}>
          {cursoLabel(curso)}
        </span>
        <button
          type="button"
          onClick={onAddTurma}
          className="inline-flex items-center gap-1 rounded-2xl border border-dashed border-violet-300 px-2.5 py-0.5 text-xs font-medium text-violet-600 hover:border-violet-400 hover:bg-violet-50"
        >
          <Plus className="h-3 w-3" />
          Nova turma
        </button>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={onEditCurso}
            title="Editar curso"
            className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={onDeleteCurso}
            title="Excluir curso"
            className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="space-y-1.5 pl-1">
        {/* Grouped turmas */}
        {Array.from(groups.entries()).map(([gid, gTurmas]) => {
          if (gTurmas.length === 1) {
            const t = gTurmas[0];
            return (
              <TurmaChip key={t.id} turma={t} onEdit={() => onEditTurma(t)} onDelete={() => onDeleteTurma(t)} onDesagrupar={undefined} />
            );
          }
          return (
            <div key={gid} className="flex flex-wrap items-center gap-1.5 rounded-2xl bg-slate-50 border border-slate-200 px-3 py-2">
              <Users className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-label="Turmas agrupadas" />
              {gTurmas.map((t) => (
                <TurmaChip
                  key={t.id}
                  turma={t}
                  onEdit={() => onEditTurma(t)}
                  onDelete={() => onDeleteTurma(t)}
                  onDesagrupar={() => onDesagrupar(t)}
                  compact
                />
              ))}
              <span className="text-[10px] text-slate-400 ml-1">plano compartilhado</span>
            </div>
          );
        })}

        {/* Solo turmas */}
        {solos.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {solos.map((t) => (
              <TurmaChip key={t.id} turma={t} onEdit={() => onEditTurma(t)} onDelete={() => onDeleteTurma(t)} onDesagrupar={undefined} />
            ))}
          </div>
        )}

        {turmas.length === 0 && (
          <p className="text-xs text-slate-400 italic">Nenhuma turma ainda.</p>
        )}
      </div>
    </div>
  );
}

interface TurmaChipProps {
  turma: TurmaRecord;
  compact?: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onDesagrupar: (() => void) | undefined;
}

function TurmaChip({ turma, compact = false, onEdit, onDelete, onDesagrupar }: TurmaChipProps) {
  return (
    <div className="group inline-flex items-center gap-1 rounded-2xl bg-white border border-slate-200 px-2.5 py-1 text-xs shadow-sm">
      {turma.tem_aluno_especial && (
        <span title="Turma com aluno de necessidade especial">
          <AlertCircle className="h-3 w-3 text-amber-500 shrink-0" />
        </span>
      )}
      <span className="font-medium text-slate-800">{turma.nome}</span>
      {turma.disciplina && !compact && (
        <span className="text-slate-400">· {turma.disciplina}</span>
      )}
      {onDesagrupar && (
        <button
          type="button"
          onClick={onDesagrupar}
          title="Desagrupar — criar plano individual para esta turma"
          className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-slate-300 hover:bg-slate-100 hover:text-amber-600"
        >
          <Unlink className="h-2.5 w-2.5" />
        </button>
      )}
      <button
        type="button"
        onClick={onEdit}
        title="Editar turma"
        className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-slate-300 opacity-0 group-hover:opacity-100 hover:bg-slate-100 hover:text-slate-700 transition-opacity"
        aria-label={`Editar turma ${turma.nome}`}
      >
        <Pencil className="h-2.5 w-2.5" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-slate-300 hover:bg-slate-100 hover:text-rose-600"
        aria-label={`Excluir turma ${turma.nome}`}
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main EscolasManager
// ---------------------------------------------------------------------------

export function EscolasManager({ initialEscolas, initialTurmas, initialEscolaPadrao }: Props) {
  const [escolas, setEscolas] = useState<EscolaRecord[]>(initialEscolas);
  const [turmas, setTurmas] = useState<TurmaRecord[]>(initialTurmas);
  const [escolaPadrao, setEscolaPadrao] = useState<string | null>(initialEscolaPadrao);

  const [collapsedEscolas, setCollapsedEscolas] = useState<Set<string>>(new Set());
  const [addEscolaOpen, setAddEscolaOpen] = useState(false);
  const [editEscolaTarget, setEditEscolaTarget] = useState<EscolaRecord | null>(null);
  const [deleteEscolaTarget, setDeleteEscolaTarget] = useState<EscolaRecord | null>(null);

  // {escolaId, tipoCurso?: CursoEntry}
  const [addTurmaTarget, setAddTurmaTarget] = useState<{ escolaId: string; tipoCurso?: CursoEntry } | null>(null);
  const [editTurmaTarget, setEditTurmaTarget] = useState<TurmaRecord | null>(null);
  const [deleteTurmaTarget, setDeleteTurmaTarget] = useState<TurmaRecord | null>(null);
  const [addCursoTarget, setAddCursoTarget] = useState<EscolaRecord | null>(null);
  const [editCursoTarget, setEditCursoTarget] = useState<{ escola: EscolaRecord; curso: CursoEntry } | null>(null);
  const [deleteCursoTarget, setDeleteCursoTarget] = useState<{ escola: EscolaRecord; curso: CursoEntry } | null>(null);

  function turmasForEscola(escolaId: string) {
    return turmas.filter((t) => t.escola_id === escolaId);
  }

  function handleEscolaSaved(saved: EscolaRecord) {
    if (editEscolaTarget) {
      setEscolas((prev) =>
        prev.map((e) => (e.id === saved.id ? saved : e)).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
      );
      setTurmas((prev) =>
        prev.map((t) => (t.escola_id === saved.id ? { ...t, escola_nome: saved.nome } : t))
      );
    } else {
      setEscolas((prev) =>
        [...prev, saved].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
      );
    }
  }

  function handleModalClose() {
    setAddEscolaOpen(false);
    setEditEscolaTarget(null);
  }

  function handleTurmaAdded(turma: TurmaRecord) {
    setTurmas((prev) =>
      [...prev, turma].sort(
        (a, b) => a.escola_nome.localeCompare(b.escola_nome, "pt-BR") || a.nome.localeCompare(b.nome, "pt-BR")
      )
    );
    setAddTurmaTarget(null);
  }

  function handleCursoAdded(updatedEscola: EscolaRecord, newCurso: CursoEntry) {
    setEscolas((prev) => prev.map((e) => e.id === updatedEscola.id ? updatedEscola : e));
    setAddCursoTarget(null);
    setAddTurmaTarget({ escolaId: updatedEscola.id, tipoCurso: newCurso });
  }

  function handleEscolaDeleted(escolaId: string) {
    setEscolas((prev) => prev.filter((e) => e.id !== escolaId));
    setTurmas((prev) => prev.filter((t) => t.escola_id !== escolaId));
    setDeleteEscolaTarget(null);
  }

  function handleTurmaUpdated(updated: TurmaRecord) {
    setTurmas((prev) => prev.map((t) => t.id === updated.id ? updated : t));
    setEditTurmaTarget(null);
  }

  function handleTurmaDeleted(turmaId: string) {
    setTurmas((prev) => prev.filter((t) => t.id !== turmaId));
    setDeleteTurmaTarget(null);
  }

  function handleCursoUpdated(escolaId: string, updatedCurso: CursoEntry) {
    setEscolas((prev) => prev.map((e) => {
      if (e.id !== escolaId) return e;
      return { ...e, cursos: (e.cursos ?? []).map((c) => c.tipo === updatedCurso.tipo ? updatedCurso : c) };
    }));
    setEditCursoTarget(null);
  }

  function handleCursoDeleted(escolaId: string, cursoTipo: string) {
    setEscolas((prev) => prev.map((e) => {
      if (e.id !== escolaId) return e;
      return { ...e, cursos: (e.cursos ?? []).filter((c) => c.tipo !== cursoTipo) };
    }));
    setTurmas((prev) => prev.filter((t) => !(t.escola_id === escolaId && t.tipo_curso === cursoTipo)));
    setDeleteCursoTarget(null);
  }

  async function handleDesagrupar(turma: TurmaRecord) {
    try {
      await fetch(`/api/turmas/${turma.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grupo_id: null, tem_aluno_especial: true }),
      });
      setTurmas((prev) =>
        prev.map((t) => t.id === turma.id ? { ...t, grupo_id: null, tem_aluno_especial: true } : t)
      );
    } catch {
      // silent — turma already shows in list
    }
  }

  const addTurmaEscola = addTurmaTarget
    ? escolas.find((e) => e.id === addTurmaTarget.escolaId) ?? null
    : null;

  return (
    <>
      {/* ── Magis bubble ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-6">
        <div className="flex items-start gap-3 max-w-2xl">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-violet-600 shadow-md">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1 rounded-2xl rounded-tl-none border border-violet-100 bg-violet-50 p-4 shadow-sm">
            <div className="mb-1.5 flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-violet-600" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-violet-600">Magis</span>
            </div>
            {escolas.length === 0 ? (
              <p className="text-sm leading-relaxed text-slate-800">
                Vamos organizar suas escolas e turmas! Isso torna seus planos muito mais rápidos de preencher. Me conta: em qual escola você leciona?
              </p>
            ) : (
              <p className="text-sm leading-relaxed text-slate-800">
                Ótimo! Com suas escolas cadastradas podemos organizar melhor os templates e planos de aula. Se desejar criar mais escolas, é só clicar no botão a seguir.
              </p>
            )}
          </div>
        </div>
        <div className="flex w-full justify-center">
          <button
            type="button"
            onClick={() => setAddEscolaOpen(true)}
            className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-violet-500"
          >
            <Building2 className="h-4 w-4" />
            {escolas.length === 0 ? "Adicionar minha primeira escola" : "Adicionar nova escola"}
            <span>→</span>
          </button>
        </div>
      </div>

      {/* ── Escolas list ─────────────────────────────────────────────────── */}
      {escolas.length > 0 && (
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          {/* Section header */}
          <div className="mb-3 flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-slate-500" />
              <p className="text-sm font-semibold text-slate-800">Escolas cadastradas</p>
            </div>
            <span className="text-sm text-slate-400">
              {escolas.length} cadastrada{escolas.length !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Escola cards */}
          <div className="space-y-3">
            {escolas.map((escola) => {
              const escolaTurmas = turmasForEscola(escola.id);
              const hasCursos = !!(escola.cursos && escola.cursos.length > 0);
              const turmaCount = escolaTurmas.length;
              const cursoCount = (escola.cursos ?? []).length;
              const isCollapsed = collapsedEscolas.has(escola.id);
              const toggleCollapse = () =>
                setCollapsedEscolas((prev) => {
                  const next = new Set(prev);
                  if (next.has(escola.id)) next.delete(escola.id);
                  else next.add(escola.id);
                  return next;
                });

              return (
                <div key={escola.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  {/* Row */}
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
                      <Building2 className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-slate-900 leading-tight">{escola.nome}</p>
                        {escolaPadrao && escola.nome === escolaPadrao && (
                          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                            padrão
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {turmaCount > 0
                          ? `${turmaCount} turma${turmaCount !== 1 ? "s" : ""}`
                          : "Sem turmas"}
                        {cursoCount > 0
                          ? ` · ${cursoCount} modalidade${cursoCount !== 1 ? "s" : ""}`
                          : ""}
                      </p>
                    </div>
                    {/* Actions */}
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                      {hasCursos ? (
                        <button
                          type="button"
                          onClick={() => setAddCursoTarget(escola)}
                          className="inline-flex items-center gap-1 rounded-xl border border-dashed border-indigo-300 px-3 py-1.5 text-xs font-medium text-indigo-600 transition hover:border-indigo-400 hover:bg-indigo-50"
                        >
                          <Plus className="h-3 w-3" />
                          Novo curso
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setAddTurmaTarget({ escolaId: escola.id })}
                          className="inline-flex items-center gap-1 rounded-xl border border-dashed border-violet-300 px-3 py-1.5 text-xs font-medium text-violet-600 transition hover:border-violet-400 hover:bg-violet-50"
                        >
                          <Plus className="h-3 w-3" />
                          Nova turma
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setEditEscolaTarget(escola)}
                        className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        <Pencil className="h-3 w-3" />
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteEscolaTarget(escola)}
                        className="inline-flex items-center gap-1 rounded-xl border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50"
                      >
                        <Trash2 className="h-3 w-3" />
                        Excluir
                      </button>
                      <button
                        type="button"
                        onClick={toggleCollapse}
                        aria-label={isCollapsed ? "Expandir turmas" : "Recolher turmas"}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                      >
                        <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isCollapsed ? "-rotate-90" : ""}`} />
                      </button>
                    </div>
                  </div>

                  {/* Expandable turmas / cursos */}
                  {!isCollapsed && (hasCursos || turmaCount > 0) && (
                    <div className="mt-3 border-t border-slate-50 pt-3">
                      {hasCursos ? (
                        <div className="space-y-4">
                          {(escola.cursos ?? []).map((curso) => {
                            const cursoTurmas = escolaTurmas.filter((t) => t.tipo_curso === curso.tipo);
                            return (
                              <TurmaSection
                                key={curso.tipo}
                                curso={curso}
                                turmas={cursoTurmas}
                                onAddTurma={() => setAddTurmaTarget({ escolaId: escola.id, tipoCurso: curso })}
                                onEditTurma={(t) => setEditTurmaTarget(t)}
                                onDeleteTurma={(t) => setDeleteTurmaTarget(t)}
                                onDesagrupar={(t) => void handleDesagrupar(t)}
                                onEditCurso={() => setEditCursoTarget({ escola, curso })}
                                onDeleteCurso={() => setDeleteCursoTarget({ escola, curso })}
                              />
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {escolaTurmas.map((turma) => (
                            <TurmaChip
                              key={turma.id}
                              turma={turma}
                              onEdit={() => setEditTurmaTarget(turma)}
                              onDelete={() => setDeleteTurmaTarget(turma)}
                              onDesagrupar={undefined}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────── */}
      {(addEscolaOpen || editEscolaTarget) && (
        <EscolaModal
          target={editEscolaTarget ?? null}
          hasEscolaPadrao={!!escolaPadrao}
          onClose={handleModalClose}
          onSaved={handleEscolaSaved}
          onTurmaAdded={handleTurmaAdded}
          onSetEscolaPadrao={(nome) => setEscolaPadrao(nome)}
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

      {addTurmaEscola && addTurmaTarget && (
        <AddTurmaModal
          escola={addTurmaEscola}
          tipoCurso={addTurmaTarget.tipoCurso ?? null}
          onClose={() => setAddTurmaTarget(null)}
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

      {addCursoTarget && (
        <AddCursoModal
          escola={addCursoTarget}
          onClose={() => setAddCursoTarget(null)}
          onCursoAdded={handleCursoAdded}
        />
      )}

      {editTurmaTarget && (
        <EditTurmaModal
          turma={editTurmaTarget}
          onClose={() => setEditTurmaTarget(null)}
          onUpdated={handleTurmaUpdated}
        />
      )}

      {editCursoTarget && (
        <EditCursoModal
          escola={editCursoTarget.escola}
          curso={editCursoTarget.curso}
          onClose={() => setEditCursoTarget(null)}
          onUpdated={(updated) => handleCursoUpdated(editCursoTarget.escola.id, updated)}
        />
      )}

      {deleteCursoTarget && (
        <DeleteCursoModal
          escola={deleteCursoTarget.escola}
          curso={deleteCursoTarget.curso}
          turmaCount={turmas.filter((t) => t.escola_id === deleteCursoTarget.escola.id && t.tipo_curso === deleteCursoTarget.curso.tipo).length}
          onClose={() => setDeleteCursoTarget(null)}
          onDeleted={() => handleCursoDeleted(deleteCursoTarget.escola.id, deleteCursoTarget.curso.tipo)}
        />
      )}
    </>
  );
}
