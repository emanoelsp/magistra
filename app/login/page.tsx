 "use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";

import { firebaseAuth, firebaseDb } from "../../lib/firebase/client";

type Mode = "login" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const authFn =
        mode === "signup" ? createUserWithEmailAndPassword : signInWithEmailAndPassword;

      const credentials = await authFn(firebaseAuth, email, password);

      const isNewUser = mode === "signup";

      if (isNewUser) {
        const userRef = doc(firebaseDb, "users", credentials.user.uid);
        await setDoc(
          userRef,
          {
            uid: credentials.user.uid,
            nome: credentials.user.displayName ?? "",
            email: credentials.user.email ?? email,
            escola_padrao: null,
            plano: "free",
            tokens_usados_mes: 0,
            onboarding_concluido: false,
          },
          { merge: true },
        );
      }

      const idToken = await credentials.user.getIdToken(true);

      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });

      if (!response.ok) {
        throw new Error("Não foi possível criar a sessão segura.");
      }

      router.push(isNewUser ? "/onboarding" : "/dashboard");
      router.refresh();
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Erro ao autenticar. Verifique os dados digitados.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-10">
      <section className="w-full max-w-md rounded-[2rem] border border-slate-200 bg-white p-8 text-center shadow-sm">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-950 text-white">
          <LockKeyhole className="h-5 w-5" />
        </span>

        <h1 className="mt-6 text-3xl font-semibold tracking-tight text-slate-950">
          {mode === "login" ? "Entrar" : "Criar conta"}
        </h1>
        <p className="mt-4 text-sm leading-7 text-slate-600">
          Use seu e-mail e uma senha para {mode === "login" ? "acessar" : "criar"} sua conta no PlanoMestre.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4 text-left">
          <div className="space-y-1">
            <label htmlFor="email" className="text-sm font-medium text-slate-700">
              E-mail
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-0 transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="password" className="text-sm font-medium text-slate-700">
              Senha
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-0 transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 inline-flex w-full items-center justify-center rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading
              ? mode === "login"
                ? "Entrando..."
                : "Criando conta..."
              : mode === "login"
                ? "Entrar"
                : "Criar conta"}
          </button>
        </form>

        <p className="mt-4 text-sm text-slate-600">
          {mode === "login" ? "Ainda não tem conta?" : "Já tem conta?"}{" "}
          <button
            type="button"
            onClick={() => setMode(mode === "login" ? "signup" : "login")}
            className="font-semibold text-slate-900 underline-offset-2 hover:underline"
          >
            {mode === "login" ? "Criar conta" : "Fazer login"}
          </button>
        </p>
      </section>
    </main>
  );
}
