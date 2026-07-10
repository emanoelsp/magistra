"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, BookOpen, Check, ChevronDown, Eye, EyeOff, Loader2, Lock } from "lucide-react";
import type { PerfilPedagogico } from "../../../lib/types/firestore";

interface PerfilFormProps {
  nome: string;
  email: string;
  escolaPadrao: string | null;
  perfilPedagogico: PerfilPedagogico;
}

// ─── Dados pessoais ───────────────────────────────────────────────────────────

function DadosPessoaisSection({
  nome,
  email,
  escolaPadrao,
}: Omit<PerfilFormProps, "perfilPedagogico">) {
  const router = useRouter();
  const [values, setValues] = useState({
    nome: nome ?? "",
    escola_padrao: escolaPadrao ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    values.nome.trim() !== (nome ?? "") ||
    values.escola_padrao.trim() !== (escolaPadrao ?? "");

  const nomeEmpty = values.nome.trim() === "";
  const escolaEmpty = values.escola_padrao.trim() === "";
  const hasWarning = nomeEmpty || escolaEmpty;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const res = await fetch("/api/user/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: values.nome.trim(),
          escola_padrao: values.escola_padrao.trim(),
        }),
      });

      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Erro ao salvar");

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {hasWarning && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <p className="text-xs leading-relaxed text-amber-700">
            Preencha os campos destacados para completar seu perfil e remover a notificação do menu.
          </p>
        </div>
      )}

      <div>
        <label className={`mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${nomeEmpty ? "text-amber-600" : "text-slate-500"}`}>
          Nome
          {nomeEmpty && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold normal-case tracking-normal text-amber-600">Pendente</span>}
        </label>
        <input
          type="text"
          value={values.nome}
          onChange={(e) => setValues((v) => ({ ...v, nome: e.target.value }))}
          placeholder="Seu nome completo"
          className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none transition ${nomeEmpty ? "border-amber-400 bg-amber-50/50 focus:border-amber-500" : "border-slate-300 focus:border-slate-950"}`}
        />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
          E-mail
        </label>
        <input
          type="email"
          value={email}
          disabled
          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-400 outline-none"
        />
        <p className="mt-1 text-xs text-slate-400">O e-mail não pode ser alterado.</p>
      </div>

      <div>
        <label className={`mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${escolaEmpty ? "text-amber-600" : "text-slate-500"}`}>
          Escola padrão
          {escolaEmpty && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold normal-case tracking-normal text-amber-600">Pendente</span>}
        </label>
        <input
          type="text"
          value={values.escola_padrao}
          onChange={(e) => setValues((v) => ({ ...v, escola_padrao: e.target.value }))}
          placeholder="Nome da sua escola"
          className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none transition ${escolaEmpty ? "border-amber-400 bg-amber-50/50 focus:border-amber-500" : "border-slate-300 focus:border-slate-950"}`}
        />
        <p className="mt-1 text-xs text-slate-400">
          Preenchida automaticamente nos planos que você gerar.
        </p>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={saving || !dirty}
          className="rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Salvando…
            </span>
          ) : (
            "Salvar alterações"
          )}
        </button>

        {saved && (
          <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-600">
            <Check className="h-4 w-4" />
            Salvo!
          </span>
        )}

        {error && <span className="text-sm text-rose-600">{error}</span>}
      </div>
    </form>
  );
}

// ─── Dados pedagógicos ────────────────────────────────────────────────────────

const NIVEIS_ENSINO = [
  { value: "",     label: "Selecione…" },
  { value: "EI",   label: "Educação Infantil (EI)" },
  { value: "EF1",  label: "Ensino Fundamental — Anos Iniciais (1º ao 5º)" },
  { value: "EF2",  label: "Ensino Fundamental — Anos Finais (6º ao 9º)" },
  { value: "EM",   label: "Ensino Médio (EM)" },
  { value: "EJA",  label: "EJA" },
  { value: "TEC",  label: "Ensino Técnico / Profissionalizante" },
];

const UFS = [
  "",
  "AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT",
  "PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO",
];

function DadosPedagogicosSection({ initial }: { initial: PerfilPedagogico }) {
  const router = useRouter();
  const [values, setValues] = useState<PerfilPedagogico>({
    disciplina:   initial.disciplina   ?? "",
    turma:        initial.turma        ?? "",
    nivel_ensino: initial.nivel_ensino ?? "",
    uf:           initial.uf           ?? "",
    municipio:    initial.municipio    ?? "",
    cargo:        initial.cargo        ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(values) !== JSON.stringify({
    disciplina:   initial.disciplina   ?? "",
    turma:        initial.turma        ?? "",
    nivel_ensino: initial.nivel_ensino ?? "",
    uf:           initial.uf           ?? "",
    municipio:    initial.municipio    ?? "",
    cargo:        initial.cargo        ?? "",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const res = await fetch("/api/user/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ perfil_pedagogico: values }),
      });

      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Erro ao salvar");

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  const set = (k: keyof PerfilPedagogico) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs leading-relaxed text-blue-700">
        Preencha uma vez e a Magis usa esses dados para sugerir automaticamente os campos pedagógicos dos seus planos — sem precisar de IA.
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
            Componente curricular principal
          </label>
          <input
            type="text"
            value={values.disciplina ?? ""}
            onChange={set("disciplina")}
            placeholder="ex: Língua Portuguesa"
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-950"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
            Turma / Série
          </label>
          <input
            type="text"
            value={values.turma ?? ""}
            onChange={set("turma")}
            placeholder="ex: 9º B, Turma 301"
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-950"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
            Nível de ensino
          </label>
          <select
            value={values.nivel_ensino ?? ""}
            onChange={set("nivel_ensino")}
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-950 bg-white"
          >
            {NIVEIS_ENSINO.map((n) => (
              <option key={n.value} value={n.value}>{n.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
            Cargo / Função
          </label>
          <input
            type="text"
            value={values.cargo ?? ""}
            onChange={set("cargo")}
            placeholder="ex: Professor, Coordenador"
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-950"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
            Estado (UF)
          </label>
          <select
            value={values.uf ?? ""}
            onChange={set("uf")}
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-950 bg-white"
          >
            <option value="">Selecione…</option>
            {UFS.filter(Boolean).map((uf) => (
              <option key={uf} value={uf}>{uf}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
            Município
          </label>
          <input
            type="text"
            value={values.municipio ?? ""}
            onChange={set("municipio")}
            placeholder="ex: Florianópolis"
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-950"
          />
        </div>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={saving || !dirty}
          className="rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Salvando…
            </span>
          ) : (
            "Salvar dados pedagógicos"
          )}
        </button>

        {saved && (
          <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-600">
            <Check className="h-4 w-4" />
            Salvo!
          </span>
        )}

        {error && <span className="text-sm text-rose-600">{error}</span>}
      </div>
    </form>
  );
}

// ─── Alterar senha ────────────────────────────────────────────────────────────

function AlterarSenhaSection() {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({ password: "", confirm: "" });
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setValues({ password: "", confirm: "" });
    setError(null);
    setSaved(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    if (values.password.length < 6) {
      setError("A senha deve ter no mínimo 6 caracteres.");
      return;
    }
    if (values.password !== values.confirm) {
      setError("As senhas não coincidem.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/user/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: values.password, confirm: values.confirm }),
      });

      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Erro ao alterar senha");

      setSaved(true);
      setValues({ password: "", confirm: "" });
      setTimeout(() => {
        setSaved(false);
        setOpen(false);
      }, 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível alterar a senha.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-t border-slate-100 pt-5">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (open) reset();
        }}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <Lock className="h-4 w-4 text-slate-400" />
          Alterar senha
        </span>
        <ChevronDown
          className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
              Nova senha
            </label>
            <div className="relative">
              <input
                type={showPwd ? "text" : "password"}
                value={values.password}
                onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
                placeholder="Mínimo 6 caracteres"
                autoComplete="new-password"
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 pr-11 text-sm outline-none transition focus:border-slate-950"
              />
              <button
                type="button"
                onClick={() => setShowPwd((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                tabIndex={-1}
              >
                {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
              Confirmar nova senha
            </label>
            <div className="relative">
              <input
                type={showConfirm ? "text" : "password"}
                value={values.confirm}
                onChange={(e) => setValues((v) => ({ ...v, confirm: e.target.value }))}
                placeholder="Repita a nova senha"
                autoComplete="new-password"
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 pr-11 text-sm outline-none transition focus:border-slate-950"
              />
              <button
                type="button"
                onClick={() => setShowConfirm((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                tabIndex={-1}
              >
                {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={saving || !values.password || !values.confirm}
              className="rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Alterando…
                </span>
              ) : (
                "Alterar senha"
              )}
            </button>

            {saved && (
              <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-600">
                <Check className="h-4 w-4" />
                Senha alterada!
              </span>
            )}

            {error && <span className="text-sm text-rose-600">{error}</span>}
          </div>
        </form>
      )}
    </div>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────

export function PerfilForm({ nome, email, escolaPadrao, perfilPedagogico }: PerfilFormProps) {
  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-5 text-lg font-semibold tracking-tight text-slate-950">Dados pessoais</h2>
        <DadosPessoaisSection nome={nome} email={email} escolaPadrao={escolaPadrao} />
        <AlterarSenhaSection />
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-2.5">
          <div className="rounded-xl bg-blue-100 p-2 text-blue-600">
            <BookOpen className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-lg font-semibold leading-tight tracking-tight text-slate-950">Dados pedagógicos</h2>
            <p className="text-xs text-slate-500">Preenchidos automaticamente nos campos de perfil dos seus planos</p>
          </div>
        </div>
        <DadosPedagogicosSection initial={perfilPedagogico} />
      </div>
    </div>
  );
}
