import { EditorMockup } from "./editor-mockup";

export function LandingDemo() {
  return (
    <section id="demo" className="py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-12 text-center">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-violet-600">Demonstração</p>
          <h2 className="text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
            Veja o editor
            <br />
            <span className="wordmark-accent">em ação.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-lg text-slate-500">
            Foque em um campo e a Magis gera sugestões pedagógicas precisas na hora — BNCC, SAEB e currículo do seu
            território, sem digitar nada.
          </p>
        </div>

        <EditorMockup variant="full" />
      </div>
    </section>
  );
}
