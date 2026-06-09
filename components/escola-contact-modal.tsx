"use client";

import { useState } from "react";
import { Check, GraduationCap, Loader2, Send, X } from "lucide-react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";

import { firebaseDb } from "../lib/firebase/client";

interface FormState {
  nome: string;
  escola: string;
  telefone: string;
  email: string;
  mensagem: string;
}

const EMPTY: FormState = { nome: "", escola: "", telefone: "", email: "", mensagem: "" };

interface Props {
  className?: string;
  children?: React.ReactNode;
}

export function EscolaContactButton({ className, children }: Props) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    setOpen(false);
    if (sent) {
      setSent(false);
      setForm(EMPTY);
    }
    setError(null);
  }

  function set(key: keyof FormState, val: string) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      await addDoc(collection(firebaseDb, "magis_planoescola"), {
        nome: form.nome.trim(),
        escola: form.escola.trim(),
        telefone: form.telefone.trim(),
        email: form.email.trim(),
        mensagem: form.mensagem.trim(),
        criado_em: serverTimestamp(),
      });
      setSent(true);
    } catch {
      setError("Não foi possível enviar. Tente novamente.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {children ?? "Falar com nossa equipe"}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backdropFilter: "blur(6px)", backgroundColor: "rgba(15,23,42,0.55)" }}
          onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
        >
          <div className="relative w-full max-w-lg rounded-3xl bg-white p-8 shadow-2xl">
            {/* Close */}
            <button
              type="button"
              onClick={handleClose}
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200"
            >
              <X className="h-4 w-4" />
            </button>

            {/* Header */}
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white">
                <GraduationCap className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-950">Plano Escola</h2>
                <p className="text-sm text-slate-500">
                  Preencha e nossa equipe entra em contato em breve.
                </p>
              </div>
            </div>

            {sent ? (
              <div className="flex flex-col items-center gap-4 py-8 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
                  <Check className="h-7 w-7 text-emerald-600" />
                </div>
                <p className="text-lg font-bold text-slate-950">Mensagem enviada!</p>
                <p className="text-sm leading-relaxed text-slate-600">
                  Recebemos sua solicitação. Nossa equipe entrará em contato pelo e-mail ou
                  telefone informado em até 1 dia útil.
                </p>
                <button
                  type="button"
                  onClick={handleClose}
                  className="mt-2 rounded-2xl bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  Fechar
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Nome
                    </label>
                    <input
                      type="text"
                      required
                      value={form.nome}
                      onChange={(e) => set("nome", e.target.value)}
                      placeholder="Seu nome"
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-950"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Escola
                    </label>
                    <input
                      type="text"
                      required
                      value={form.escola}
                      onChange={(e) => set("escola", e.target.value)}
                      placeholder="Nome da instituição"
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-950"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Telefone
                    </label>
                    <input
                      type="tel"
                      required
                      value={form.telefone}
                      onChange={(e) => set("telefone", e.target.value)}
                      placeholder="(11) 99999-9999"
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-950"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                      E-mail
                    </label>
                    <input
                      type="email"
                      required
                      value={form.email}
                      onChange={(e) => set("email", e.target.value)}
                      placeholder="seu@email.com.br"
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-950"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Mensagem
                  </label>
                  <textarea
                    required
                    value={form.mensagem}
                    onChange={(e) => set("mensagem", e.target.value)}
                    placeholder="Conte sobre a sua escola e o que você precisa…"
                    rows={4}
                    className="w-full resize-none rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-950"
                  />
                </div>

                {error && <p className="text-sm text-rose-600">{error}</p>}

                <button
                  type="submit"
                  disabled={sending}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 py-3.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
                >
                  {sending ? (
                    <><Loader2 className="h-4 w-4 animate-spin" />Enviando…</>
                  ) : (
                    <><Send className="h-4 w-4" />Enviar mensagem</>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
