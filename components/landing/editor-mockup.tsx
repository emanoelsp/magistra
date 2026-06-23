import { Sparkles } from "lucide-react";

interface EditorMockupProps {
  variant?: "compact" | "full";
  className?: string;
}

export function EditorMockup({ variant = "full", className = "" }: EditorMockupProps) {
  const isCompact = variant === "compact";

  const formFields = isCompact
    ? [
        { label: "Turma", val: "9º Ano B" },
        { label: "Disciplina", val: "Matemática" },
        { label: "Bimestre", val: "2º Bimestre / 2026" },
        { label: "Conteúdo", val: "Equações do 2º grau" },
      ]
    : [
        { label: "Turma", val: "9º Ano B" },
        { label: "Disciplina", val: "Matemática" },
        { label: "Bimestre", val: "2º Bimestre · 2026" },
        { label: "Conteúdo", val: "Equações do 2º grau — Fórmula de Báskara" },
        { label: "Metodologia", val: "Resolução de problemas + Aula dialogada" },
      ];

  const suggestions = isCompact
    ? [
        "EF09MA06 alinhada ao SAEB T5",
        "Competência 3 — Argumentação matemática",
        "Obj.: compreender a fórmula de Báskara",
      ]
    : [
        {
          code: "EF09MA07",
          desc: "Indicar a relação entre as raízes e os coeficientes da equação — Descritora D33.",
        },
        {
          code: "Competência 3",
          desc: "Argumentação: elaborar e testar conjecturas a partir de situações-problema.",
        },
      ];

  return (
    <div className={`overflow-hidden rounded-3xl shadow-2xl shadow-slate-300/60 ring-1 ring-slate-200 ${className}`}>
      <div className={`flex items-center gap-2 border-b border-slate-200 bg-slate-100 ${isCompact ? "px-4 py-3" : "px-5 py-3.5"}`}>
        <div className="h-3 w-3 rounded-full bg-rose-400" />
        <div className="h-3 w-3 rounded-full bg-amber-400" />
        <div className="h-3 w-3 rounded-full bg-emerald-400" />
        <div
          className={`ml-3 flex-1 rounded-md border border-slate-200 bg-white font-mono text-slate-400 ${
            isCompact ? "px-3 py-1 text-[10px]" : "px-3 py-1.5 text-xs"
          }`}
        >
          planomagistra.com.br/dashboard/editor
        </div>
      </div>

      <div className={`flex items-center justify-between border-b border-slate-100 bg-white ${isCompact ? "px-4 py-2.5" : "px-6 py-3.5"}`}>
        <div>
          <p className={`font-bold uppercase tracking-widest text-slate-400 ${isCompact ? "text-[9px]" : "text-[10px]"}`}>
            Plano de Aula
          </p>
          <p className={`font-semibold text-slate-800 ${isCompact ? "text-xs" : "text-sm"}`}>
            9º Ano B — Matemática
          </p>
        </div>
        <div className="flex gap-2">
          {!isCompact && (
            <span className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600">
              Rascunho
            </span>
          )}
          {isCompact && (
            <span className="rounded-xl border border-slate-200 px-2.5 py-1.5 text-[10px] font-medium text-slate-600">
              Salvar
            </span>
          )}
          <span
            className={`rounded-xl bg-emerald-600 font-bold text-white ${
              isCompact ? "px-2.5 py-1.5 text-[10px]" : "px-3 py-2 text-xs"
            }`}
          >
            ↓ Baixar PDF
          </span>
        </div>
      </div>

      <div className={`grid divide-x divide-slate-100 bg-white ${isCompact ? "grid-cols-[1fr,1fr]" : "lg:grid-cols-[1fr,380px]"}`}>
        <div className={isCompact ? "space-y-2 p-4" : "p-6"}>
          <p
            className={`font-bold uppercase tracking-widest text-slate-400 ${
              isCompact ? "mb-2 text-[9px]" : "mb-4 text-[10px]"
            }`}
          >
            Campos do template
          </p>
          <div className={isCompact ? "space-y-2" : "space-y-3"}>
            {formFields.map((f) => (
              <div
                key={f.label}
                className={
                  isCompact
                    ? "rounded-xl bg-slate-50 p-2.5"
                    : "rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3"
                }
              >
                <p
                  className={`mb-0.5 font-bold uppercase tracking-wider text-slate-400 ${
                    isCompact ? "text-[9px]" : "text-[9px]"
                  }`}
                >
                  {f.label}
                </p>
                <p className={`text-slate-700 ${isCompact ? "text-xs font-medium" : "text-sm"}`}>{f.val}</p>
              </div>
            ))}

            <div
              className={
                isCompact
                  ? "rounded-xl border-2 border-violet-300 bg-violet-50 p-2.5 ring-2 ring-violet-100/60"
                  : "rounded-2xl border-2 border-violet-300 bg-violet-50 px-4 py-3 ring-2 ring-violet-100/60"
              }
            >
              <div className={`flex items-center ${isCompact ? "mb-1 gap-1" : "mb-2 gap-1.5"}`}>
                <Sparkles className={isCompact ? "h-3 w-3 text-violet-500" : "h-3.5 w-3.5 text-violet-500"} />
                <p
                  className={`font-bold uppercase tracking-wider text-violet-600 ${
                    isCompact ? "text-[9px]" : "text-[9px]"
                  }`}
                >
                  Habilidade BNCC · {isCompact ? "IA ativa" : "Magis sugerindo…"}
                </p>
              </div>
              <p className={`leading-relaxed text-slate-700 ${isCompact ? "text-[11px]" : "text-sm"}`}>
                EF09MA06 — Resolver e elaborar problemas que envolvam equações polinomiais do 2º grau…
              </p>
              <div className={`${isCompact ? "mt-2 flex gap-1.5" : "mt-3 flex gap-2"}`}>
                <span
                  className={`rounded-xl bg-violet-600 font-bold text-white ${
                    isCompact ? "rounded-lg px-2.5 py-1 text-[10px]" : "px-3 py-1.5 text-xs"
                  }`}
                >
                  Inserir
                </span>
                <span
                  className={`border border-slate-200 bg-white text-slate-500 ${
                    isCompact ? "rounded-lg px-2 py-1 text-[10px]" : "rounded-xl px-3 py-1.5 text-xs"
                  }`}
                >
                  Reescrever
                </span>
              </div>
            </div>

            {!isCompact && (
              <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-3 opacity-50">
                <p className="mb-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">Avaliação</p>
                <p className="text-sm italic text-slate-400">Foque aqui para pedir sugestão à Magis…</p>
              </div>
            )}
          </div>
        </div>

        <div className={`flex flex-col bg-slate-950 ${isCompact ? "gap-2.5 p-4" : "gap-3 p-6"}`}>
          <div className="mb-1 flex items-center gap-2">
            <div
              className={`flex items-center justify-center rounded-xl bg-violet-600 ${
                isCompact ? "h-5 w-5 rounded-full" : "h-7 w-7"
              }`}
            >
              <Sparkles className={isCompact ? "h-3 w-3 text-white" : "h-4 w-4 text-white"} />
            </div>
            {isCompact ? (
              <span className="text-[9px] font-bold uppercase tracking-widest text-violet-400">Magis sugere</span>
            ) : (
              <div>
                <p className="text-xs font-bold text-white">Magis</p>
                <p className="text-[9px] text-violet-400">Assistente Pedagógica IA</p>
              </div>
            )}
            {!isCompact && (
              <div className="ml-auto flex gap-1">
                <span className="dot-1 h-2 w-2 rounded-full bg-emerald-400" />
                <span className="dot-2 h-2 w-2 rounded-full bg-emerald-400" />
                <span className="dot-3 h-2 w-2 rounded-full bg-emerald-400" />
              </div>
            )}
          </div>

          {isCompact ? (
            <>
              <div className="rounded-xl border border-violet-500/40 bg-violet-900/30 p-2.5">
                <p className="text-[10px] leading-relaxed text-slate-200">{suggestions[0] as string}</p>
              </div>
              {(suggestions as string[]).slice(1).map((s, i) => (
                <div key={i} className="rounded-xl border border-slate-700 bg-slate-800 p-2.5">
                  <p className="text-[10px] leading-relaxed text-slate-300">{s}</p>
                </div>
              ))}
            </>
          ) : (
            <>
              <p className="text-[10px] text-slate-400">
                Sugestões para <span className="font-bold text-violet-300">Habilidade BNCC</span>:
              </p>
              <div className="rounded-xl border border-violet-500/40 bg-violet-900/30 p-3">
                <p className="text-[11px] font-semibold leading-relaxed text-violet-200">EF09MA06</p>
                <p className="mt-1 text-[10px] leading-relaxed text-slate-300">
                  Resolver e elaborar problemas que envolvam equações polinomiais do 2º grau — alinhada ao SAEB Tema 5,
                  Descritora D32.
                </p>
              </div>
              {(suggestions as { code: string; desc: string }[]).map((s, i) => (
                <div key={i} className="rounded-xl border border-slate-700 bg-slate-800 p-3">
                  <p className="text-[10px] font-bold text-slate-300">{s.code}</p>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-slate-400">{s.desc}</p>
                </div>
              ))}
            </>
          )}

          <div className={`flex items-center gap-1.5 ${isCompact ? "px-1 py-1" : "px-1"}`}>
            <span className="dot-1 h-1.5 w-1.5 rounded-full bg-violet-400" />
            <span className="dot-2 h-1.5 w-1.5 rounded-full bg-violet-400" />
            <span className="dot-3 h-1.5 w-1.5 rounded-full bg-violet-400" />
            <span className="ml-1 text-[9px] text-slate-500">
              Magis está gerando{isCompact ? "…" : " mais sugestões…"}
            </span>
          </div>

          <div className={`mt-auto rounded-xl bg-emerald-600/90 text-center ${isCompact ? "p-2.5" : "p-3"}`}>
            <p className={`font-bold text-white ${isCompact ? "text-[10px]" : "text-xs"}`}>
              ✓ 6 / 8 campos preenchidos
            </p>
            {!isCompact && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-emerald-900/40">
                <div className="h-full w-[75%] rounded-full bg-emerald-300" />
              </div>
            )}
            <p className={`text-emerald-200 ${isCompact ? "mt-0.5 text-[9px]" : "mt-1.5 text-[9px]"}`}>
              Pronto para baixar em PDF
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
