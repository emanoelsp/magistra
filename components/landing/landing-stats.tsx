export function LandingStats() {
  return (
    <section className="bg-slate-950 py-7" aria-label="Indicadores">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          {[
            { n: "-70%", label: "menos tempo de planejamento", color: "text-violet-400" },
            { n: "Minutos", label: "do template ao documento pronto", color: "text-emerald-400" },
            { n: "100%", label: "alinhado à BNCC e SAEB", color: "text-white" },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <p className={`text-3xl font-black ${s.color}`}>{s.n}</p>
              <p className="mt-1 text-xs text-slate-400">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
