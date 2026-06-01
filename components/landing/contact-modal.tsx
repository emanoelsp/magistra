"use client";

import { useState } from "react";
import { X, Loader2, MessageCircle, CheckCircle2 } from "lucide-react";

export function ContactModal() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({ nome: "", email: "", assunto: "", mensagem: "" });

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/contato", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Erro ao enviar mensagem.");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado.");
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    setOpen(false);
    setTimeout(() => { setDone(false); setError(null); setForm({ nome: "", email: "", assunto: "", mensagem: "" }); }, 300);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-2xl border border-violet-500/40 bg-violet-500/10 px-6 py-3 text-sm font-semibold text-violet-300 transition hover:border-violet-400 hover:bg-violet-500/20 hover:text-violet-200"
      >
        <MessageCircle className="h-4 w-4" />
        Falar com a equipe
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={handleClose} />
          <div className="relative w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-2xl">
            <button
              onClick={handleClose}
              className="absolute right-5 top-5 rounded-xl p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-5 w-5" />
            </button>

            {done ? (
              <div className="py-6 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
                  <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                </div>
                <h3 className="mt-5 text-xl font-bold text-slate-950">Mensagem enviada!</h3>
                <p className="mt-2 text-sm text-slate-500">Entraremos em contato em breve pelo seu e-mail.</p>
                <button
                  onClick={handleClose}
                  className="mt-6 rounded-2xl bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  Fechar
                </button>
              </div>
            ) : (
              <>
                <h3 className="text-xl font-bold text-slate-950">Tire suas dúvidas</h3>
                <p className="mt-1 text-sm text-slate-500">Nossa equipe responde em até 1 dia útil.</p>

                <form onSubmit={(e) => void handleSubmit(e)} className="mt-6 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-700">Nome</label>
                      <input
                        required
                        value={form.nome}
                        onChange={(e) => set("nome", e.target.value)}
                        placeholder="Seu nome"
                        className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-950"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-700">E-mail</label>
                      <input
                        required
                        type="email"
                        value={form.email}
                        onChange={(e) => set("email", e.target.value)}
                        placeholder="seu@email.com"
                        className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-950"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-700">Assunto</label>
                    <input
                      required
                      value={form.assunto}
                      onChange={(e) => set("assunto", e.target.value)}
                      placeholder="Como podemos ajudar?"
                      className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-950"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-700">Mensagem</label>
                    <textarea
                      required
                      rows={4}
                      value={form.mensagem}
                      onChange={(e) => set("mensagem", e.target.value)}
                      placeholder="Conte mais sobre sua dúvida..."
                      className="w-full resize-none rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-950"
                    />
                  </div>

                  {error && <p className="text-center text-xs text-rose-600">{error}</p>}

                  <button
                    type="submit"
                    disabled={loading}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Enviar mensagem
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
