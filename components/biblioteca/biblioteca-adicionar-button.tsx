"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Plus } from "lucide-react";

interface BibliotecaAdicionarButtonProps {
  templateId: string;
  templateNome: string;
  arquivoComVariaveis: string;
  disabled?: boolean;
}

export function BibliotecaAdicionarButton({
  templateId,
  templateNome,
  disabled = false,
}: BibliotecaAdicionarButtonProps) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleAdicionar() {
    if (status === "loading" || status === "done") return;
    setStatus("loading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/biblioteca/adicionar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Erro ao adicionar");
      }

      const data = (await res.json()) as { id: string };
      setStatus("done");
      setTimeout(() => {
        router.push(`/dashboard/templates/${data.id}/editar`);
      }, 800);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao adicionar";
      setStatus("error");
      setErrorMsg(msg);
    }
  }

  if (status === "done") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-2xl bg-emerald-100 px-4 py-2 text-xs font-semibold text-emerald-700">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Adicionado! Redirecionando…
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => void handleAdicionar()}
        disabled={disabled || status === "loading"}
        className="inline-flex items-center gap-1.5 rounded-2xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
        title={disabled ? "Limite de templates atingido" : `Adicionar "${templateNome}" aos meus templates`}
      >
        {status === "loading" ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Adicionando…
          </>
        ) : (
          <>
            <Plus className="h-3.5 w-3.5" />
            Adicionar aos meus templates
          </>
        )}
      </button>
      {status === "error" && (
        <p className="text-xs text-rose-600">{errorMsg}</p>
      )}
    </div>
  );
}
