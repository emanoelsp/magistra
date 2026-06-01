"use client";

import { useState } from "react";
import { CheckCircle2, Clock, Loader2, MessageSquare, RefreshCw, Tag } from "lucide-react";

export interface AdminMensagem {
  id: string;
  origem: "contato" | "suporte";
  tipo: string;
  nome: string;
  email: string;
  assunto: string;
  mensagem: string;
  status: string;
  created_at: string;
  resposta?: string;
  prioridade?: string;
}

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  aberto:         { label: "Aberto",         cls: "bg-rose-100 text-rose-700" },
  em_andamento:   { label: "Em andamento",   cls: "bg-amber-100 text-amber-700" },
  em_atendimento: { label: "Em atendimento", cls: "bg-amber-100 text-amber-700" },
  resolvido:      { label: "Resolvido",      cls: "bg-emerald-100 text-emerald-700" },
  encerrado:      { label: "Encerrado",      cls: "bg-slate-100 text-slate-600" },
};

const PRIORIDADE_CONFIG: Record<string, string> = {
  baixa:   "bg-slate-100 text-slate-500",
  normal:  "bg-blue-100 text-blue-600",
  alta:    "bg-amber-100 text-amber-700",
  urgente: "bg-rose-100 text-rose-700",
};

type FilterStatus = "todos" | "aberto" | "em_andamento" | "resolvido";

export function MensagensClient({ mensagens: initial }: { mensagens: AdminMensagem[] }) {
  const [mensagens, setMensagens] = useState(initial);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [resposta, setResposta] = useState("");
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<FilterStatus>("todos");
  const [origem, setOrigem] = useState<"todos" | "contato" | "suporte">("todos");

  function matchesStatus(m: AdminMensagem) {
    if (filter === "todos") return true;
    if (filter === "aberto") return m.status === "aberto";
    if (filter === "em_andamento") return m.status === "em_andamento" || m.status === "em_atendimento";
    if (filter === "resolvido") return m.status === "resolvido" || m.status === "encerrado";
    return true;
  }

  const filtered = mensagens.filter((m) => matchesStatus(m) && (origem === "todos" || m.origem === origem));

  const collection = (m: AdminMensagem) => m.origem === "suporte" ? "magis_suporte" : "magis_messages";

  async function updateStatus(m: AdminMensagem, status: string) {
    const fieldStatus = m.origem === "suporte" && status === "em_andamento" ? "em_atendimento" : status;
    const body = m.origem === "suporte"
      ? { status: fieldStatus, atualizado_em: new Date().toISOString() }
      : { status: fieldStatus };

    await fetch(`/api/admin/mensagens/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, collection: collection(m) }),
    });
    setMensagens((prev) => prev.map((x) => x.id === m.id ? { ...x, status: fieldStatus } : x));
  }

  async function enviarResposta(m: AdminMensagem) {
    if (!resposta.trim()) return;
    setSaving(true);
    try {
      await fetch(`/api/admin/mensagens/${m.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resposta: resposta.trim(),
          status: m.origem === "suporte" ? "resolvido" : "resolvido",
          collection: collection(m),
        }),
      });
      setMensagens((prev) => prev.map((x) =>
        x.id === m.id ? { ...x, resposta: resposta.trim(), status: "resolvido" } : x,
      ));
      setActiveId(null);
      setResposta("");
    } finally {
      setSaving(false);
    }
  }

  const counts = {
    todos: mensagens.length,
    aberto: mensagens.filter((m) => m.status === "aberto").length,
    em_andamento: mensagens.filter((m) => m.status === "em_andamento" || m.status === "em_atendimento").length,
    resolvido: mensagens.filter((m) => m.status === "resolvido" || m.status === "encerrado").length,
  };

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
          {(["todos", "aberto", "em_andamento", "resolvido"] as FilterStatus[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-1 text-xs font-medium transition ${filter === f ? "bg-white shadow-sm text-slate-950" : "text-slate-500 hover:text-slate-700"}`}
            >
              {f === "todos" ? "Todos" : f === "aberto" ? "Abertos" : f === "em_andamento" ? "Em andamento" : "Resolvidos"}
              <span className="ml-1 opacity-60">({counts[f]})</span>
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
          {(["todos", "contato", "suporte"] as const).map((o) => (
            <button
              key={o}
              onClick={() => setOrigem(o)}
              className={`rounded-lg px-3 py-1 text-xs font-medium transition ${origem === o ? "bg-white shadow-sm text-slate-950" : "text-slate-500 hover:text-slate-700"}`}
            >
              {o === "todos" ? "Todos" : o === "contato" ? "Contato" : "Suporte"}
            </button>
          ))}
        </div>
      </div>

      {/* Lista */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center">
          <MessageSquare className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm text-slate-500">Nenhuma mensagem encontrada.</p>
        </div>
      ) : (
        filtered.map((m) => {
          const sc = STATUS_CONFIG[m.status] ?? STATUS_CONFIG.aberto;
          const isOpen = activeId === m.id;
          const isResolved = m.status === "resolvido" || m.status === "encerrado";
          return (
            <div key={m.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${sc.cls}`}>{sc.label}</span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${m.origem === "suporte" ? "bg-violet-100 text-violet-700" : "bg-blue-100 text-blue-700"}`}>
                      {m.origem === "suporte" ? "Suporte" : "Contato"}
                    </span>
                    {m.prioridade && m.prioridade !== "normal" && (
                      <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${PRIORIDADE_CONFIG[m.prioridade] ?? ""}`}>
                        <Tag className="h-2.5 w-2.5" /> {m.prioridade}
                      </span>
                    )}
                    <span className="text-xs text-slate-400">{m.created_at.slice(0, 16).replace("T", " ")}</span>
                  </div>
                  <p className="mt-2 font-semibold text-slate-950">{m.assunto}</p>
                  <p className="text-xs text-slate-500">{m.nome} · {m.email}</p>
                  <p className="mt-2 text-sm text-slate-700 whitespace-pre-line line-clamp-4">{m.mensagem}</p>
                  {m.resposta && (
                    <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                      <p className="text-xs font-semibold text-emerald-700 mb-1">Resposta registrada</p>
                      <p className="text-sm text-emerald-900 whitespace-pre-line">{m.resposta}</p>
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 flex-col gap-2">
                  {!isResolved && m.status === "aberto" && (
                    <button onClick={() => void updateStatus(m, "em_andamento")}
                      className="flex items-center gap-1 rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-950">
                      <Clock className="h-3 w-3" /> Em andamento
                    </button>
                  )}
                  {!isResolved && (
                    <button onClick={() => void updateStatus(m, "resolvido")}
                      className="flex items-center gap-1 rounded-xl border border-emerald-300 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50">
                      <CheckCircle2 className="h-3 w-3" /> Resolver
                    </button>
                  )}
                  {isResolved && (
                    <button onClick={() => void updateStatus(m, "aberto")}
                      className="flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:border-slate-400">
                      <RefreshCw className="h-3 w-3" /> Reabrir
                    </button>
                  )}
                  <button
                    onClick={() => { setActiveId(isOpen ? null : m.id); setResposta(m.resposta ?? ""); }}
                    className="flex items-center gap-1 rounded-xl bg-slate-950 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800">
                    <MessageSquare className="h-3 w-3" /> Responder
                  </button>
                </div>
              </div>

              {isOpen && (
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <textarea
                    value={resposta}
                    onChange={(e) => setResposta(e.target.value)}
                    rows={4}
                    placeholder="Resposta interna (registro)…"
                    className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-950 resize-none"
                  />
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => void enviarResposta(m)} disabled={saving || !resposta.trim()}
                      className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-xs font-medium text-white disabled:opacity-50">
                      {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                      Salvar e resolver
                    </button>
                    <button onClick={() => { setActiveId(null); setResposta(""); }}
                      className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-medium text-slate-600">
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
