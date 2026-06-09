"use client";

import { useEffect, useState } from "react";
import { addDoc, collection, getDocs, orderBy, query, serverTimestamp, where } from "firebase/firestore";
import { AlertCircle, CheckCircle2, Clock, Loader2, MessageSquarePlus, Send, TicketCheck } from "lucide-react";

import { firebaseDb } from "../../../lib/firebase/client";

// ─── Types ────────────────────────────────────────────────────────────────────

type TicketStatus = "aberto" | "em_atendimento" | "resolvido" | "encerrado";
type Tab = "novo" | "abertos" | "encerrados";

interface Ticket {
  id: string;
  assunto: string;
  categoria: string;
  prioridade: string;
  mensagem: string;
  status: TicketStatus;
  criado_em: Date | null;
  protocolo: string;
}

interface Props {
  userId: string;
  userName: string;
  userEmail: string;
  userEscola: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<TicketStatus, string> = {
  aberto:         "Aberto",
  em_atendimento: "Em atendimento",
  resolvido:      "Resolvido",
  encerrado:      "Encerrado",
};

const STATUS_CLASS: Record<TicketStatus, string> = {
  aberto:         "bg-amber-100 text-amber-700",
  em_atendimento: "bg-violet-100 text-violet-700",
  resolvido:      "bg-emerald-100 text-emerald-700",
  encerrado:      "bg-slate-100 text-slate-500",
};

const PRIORIDADE_CLASS: Record<string, string> = {
  baixa:   "bg-slate-100 text-slate-500",
  normal:  "bg-blue-100 text-blue-600",
  alta:    "bg-amber-100 text-amber-700",
  urgente: "bg-rose-100 text-rose-700",
};

function fmtDate(d: Date | null) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
}

// ─── Novo chamado form ────────────────────────────────────────────────────────

interface FormState {
  assunto: string;
  categoria: string;
  prioridade: string;
  mensagem: string;
}

const EMPTY_FORM: FormState = { assunto: "", categoria: "duvida", prioridade: "normal", mensagem: "" };

function NovoChamadoForm({ userId, userName, userEmail, userEscola, onCreated }: Props & { onCreated: () => void }) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(key: keyof FormState, val: string) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);

    try {
      await addDoc(collection(firebaseDb, "magis_suporte"), {
        user_id:    userId,
        nome:       userName,
        email:      userEmail,
        escola:     userEscola,
        assunto:    form.assunto.trim(),
        categoria:  form.categoria,
        prioridade: form.prioridade,
        mensagem:   form.mensagem.trim(),
        status:     "aberto" as TicketStatus,
        criado_em:  serverTimestamp(),
        atualizado_em: serverTimestamp(),
      });

      setSent(true);
      setForm(EMPTY_FORM);
      onCreated();
    } catch {
      setError("Não foi possível enviar o chamado. Tente novamente.");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
          <CheckCircle2 className="h-7 w-7 text-emerald-600" />
        </div>
        <p className="text-lg font-bold text-slate-950">Chamado aberto com sucesso!</p>
        <p className="max-w-sm text-sm text-slate-600">
          Seu chamado foi registrado. Nossa equipe entrará em contato em breve.
          Acompanhe o status na aba <strong>Chamados abertos</strong>.
        </p>
        <button
          type="button"
          onClick={() => setSent(false)}
          className="mt-2 rounded-2xl bg-slate-950 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          Abrir novo chamado
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-2xl space-y-5 py-2">
      {/* Dados do solicitante — somente leitura */}
      <div className="grid grid-cols-1 gap-4 rounded-2xl border border-slate-100 bg-slate-50 p-4 sm:grid-cols-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Nome</p>
          <p className="mt-0.5 text-sm font-medium text-slate-700">{userName || "—"}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">E-mail</p>
          <p className="mt-0.5 truncate text-sm font-medium text-slate-700">{userEmail}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Escola</p>
          <p className="mt-0.5 text-sm font-medium text-slate-700">{userEscola || "Não informada"}</p>
        </div>
      </div>

      {/* Assunto */}
      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
          Assunto <span className="text-rose-500">*</span>
        </label>
        <input
          type="text"
          required
          value={form.assunto}
          onChange={(e) => set("assunto", e.target.value)}
          placeholder="Descreva brevemente o seu problema ou dúvida"
          className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-950"
        />
      </div>

      {/* Categoria + Prioridade */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
            Categoria <span className="text-rose-500">*</span>
          </label>
          <select
            required
            value={form.categoria}
            onChange={(e) => set("categoria", e.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-950 bg-white"
          >
            <option value="duvida">Dúvida</option>
            <option value="problema_tecnico">Problema técnico</option>
            <option value="sugestao">Sugestão</option>
            <option value="elogio">Elogio</option>
            <option value="outro">Outro</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
            Prioridade
          </label>
          <select
            value={form.prioridade}
            onChange={(e) => set("prioridade", e.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-950 bg-white"
          >
            <option value="baixa">Baixa</option>
            <option value="normal">Normal</option>
            <option value="alta">Alta</option>
            <option value="urgente">Urgente</option>
          </select>
        </div>
      </div>

      {/* Mensagem */}
      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
          Mensagem <span className="text-rose-500">*</span>
        </label>
        <textarea
          required
          rows={6}
          value={form.mensagem}
          onChange={(e) => set("mensagem", e.target.value)}
          placeholder="Descreva em detalhes o que aconteceu, incluindo os passos para reproduzir o problema (se aplicável)…"
          className="w-full resize-none rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-950"
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-500" />
          <p className="text-sm text-rose-700">{error}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={sending}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 py-3.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 sm:w-auto sm:px-8"
      >
        {sending ? (
          <><Loader2 className="h-4 w-4 animate-spin" />Enviando…</>
        ) : (
          <><Send className="h-4 w-4" />Abrir chamado</>
        )}
      </button>
    </form>
  );
}

// ─── Ticket card ──────────────────────────────────────────────────────────────

function TicketCard({ ticket }: { ticket: Ticket }) {
  const CATEGORIA_LABEL: Record<string, string> = {
    duvida:           "Dúvida",
    problema_tecnico: "Problema técnico",
    sugestao:         "Sugestão",
    elogio:           "Elogio",
    outro:            "Outro",
  };

  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 transition hover:border-slate-200">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] font-bold text-slate-400">
              #{ticket.protocolo.toUpperCase()}
            </span>
            <span className={["rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide", STATUS_CLASS[ticket.status]].join(" ")}>
              {STATUS_LABEL[ticket.status]}
            </span>
            <span className={["rounded-full px-2.5 py-0.5 text-[10px] font-semibold", PRIORIDADE_CLASS[ticket.prioridade] ?? "bg-slate-100 text-slate-500"].join(" ")}>
              {ticket.prioridade.charAt(0).toUpperCase() + ticket.prioridade.slice(1)}
            </span>
          </div>
          <p className="mt-1.5 font-semibold text-slate-900">{ticket.assunto}</p>
          <p className="mt-0.5 text-xs text-slate-500">{CATEGORIA_LABEL[ticket.categoria] ?? ticket.categoria}</p>
          <p className="mt-2 line-clamp-2 text-sm text-slate-600">{ticket.mensagem}</p>
        </div>
        <p className="shrink-0 text-[11px] text-slate-400">{fmtDate(ticket.criado_em)}</p>
      </div>
    </div>
  );
}

// ─── Main tabs component ──────────────────────────────────────────────────────

export function SuporteTabs({ userId, userName, userEmail, userEscola }: Props) {
  const [tab, setTab] = useState<Tab>("novo");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);

  async function fetchTickets() {
    setLoadingTickets(true);
    try {
      const q = query(
        collection(firebaseDb, "magis_suporte"),
        where("user_id", "==", userId),
        orderBy("criado_em", "desc"),
      );
      const snap = await getDocs(q);
      const list: Ticket[] = snap.docs.map((doc) => {
        const d = doc.data();
        const raw = d.criado_em;
        const dt: Date | null = raw && typeof raw.toDate === "function" ? (raw.toDate() as Date) : null;
        return {
          id:         doc.id,
          protocolo:  doc.id.slice(0, 8),
          assunto:    String(d.assunto ?? ""),
          categoria:  String(d.categoria ?? ""),
          prioridade: String(d.prioridade ?? "normal"),
          mensagem:   String(d.mensagem ?? ""),
          status:     (d.status as TicketStatus) ?? "aberto",
          criado_em:  dt,
        };
      });
      setTickets(list);
    } catch {
      // silent — user will see empty state
    } finally {
      setLoadingTickets(false);
    }
  }

  useEffect(() => {
    void fetchTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const abertos    = tickets.filter((t) => t.status === "aberto" || t.status === "em_atendimento");
  const encerrados = tickets.filter((t) => t.status === "resolvido" || t.status === "encerrado");

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: "novo",       label: "Novo chamado" },
    { id: "abertos",    label: "Chamados abertos",    count: abertos.length },
    { id: "encerrados", label: "Chamados encerrados", count: encerrados.length },
  ];

  return (
    <div>
      {/* Tab bar — mesmo padrão do Histórico */}
      <div className="flex w-fit gap-1 rounded-2xl border border-slate-200 bg-slate-100 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={[
              "flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition",
              tab === t.id
                ? "bg-white text-slate-950 shadow-sm"
                : "text-slate-500 hover:text-slate-800",
            ].join(" ")}
          >
            {t.id === "novo"       && <MessageSquarePlus className="h-4 w-4" />}
            {t.id === "abertos"    && <Clock className="h-4 w-4" />}
            {t.id === "encerrados" && <TicketCheck className="h-4 w-4" />}
            {t.label}
            {t.count !== undefined && (
              <span className={[
                "rounded-full px-2 py-0.5 text-xs font-semibold",
                tab === t.id ? "bg-slate-100 text-slate-700" : "bg-slate-200 text-slate-500",
              ].join(" ")}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="mt-6">
        {tab === "novo" && (
          <NovoChamadoForm
            userId={userId}
            userName={userName}
            userEmail={userEmail}
            userEscola={userEscola}
            onCreated={() => {
              void fetchTickets();
              setTab("abertos");
            }}
          />
        )}

        {(tab === "abertos" || tab === "encerrados") && (
          <div>
            {loadingTickets ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : (
              <div className="space-y-3">
                {(tab === "abertos" ? abertos : encerrados).length === 0 ? (
                  <div className="py-12 text-center">
                    <p className="text-sm text-slate-500">
                      {tab === "abertos"
                        ? "Nenhum chamado aberto no momento."
                        : "Nenhum chamado encerrado ainda."}
                    </p>
                  </div>
                ) : (
                  (tab === "abertos" ? abertos : encerrados).map((ticket) => (
                    <TicketCard key={ticket.id} ticket={ticket} />
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
