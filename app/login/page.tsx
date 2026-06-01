"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";

import { firebaseAuth, firebaseDb } from "../../lib/firebase/client";

type Mode = "login" | "signup" | "forgot";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotSent, setForgotSent] = useState(false);

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
        const userRef = doc(firebaseDb, "magis_users", credentials.user.uid);
        await setDoc(
          userRef,
          {
            uid: credentials.user.uid,
            nome: credentials.user.displayName ?? "",
            email: credentials.user.email ?? email,
            escola_padrao: null,
            plano: "medio",
            plano_validade: null,
            tokens_usados_mes: 0,
            onboarding_concluido: false,
            role: "professor",
            data_criacao: new Date().toISOString(),
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

      const next = searchParams.get("next");
      const destination = isNewUser ? "/onboarding" : (next && next.startsWith("/") ? next : "/dashboard");
      router.push(destination);
      router.refresh();
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Erro ao autenticar. Verifique os dados digitados.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await sendPasswordResetEmail(firebaseAuth, email);
      setForgotSent(true);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "auth/user-not-found" || code === "auth/invalid-credential") {
        setError("Não encontramos uma conta com este e-mail.");
      } else if (code === "auth/invalid-email") {
        setError("E-mail inválido.");
      } else {
        setError("Não foi possível enviar o e-mail. Tente novamente.");
      }
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
          {mode === "login" ? "Entrar" : mode === "signup" ? "Criar conta" : "Redefinir senha"}
        </h1>
        <p className="mt-4 text-sm leading-7 text-slate-600">
          {mode === "login"
            ? "Use seu e-mail e uma senha para acessar sua conta no PlanoMagistra."
            : mode === "signup"
              ? "Use seu e-mail e uma senha para criar sua conta no PlanoMagistra."
              : "Informe seu e-mail e enviaremos um link para você redefinir sua senha."}
        </p>

        {mode === "forgot" ? (
          forgotSent ? (
            <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-left">
              <p className="text-sm font-medium text-emerald-800">E-mail enviado!</p>
              <p className="mt-1 text-sm text-emerald-700">
                Verifique sua caixa de entrada e siga o link para redefinir sua senha.
              </p>
              <button
                type="button"
                onClick={() => { setMode("login"); setForgotSent(false); setEmail(""); setError(null); }}
                className="mt-4 text-sm font-semibold text-slate-900 underline-offset-2 hover:underline"
              >
                Voltar ao login
              </button>
            </div>
          ) : (
            <form onSubmit={handleForgotPassword} className="mt-6 space-y-4 text-left">
              <div className="space-y-1">
                <label htmlFor="email" className="text-sm font-medium text-slate-700">
                  E-mail
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-0 transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
                />
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="mt-2 inline-flex w-full items-center justify-center rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "Enviando..." : "Enviar link de redefinição"}
              </button>

              <p className="text-center text-sm text-slate-600">
                <button
                  type="button"
                  onClick={() => { setMode("login"); setError(null); }}
                  className="font-semibold text-slate-900 underline-offset-2 hover:underline"
                >
                  Voltar ao login
                </button>
              </p>
            </form>
          )
        ) : (
          <>
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
                <div className="flex items-center justify-between">
                  <label htmlFor="password" className="text-sm font-medium text-slate-700">
                    Senha
                  </label>
                  {mode === "login" && (
                    <button
                      type="button"
                      onClick={() => { setMode("forgot"); setError(null); }}
                      className="text-xs text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline"
                    >
                      Esqueceu a senha?
                    </button>
                  )}
                </div>
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

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="mt-2 inline-flex w-full items-center justify-center rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading
                  ? mode === "login" ? "Entrando..." : "Criando conta..."
                  : mode === "login" ? "Entrar" : "Criar conta"}
              </button>
            </form>

            <p className="mt-4 text-sm text-slate-600">
              {mode === "login" ? "Ainda não tem conta?" : "Já tem conta?"}{" "}
              <button
                type="button"
                onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(null); }}
                className="font-semibold text-slate-900 underline-offset-2 hover:underline"
              >
                {mode === "login" ? "Criar conta" : "Fazer login"}
              </button>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
